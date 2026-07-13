import { describe, expect, it } from "vitest";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import base64url from "../base64url.js";
import { SignerKey } from "../types.js";
import { signerKeyToContractScVal } from "./codec.js";

/**
 * The eviction probe + reverse-lookup confirmation store/read the signer entry
 * under the contract `SignerKey` ScVal (a `scvVec([symbol, bytes|address])`).
 * These assert the encoding matches the contract for each signer kind.
 */
describe("signerKeyToContractScVal", () => {
  it("encodes a Secp256r1 key as a symbol+bytes vector", () => {
    const keyId = base64url.encode(Buffer.alloc(16, 0xab));
    const scVal = signerKeyToContractScVal(SignerKey.Secp256r1(keyId));
    const vec = scVal.vec()!;
    expect(scVal.switch().name).toBe("scvVec");
    expect(vec[0]!.sym().toString()).toBe("Secp256r1");
    expect(Buffer.from(vec[1]!.bytes()).toString("base64url")).toBe(keyId);
  });

  it("encodes an Ed25519 key as a symbol+bytes vector (G-address raw bytes)", () => {
    const g = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2)).publicKey();
    const scVal = signerKeyToContractScVal(SignerKey.Ed25519(g));
    const vec = scVal.vec()!;
    expect(vec[0]!.sym().toString()).toBe("Ed25519");
    expect(StrKey.encodeEd25519PublicKey(Buffer.from(vec[1]!.bytes()))).toBe(g);
  });

  it("encodes a Policy key as a symbol+address vector", () => {
    const c = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";
    const scVal = signerKeyToContractScVal(SignerKey.Policy(c));
    const vec = scVal.vec()!;
    expect(vec[0]!.sym().toString()).toBe("Policy");
    expect(vec[1]!.switch().name).toBe("scvAddress");
  });
});
