import { describe, expect, it } from "vitest";
import { xdr } from "@stellar/stellar-sdk";
import base64url from "../base64url.js";
import { SignerKey } from "../types.js";
import { SIGNER_VAL_UDT } from "../kit/auth-payload.js";
import {
  StellarIndexerBackend,
  type StellarIndexerEntry,
} from "./stellar-indexer.js";
import { signerKeyToContractScVal, walletSpec } from "./codec.js";

function keyXdr(keyId: string): string {
  return signerKeyToContractScVal(SignerKey.Secp256r1(keyId)).toXDR("base64");
}

function valXdr(expiration?: number): string {
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

function backend(): StellarIndexerBackend {
  return new StellarIndexerBackend({
    url: "https://indexer.test",
    accessToken: "token",
    now: () => 1000,
  });
}

describe("StellarIndexerBackend.entriesToSigners", () => {
  it("prefers a live entry over a tombstoned twin (durability flip)", () => {
    const keyId = base64url.encode(Buffer.alloc(16, 1));
    const key = keyXdr(keyId);
    const entries: StellarIndexerEntry[] = [
      { key, val: valXdr(), durability: "temporary", deleted_at: "2026-07-11" },
      { key, val: valXdr(), durability: "persistent", deleted_at: null },
    ];

    const signers = backend().entriesToSigners(entries);
    expect(signers).toHaveLength(1);
    expect(signers[0]!.status).toBe("live");
    expect(signers[0]!.storage).toBe("persistent");
    expect(signers[0]!.key.value).toBe(keyId);
  });

  it("marks a key removed when every entry is tombstoned", () => {
    const keyId = base64url.encode(Buffer.alloc(16, 2));
    const key = keyXdr(keyId);
    const entries: StellarIndexerEntry[] = [
      { key, val: valXdr(), durability: "persistent", deleted_at: "2026-07-11" },
    ];
    const signers = backend().entriesToSigners(entries);
    expect(signers[0]!.status).toBe("removed");
  });

  it("marks a live-but-expired entry expired", () => {
    const keyId = base64url.encode(Buffer.alloc(16, 3));
    const entries: StellarIndexerEntry[] = [
      {
        key: keyXdr(keyId),
        val: valXdr(500), // expiration 500 < now 1000
        durability: "persistent",
        deleted_at: null,
      },
    ];
    expect(backend().entriesToSigners(entries)[0]!.status).toBe("expired");
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
