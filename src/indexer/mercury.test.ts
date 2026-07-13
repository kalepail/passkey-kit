import { afterEach, describe, expect, it, vi } from "vitest";
import { Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import base64url from "../base64url.js";
import { SignerKey } from "../types.js";
import { IndexerError } from "../errors.js";
import { deriveContractAddress } from "../utils.js";
import {
  MercuryIndexer,
  mercuryPasskeyIndexerUrl,
} from "./mercury.js";
import { signerKeyToContractScVal } from "./codec.js";

const TESTNET = Networks.TESTNET;
const DEPLOYER = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9)).publicKey();
const BASE = "https://testnet.mercurydata.app/rest/passkey-indexer";
const WALLET = "CC2R2H3DTXS7OCNV3FTNPAZYIRCY2L2OTBG5FZWJV63HXQ35WB2T2NWJ";
const OTHER_WALLET = "CBQU3NIOXC3IDGERJWV3YVMSQSIOU2S6NSMH35OS3GPG6XARZFAAT2NL";
const ED25519 = "GA5A447HNYRI52DHWLH2SCSQLNG2KHXP6ZY4RNFT63SVAQRO4VNQPDAI";
const CRED_HEX = "cc".repeat(32);
const PUBKEY_HEX = "04" + "ab".repeat(64);

/**
 * Stub the global fetch with a handler that returns a JSON body (and optional
 * status) per requested URL. Mirrors the passkey-indexer's `Response` surface.
 */
