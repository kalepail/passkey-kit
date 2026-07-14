/**
 * Cryptographic and derivation helpers for the Passkey Kit SDK.
 *
 * @packageDocumentation
 */

import { StrKey, hash, xdr, Address } from "@stellar/stellar-sdk";
import type { RegistrationResponseJSON } from "@simplewebauthn/browser";
import base64url from "./base64url.js";
import {
  SECP256R1_PUBLIC_KEY_SIZE,
  SECP256R1_CURVE_ORDER,
  SECP256R1_FIELD_PRIME,
  SECP256R1_B,
  UNCOMPRESSED_PUBKEY_PREFIX,
  WEBAUTHN_CHALLENGE_SIZE,
} from "./constants.js";
import {
  ValidationError,
  WebAuthnError,
  PasskeyKitErrorCode,
} from "./errors.js";

// ============================================================================
// Deterministic contract-address derivation
// ============================================================================

/**
 * Derive a smart-wallet contract address from a passkey credential id.
 *
 * The wallet's contract id is deterministic: `salt = sha256(keyId)` and the
 * deployer address salts a `ContractIdPreimageFromAddress`. This determinism is
 * load-bearing — the indexer reverse-lookup (keyId → wallet) re-derives the
 * address the same way — so this function is pinned with golden vectors in
 * `utils.test.ts`. Any change to the derivation breaks the tests instead of
 * silently shifting deployed addresses.
 *
 * @param keyId - The raw credential id bytes
 * @param deployerPublicKey - The deployer's `G…` public key
 * @param networkPassphrase - The network passphrase
 * @returns The derived contract address (`C…`)
 */
export function deriveContractAddress(
  keyId: Buffer,
  deployerPublicKey: string,
  networkPassphrase: string
): string {
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
        new xdr.ContractIdPreimageFromAddress({
          address: Address.fromString(deployerPublicKey).toScAddress(),
          salt: hash(keyId),
        })
      ),
    })
  );

  return StrKey.encodeContract(hash(preimage.toXDR()));
}

// ============================================================================
// WebAuthn public-key extraction
// ============================================================================

/** COSE map prefix for an ES256 (P-256) key: `{1:2, 3:-26, -1:1, -2: bytes(32)…}`. */
const ES256_COSE_PREFIX = Buffer.from([
  0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20,
]);

/** COSE label for the `y` coordinate that must follow `x`: `-3: bytes(32)`. */
const COSE_Y_LABEL = Buffer.from([0x22, 0x58, 0x20]);

/**
 * Whether an uncompressed `0x04 || x || y` key is a point on the P-256 curve
 * (`y² ≡ x³ − 3x + b (mod p)`, coordinates in-field). A structurally valid but
 * off-curve key would register fine and deploy a wallet no signature can ever
 * satisfy, so extraction rejects it up front.
 */
export function isOnP256Curve(publicKey: Uint8Array): boolean {
  const key = Buffer.from(publicKey);
  if (
    key.length !== SECP256R1_PUBLIC_KEY_SIZE ||
    key[0] !== UNCOMPRESSED_PUBKEY_PREFIX
  ) {
    return false;
  }
  const p = SECP256R1_FIELD_PRIME;
  const x = BigInt("0x" + key.subarray(1, 33).toString("hex"));
  const y = BigInt("0x" + key.subarray(33, 65).toString("hex"));
  if (x >= p || y >= p) return false;
  const x3 = (((x * x) % p) * x) % p;
  const rhs = (((x3 - ((3n * x) % p) + SECP256R1_B) % p) + p) % p;
  return (y * y) % p === rhs;
}

/**
 * Read `x || y` out of a COSE key at `xStart`, verifying the `y` label bytes
 * and buffer bounds instead of trusting fixed offsets. Returns the
 * uncompressed `0x04 || x || y` point, or `undefined` when the shape doesn't
 * match.
 */
function coseCoordinates(buf: Buffer, xStart: number): Buffer | undefined {
  const yLabelStart = xStart + 32;
  const yStart = yLabelStart + COSE_Y_LABEL.length;
  if (buf.length < yStart + 32) return undefined;
  if (!buf.subarray(yLabelStart, yStart).equals(COSE_Y_LABEL)) return undefined;
  return Buffer.concat([
    Buffer.from([UNCOMPRESSED_PUBKEY_PREFIX]),
    buf.subarray(xStart, xStart + 32),
    buf.subarray(yStart, yStart + 32),
  ]);
}

