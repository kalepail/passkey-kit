/**
 * Client-side input validation.
 *
 * Produces clear {@link ValidationError}s before submission instead of opaque
 * on-chain or WebCrypto failures. The smart wallet imposes no signer-count caps
 * (unlike a policy-based account), so validation here is about shapes and
 * ranges: addresses, amounts, expirations, and secp256r1 public keys.
 *
 * @packageDocumentation
 */

import { StrKey } from "@stellar/stellar-sdk";
import {
  SECP256R1_PUBLIC_KEY_SIZE,
  UNCOMPRESSED_PUBKEY_PREFIX,
} from "./constants.js";
import { PasskeyKitErrorCode, ValidationError } from "./errors.js";

/**
 * Validate that a string is a Stellar account (`G…`) or contract (`C…`) address.
 *
 * @throws {ValidationError} If the address is missing or malformed.
 */
export function validateAddress(
  address: string,
  fieldName = "address"
): void {
  if (!address || typeof address !== "string") {
    throw new ValidationError(
      `${fieldName} is required`,
      PasskeyKitErrorCode.INVALID_ADDRESS,
      { field: fieldName }
    );
  }

  if (
    !StrKey.isValidEd25519PublicKey(address) &&
    !StrKey.isValidContract(address)
  ) {
    throw new ValidationError(
      `Invalid ${fieldName}: must be a valid Stellar account (G…) or contract (C…) address`,
      PasskeyKitErrorCode.INVALID_ADDRESS,
      { field: fieldName, value: address.slice(0, 10) + "…" }
    );
  }
}

/**
 * Validate that an amount is a positive, finite number.
 *
 * @throws {ValidationError} If the amount is not a positive number.
 */
export function validateAmount(amount: number, fieldName = "amount"): void {
  if (typeof amount !== "number" || !Number.isFinite(amount)) {
    throw new ValidationError(
      `${fieldName} must be a number`,
      PasskeyKitErrorCode.INVALID_AMOUNT,
      { field: fieldName }
    );
  }
  if (amount <= 0) {
    throw new ValidationError(
      `${fieldName} must be positive`,
      PasskeyKitErrorCode.INVALID_AMOUNT,
      { field: fieldName, value: amount }
    );
  }
}

/**
 * Validate a signer expiration.
 *
 * The contract types signer expiration as `Option<u64>` UNIX seconds, so the
 * accepted range here is the `u64`-compatible safe-integer range: a
 * non-negative integer up to `Number.MAX_SAFE_INTEGER` (the kit carries the
 * value as a JS number before converting to `BigInt`). `undefined` means "no
 * expiration". Capping at `u32` (the old bound) would reject post-2106
 * timestamps the contract accepts.
 *
 * @throws {ValidationError} If the expiration is out of range.
 */
export function validateExpiration(
  expiration: number | undefined,
  fieldName = "expiration"
): void {
  if (expiration === undefined) return;
  if (
    !Number.isInteger(expiration) ||
    expiration < 0 ||
    expiration > Number.MAX_SAFE_INTEGER
  ) {
    throw new ValidationError(
      `${fieldName} must be a non-negative integer (u64 UNIX seconds, within JS safe-integer range)`,
      PasskeyKitErrorCode.INVALID_INPUT,
      { field: fieldName, value: expiration }
    );
  }
}

/**
 * Validate a secp256r1 public key: 65 bytes, uncompressed (`0x04`) prefix.
 *
 * @throws {ValidationError} If the key is not a valid uncompressed EC point.
 */
export function validateSecp256r1PublicKey(
  publicKey: Uint8Array,
  fieldName = "publicKey"
): void {
  if (publicKey.length !== SECP256R1_PUBLIC_KEY_SIZE) {
    throw new ValidationError(
      `${fieldName} must be ${SECP256R1_PUBLIC_KEY_SIZE} bytes (got ${publicKey.length})`,
      PasskeyKitErrorCode.INVALID_PUBLIC_KEY,
      { field: fieldName, length: publicKey.length }
    );
  }
  if (publicKey[0] !== UNCOMPRESSED_PUBKEY_PREFIX) {
    throw new ValidationError(
      `${fieldName} must be an uncompressed EC point (0x04 prefix)`,
      PasskeyKitErrorCode.INVALID_PUBLIC_KEY,
      { field: fieldName, prefix: publicKey[0] }
    );
  }
}
