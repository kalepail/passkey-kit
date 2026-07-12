/**
 * Contract error decoding.
 *
 * Maps on-chain smart-wallet failure codes (surfaced in simulation/submission
 * diagnostics as `Error(Contract, #N)`) to typed {@link ContractError}s with the
 * enum variant name and a human-readable message.
 *
 * The `SmartWallet` family is the source of truth in the generated bindings'
 * `Errors` map; `contract-errors.test.ts` asserts this registry stays in sync
 * with it, so a bindings regen surfaces any drift.
 *
 * NOTE: these are the CURRENT contract's 9 codes (1-9). The reworked contract
 * deliberately renumbers and adds codes (spec #602); this registry is resynced
 * to the regenerated bindings in B4.
 *
 * @packageDocumentation
 */

import {
  ContractError,
  SimulationError,
  SubmissionError,
  PasskeyKitError,
} from "./errors.js";
import type { TransactionFailure } from "./types.js";

/**
 * Contract families that expose custom error codes.
 */
export type ContractErrorFamily = "SmartWallet";

/**
 * A single contract error entry: code, enum variant name, family, and a
 * human-readable message.
 */
export interface ContractErrorInfo {
  code: number;
  name: string;
  family: ContractErrorFamily;
  message: string;
}

function entry(
  code: number,
  name: string,
  family: ContractErrorFamily,
  message: string
): [number, ContractErrorInfo] {
  return [code, { code, name, family, message }];
}

/**
 * Registry of every known contract error code, keyed by numeric code.
 */
export const CONTRACT_ERROR_REGISTRY: Readonly<
  Record<number, ContractErrorInfo>
> = Object.freeze(
  Object.fromEntries([
    entry(1, "NotFound", "SmartWallet", "The specified signer was not found."),
    entry(2, "AlreadyExists", "SmartWallet", "The signer already exists on this wallet."),
    entry(3, "MissingContext", "SmartWallet", "The signature did not cover a required authorization context."),
    entry(4, "SignerExpired", "SmartWallet", "The signer has expired."),
    entry(5, "FailedSignerLimits", "SmartWallet", "The signer is not permitted to authorize this context by its limits."),
    entry(6, "FailedPolicySignerLimits", "SmartWallet", "A policy signer's limits rejected this context."),
    entry(7, "SignatureKeyValueMismatch", "SmartWallet", "A signature entry's key and value did not match."),
    entry(8, "ClientDataJsonChallengeIncorrect", "SmartWallet", "The WebAuthn clientDataJSON challenge did not match the signature payload."),
    entry(9, "JsonParseError", "SmartWallet", "The WebAuthn clientDataJSON could not be parsed."),
  ])
);

/**
 * Matches the host's rendering of a contract error, e.g. `Error(Contract, #4)`.
 */
const CONTRACT_ERROR_PATTERN = /Error\(Contract,\s*#(\d+)\)/;

function diagnosticToString(diagnostic: unknown): string {
  if (diagnostic == null) return "";
  if (typeof diagnostic === "string") return diagnostic;
  if (diagnostic instanceof Error) return diagnostic.message;
  try {
    return JSON.stringify(diagnostic);
  } catch {
    return String(diagnostic);
  }
}

/**
 * Build a {@link ContractError} for a known contract code, or `null` if the code
 * is not in the registry.
 */
export function contractErrorFromCode(
  code: number,
  context?: Record<string, unknown>
): ContractError | null {
  const info = CONTRACT_ERROR_REGISTRY[code];
  if (!info) return null;
  return new ContractError(info.code, info.name, info.family, info.message, {
    context,
  });
}

/**
 * Decode a simulation/submission diagnostic into a typed {@link ContractError}.
 *
 * Scans the (stringified) diagnostic for an `Error(Contract, #N)` marker and
 * looks the code up in {@link CONTRACT_ERROR_REGISTRY}. Returns `null` when no
 * contract code is present or the code is unknown, letting callers fall back to
 * a generic {@link SimulationError}/{@link SubmissionError}.
 */
export function decodeContractError(diagnostic: unknown): ContractError | null {
  const text = diagnosticToString(diagnostic);
  const match = text.match(CONTRACT_ERROR_PATTERN);
  if (!match) return null;
  const code = Number.parseInt(match[1]!, 10);
  return contractErrorFromCode(code, { diagnostic: text });
}

/**
 * Build a {@link TransactionFailure} from an already-typed error.
 */
export function failedTransaction(
  error: PasskeyKitError,
  hash?: string
): TransactionFailure {
  return {
    success: false,
    error,
    ...(hash ? { hash } : {}),
  };
}

/**
 * Build a {@link TransactionFailure} from a simulation diagnostic, decoding a
 * contract error when present and otherwise wrapping it in a
 * {@link SimulationError}.
 */
export function simulationFailure(
  diagnostic: unknown,
  hash?: string
): TransactionFailure {
  const error =
    decodeContractError(diagnostic) ??
    new SimulationError(diagnosticToString(diagnostic) || "Simulation failed");
  return failedTransaction(error, hash);
}

/**
 * Build a {@link TransactionFailure} from a submission diagnostic, decoding a
 * contract error when present and otherwise wrapping it in a
 * {@link SubmissionError}.
 */
export function submissionFailure(
  diagnostic: unknown,
  hash?: string
): TransactionFailure {
  const error =
    decodeContractError(diagnostic) ??
    new SubmissionError(
      diagnosticToString(diagnostic) || "Submission failed",
      hash
    );
  return failedTransaction(error, hash);
}
