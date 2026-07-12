/**
 * `localStorage` passkey storage adapter.
 *
 * Persists passkey records across page reloads in the browser. `localStorage`
 * has a ~5MB limit and stores data unencrypted; for larger or more structured
 * needs prefer {@link import("./indexeddb.js").IndexedDBStorage}.
 */

import type { StorageAdapter, StoredPasskey } from "../types.js";
import { LOCALSTORAGE_CREDENTIALS_KEY } from "../constants.js";

/**
 * JSON-serializable form of a passkey record (`publicKey` becomes a number[]
 * since `Uint8Array` is not JSON-serializable).
 */
type SerializedPasskey = Omit<StoredPasskey, "publicKey"> & {
  publicKey: number[];
};

function serialize(passkey: StoredPasskey): SerializedPasskey {
  return { ...passkey, publicKey: Array.from(passkey.publicKey) };
}

function deserialize(data: SerializedPasskey): StoredPasskey {
  return { ...data, publicKey: new Uint8Array(data.publicKey) };
}

export class LocalStorageAdapter implements StorageAdapter {
  private storageKey: string;

  constructor(storageKey: string = LOCALSTORAGE_CREDENTIALS_KEY) {
    this.storageKey = storageKey;
  }

  private read(): Map<string, StoredPasskey> {
    if (typeof localStorage === "undefined") {
      throw new Error("localStorage is not available in this environment");
    }

    const data = localStorage.getItem(this.storageKey);
    if (!data) return new Map();

    try {
      const parsed = JSON.parse(data) as Record<string, SerializedPasskey>;
      const map = new Map<string, StoredPasskey>();
      for (const [key, value] of Object.entries(parsed)) {
        map.set(key, deserialize(value));
      }
      return map;
    } catch (error) {
      // Corrupt storage: warn loudly rather than silently dropping the user's
      // passkeys. Return empty so the app keeps working; do not overwrite.
      console.error(
        `[PasskeyKit] Failed to parse stored passkeys at "${this.storageKey}"; treating storage as empty.`,
        error
      );
      return new Map();
    }
  }

  private write(passkeys: Map<string, StoredPasskey>): void {
    const obj: Record<string, SerializedPasskey> = {};
    for (const [key, value] of passkeys.entries()) {
      obj[key] = serialize(value);
    }
    localStorage.setItem(this.storageKey, JSON.stringify(obj));
  }

  async save(passkey: StoredPasskey): Promise<void> {
    const passkeys = this.read();
    passkeys.set(passkey.keyId, passkey);
    this.write(passkeys);
  }

  async get(keyId: string): Promise<StoredPasskey | null> {
    return this.read().get(keyId) ?? null;
  }

  async getByContract(contractId: string): Promise<StoredPasskey[]> {
    const results: StoredPasskey[] = [];
    for (const passkey of this.read().values()) {
      if (passkey.contractId === contractId) {
        results.push(passkey);
      }
    }
    return results;
  }

  async getAll(): Promise<StoredPasskey[]> {
    return Array.from(this.read().values());
  }

  async delete(keyId: string): Promise<void> {
    const passkeys = this.read();
    passkeys.delete(keyId);
    this.write(passkeys);
  }

  async update(
    keyId: string,
    updates: Partial<Omit<StoredPasskey, "keyId" | "publicKey">>
  ): Promise<void> {
    const passkeys = this.read();
    const passkey = passkeys.get(keyId);
    if (passkey) {
      passkeys.set(keyId, { ...passkey, ...updates });
      this.write(passkeys);
    }
  }

  async clear(): Promise<void> {
    localStorage.removeItem(this.storageKey);
  }
}
