/**
 * Storage adapters for passkey persistence.
 *
 * Import from the `passkey-kit/storage` subpath:
 * ```typescript
 * import { IndexedDBStorage, MemoryStorage } from "passkey-kit/storage";
 * ```
 */

export { MemoryStorage } from "./memory.js";
export { LocalStorageAdapter } from "./localStorage.js";
export { IndexedDBStorage } from "./indexeddb.js";

export type { StorageAdapter, StoredPasskey } from "../types.js";