/**
 * Parse the attested COSE key out of raw `authenticatorData`:
 * `rpIdHash(32) | flags(1) | counter(4) | aaguid(16) | credIdLen(2) | credId | COSE`.
 * Every offset is bounds-checked and the ES256 COSE prefix is verified in
 * place before any coordinate is sliced.
 */
function coseKeyFromAuthenticatorData(ad: Buffer): Buffer | undefined {
  if (ad.length < 55) return undefined;
  const credentialIdLength = (ad[53]! << 8) | ad[54]!;
  const coseStart = 55 + credentialIdLength;
  if (ad.length < coseStart + ES256_COSE_PREFIX.length) return undefined;
  if (
    !ad
      .subarray(coseStart, coseStart + ES256_COSE_PREFIX.length)
      .equals(ES256_COSE_PREFIX)
  ) {
    return undefined;
  }
  return coseCoordinates(ad, coseStart + ES256_COSE_PREFIX.length);
}

/** Locate the ES256 COSE key inside a CBOR attestation object and extract it. */
function coseKeyFromAttestationObject(ao: Buffer): Buffer | undefined {
  const prefixIndex = ao.indexOf(ES256_COSE_PREFIX);
  if (prefixIndex === -1) return undefined;
  return coseCoordinates(ao, prefixIndex + ES256_COSE_PREFIX.length);
}

/**
 * Extract the 65-byte uncompressed secp256r1 public key from a WebAuthn
 * registration (attestation) response.
 *
 * Tries, in order:
 * 1. `response.publicKey` when it is already a raw uncompressed EC point.
 * 2. `response.publicKey` decoded from SPKI via WebCrypto (`crypto.subtle`),
 *    which is the correct, non-magic-offset way to normalize the DER-encoded
 *    SubjectPublicKeyInfo most authenticators return.
 * 3. Parsing the COSE key out of `authenticatorData`, then
 *    `attestationObject` — with the COSE structure verified in place, never
 *    trusted fixed offsets.
 *
 * Whatever the source, the result must be a valid point ON the P-256 curve;
 * a mangled key is rejected here rather than deployed as an unusable wallet
 * signer.
 *
 * @throws {WebAuthnError} If no valid public key can be extracted.
 */
export async function extractPublicKeyFromAttestation(
  response: RegistrationResponseJSON["response"]
): Promise<Uint8Array> {
  let publicKey: Buffer | undefined;

  if (response.publicKey) {
    const encodedPublicKey = base64url.toBuffer(response.publicKey);

    if (
      encodedPublicKey.length === SECP256R1_PUBLIC_KEY_SIZE &&
      encodedPublicKey[0] === UNCOMPRESSED_PUBKEY_PREFIX
    ) {
      publicKey = encodedPublicKey;
    } else if (typeof crypto?.subtle !== "undefined") {
      try {
        const imported = await crypto.subtle.importKey(
          "spki",
          new Uint8Array(encodedPublicKey),
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          []
        );
        const rawKey = await crypto.subtle.exportKey("raw", imported);
        publicKey = Buffer.from(new Uint8Array(rawKey));
      } catch {
        publicKey = undefined; // not SPKI — fall through to the COSE paths
      }
    }
  }

  // Fall back to the attested COSE key when `response.publicKey` is absent or
  // didn't yield a valid on-curve point.
  if (!publicKey || !isOnP256Curve(publicKey)) {
    publicKey =
      (response.authenticatorData
        ? coseKeyFromAuthenticatorData(
            base64url.toBuffer(response.authenticatorData)
          )
        : undefined) ??
      (response.attestationObject
        ? coseKeyFromAttestationObject(
            base64url.toBuffer(response.attestationObject)
          )
        : undefined);
  }

  if (!publicKey || !isOnP256Curve(publicKey)) {
    throw new WebAuthnError(
      "Could not extract a valid secp256r1 public key from the attestation response",
      PasskeyKitErrorCode.PUBLIC_KEY_EXTRACTION_FAILED
    );
  }

  return new Uint8Array(publicKey);
}

