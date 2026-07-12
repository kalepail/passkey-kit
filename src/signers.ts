/**
 * Typed signer abstraction for the flat `Signatures` map.
 *
 * A {@link Signer} knows how to authenticate a signature payload (the 32-byte
 * hash from `buildSignaturePayload`) and produce the on-chain
 * `(SignerKey, Signature)` pair the wallet's `__check_auth` expects. This
 * replaces the old `sign({ keyId | keypair | policy })` option trio, where the
 * caller had to pass exactly one of three mutually-exclusive fields, with three
 * explicit signer classes:
 *
 * - {@link PasskeySigner} — a WebAuthn secp256r1 passkey (default).
 * - {@link Ed25519Signer} — a local Stellar keypair.
 * - {@link PolicySigner} — a policy contract co-signer (no signature bytes).
 *
 * @packageDocumentation
 */

import { Keypair } from "@stellar/stellar-sdk";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import type {
  Signature as SDKSignature,
  SignerKey as SDKSignerKey,
} from "passkey-kit-sdk";
import base64url from "./base64url.js";
import { compactSignature } from "./utils.js";
import { ValidationError, PasskeyKitErrorCode } from "./errors.js";
import { WEBAUTHN_TIMEOUT_MS } from "./constants.js";

/** The WebAuthn `startAuthentication` surface a {@link PasskeySigner} needs. */
export interface WebAuthnAuthenticator {
  startAuthentication(args: {
    optionsJSON: PublicKeyCredentialRequestOptionsJSON;
  }): Promise<AuthenticationResponseJSON>;
}

/** Ambient context passed to every {@link Signer.sign} call by the kit. */
export interface SignerContext {
  /** WebAuthn Relying Party id (domain); defaults to the current origin. */
  rpId?: string;
  /** The WebAuthn implementation (overridable for tests). */
  webAuthn: WebAuthnAuthenticator;
  /** The connected wallet's default passkey keyId (base64url), when known. */
  defaultKeyId?: string;
}

/** The on-chain `(SignerKey, Signature)` pair a signer produces. */
export interface PreparedSignature {
  key: SDKSignerKey;
  /** `undefined` for policy signers (the map stores `scvVoid` for the value). */
  value: SDKSignature | undefined;
}

/** A signer for the wallet's flat `Signatures` map. */
export interface Signer {
  /** Authenticate a signature payload into an on-chain signature pair. */
  sign(
    payload: Buffer,
    context: SignerContext
  ): Promise<PreparedSignature> | PreparedSignature;
}

/**
 * An Ed25519 signer backed by a local Stellar keypair.
 */
export class Ed25519Signer implements Signer {
  private readonly keypair: Keypair;

  constructor(keypair: Keypair) {
    this.keypair = keypair;
  }

  /**
   * Build an {@link Ed25519Signer} from a Stellar secret key (`S…`).
   *
   * @throws {ValidationError} If the secret key is invalid.
   */
  static fromSecret(secretKey: string): Ed25519Signer {
    try {
      return new Ed25519Signer(Keypair.fromSecret(secretKey));
    } catch {
      throw new ValidationError(
        "Invalid Ed25519 secret key (must be a valid Stellar secret key, S…)"
      );
    }
  }

  /** The signer's `G…` public key. */
  get address(): string {
    return this.keypair.publicKey();
  }

  sign(payload: Buffer): PreparedSignature {
    const signature = this.keypair.sign(payload);
    return {
      key: { tag: "Ed25519", values: [Buffer.from(this.keypair.rawPublicKey())] },
      value: { tag: "Ed25519", values: [signature] },
    };
  }
}

/**
 * A policy signer: a policy contract co-authorizes the entry. The map value is
 * `scvVoid`; the wallet calls the policy's `policy__` during `__check_auth`.
 */
export class PolicySigner implements Signer {
  private readonly policy: string;

  constructor(policy: string) {
    this.policy = policy;
  }

  sign(): PreparedSignature {
    return {
      key: { tag: "Policy", values: [this.policy] },
      value: { tag: "Policy", values: undefined },
    };
  }
}

/**
 * A WebAuthn secp256r1 passkey signer.
 *
 * Pass a specific `keyId` to require that credential, `"any"` to let the
 * authenticator pick a discoverable credential, or omit it to use the kit's
 * connected passkey ({@link SignerContext.defaultKeyId}).
 */
export class PasskeySigner implements Signer {
  private readonly keyId: "any" | string | undefined;

  constructor(keyId?: "any" | string | Uint8Array) {
    this.keyId =
      keyId instanceof Uint8Array ? base64url(Buffer.from(keyId)) : keyId;
  }

  async sign(
    payload: Buffer,
    context: SignerContext
  ): Promise<PreparedSignature> {
    const requestedKeyId =
      this.keyId === "any" ? undefined : this.keyId ?? context.defaultKeyId;

    // No specific credential → let the authenticator choose a discoverable one.
    const discoverable = this.keyId === "any" || requestedKeyId === undefined;

    const optionsJSON: PublicKeyCredentialRequestOptionsJSON = {
      challenge: base64url(payload),
      rpId: context.rpId,
      userVerification: "preferred",
      timeout: WEBAUTHN_TIMEOUT_MS,
      ...(discoverable
        ? {}
        : {
            allowCredentials: [{ id: requestedKeyId!, type: "public-key" }],
          }),
    };

    let response: AuthenticationResponseJSON;
    try {
      response = await context.webAuthn.startAuthentication({ optionsJSON });
    } catch (err) {
      throw new ValidationError(
        "WebAuthn authentication failed",
        PasskeyKitErrorCode.INVALID_INPUT,
        { cause: err instanceof Error ? err.message : String(err) }
      );
    }

    return {
      key: {
        tag: "Secp256r1",
        values: [base64url.toBuffer(response.id)],
      },
      value: {
        tag: "Secp256r1",
        values: [
          {
            authenticator_data: base64url.toBuffer(
              response.response.authenticatorData
            ),
            client_data_json: base64url.toBuffer(
              response.response.clientDataJSON
            ),
            signature: Buffer.from(
              compactSignature(
                base64url.toBuffer(response.response.signature)
              )
            ),
          },
        ],
      },
    };
  }
}
