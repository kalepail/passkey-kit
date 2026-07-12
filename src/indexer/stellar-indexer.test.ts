import { afterEach, describe, expect, it, vi } from "vitest";
import { Address, Keypair, Networks, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import base64url from "../base64url.js";
import { SignerKey } from "../types.js";
import { IndexerError } from "../errors.js";
import {
  StellarIndexerBackend,
  jsonScValToXdr,
  type StellarIndexerEntry,
} from "./stellar-indexer.js";
import { scValToSignerKey, signerKeyToIndexerJson } from "./codec.js";

const CONTRACT = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";

function backend(): StellarIndexerBackend {
  return new StellarIndexerBackend({
    url: "https://indexer.test",
    accessToken: "token",
    now: () => 1000,
  });
}

/** Documented JSON-ScVal `val` for a Secp256r1 SignerVal (65-byte pubkey). */
function secpValJson(expiration?: number, limits?: unknown): unknown {
  const exp = expiration == null ? { void: null } : { u64: String(expiration) };
  return {
    vec: [
      { symbol: "Secp256r1" },
      { bytes: Buffer.alloc(65, 4).toString("hex") },
      { vec: [exp] }, // SignerExpiration = [Option<u64>]
      { vec: [limits ?? { void: null }] }, // SignerLimits = [Option<Map>]
    ],
  };
}

describe("jsonScValToXdr (Stellar Indexer wire decode)", () => {
  const cases: Array<[string, unknown, xdr.ScVal]> = [
    ["symbol", { symbol: "Secp256r1" }, xdr.ScVal.scvSymbol("Secp256r1")],
    ["bytes (hex)", { bytes: "deadbeef" }, xdr.ScVal.scvBytes(Buffer.from("deadbeef", "hex"))],
    ["void", { void: null }, xdr.ScVal.scvVoid()],
    ["bool", { bool: true }, xdr.ScVal.scvBool(true)],
    ["u32", { u32: 42 }, xdr.ScVal.scvU32(42)],
    ["u64 (string)", { u64: "1786422535" }, nativeToScVal(1786422535n, { type: "u64" })],
    ["address", { address: CONTRACT }, Address.fromString(CONTRACT).toScVal()],
  ];

  it.each(cases)("decodes %s to the same ScVal", (_name, json, expected) => {
    expect(jsonScValToXdr(json).toXDR("base64")).toBe(expected.toXDR("base64"));
  });

  it("treats a bare null as void", () => {
    expect(jsonScValToXdr(null).toXDR("base64")).toBe(
      xdr.ScVal.scvVoid().toXDR("base64")
    );
  });

  it("decodes a nested vec", () => {
    const json = { vec: [{ symbol: "Secp256r1" }, { bytes: "aabb" }] };
    const expected = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol("Secp256r1"),
      xdr.ScVal.scvBytes(Buffer.from("aabb", "hex")),
    ]);
    expect(jsonScValToXdr(json).toXDR("base64")).toBe(expected.toXDR("base64"));
  });

  it("decodes a map ([{key,val}])", () => {
    const json = { map: [{ key: { symbol: "a" }, val: { u32: 1 } }] };
    const expected = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("a"), val: xdr.ScVal.scvU32(1) }),
    ]);
    expect(jsonScValToXdr(json).toXDR("base64")).toBe(expected.toXDR("base64"));
  });

  it("throws on an unknown or malformed variant (no silent misdecode)", () => {
    expect(() => jsonScValToXdr({ wat: 1 })).toThrow(IndexerError);
    expect(() => jsonScValToXdr({ symbol: "a", extra: 1 })).toThrow(IndexerError);
    expect(() => jsonScValToXdr("nope")).toThrow(IndexerError);
  });

  it("round-trips a real SignerKey through the SDK's own documented-JSON encoder", () => {
    // signerKeyToIndexerJson emits the documented JSON-ScVal key predicate; the
    // live response uses the same convention, so decode must invert it.
    const keyId = base64url.encode(Buffer.alloc(16, 0xab));
    const decoded = scValToSignerKey(
      jsonScValToXdr(signerKeyToIndexerJson(SignerKey.Secp256r1(keyId)))
    );
    expect(decoded.key).toBe("Secp256r1");
    expect(decoded.value).toBe(keyId);

    const g = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
    const ed = scValToSignerKey(
      jsonScValToXdr(signerKeyToIndexerJson(SignerKey.Ed25519(g)))
    );
    expect(ed.key).toBe("Ed25519");
    expect(ed.value).toBe(g);
  });
});

