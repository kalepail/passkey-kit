import { describe, expect, it } from "vitest";
import { Errors as BindingsErrors } from "passkey-kit-sdk";
import {
  CONTRACT_ERROR_REGISTRY,
  contractErrorFromCode,
  decodeContractError,
  failedTransaction,
  simulationFailure,
  submissionFailure,
} from "./contract-errors.js";
import {
  ContractError,
  SimulationError,
  SubmissionError,
  ValidationError,
  PasskeyKitErrorCode,
} from "./errors.js";

describe("decodeContractError", () => {
  it("decodes a v1 contract error from a diagnostic string", () => {
    const error = decodeContractError(
      "HostError: Error(Contract, #102) ... SignerExpired"
    );
    expect(error).toBeInstanceOf(ContractError);
    expect(error?.contractCode).toBe(102);
    expect(error?.contractErrorName).toBe("SignerExpired");
    expect(error?.family).toBe("SmartWallet");
    expect(error?.code).toBe(PasskeyKitErrorCode.CONTRACT_ERROR);
  });

  it.each([
    [100, "SignerNotFound"],
    [101, "SignerAlreadyExists"],
    [110, "MissingContext"],
    [122, "ClientDataJsonChallengeIncorrect"],
    [123, "InvalidWebAuthnType"],
    [125, "UserPresenceRequired"],
  ])("decodes v1 #%i as %s", (code, name) => {
    const error = decodeContractError(`Error(Contract, #${code})`);
    expect(error?.contractCode).toBe(code);
    expect(error?.contractErrorName).toBe(name);
    expect(error?.family).toBe("SmartWallet");
  });

  it("still decodes legacy (< 100) codes as SmartWalletLegacy", () => {
    const error = decodeContractError("Error(Contract, #4)");
    expect(error?.contractErrorName).toBe("SignerExpired");
    expect(error?.family).toBe("SmartWalletLegacy");
  });

  it("handles whitespace variations in the marker", () => {
    expect(decodeContractError("Error(Contract,#101)")?.contractErrorName).toBe(
      "SignerAlreadyExists"
    );
    expect(
      decodeContractError("Error(Contract,   #101)")?.contractErrorName
    ).toBe("SignerAlreadyExists");
  });

  it("decodes from an Error object's message", () => {
    const error = decodeContractError(new Error("Error(Contract, #111)"));
    expect(error?.contractErrorName).toBe("SignatureKeyValueMismatch");
  });

  it("returns null when there is no contract marker", () => {
    expect(decodeContractError("some unrelated error")).toBeNull();
    expect(decodeContractError("")).toBeNull();
    expect(decodeContractError(null)).toBeNull();
    expect(decodeContractError(undefined)).toBeNull();
  });

  it("returns null for an unknown contract code", () => {
    expect(decodeContractError("Error(Contract, #9999)")).toBeNull();
  });
});

describe("contractErrorFromCode", () => {
  it("builds a ContractError for a known code", () => {
    const error = contractErrorFromCode(120);
    expect(error).toBeInstanceOf(ContractError);
    expect(error?.contractErrorName).toBe("ClientDataJsonTooLarge");
  });

  it("returns null for an unknown code", () => {
    expect(contractErrorFromCode(1234)).toBeNull();
  });
});

describe("CONTRACT_ERROR_REGISTRY", () => {
  it("stays in sync with the generated bindings' Errors map", () => {
    // The bindings' Errors map is the source of truth; a regen must not drift
    // from this registry (this is the guard the B4 resync relies on).
    const bindingsEntries = Object.entries(
      BindingsErrors as Record<string, { message: string }>
    );
    expect(bindingsEntries.length).toBeGreaterThan(0);

    for (const [codeStr, { message: name }] of bindingsEntries) {
      const code = Number(codeStr);
      const info = CONTRACT_ERROR_REGISTRY[code];
      expect(info, `registry missing SmartWallet code ${code}`).toBeDefined();
      expect(info.name).toBe(name);
      expect(info.family).toBe("SmartWallet");
    }
  });

  it("keeps every entry's key aligned with its code field", () => {
    for (const [key, info] of Object.entries(CONTRACT_ERROR_REGISTRY)) {
      expect(info.code).toBe(Number(key));
    }
  });
});

describe("transaction failure helpers", () => {
  it("failedTransaction exposes error.code and omits an empty hash", () => {
    const failure = failedTransaction(new ValidationError("bad input"));
    expect(failure.success).toBe(false);
    expect(failure.error).toBeInstanceOf(ValidationError);
    expect(failure.error.code).toBe(PasskeyKitErrorCode.INVALID_INPUT);
    expect(failure.hash).toBeUndefined();
  });

  it("failedTransaction preserves a provided hash", () => {
    const failure = failedTransaction(new SubmissionError("boom"), "abc123");
    expect(failure.hash).toBe("abc123");
  });

  it("simulationFailure decodes a contract error when present", () => {
    const failure = simulationFailure("Error(Contract, #102)");
    expect(failure.error).toBeInstanceOf(ContractError);
    expect(failure.error.code).toBe(PasskeyKitErrorCode.CONTRACT_ERROR);
  });

  it("simulationFailure falls back to SimulationError", () => {
    const failure = simulationFailure("host is unreachable");
    expect(failure.error).toBeInstanceOf(SimulationError);
    expect(failure.error.message).toContain("host is unreachable");
  });

  it("submissionFailure falls back to SubmissionError and keeps the hash", () => {
    const failure = submissionFailure("rejected", "tx-hash");
    expect(failure.error).toBeInstanceOf(SubmissionError);
    expect(failure.hash).toBe("tx-hash");
  });
});
