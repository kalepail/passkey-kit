import { describe, expect, it } from "vitest";
import {
  PasskeyKitError,
  PasskeyKitErrorCode,
  ContractError,
  WalletNotConnectedError,
  WebAuthnError,
  ValidationError,
  wrapError,
} from "./errors.js";

describe("PasskeyKitError", () => {
  it("carries code, context, and cause", () => {
    const cause = new Error("root cause");
    const err = new PasskeyKitError("boom", PasskeyKitErrorCode.INVALID_CONFIG, {
      context: { foo: "bar" },
      cause,
    });
    expect(err.code).toBe(PasskeyKitErrorCode.INVALID_CONFIG);
    expect(err.context).toEqual({ foo: "bar" });
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
  });

  it("formats a detailed string with code, context, and cause", () => {
    const err = new PasskeyKitError("boom", PasskeyKitErrorCode.INVALID_CONFIG, {
      context: { foo: "bar" },
      cause: new Error("underlying"),
    });
    const detailed = err.toDetailedString();
    expect(detailed).toContain(`[${PasskeyKitErrorCode.INVALID_CONFIG}]`);
    expect(detailed).toContain("boom");
    expect(detailed).toContain("foo");
    expect(detailed).toContain("Caused by: underlying");
  });
});

describe("error subclasses", () => {
  it("WalletNotConnectedError references the operation", () => {
    const err = new WalletNotConnectedError("add a signer");
    expect(err.code).toBe(PasskeyKitErrorCode.WALLET_NOT_CONNECTED);
    expect(err.message).toContain("add a signer");
    expect(err.name).toBe("WalletNotConnectedError");
  });

  it("WebAuthnError carries its cause", () => {
    const cause = new Error("user cancelled");
    const err = new WebAuthnError(
      "registration failed",
      PasskeyKitErrorCode.WEBAUTHN_REGISTRATION_FAILED,
      cause
    );
    expect(err.cause).toBe(cause);
    expect(err.code).toBe(PasskeyKitErrorCode.WEBAUTHN_REGISTRATION_FAILED);
  });

  it("ContractError exposes the raw contract code, name, and family", () => {
    const err = new ContractError(4, "SignerExpired", "SmartWallet", "expired");
    expect(err.code).toBe(PasskeyKitErrorCode.CONTRACT_ERROR);
    expect(err.contractCode).toBe(4);
    expect(err.contractErrorName).toBe("SignerExpired");
    expect(err.family).toBe("SmartWallet");
    expect(err.context).toMatchObject({
      contractCode: 4,
      contractErrorName: "SignerExpired",
    });
  });
});

describe("wrapError", () => {
  it("passes through an existing PasskeyKitError", () => {
    const original = new ValidationError("bad");
    expect(wrapError(original)).toBe(original);
  });

  it("wraps a plain Error, preserving message and cause", () => {
    const plain = new Error("kaboom");
    const wrapped = wrapError(plain, PasskeyKitErrorCode.SIMULATION_FAILED);
    expect(wrapped).toBeInstanceOf(PasskeyKitError);
    expect(wrapped.message).toBe("kaboom");
    expect(wrapped.code).toBe(PasskeyKitErrorCode.SIMULATION_FAILED);
    expect(wrapped.cause).toBe(plain);
  });

  it("wraps a non-Error value with its string form", () => {
    const wrapped = wrapError("just a string");
    expect(wrapped.message).toBe("just a string");
    expect(wrapped.code).toBe(PasskeyKitErrorCode.INVALID_INPUT);
    expect(wrapped.cause).toBeUndefined();
  });
});