describe("StellarIndexerBackend.entriesToSigners (JSON ScVal entries)", () => {
  it("prefers a live entry over a tombstoned twin (durability flip)", () => {
    const keyId = base64url.encode(Buffer.alloc(16, 1));
    const key = signerKeyToIndexerJson(SignerKey.Secp256r1(keyId));
    const entries: StellarIndexerEntry[] = [
      { key, val: secpValJson(), durability: "temporary", deleted_at: "2026-07-11" },
      { key, val: secpValJson(), durability: "persistent", deleted_at: null },
    ];

    const signers = backend().entriesToSigners(entries);
    expect(signers).toHaveLength(1);
    expect(signers[0]!.status).toBe("live");
    expect(signers[0]!.storage).toBe("persistent");
    expect(signers[0]!.key.value).toBe(keyId);
    expect(signers[0]!.publicKey).toHaveLength(65);
  });

  it("marks a key removed when every entry is tombstoned", () => {
    const keyId = base64url.encode(Buffer.alloc(16, 2));
    const entries: StellarIndexerEntry[] = [
      {
        key: signerKeyToIndexerJson(SignerKey.Secp256r1(keyId)),
        val: secpValJson(),
        durability: "persistent",
        deleted_at: "2026-07-11",
      },
    ];
    expect(backend().entriesToSigners(entries)[0]!.status).toBe("removed");
  });

  it("marks a live-but-expired entry expired", () => {
    const keyId = base64url.encode(Buffer.alloc(16, 3));
    const entries: StellarIndexerEntry[] = [
      {
        key: signerKeyToIndexerJson(SignerKey.Secp256r1(keyId)),
        val: secpValJson(500), // expiration 500 < now 1000
        durability: "persistent",
        deleted_at: null,
      },
    ];
    expect(backend().entriesToSigners(entries)[0]!.status).toBe("expired");
  });

  it("decodes an Ed25519 signer (no stored public key)", () => {
    const g = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey();
    const entries: StellarIndexerEntry[] = [
      {
        key: signerKeyToIndexerJson(SignerKey.Ed25519(g)),
        val: { vec: [{ symbol: "Ed25519" }, { vec: [{ void: null }] }, { vec: [{ void: null }] }] },
        durability: "persistent",
        deleted_at: null,
      },
    ];
    const signer = backend().entriesToSigners(entries)[0]!;
    expect(signer.key.key).toBe("Ed25519");
    expect(signer.key.value).toBe(g);
    expect(signer.status).toBe("live");
    expect(signer.publicKey).toBeUndefined();
  });
});

describe("StellarIndexerBackend mainnet-only network awareness", () => {
  const cfg = { url: "https://indexer.test", accessToken: "token" };

  it("forNetwork returns null off mainnet (discovery disabled, not empty signers)", () => {
    expect(StellarIndexerBackend.forNetwork(cfg, Networks.TESTNET)).toBeNull();
    expect(StellarIndexerBackend.forNetwork(cfg, Networks.FUTURENET)).toBeNull();
  });

  it("forNetwork returns a backend on mainnet", () => {
    expect(StellarIndexerBackend.forNetwork(cfg, Networks.PUBLIC)).toBeInstanceOf(
      StellarIndexerBackend
    );
  });

  it("constructing pinned to a non-mainnet passphrase throws (no silent [])", () => {
    expect(
      () => new StellarIndexerBackend({ ...cfg, networkPassphrase: Networks.TESTNET })
    ).toThrow(IndexerError);
  });
});

describe("StellarIndexerBackend.findWallets", () => {
  it("returns [] for non-Secp256r1 keys (not derivable here)", async () => {
    const result = await backend().findWallets(
      SignerKey.Ed25519(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      )
    );
    expect(result).toEqual([]);
  });
});

describe("StellarIndexerBackend response-shape handling (audit LOW)", () => {
  const WALLET = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";

  afterEach(() => vi.unstubAllGlobals());

  function stubResponse(json: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => json,
        text: async () => "",
      }))
    );
  }

  it("throws IndexerError on an unrecognized non-empty response shape", async () => {
    stubResponse({ results: [{ key: "x" }] });
    await expect(backend().getSigners(WALLET)).rejects.toBeInstanceOf(
      IndexerError
    );
  });

  it("treats a genuinely-empty object/array as no entries", async () => {
    stubResponse({});
    expect(await backend().getSigners(WALLET)).toEqual([]);
    stubResponse({ entries: [] });
    expect(await backend().getSigners(WALLET)).toEqual([]);
  });
});
