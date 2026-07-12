/**
 * Display + typed-error formatting helpers.
 */

import { ContractError, PasskeyKitError } from "passkey-kit";

/** Abbreviate a long id (contract, key, hash) as `ABCDEF…UVWXYZ`. */
export function shortId(id: string | undefined, edge = 6): string {
  if (!id) return "";
  return id.length <= edge * 2 + 1 ? id : `${id.slice(0, edge)}…${id.slice(-edge)}`;
}

const STROOPS_PER_UNIT = 10_000_000n;

/**
 * Format i128 stroops as a human XLM/token amount (7 decimals), using exact
 * BigInt math (no JS `Number`, which loses integer precision above ~9e15).
 */
export function fromStroops(stroops: string | bigint | undefined): string {
  if (stroops === undefined) return "—";
  const value = BigInt(stroops);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = (abs % STROOPS_PER_UNIT).toString().padStart(7, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/**
 * Parse a human token amount into i128 stroops. String inputs are parsed with
 * exact decimal→BigInt math (no `Number` rounding); numbers fall back to a safe
 * scale-and-round (demo-scale amounts only).
 */
export function toStroops(amount: string | number): bigint {
  const str = typeof amount === "string" ? amount.trim() : String(amount);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(str);
  if (!match) {
    // Scientific notation etc. from a number input: scale then round.
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) throw new Error("Invalid amount");
    return BigInt(Math.round(n * 10_000_000));
  }
  const whole = BigInt(match[1]);
  const frac = BigInt((match[2] ?? "").padEnd(7, "0").slice(0, 7));
  return whole * STROOPS_PER_UNIT + frac;
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
