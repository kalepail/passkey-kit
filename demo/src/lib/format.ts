/**
 * Display + typed-error formatting helpers.
 */

import { ContractError, PasskeyKitError } from "passkey-kit";

/** Abbreviate a long id (contract, key, hash) as `ABCDEF…UVWXYZ`. */
export function shortId(id: string | undefined, edge = 6): string {
  if (!id) return "";
  return id.length <= edge * 2 + 1 ? id : `${id.slice(0, edge)}…${id.slice(-edge)}`;
}

/** Format i128 stroops as a human XLM/token amount (7 decimals). */
export function fromStroops(stroops: string | bigint | undefined): string {
  if (stroops === undefined) return "—";
  const value = Number(BigInt(stroops)) / 10_000_000;
  return parseFloat(value.toFixed(7)).toString();
}

/** Parse a human token amount into i128 stroops. */
export function toStroops(amount: string | number): bigint {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n) || n < 0) throw new Error("Invalid amount");
  return BigInt(Math.round(n * 10_000_000));
}

/** A structured, human-readable description of any thrown value. */
export interface ErrorDescription {
  name: string;
  message: string;
  code?: number;
  contract?: string;
}

/**
 * Turn any thrown value into a typed, surfacing-friendly description. Recognizes
 * the SDK's {@link PasskeyKitError} hierarchy so the UI shows real error codes
 * and decoded contract-error names instead of `alert(err.message)`.
 */
export function describeError(err: unknown): ErrorDescription {
  if (err instanceof ContractError) {
    return {
      name: err.name,
      message: err.message,
      code: err.code,
      contract: `#${err.contractCode} ${err.contractErrorName} (${err.family})`,
    };
  }
  if (err instanceof PasskeyKitError) {
    return { name: err.name, message: err.message, code: err.code };
  }
  if (err instanceof Error) {
    return { name: err.name || "Error", message: err.message };
  }
  return { name: "Error", message: String(err) };
}
