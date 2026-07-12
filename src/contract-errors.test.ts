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
  it("decodes a contract error from a diagnostic string", () => {
    const error = decodeContractError(
      "HostError: Error(Contract, #4) ... SignerExpired"
    );
    expect(error).toBeInstanceOf(ContractError);
    expect(error?.contractCode).toBe(4);
    expect(error?.contractErrorName).toBe("SignerExpired");
    expect(error?.family).toBe("SmartWallet");
    expect(error?.code).toBe(PasskeyKitErrorCode.CONTRACT_ERROR);
  });

  it.each([
    [1, "NotFound"],
    [2, "AlreadyExists"],
    [3, "MissingContext"],
    [7, "SignatureKeyValueMismatch"],
    [8, "ClientDataJsonChallengeIncorrect"],
    [9, "JsonParseError"],
  ])("decodes #%i as %s", (code, name) => {
    const error = decodeContractError(`Error(Contract, #${code})`);
    expect(error?.contractCode).toBe(code);
    expect(error?.contractErrorName).toBe(name);
    expect(error?.family).toBe("SmartWallet");
  });

  it("handles whitespace variations in the marker", () => {
    expect(decodeContractError("Error(Contract,#2)")?.contractErrorName).toBe(
      "AlreadyExists"
    );
    expect(decodeContractError("Error(Contract,   #2)")?.contractErrorName).toBe(
      "AlreadyExists"
    );
  });

  it("decodes from an Error object's message", () => {
    const error = decodeContractError(new Error("Error(Contract, #5)"));
    expect(error?.contractErrorName).toBe("FailedSignerLimits");
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
    const error = contractErrorFromCode(6);
    expect(error).toBeInstanceOf(ContractError);
    expect(error?.contractErrorName).toBe("FailedPolicySignerLimits");
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
    const failure = simulationFailure("Error(Contract, #4)");
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