function stubFetch(
  handler: (url: string) => { status?: number; body?: unknown }
) {
  const mock = vi.fn(async (url: string | URL) => {
    const { status = 200, body } = handler(String(url));
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () =>
        typeof body === "string" ? body : JSON.stringify(body ?? ""),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function fakeRpc(getLedgerEntries: ReturnType<typeof vi.fn>) {
  return { getLedgerEntries } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mercuryPasskeyIndexerUrl", () => {
  it("resolves the hosted base per network, undefined otherwise", () => {
    expect(mercuryPasskeyIndexerUrl(Networks.TESTNET)).toBe(BASE);
    expect(mercuryPasskeyIndexerUrl(Networks.PUBLIC)).toBe(
      "https://mainnet.mercurydata.app/rest/passkey-indexer"
    );
    expect(mercuryPasskeyIndexerUrl(Networks.FUTURENET)).toBeUndefined();
  });

  it("forNetwork returns null on an unsupported network with no explicit url", () => {
    expect(MercuryIndexer.forNetwork({}, Networks.FUTURENET)).toBeNull();
    expect(
      MercuryIndexer.forNetwork({ url: "https://self.host" }, Networks.FUTURENET)
    ).toBeInstanceOf(MercuryIndexer);
  });
});

describe("MercuryIndexer.getSigners", () => {
  it("maps decoded JSON rows to WalletSigners", async () => {
    stubFetch(() => ({
      body: {
        contractId: WALLET,
        generation: "v1",
        signers: [
          {
            key: { type: "secp256r1", value: CRED_HEX },
            publicKey: PUBKEY_HEX,
            storage: "persistent",
            status: "live",
          },
          {
            key: { type: "ed25519", value: ED25519 },
            expiration: 1786422535,
            expiration_unit: "unix",
            limits: {},
            storage: "temporary",
            status: "live",
          },
        ],
      },
    }));

    const indexer = new MercuryIndexer({ url: BASE });
    const signers = await indexer.getSigners(WALLET);

    expect(signers).toHaveLength(2);

    const secp = signers[0]!;
    expect(secp.key.key).toBe("Secp256r1");
    // hex credential id decodes to the SDK's base64url keyId
    expect(secp.key.value).toBe(Buffer.from(CRED_HEX, "hex").toString("base64url"));
    expect(secp.publicKey).toHaveLength(65);
    expect(secp.expiration).toBeUndefined(); // never expires
    expect(secp.limits).toBeUndefined(); // absent limits => unlimited
    expect(secp.storage).toBe("persistent");
    expect(secp.status).toBe("live");

    const ed = signers[1]!;
    expect(ed.key.key).toBe("Ed25519");
    expect(ed.key.value).toBe(ED25519);
    expect(ed.expiration).toBe(1786422535);
    expect(ed.limits).toBeInstanceOf(Map);
    expect(ed.limits!.size).toBe(0); // `{}` => deny-all (empty Map)
    expect(ed.storage).toBe("temporary");
  });

  it("decodes scoped/any-key limits", async () => {
    stubFetch(() => ({
      body: {
        contractId: WALLET,
        generation: "v1",
        signers: [
          {
            key: { type: "policy", value: OTHER_WALLET },
            limits: {
              [OTHER_WALLET]: null,
              [WALLET]: [{ type: "ed25519", value: ED25519 }],
            },
            storage: "persistent",
            status: "live",
          },
        ],
      },
    }));

    const [signer] = await new MercuryIndexer({ url: BASE }).getSigners(WALLET);
    expect(signer!.key.key).toBe("Policy");
    expect(signer!.limits!.get(OTHER_WALLET)).toBeUndefined(); // null => any key
    const scoped = signer!.limits!.get(WALLET)!;
    expect(scoped).toHaveLength(1);
    expect(scoped[0]!.key).toBe("Ed25519");
    expect(scoped[0]!.value).toBe(ED25519);
  });

  it("carries no unix expiration for a legacy ledger-sequence signer", async () => {
    stubFetch(() => ({
      body: {
        contractId: WALLET,
        generation: "legacy",
        signers: [
          {
            key: { type: "secp256r1", value: CRED_HEX },
            publicKey: PUBKEY_HEX,
            expiration: 54309985,
            expiration_unit: "ledger",
            storage: "persistent",
            status: "expired",
          },
        ],
      },
    }));

    const [signer] = await new MercuryIndexer({ url: BASE }).getSigners(WALLET);
    expect(signer!.expiration).toBeUndefined(); // ledger seq is not a unix time
    expect(signer!.status).toBe("expired"); // lifecycle preserved via status
  });

  it("returns [] on a 404 (wallet has no indexed signers)", async () => {
    stubFetch(() => ({ status: 404, body: { error: "Wallet not found" } }));
    const signers = await new MercuryIndexer({ url: BASE }).getSigners(WALLET);
    expect(signers).toEqual([]);
  });

  it("throws an IndexerError on a non-404 failure", async () => {
    stubFetch(() => ({ status: 500, body: "boom" }));
    await expect(
      new MercuryIndexer({ url: BASE }).getSigners(WALLET)
    ).rejects.toBeInstanceOf(IndexerError);
  });
});

describe("MercuryIndexer eviction probe (audit H2)", () => {
  function tempLiveBody() {
    return {
      contractId: WALLET,
      generation: "v1",
      signers: [
        {
          key: { type: "secp256r1", value: CRED_HEX },
          publicKey: PUBKEY_HEX,
          storage: "temporary",
          status: "live",
        },
      ],
    };
  }

  it("probes by the SignerKey ScVal and keeps a still-present temporary signer", async () => {
    stubFetch(() => ({ body: tempLiveBody() }));
    const present = { contractData: () => ({ val: () => xdr.ScVal.scvVoid() }) };
    const getLedgerEntries = vi.fn(async () => ({ entries: [{ val: present }] }));
    const indexer = new MercuryIndexer({
      url: BASE,
      rpc: fakeRpc(getLedgerEntries),
    });

    const [signer] = await indexer.getSigners(WALLET);
    expect(signer!.status).toBe("live");
    expect(getLedgerEntries).toHaveBeenCalledTimes(1);

    const ledgerKey = getLedgerEntries.mock.calls[0]![0] as xdr.LedgerKey;
    const probedKey = ledgerKey.contractData().key();
    expect(probedKey.toXDR("base64")).toBe(
      signerKeyToContractScVal(
        SignerKey.Secp256r1(Buffer.from(CRED_HEX, "hex").toString("base64url"))
      ).toXDR("base64")
    );
    expect(probedKey.switch().name).toBe("scvVec");
  });

  it("marks a temporary signer evicted on a genuine not-found", async () => {
    stubFetch(() => ({ body: tempLiveBody() }));
    const indexer = new MercuryIndexer({
      url: BASE,
      rpc: fakeRpc(vi.fn(async () => ({ entries: [] }))),
    });
    const [signer] = await indexer.getSigners(WALLET);
    expect(signer!.status).toBe("evicted");
  });

  it("does NOT evict on a transport error during the probe", async () => {
    stubFetch(() => ({ body: tempLiveBody() }));
    const indexer = new MercuryIndexer({
      url: BASE,
      rpc: fakeRpc(
        vi.fn(async () => {
          throw new Error("429 too many requests");
        })
      ),
    });
    const [signer] = await indexer.getSigners(WALLET);
    expect(signer!.status).toBe("live"); // left as reported, not false-evicted
  });
});

describe("MercuryIndexer.findWallets", () => {
  it("looks up a Secp256r1 key by hex credential id", async () => {
    const keyId = base64url.encode(Buffer.alloc(16, 7));
    const derived = deriveContractAddress(
      base64url.toBuffer(keyId),
      DEPLOYER,
      TESTNET
    );
    const mock = stubFetch((url) => {
      expect(url).toContain(
        `/api/lookup/${base64url.toBuffer(keyId).toString("hex")}`
      );
      return {
        body: {
          credentialId: base64url.toBuffer(keyId).toString("hex"),
          wallets: [
            { contract_id: derived, generation: "v1", signer_count: 1 },
            { contract_id: OTHER_WALLET, generation: "v1", signer_count: 1 },
          ],
          count: 2,
        },
      };
    });

    const indexer = new MercuryIndexer({
      url: BASE,
      hardening: { networkPassphrase: TESTNET, deployerPublicKey: DEPLOYER },
    });
    const wallets = await indexer.findWallets(SignerKey.Secp256r1(keyId));

    // OTHER_WALLET is dropped: not the derived address and no rpc to confirm it.
    expect(wallets).toEqual([derived]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("looks up an Ed25519 key by its strkey address", async () => {
    const mock = stubFetch((url) => {
      expect(url).toContain(`/api/lookup/address/${ED25519}`);
      return {
        body: {
          signerAddress: ED25519,
          wallets: [{ contract_id: OTHER_WALLET, generation: "v1", signer_count: 1 }],
          count: 1,
        },
      };
    });

    // No rpc + no hardening => candidates returned unfiltered.
    const wallets = await new MercuryIndexer({ url: BASE }).findWallets(
      SignerKey.Ed25519(ED25519)
    );
    expect(wallets).toEqual([OTHER_WALLET]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("returns [] on a 404 lookup", async () => {
    stubFetch(() => ({ status: 404, body: { error: "not found" } }));
    const wallets = await new MercuryIndexer({ url: BASE }).findWallets(
      SignerKey.Policy(OTHER_WALLET)
    );
    expect(wallets).toEqual([]);
  });
});

describe("MercuryIndexer.health", () => {
  it("reports ok on a healthy root response", async () => {
    stubFetch(() => ({ body: { service: "passkey-indexer", status: "ok" } }));
    expect(await new MercuryIndexer({ url: BASE }).health()).toEqual({
      ok: true,
      backend: "mercury",
    });
  });

  it("reports ok:false on a transport failure", async () => {
    stubFetch(() => ({ status: 503, body: "down" }));
    const h = await new MercuryIndexer({ url: BASE }).health();
    expect(h.ok).toBe(false);
    expect(h.backend).toBe("mercury");
    expect(h.detail).toBeTruthy();
  });
});
