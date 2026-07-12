/**
 * IndexedDB passkey storage adapter.
 *
 * Recommended for web apps: larger limits than localStorage, an async API that
 * doesn't block the main thread, and native `Uint8Array` support.
 */

import type { StorageAdapter, StoredPasskey } from "../types.js";
import {
  DB_NAME,
  DB_VERSION,
  IDB_STORE_CREDENTIALS,
  IDB_INDEX_CONTRACT_ID,
} from "../constants.js";

export class IndexedDBStorage implements StorageAdapter {
  private dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string = DB_NAME) {
    this.dbName = dbName;
  }

  private async getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this environment"));
        return;
      }

      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () =>
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));

      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(IDB_STORE_CREDENTIALS)) {
          const store = db.createObjectStore(IDB_STORE_CREDENTIALS, {
            keyPath: "keyId",
          });
          store.createIndex(IDB_INDEX_CONTRACT_ID, IDB_INDEX_CONTRACT_ID, {
            unique: false,
          });
        }
      };
    });

    return this.dbPromise;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    callback: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDB_STORE_CREDENTIALS, mode);
      const store = transaction.objectStore(IDB_STORE_CREDENTIALS);
      const request = callback(store);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(`IndexedDB operation failed: ${request.error?.message}`)
        );
    });
  }

  async save(passkey: StoredPasskey): Promise<void> {
    await this.withStore("readwrite", (store) => store.put(passkey));
  }

  async get(keyId: string): Promise<StoredPasskey | null> {
    const result = await this.withStore<StoredPasskey | undefined>(
      "readonly",
      (store) => store.get(keyId)
    );
    return result ?? null;
  }

  async getByContract(contractId: string): Promise<StoredPasskey[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(IDB_STORE_CREDENTIALS, "readonly");
      const index = transaction
        .objectStore(IDB_STORE_CREDENTIALS)
        .index(IDB_INDEX_CONTRACT_ID);
      const request = index.getAll(contractId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(`Failed to query by contract: ${request.error?.message}`)
        );
    });
  }

  async getAll(): Promise<StoredPasskey[]> {
    return this.withStore<StoredPasskey[]>("readonly", (store) =>
      store.getAll()
    );
  }

  async delete(keyId: string): Promise<void> {
    await this.withStore("readwrite", (store) => store.delete(keyId));
  }

  async update(
    keyId: string,
    updates: Partial<Omit<StoredPasskey, "keyId" | "publicKey">>
  ): Promise<void> {
    const existing = await this.get(keyId);
    if (existing) {
      await this.save({ ...existing, ...updates });
    }
  }

  async clear(): Promise<void> {
    await this.withStore("readwrite", (store) => store.clear());
  }

  /** Close the database connection. */
  async close(): Promise<void> {
    if (this.dbPromise) {
      const db = await this.dbPromise;
      db.close();
      this.dbPromise = null;
    }
  }

  /** Delete the entire database. */
  static async deleteDatabase(dbName: string = DB_NAME): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(new Error(`Failed to delete database: ${request.error?.message}`));
    });
  }
}
