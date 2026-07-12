import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  validateAddress,
  validateAmount,
  validateExpiration,
  validateSecp256r1PublicKey,
} from "./validation.js";
import { PasskeyKitErrorCode, ValidationError } from "./errors.js";

const G_ADDRESS = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const C_ADDRESS = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";

describe("validateAddress", () => {
  it("accepts G… and C… addresses", () => {
    expect(() => validateAddress(G_ADDRESS)).not.toThrow();
    expect(() => validateAddress(C_ADDRESS)).not.toThrow();
  });

  it("rejects malformed or empty addresses with INVALID_ADDRESS", () => {
    expect(() => validateAddress("not-an-address")).toThrow(ValidationError);
    try {
      validateAddress("");
    } catch (err) {
      expect((err as ValidationError).code).toBe(
        PasskeyKitErrorCode.INVALID_ADDRESS
      );
    }
  });
});

describe("validateAmount", () => {
  it("accepts positive finite numbers", () => {
    expect(() => validateAmount(1)).not.toThrow();
    expect(() => validateAmount(0.5)).not.toThrow();
  });

  it("rejects zero, negatives, and non-finite values", () => {
    expect(() => validateAmount(0)).toThrow(ValidationError);
    expect(() => validateAmount(-1)).toThrow(ValidationError);
    expect(() => validateAmount(Number.NaN)).toThrow(ValidationError);
    expect(() => validateAmount(Number.POSITIVE_INFINITY)).toThrow(
      ValidationError
    );
  });
});

describe("validateExpiration", () => {
  it("accepts undefined and valid u32 values", () => {
    expect(() => validateExpiration(undefined)).not.toThrow();
    expect(() => validateExpiration(0)).not.toThrow();
    expect(() => validateExpiration(0xffffffff)).not.toThrow();
  });

  it("rejects negatives, non-integers, and out-of-range values", () => {
    expect(() => validateExpiration(-1)).toThrow(ValidationError);
    expect(() => validateExpiration(1.5)).toThrow(ValidationError);
    expect(() => validateExpiration(0x100000000)).toThrow(ValidationError);
  });
});

describe("validateSecp256r1PublicKey", () => {
  it("accepts a 65-byte uncompressed point", () => {
    const key = new Uint8Array(65);
    key[0] = 0x04;
    expect(() => validateSecp256r1PublicKey(key)).not.toThrow();
  });

  it("rejects wrong length or wrong prefix with INVALID_PUBLIC_KEY", () => {
    const wrongLength = new Uint8Array(64);
    wrongLength[0] = 0x04;
    const wrongPrefix = new Uint8Array(65);
    wrongPrefix[0] = 0x02;

    for (const bad of [wrongLength, wrongPrefix]) {
      try {
        validateSecp256r1PublicKey(bad);
        throw new Error("expected to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        expect((err as ValidationError).code).toBe(
          PasskeyKitErrorCode.INVALID_PUBLIC_KEY
        );
      }
    }
  });
});
