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
 * The v1 contract deliberately renumbered its error space to 100-129 so it is
 * disjoint from the legacy (pre-1.0) 1-9 range: a decoded code < 100 means the
 * client is talking to a legacy wallet. Both ranges are kept here so errors
 * from legacy deployed wallets still decode (family `SmartWalletLegacy`).
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
export type ContractErrorFamily = "SmartWallet" | "SmartWalletLegacy";

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
    // --- v1 SmartWallet (100-129) — source of truth in the bindings Errors map ---
    // 100-109: signer storage / management
    entry(100, "SignerNotFound", "SmartWallet", "The requested signer does not exist on this smart wallet."),
    entry(101, "SignerAlreadyExists", "SmartWallet", "add_signer was called with a signer key that already exists."),
    entry(102, "SignerExpired", "SmartWallet", "The signer's expiration timestamp is in the past."),
    entry(103, "LastAdminSigner", "SmartWallet", "This change would remove or demote the wallet's last durable admin signer (persistent, non-expiring, independently admin-capable) and permanently lock the wallet's admin surface; add or promote a replacement admin signer first."),
    entry(104, "LastSigner", "SmartWallet", "The operation would leave the wallet without any durable (Persistent, non-expiring) signer — thrown by remove_signer, update_signer demotions, and a __constructor with a non-durable first signer; keep or add a Persistent, non-expiring signer."),
    // 110-119: auth (__check_auth)
    entry(110, "MissingContext", "SmartWallet", "No signer in the signatures map is permitted to authorize one of the requested auth contexts."),
    entry(111, "SignatureKeyValueMismatch", "SmartWallet", "A signature's variant does not match the stored signer it claims to be for."),
    // 120-129: WebAuthn (secp256r1) verification
    entry(120, "ClientDataJsonTooLarge", "SmartWallet", "clientDataJSON exceeds the 1024-byte parse buffer."),
    entry(121, "ClientDataJsonParseError", "SmartWallet", "clientDataJSON is not parseable JSON (or is missing required fields)."),
    entry(122, "ClientDataJsonChallengeIncorrect", "SmartWallet", "The clientDataJSON challenge does not match the signature payload; this binding MUST NOT be weakened."),
    entry(123, "InvalidWebAuthnType", "SmartWallet", 'clientDataJSON `type` is not "webauthn.get".'),
    entry(124, "InvalidAuthenticatorData", "SmartWallet", "authenticatorData is shorter than the WebAuthn minimum of 37 bytes."),
    entry(125, "UserPresenceRequired", "SmartWallet", "The authenticator did not set the User Present (UP) flag."),
    entry(126, "AuthenticatorDataTooLarge", "SmartWallet", "authenticatorData exceeds the 1024-byte cap."),

    // --- Legacy (pre-1.0) 1-9 — kept so errors from legacy deployed wallets decode ---
    entry(1, "NotFound", "SmartWalletLegacy", "[legacy] The specified signer was not found."),
    entry(2, "AlreadyExists", "SmartWalletLegacy", "[legacy] The signer already exists on this wallet."),
    entry(3, "MissingContext", "SmartWalletLegacy", "[legacy] The signature did not cover a required authorization context."),
    entry(4, "SignerExpired", "SmartWalletLegacy", "[legacy] The signer has expired."),
    entry(5, "FailedSignerLimits", "SmartWalletLegacy", "[legacy] The signer is not permitted to authorize this context by its limits."),
    entry(6, "FailedPolicySignerLimits", "SmartWalletLegacy", "[legacy] A policy signer's limits rejected this context."),
    entry(7, "SignatureKeyValueMismatch", "SmartWalletLegacy", "[legacy] A signature entry's key and value did not match."),
    entry(8, "ClientDataJsonChallengeIncorrect", "SmartWalletLegacy", "[legacy] The WebAuthn clientDataJSON challenge did not match the signature payload."),
    entry(9, "JsonParseError", "SmartWalletLegacy", "[legacy] The WebAuthn clientDataJSON could not be parsed."),
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
