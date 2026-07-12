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
  UNCOMPRESSED_PUBKEY_PREFIX,
  WEBAUTHN_CHALLENGE_SIZE,
} from "./constants.js";
import { WebAuthnError, PasskeyKitErrorCode } from "./errors.js";

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

/**
 * Extract the 65-byte uncompressed secp256r1 public key from a WebAuthn
 * registration (attestation) response.
 *
 * Tries, in order:
 * 1. `response.publicKey` when it is already a raw uncompressed EC point.
 * 2. `response.publicKey` decoded from SPKI via WebCrypto (`crypto.subtle`),
 *    which is the correct, non-magic-offset way to normalize the DER-encoded
 *    SubjectPublicKeyInfo most authenticators return.
 * 3. Parsing the COSE key out of `authenticatorData` / `attestationObject`.
 *
 * @throws {WebAuthnError} If the public key cannot be extracted.
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
        publicKey = encodedPublicKey.subarray(
          encodedPublicKey.length - SECP256R1_PUBLIC_KEY_SIZE
        );
      }
    } else {
      publicKey = encodedPublicKey.subarray(
        encodedPublicKey.length - SECP256R1_PUBLIC_KEY_SIZE
      );
    }
  }

  // Validate it is a proper uncompressed EC point; otherwise fall back to the
  // COSE key embedded in authenticatorData / attestationObject.
  if (
    !publicKey ||
    publicKey[0] !== UNCOMPRESSED_PUBKEY_PREFIX ||
    publicKey.length !== SECP256R1_PUBLIC_KEY_SIZE
  ) {
    let x: Buffer;
    let y: Buffer;

    if (response.authenticatorData) {
      const authenticatorData = base64url.toBuffer(response.authenticatorData);
      const credentialIdLength =
        (authenticatorData[53]! << 8) | authenticatorData[54]!;

      x = authenticatorData.subarray(
        65 + credentialIdLength,
        97 + credentialIdLength
      );
      y = authenticatorData.subarray(
        100 + credentialIdLength,
        132 + credentialIdLength
      );
    } else if (response.attestationObject) {
      const attestationObject = base64url.toBuffer(response.attestationObject);

      // COSE key structure prefix for an ES256 (P-256) key.
      const publicKeyPrefixSlice = Buffer.from([
        0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20,
      ]);
      let startIndex = attestationObject.indexOf(publicKeyPrefixSlice);
      if (startIndex === -1) {
        throw new WebAuthnError(
          "Could not locate the COSE public key in the attestation object",
          PasskeyKitErrorCode.PUBLIC_KEY_EXTRACTION_FAILED
        );
      }
      startIndex = startIndex + publicKeyPrefixSlice.length;

      x = attestationObject.subarray(startIndex, 32 + startIndex);
      y = attestationObject.subarray(35 + startIndex, 67 + startIndex);
    } else {
      throw new WebAuthnError(
        "Could not extract a public key from the attestation response",
        PasskeyKitErrorCode.PUBLIC_KEY_EXTRACTION_FAILED
      );
    }

    publicKey = Buffer.from([UNCOMPRESSED_PUBKEY_PREFIX, ...x, ...y]);
  }

  return new Uint8Array(publicKey);
}

// ============================================================================
// Signature encoding
// ============================================================================

/**
 * Convert a DER-encoded ECDSA signature to Stellar's compact `r || s` form with
 * a low-S value (S <= n/2), as required by the secp256r1 host function.
 *
 * @param derSignature - The DER-encoded signature
 * @returns 64-byte compact signature (`r || s`)
 */
export function compactSignature(derSignature: Buffer): Uint8Array {
  // DER: 0x30 [total-len] 0x02 [r-len] [r] 0x02 [s-len] [s]
  let offset = 2; // skip 0x30 and the total length

  const rLength = derSignature[offset + 1]!;
  const r = derSignature.subarray(offset + 2, offset + 2 + rLength);

  offset += 2 + rLength;

  const sLength = derSignature[offset + 1]!;
  const s = derSignature.subarray(offset + 2, offset + 2 + sLength);

  const rBigInt = BigInt("0x" + r.toString("hex"));
  let sBigInt = BigInt("0x" + s.toString("hex"));

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
