/**
 * WebAuthn ceremony operations: passkey registration and authentication.
 *
 * Pure functions over an injected WebAuthn implementation and RP config, so the
 * ceremonies are unit-testable with a fake authenticator. The old kit hard-coded
 * a static challenge (`"stellaristhebetterblockchain"`) and read `rpId` per
 * call; here the challenge is random (see {@link generateChallenge}) and the RP
 * config comes from the kit constructor.
 *
 * @packageDocumentation
 */

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  AuthenticatorSelectionCriteria,
} from "@simplewebauthn/browser";
import base64url from "../base64url.js";
import { extractPublicKeyFromAttestation, generateChallenge } from "../utils.js";
import { WEBAUTHN_TIMEOUT_MS } from "../constants.js";
import { WebAuthnError, PasskeyKitErrorCode } from "../errors.js";

/** The WebAuthn ceremony surface the kit depends on (overridable for tests). */
export interface WebAuthnClient {
  startRegistration(args: {
    optionsJSON: PublicKeyCredentialCreationOptionsJSON;
  }): Promise<RegistrationResponseJSON>;
  startAuthentication(args: {
    optionsJSON: PublicKeyCredentialRequestOptionsJSON;
  }): Promise<AuthenticationResponseJSON>;
}

/** RP config + WebAuthn implementation for the ceremonies. */
export interface WebAuthnDeps {
  rpId?: string;
  webAuthn: WebAuthnClient;
}

/** A freshly registered passkey. */
export interface CreatedPasskey {
  rawResponse: RegistrationResponseJSON;
  /** Base64URL credential id. */
  keyId: string;
  /** Raw credential id bytes. */
  keyIdBuffer: Buffer;
  /** 65-byte uncompressed secp256r1 public key. */
  publicKey: Uint8Array;
}

/**
 * Run a WebAuthn registration ceremony and extract the passkey public key.
 *
 * `pubKeyCredParams` is ES256-only (the smart wallet verifies secp256r1).
 */
export async function createPasskey(
  deps: WebAuthnDeps,
  appName: string,
  userName: string,
  authenticatorSelection: AuthenticatorSelectionCriteria = {
    residentKey: "preferred",
    userVerification: "preferred",
  }
): Promise<CreatedPasskey> {
  const now = new Date();
  const displayName = `${userName} — ${now.toLocaleString()}`;

  const optionsJSON: PublicKeyCredentialCreationOptionsJSON = {
    challenge: generateChallenge(),
    rp: { id: deps.rpId, name: appName },
    user: {
      id: generateChallenge(),
      name: displayName,
      displayName,
    },
    authenticatorSelection,
    pubKeyCredParams: [{ alg: -7, type: "public-key" }],
    timeout: WEBAUTHN_TIMEOUT_MS,
  };

  let rawResponse: RegistrationResponseJSON;
  try {
    rawResponse = await deps.webAuthn.startRegistration({ optionsJSON });
  } catch (err) {
    throw new WebAuthnError(
      "Passkey registration failed",
      PasskeyKitErrorCode.WEBAUTHN_REGISTRATION_FAILED,
      err instanceof Error ? err : undefined
    );
  }

  const publicKey = await extractPublicKeyFromAttestation(rawResponse.response);

  return {
    rawResponse,
    keyId: rawResponse.id,
    keyIdBuffer: base64url.toBuffer(rawResponse.id),
    publicKey,
  };
}

/** A discoverable-credential authentication result. */
export interface AuthenticatedPasskey {
  keyId: string;
  keyIdBuffer: Buffer;
  rawResponse: AuthenticationResponseJSON;
}

/**
 * Run a WebAuthn authentication ceremony against a discoverable credential (no
 * `allowCredentials`), returning the selected credential id. Used by
 * `connectWallet` to discover which passkey the user picked.
 */
export async function authenticatePasskey(
  deps: WebAuthnDeps
): Promise<AuthenticatedPasskey> {
  const optionsJSON: PublicKeyCredentialRequestOptionsJSON = {
    challenge: generateChallenge(),
    rpId: deps.rpId,
    userVerification: "preferred",
    timeout: WEBAUTHN_TIMEOUT_MS,
  };

  let rawResponse: AuthenticationResponseJSON;
  try {
    rawResponse = await deps.webAuthn.startAuthentication({ optionsJSON });
  } catch (err) {
    throw new WebAuthnError(
      "Passkey authentication failed",
      PasskeyKitErrorCode.WEBAUTHN_AUTHENTICATION_FAILED,
      err instanceof Error ? err : undefined
    );
  }

  return {
    keyId: rawResponse.id,
    keyIdBuffer: base64url.toBuffer(rawResponse.id),
    rawResponse,
  };
}
