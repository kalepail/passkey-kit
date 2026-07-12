import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import base64url from "../base64url.js";
import { SignerKey } from "../types.js";
import { SIGNER_VAL_UDT } from "../kit/auth-payload.js";
import { deriveContractAddress } from "../utils.js";
import { MercuryIndexer, type MercurySignerRow } from "./mercury.js";
import { walletSpec } from "./codec.js";

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
