import { describe, expect, it } from "vitest";
import { Keypair, StrKey, xdr } from "@stellar/stellar-sdk";
import base64url from "../base64url.js";
import { SignerKey } from "../types.js";
import { SIGNER_VAL_UDT } from "../kit/auth-payload.js";
import {
  decodeSignerVal,
  deriveStatus,
  scValToSignerKey,
  signerKeyToContractScVal,
  signerKeyToIndexerJson,
  walletSpec,
} from "./codec.js";
import { toContractSignerKey } from "../kit/wallet-ops.js";

/** Encode a native SignerVal to its ScVal via the contract spec. */
function encodeSignerVal(native: unknown): xdr.ScVal {
  return walletSpec().nativeToScVal(native, SIGNER_VAL_UDT);
}

describe("decodeSignerVal", () => {
  it("decodes a Secp256r1 signer value (publicKey, expiration, unlimited)", () => {
    const publicKey = Buffer.alloc(65, 4);
    const scVal = encodeSignerVal({
      tag: "Secp256r1",
      values: [publicKey, [1000], [undefined]],
    });

    const decoded = decodeSignerVal(scVal);
    expect(decoded.kind).toBe("Secp256r1");
    expect(Buffer.from(decoded.publicKey!)).toEqual(publicKey);
    expect(decoded.expiration).toBe(1000);
    expect(decoded.limits).toBeUndefined();
  });

  it("decodes an Ed25519 signer value with no expiration", () => {
    const scVal = encodeSignerVal({
      tag: "Ed25519",
      values: [[undefined], [undefined]],
    });
    const decoded = decodeSignerVal(scVal);
    expect(decoded.kind).toBe("Ed25519");
    expect(decoded.publicKey).toBeUndefined();
    expect(decoded.expiration).toBeUndefined();
  });
});

describe("decodeSignerVal — limits-nested keys (audit M1)", () => {
  it("decodes a limits-nested Ed25519 key as a G-address that round-trips", () => {
    const g = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();
    const rawPk = Keypair.fromPublicKey(g).rawPublicKey();
    const contract = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";
    // SignerVal Ed25519 = [ SignerExpiration, SignerLimits ]; limits = Some({
    // contract -> Some([ Ed25519 key ]) }).
    const scVal = encodeSignerVal({
      tag: "Ed25519",
      values: [
        [undefined],
        [new Map<string, unknown>([[contract, [{ tag: "Ed25519", values: [rawPk] }]]])],
      ],
    });

    const nested = decodeSignerVal(scVal).limits!.get(contract)![0]!;
    expect(nested.key).toBe("Ed25519");
    expect(StrKey.isValidEd25519PublicKey(nested.value)).toBe(true);
    expect(nested.value).toBe(g); // a G-address, NOT hex
    // The old hex encoding threw here (Keypair.fromPublicKey(hex)).
    expect(() => toContractSignerKey(nested)).not.toThrow();
  });
});

describe("scValToSignerKey", () => {
  it("round-trips a Secp256r1 key", () => {
    const keyId = base64url.encode(Buffer.alloc(16, 0xab));
    const scVal = signerKeyToContractScVal(SignerKey.Secp256r1(keyId));
    const decoded = scValToSignerKey(scVal);
    expect(decoded.key).toBe("Secp256r1");
    expect(decoded.value).toBe(keyId);
  });

  it("round-trips an Ed25519 key (raw bytes <-> G-address)", () => {
    const g = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
    const scVal = signerKeyToContractScVal(SignerKey.Ed25519(g));
    const decoded = scValToSignerKey(scVal);
    expect(decoded.key).toBe("Ed25519");
    expect(StrKey.isValidEd25519PublicKey(decoded.value)).toBe(true);
    expect(decoded.value).toBe(g);
  });

  it("round-trips a Policy key", () => {
    const c = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";
    const decoded = scValToSignerKey(
      signerKeyToContractScVal(SignerKey.Policy(c))
    );
    expect(decoded.key).toBe("Policy");
    expect(decoded.value).toBe(c);
  });
});

describe("signerKeyToIndexerJson", () => {
  it("encodes a Secp256r1 key as a symbol+bytes(hex) vector", () => {
    const keyId = base64url.encode(Buffer.from([0xde, 0xad]));
    expect(signerKeyToIndexerJson(SignerKey.Secp256r1(keyId))).toEqual({
      vec: [{ symbol: "Secp256r1" }, { bytes: "dead" }],
    });
  });

  it("encodes a Policy key as a symbol+address vector", () => {
    const c = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";
    expect(signerKeyToIndexerJson(SignerKey.Policy(c))).toEqual({
      vec: [{ symbol: "Policy" }, { address: c }],
    });
  });
});

describe("deriveStatus", () => {
  it("derives live / expired / evicted / removed", () => {
    expect(deriveStatus({ nowSeconds: 100 })).toBe("live");
    expect(deriveStatus({ expiration: 100, nowSeconds: 100 })).toBe("live"); // inclusive
    expect(deriveStatus({ expiration: 99, nowSeconds: 100 })).toBe("expired");
    expect(deriveStatus({ evicted: true, nowSeconds: 100 })).toBe("evicted");
    expect(deriveStatus({ tombstoned: true, evicted: true, nowSeconds: 100 })).toBe(
      "removed"
    );
  });
});
