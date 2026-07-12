/**
 * In-memory passkey storage adapter.
 *
 * Useful for tests and server-side environments. Data is lost when the process
 * restarts.
 */

import type { StorageAdapter, StoredPasskey } from "../types.js";

export class MemoryStorage implements StorageAdapter {
  private passkeys: Map<string, StoredPasskey> = new Map();

  async save(passkey: StoredPasskey): Promise<void> {
    this.passkeys.set(passkey.keyId, { ...passkey });
  }

  async get(keyId: string): Promise<StoredPasskey | null> {
    const passkey = this.passkeys.get(keyId);
    return passkey ? { ...passkey } : null;
  }

  async getByContract(contractId: string): Promise<StoredPasskey[]> {
    const results: StoredPasskey[] = [];
    for (const passkey of this.passkeys.values()) {
      if (passkey.contractId === contractId) {
        results.push({ ...passkey });
      }
    }
    return results;
  }

  async getAll(): Promise<StoredPasskey[]> {
    return Array.from(this.passkeys.values()).map((p) => ({ ...p }));
  }

  async delete(keyId: string): Promise<void> {
    this.passkeys.delete(keyId);
  }

  async update(
    keyId: string,
    updates: Partial<Omit<StoredPasskey, "keyId" | "publicKey">>
  ): Promise<void> {
    const passkey = this.passkeys.get(keyId);
    if (passkey) {
      this.passkeys.set(keyId, { ...passkey, ...updates });
    }
  }

  async clear(): Promise<void> {
    this.passkeys.clear();
  }
}
