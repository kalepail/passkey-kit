/**
 * Soroban authorization-entry payload helpers + the flat `Signatures` map codec.
 *
 * These are thin wrappers over the stellar-sdk's native Protocol-27 auth
 * primitives (`buildAuthorizationEntryPreimage`). The old kit hand-rolled a
 * stack of "does this SDK support P27?" probe shims; on stellar-sdk >= 16 those
 * are all dead, so this module simply uses the SDK.
 *
 * The smart wallet's `__check_auth` reads a `Signatures` value — a single
 * `Map<SignerKey, Signature>` — from the address credentials. Each signer
 * contributes one entry keyed by its on-chain `SignerKey`. The host rejects an
 * `ScMap` whose keys are not in the host's canonical sort order, so the map is
 * sorted with {@link compareScVal} (NOT a byte/`localeCompare` sort — see below).
 *
 * @packageDocumentation
 */

import {
  buildAuthorizationEntryPreimage,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import type { Spec as ContractSpec } from "@stellar/stellar-sdk/contract";
import type {
  Signature as SDKSignature,
  SignerKey as SDKSignerKey,
} from "passkey-kit-sdk";
import { SigningError, PasskeyKitErrorCode } from "../errors.js";

// ============================================================================
// Address credentials + signature payload
// ============================================================================

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
 * Coerce a credentials union to an address-bound variant (CAP-0071-02).
 *
 * Legacy V1 `sorobanCredentialsAddress` credentials are upgraded to
 * `sorobanCredentialsAddressV2` IN PLACE of the signed payload's semantics: the
 * V2 preimage (`HashIdPreimageSorobanAuthorizationWithAddress`) binds the
 * authorizing address into the hash the signer signs, so the same signer key on
 * two different wallets can never produce interchangeable signatures. V1's
 * preimage has no address field — signing it verbatim would produce a payload
 * that is identical across wallets for a signer key installed on more than
 * one wallet.
 *
 * Already-address-bound variants (V2, with-delegates) pass through unchanged.
 *
 * @throws {SigningError} If the credentials are not address-based.
 */
export function toAddressBoundCredentials(
  credentials: xdr.SorobanCredentials
): xdr.SorobanCredentials {
  if (credentials.switch().name === "sorobanCredentialsAddress") {
    return xdr.SorobanCredentials.sorobanCredentialsAddressV2(
      credentials.address()
    );
  }
  // Anything else must already be address-bound (or is rejected here).
  getAddressCredentials(credentials);
  return credentials;
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

// ============================================================================
// Host-order ScVal comparison
// ============================================================================

/**
 * Compare two ScVals in the order the Soroban host uses when it validates that
 * an ScMap is sorted by key (host `metered_map::from_map`, which rejects an
 * unsorted map with `InvalidInput`).
 *
 * This is deliberately NOT a comparison of the XDR byte encodings. XDR prefixes
 * every variable-length payload (Bytes, Symbol, String, Vec) with a 4-byte
 * length, so `toXDR("hex")` sorting is length-major; the host instead compares
 * those payloads element-wise by content (Rust slice `Ord`), where a shorter
 * value that is a prefix of a longer one sorts first. The old kit's
 * `localeCompare` on a symbol+hex string approximated this and could diverge
 * from the host, producing a map the wallet rejects at `__check_auth`.
 *
 * Only the shapes that appear as `SignerKey` map keys are handled precisely
 * (Vec, Symbol, String, Bytes, Address). All other shapes are same-type here
 * (the discriminant is compared first), so their fixed-width XDR encodings sort
 * order-equivalently to the host.
 */
export function compareScVal(a: xdr.ScVal, b: xdr.ScVal): number {
  const aType = a.switch().value;
  const bType = b.switch().value;
  if (aType !== bType) {
    return aType < bType ? -1 : 1;
  }

  switch (a.switch().name) {
    case "scvVec": {
      const av = a.vec() ?? [];
      const bv = b.vec() ?? [];
      const len = Math.min(av.length, bv.length);
      for (let i = 0; i < len; i += 1) {
        const cmp = compareScVal(av[i]!, bv[i]!);
        if (cmp !== 0) return cmp;
      }
      return av.length - bv.length;
    }
    case "scvMap": {
      const am = a.map() ?? [];
      const bm = b.map() ?? [];
      const len = Math.min(am.length, bm.length);
      for (let i = 0; i < len; i += 1) {
        const keyCmp = compareScVal(am[i]!.key(), bm[i]!.key());
        if (keyCmp !== 0) return keyCmp;
        const valCmp = compareScVal(am[i]!.val(), bm[i]!.val());
        if (valCmp !== 0) return valCmp;
      }
      return am.length - bm.length;
    }
    case "scvSymbol":
      return Buffer.compare(
        Buffer.from(a.sym().toString(), "utf8"),
        Buffer.from(b.sym().toString(), "utf8")
      );
    case "scvString":
      return Buffer.compare(
        Buffer.from(a.str().toString(), "utf8"),
        Buffer.from(b.str().toString(), "utf8")
      );
    case "scvBytes":
      return Buffer.compare(Buffer.from(a.bytes()), Buffer.from(b.bytes()));
    case "scvAddress":
      // ScAddress is a type discriminant plus a fixed-width key, so a byte
      // comparison of the encoding matches the host's (type, key) ordering.
      return Buffer.compare(a.address().toXDR(), b.address().toXDR());
    default:
      // Same-type scalar (or any unhandled shape): its XDR encoding is
      // fixed-width for a given type, so a byte comparison is order-equivalent.
      return Buffer.compare(a.toXDR(), b.toXDR());
  }
}

// ============================================================================
// SignerKey / Signature encoding + the flat Signatures map
// ============================================================================

const SIGNER_KEY_UDT = xdr.ScSpecTypeDef.scSpecTypeUdt(
  new xdr.ScSpecTypeUdt({ name: "SignerKey" })
);
const SIGNATURE_UDT = xdr.ScSpecTypeDef.scSpecTypeUdt(
  new xdr.ScSpecTypeUdt({ name: "Signature" })
);

/** The `SignerVal` UDT type def, for decoding a stored signer entry's value. */
export const SIGNER_VAL_UDT = xdr.ScSpecTypeDef.scSpecTypeUdt(
  new xdr.ScSpecTypeUdt({ name: "SignerVal" })
);

/** Encode a native `SignerKey` union into its contract ScVal via the spec. */
export function signerKeyToScVal(
  spec: ContractSpec,
  key: SDKSignerKey
): xdr.ScVal {
  return spec.nativeToScVal(key, SIGNER_KEY_UDT);
}

/**
 * Encode a native `Signature` union into its contract ScVal via the spec, or
 * `scvVoid` when there is no signature value (policy signers).
 */
export function signatureToScVal(
  spec: ContractSpec,
  val: SDKSignature | undefined
): xdr.ScVal {
  return val ? spec.nativeToScVal(val, SIGNATURE_UDT) : xdr.ScVal.scvVoid();
}

/**
 * Upsert a `(SignerKey, Signature)` pair into the entry's `Signatures` value,
 * which is encoded as `scvVec([ scvMap([...]) ])`.
 *
 * A signer key already present in the map is replaced (co-signing is idempotent
 * per signer). The map is re-sorted by key in host order after every insert, so
 * the wallet's `__check_auth` accepts it.
 *
 * @throws {SigningError} If the existing signature is neither void nor a
 *   Signatures vec.
 */
export function upsertSignatureEntry(
  credentials: xdr.SorobanAddressCredentials,
  scKey: xdr.ScVal,
  scVal: xdr.ScVal
): void {
  const newEntry = new xdr.ScMapEntry({ key: scKey, val: scVal });

  switch (credentials.signature().switch().name) {
    case "scvVoid": {
      credentials.signature(xdr.ScVal.scvVec([xdr.ScVal.scvMap([newEntry])]));
      break;
    }
    case "scvVec": {
      const map = credentials.signature().vec()?.[0]?.map();
      if (!map) {
        throw new SigningError(
          "Malformed Signatures value: expected a map inside the signatures vector",
          PasskeyKitErrorCode.SIGNING_FAILED
        );
      }
      const existingIndex = map.findIndex(
        (entry) => compareScVal(entry.key(), scKey) === 0
      );
      if (existingIndex >= 0) {
        map[existingIndex] = newEntry;
      } else {
        map.push(newEntry);
      }
      // Host order: the wallet converts this map to a host object and rejects
      // it if the keys are not in host-sort order.
      map.sort((x, y) => compareScVal(x.key(), y.key()));
      break;
    }
    default:
      throw new SigningError(
        `Unsupported existing signature value: ${credentials.signature().switch().name}`,
        PasskeyKitErrorCode.SIGNING_FAILED
      );
  }
}
