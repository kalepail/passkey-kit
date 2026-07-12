/**
 * Credential manager: WebAuthn passkey ceremonies + optional passkey-record
 * persistence.
 *
 * Constructed from a plain {@link CredentialManagerDeps} object so it is fully
 * unit-testable with `vi.fn()` fakes (no live authenticator or RPC needed).
 *
 * @packageDocumentation
 */

import type { AuthenticatorSelectionCriteria } from "@simplewebauthn/browser";
import type { StorageAdapter, StoredPasskey } from "../types.js";
import {
  authenticatePasskey,
  createPasskey,
  type AuthenticatedPasskey,
  type CreatedPasskey,
  type WebAuthnClient,
} from "../kit/webauthn-ops.js";

export interface CredentialManagerDeps {
  rpId?: string;
  webAuthn: WebAuthnClient;
  /** Optional passkey-record store; when absent, remember/lookup are no-ops. */
  storage?: StorageAdapter;
}

export class CredentialManager {
  constructor(private readonly deps: CredentialManagerDeps) {}

  private get webAuthnDeps() {
    return { rpId: this.deps.rpId, webAuthn: this.deps.webAuthn };
  }

  /** Run a registration ceremony, returning the new passkey + its public key. */
  createKey(
    appName: string,
    userName: string,
    authenticatorSelection?: AuthenticatorSelectionCriteria
  ): Promise<CreatedPasskey> {
    return createPasskey(
      this.webAuthnDeps,
      appName,
      userName,
      authenticatorSelection
    );
  }

  /** Run a discoverable-credential authentication ceremony. */
  authenticate(): Promise<AuthenticatedPasskey> {
    return authenticatePasskey(this.webAuthnDeps);
  }

  /** Persist a passkey → wallet association (no-op without a storage adapter). */
  async rememberPasskey(record: StoredPasskey): Promise<void> {
    await this.deps.storage?.save(record);
  }

  /** Remove a persisted passkey record (no-op without a storage adapter). */
  async forgetPasskey(keyId: string): Promise<void> {
    await this.deps.storage?.delete(keyId);
  }

  /** Look up a stored passkey record by keyId. */
  async getPasskey(keyId: string): Promise<StoredPasskey | null> {
    return (await this.deps.storage?.get(keyId)) ?? null;
  }

  /**
   * Resolve a wallet contract id for a keyId from local storage, if a record
   * exists. Used as an indexer-free `connectWallet` fallback.
   */
  async lookupContractId(keyId: string): Promise<string | undefined> {
    return (await this.getPasskey(keyId))?.contractId;
  }
}