// ============================================================================
// Signature encoding
// ============================================================================

function malformedDer(reason: string): ValidationError {
  return new ValidationError(
    `Malformed DER ECDSA signature: ${reason}`,
    PasskeyKitErrorCode.INVALID_INPUT
  );
}

/**
 * Convert a DER-encoded ECDSA signature to Stellar's compact `r || s` form with
 * a low-S value (S <= n/2), as required by the secp256r1 host function.
 *
 * The DER structure is validated before any offset is dereferenced:
 * sequence/integer tags, short-form lengths that exactly span the buffer, and
 * `r`/`s` values in `[1, n-1]`. A WebAuthn P-256 signature always fits
 * short-form DER (total length < 128 bytes), so long-form lengths are rejected.
 *
 * @param derSignature - The DER-encoded signature
 * @returns 64-byte compact signature (`r || s`)
 * @throws {ValidationError} If the signature is not structurally valid DER or
 *   `r`/`s` are out of range for P-256.
 */
export function compactSignature(derSignature: Buffer): Uint8Array {
  // DER: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
  if (derSignature.length < 8) throw malformedDer("too short");
  if (derSignature[0] !== 0x30) throw malformedDer("missing SEQUENCE tag");
  const totalLength = derSignature[1]!;
  if (totalLength >= 0x80) throw malformedDer("long-form length not supported");
  if (totalLength !== derSignature.length - 2) {
    throw malformedDer("SEQUENCE length does not span the buffer");
  }

  if (derSignature[2] !== 0x02) throw malformedDer("missing INTEGER tag for r");
  const rLength = derSignature[3]!;
  // A P-256 integer is at most 32 bytes plus one 0x00 sign pad.
  if (rLength < 1 || rLength > 33) throw malformedDer("r length out of range");
  if (4 + rLength + 2 > derSignature.length) {
    throw malformedDer("r overruns the buffer");
  }
  const r = derSignature.subarray(4, 4 + rLength);

  const sTagOffset = 4 + rLength;
  if (derSignature[sTagOffset] !== 0x02) {
    throw malformedDer("missing INTEGER tag for s");
  }
  const sLength = derSignature[sTagOffset + 1]!;
  if (sLength < 1 || sLength > 33) throw malformedDer("s length out of range");
  if (sTagOffset + 2 + sLength !== derSignature.length) {
    throw malformedDer("s does not end exactly at the buffer end");
  }
  const s = derSignature.subarray(sTagOffset + 2, sTagOffset + 2 + sLength);

  const rBigInt = BigInt("0x" + r.toString("hex"));
  let sBigInt = BigInt("0x" + s.toString("hex"));

  // Scalars must be in [1, n-1] — anything else can never verify on-chain.
  if (rBigInt < 1n || rBigInt >= SECP256R1_CURVE_ORDER) {
    throw malformedDer("r out of curve order range");
  }
  if (sBigInt < 1n || sBigInt >= SECP256R1_CURVE_ORDER) {
    throw malformedDer("s out of curve order range");
  }

  // Enforce low-S.
  const halfN = SECP256R1_CURVE_ORDER / 2n;
  if (sBigInt > halfN) {
    sBigInt = SECP256R1_CURVE_ORDER - sBigInt;
  }

  const rPadded = Buffer.from(rBigInt.toString(16).padStart(64, "0"), "hex");
  const sLowS = Buffer.from(sBigInt.toString(16).padStart(64, "0"), "hex");

  return new Uint8Array(Buffer.concat([rPadded, sLowS]));
}

// ============================================================================
// WebAuthn challenge
// ============================================================================

/**
 * Generate a cryptographically-random base64url challenge for a WebAuthn
 * ceremony.
 *
 * Replaces the old hard-coded `"stellaristhebetterblockchain"` challenge.
 */
export function generateChallenge(): string {
  const bytes = new Uint8Array(WEBAUTHN_CHALLENGE_SIZE);
  crypto.getRandomValues(bytes);
  return base64url.encode(Buffer.from(bytes));
}
