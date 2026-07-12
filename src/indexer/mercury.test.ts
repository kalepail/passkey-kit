import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import base64url from "../base64url.js";
import { SignerKey } from "../types.js";
import { SIGNER_VAL_UDT } from "../kit/auth-payload.js";
import { deriveContractAddress } from "../utils.js";
import { MercuryIndexer, type MercurySignerRow } from "./mercury.js";
import { signerKeyToContractScVal, walletSpec } from "./codec.js";

const TESTNET = "Test SDF Network ; September 2015";
const DEPLOYER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
const OTHER_WALLET = "CBQU3NIOXC3IDGERJWV3YVMSQSIOU2S6NSMH35OS3GPG6XARZFAAT2NL";

function secp256r1ValXdr(expiration?: number): string {
  return walletSpec()
    .nativeToScVal(
      {
        tag: "Secp256r1",
        values: [Buffer.alloc(65, 4), [expiration], [undefined]],
      },
      SIGNER_VAL_UDT
    )
    .toXDR("base64");
}

/** Stub global fetch, routing by the Zephyr `fname` in the request body. */
function stubFetch(byFname: Record<string, unknown>) {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    const fname = body.mode.Function.fname as string;
    return {
      ok: true,
      json: async () => byFname[fname],
      text: async () => "",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MercuryIndexer.getSigners", () => {
  it("maps rows to WalletSigners (live Secp256r1)", async () => {
    const keyId = base64url.encode(Buffer.alloc(16, 1));
    const rows: MercurySignerRow[] = [
      { kind: "Secp256r1", key: keyId, val: secp256r1ValXdr(4_000_000_000), storage: "Persistent" },
    ];
    stubFetch({ get_signers_by_address: rows });

    const indexer = new MercuryIndexer({
      url: "https://mercury.test",
      projectName: "proj",
      jwt: "jwt",
      now: () => 1000,
    });
    const signers = await indexer.getSigners("CWALLET");

    expect(signers).toHaveLength(1);
    expect(signers[0]!.key.key).toBe("Secp256r1");
    expect(signers[0]!.key.value).toBe(keyId);
    expect(signers[0]!.storage).toBe("persistent");
    expect(signers[0]!.status).toBe("live");
    expect(signers[0]!.publicKey).toHaveLength(65);
  });
});

describe("MercuryIndexer eviction probe (audit H2)", () => {
  const WALLET = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";
  const keyId = base64url.encode(Buffer.alloc(16, 5));

  function tempRow(): MercurySignerRow {
    return {
      kind: "Secp256r1",
      key: keyId,
      val: secp256r1ValXdr(4_000_000_000),
      storage: "Temporary",
    };
  }

  function fakeRpc(getLedgerEntries: ReturnType<typeof vi.fn>) {
    return { getLedgerEntries } as never;
  }

  it("probes by the SignerKey ScVal (not raw keyId bytes) and keeps a live temporary signer", async () => {
    stubFetch({ get_signers_by_address: [tempRow()] });
    // A present entry: readContractData resolves a non-null ScVal.
    const present = { contractData: () => ({ val: () => xdr.ScVal.scvVoid() }) };
    const getLedgerEntries = vi.fn(async () => ({ entries: [{ val: present }] }));
    const indexer = new MercuryIndexer({
      url: "https://mercury.test",
      projectName: "proj",
      jwt: "jwt",
      now: () => 1000,
      rpc: fakeRpc(getLedgerEntries),
    });

    const signers = await indexer.getSigners(WALLET);

    expect(signers[0]!.status).toBe("live");
    expect(getLedgerEntries).toHaveBeenCalledTimes(1);
    // The probed ledger key must carry the SignerKey vec, NOT scvBytes(keyId).
    const ledgerKey = getLedgerEntries.mock.calls[0]![0] as xdr.LedgerKey;
    const probedKey = ledgerKey.contractData().key();
    expect(probedKey.toXDR("base64")).toBe(
      signerKeyToContractScVal(SignerKey.Secp256r1(keyId)).toXDR("base64")
    );
    expect(probedKey.switch().name).toBe("scvVec");
  });

  it("marks a temporary signer evicted only on a genuine not-found", async () => {
    stubFetch({ get_signers_by_address: [tempRow()] });
    const indexer = new MercuryIndexer({
      url: "https://mercury.test",
      projectName: "proj",
      jwt: "jwt",
      now: () => 1000,
      rpc: fakeRpc(vi.fn(async () => ({ entries: [] }))),
    });

    const signers = await indexer.getSigners(WALLET);
    expect(signers[0]!.status).toBe("evicted");
  });

  it("does NOT evict on a transport error during the probe", async () => {
    stubFetch({ get_signers_by_address: [tempRow()] });
    const indexer = new MercuryIndexer({
      url: "https://mercury.test",
      projectName: "proj",
      jwt: "jwt",
      now: () => 1000,
      rpc: fakeRpc(
        vi.fn(async () => {
          throw new Error("429 too many requests");
        })
      ),
    });

    const signers = await indexer.getSigners(WALLET);
    expect(signers[0]!.status).toBe("live"); // left as reported, not false-evicted
  });
});

describe("MercuryIndexer.findWallets hardening", () => {
  it("keeps only the deterministically-derived candidate when no rpc is available", async () => {
    const keyId = base64url.encode(Buffer.alloc(16, 7));
    const derived = deriveContractAddress(
      base64url.toBuffer(keyId),
      DEPLOYER,
      TESTNET
    );
    stubFetch({ get_addresses_by_signer: [derived, OTHER_WALLET] });

    const indexer = new MercuryIndexer({
      url: "https://mercury.test",
      projectName: "proj",
      jwt: "jwt",
      hardening: { networkPassphrase: TESTNET, deployerPublicKey: DEPLOYER },
    });

    const wallets = await indexer.findWallets(SignerKey.Secp256r1(keyId));
    // OTHER_WALLET is dropped: not the derived address and no rpc to confirm it.
    expect(wallets).toEqual([derived]);
  });

  it("returns candidates unfiltered when neither rpc nor hardening is configured", async () => {
    stubFetch({ get_addresses_by_signer: [OTHER_WALLET] });
    const indexer = new MercuryIndexer({
      url: "https://mercury.test",
      projectName: "proj",
      jwt: "jwt",
    });
    const wallets = await indexer.findWallets(
      SignerKey.Secp256r1(base64url.encode(Buffer.alloc(16, 8)))
    );
    expect(wallets).toEqual([OTHER_WALLET]);
  });
});
