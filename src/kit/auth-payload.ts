/**
 * Soroban authorization-entry payload helpers.
 *
 * These are thin wrappers over the stellar-sdk's native Protocol-27 auth
 * primitives (`buildAuthorizationEntryPreimage`). The old kit hand-rolled a
 * stack of "does this SDK support P27?" probe shims; on stellar-sdk >= 16 those
 * are all dead, so this module simply uses the SDK.
 *
 * This is the foundational slice (B1). The full signing pipeline — the
 * host-ordered `compareScVal` Signatures-map merge and Udt encoding — is layered
 * on top in B2.
 *
 * @packageDocumentation
 */

import {
  buildAuthorizationEntryPreimage,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import { SigningError, PasskeyKitErrorCode } from "../errors.js";

/**
 * Extract the {@link xdr.SorobanAddressCredentials} from a credentials union,
 * for the address / addressV2 / addressWithDelegates variants.
 *
 * @throws {SigningError} If the credentials are not address-based.
 */
export function getAddressCredentials(
  credentials: xdr.SorobanCredentials
): xdr.SorobanAddressCredentials {
  switch (credentials.switch().name) {
    case "sorobanCredentialsAddress":
      return credentials.address();
    case "sorobanCredentialsAddressV2":
      return credentials.addressV2();
    case "sorobanCredentialsAddressWithDelegates":
      return credentials.addressWithDelegates().addressCredentials();
    default:
      throw new SigningError(
        `Soroban credentials do not contain address credentials: ${credentials.switch().name}`,
        PasskeyKitErrorCode.UNSUPPORTED_CREDENTIALS
      );
  }
}

/**
 * Whether a credentials union uses an address-bound signature payload (the P27
 * V2 / with-delegates variants), whose preimage binds the invoker address.
 */
export function usesAddressBoundPayload(
  credentials: xdr.SorobanCredentials
): boolean {
  const name = credentials.switch().name;
  return (
    name === "sorobanCredentialsAddressV2" ||
    name === "sorobanCredentialsAddressWithDelegates"
  );
}

/**
 * Assert that a signature-expiration ledger is a valid `u32`.
 *
 * @throws {SigningError} If not a `u32` integer.
 */
export function assertSignatureExpirationLedger(expiration: number): void {
  if (
    !Number.isInteger(expiration) ||
    expiration < 0 ||
    expiration > 0xffffffff
  ) {
    throw new SigningError(
      "Soroban signature expiration ledger must be a uint32 integer",
      PasskeyKitErrorCode.INVALID_SIGNATURE_EXPIRATION,
      { expiration }
    );
  }
}

/**
 * Build the signature payload (the 32-byte hash a signer signs) for an
 * authorization entry at a given expiration ledger.
 *
 * Sets the expiration on the entry's address credentials, then hashes the SDK's
 * canonical authorization-entry preimage. Works for the address, addressV2, and
 * addressWithDelegates credential variants.
 *
 * @throws {SigningError} If `expiration` is not a valid `u32`.
 */
export function buildSignaturePayload(
  networkPassphrase: string,
  entry: xdr.SorobanAuthorizationEntry,
  expiration: number
): Buffer {
  assertSignatureExpirationLedger(expiration);

  const credentials = getAddressCredentials(entry.credentials());
  credentials.signatureExpirationLedger(expiration);

  return hash(
    buildAuthorizationEntryPreimage(
      entry,
      expiration,
      networkPassphrase
    ).toXDR()
  );
}
