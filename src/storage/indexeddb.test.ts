import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { IndexedDBStorage } from "./indexeddb.js";
import type { StoredPasskey } from "../types.js";

function makePasskey(overrides: Partial<StoredPasskey> = {}): StoredPasskey {
  return {
    keyId: "key-1",
    publicKey: new Uint8Array([0x04, 5, 6, 7]),
    contractId: "C1",
    createdAt: 1,
    ...overrides,
  };
}

let dbCounter = 0;

/** A fresh named database per test so cases don't share state. */
function freshStore(): IndexedDBStorage {
  return new IndexedDBStorage(`passkey-kit-test-${dbCounter++}`);
}

describe("IndexedDBStorage", () => {
  const opened: IndexedDBStorage[] = [];

  afterEach(async () => {
    await Promise.all(opened.map((s) => s.close()));
    opened.length = 0;
  });

  function track(store: IndexedDBStorage): IndexedDBStorage {
    opened.push(store);
    return store;
  }

  it("saves and retrieves a passkey with its Uint8Array intact", async () => {
    const store = track(freshStore());
    await store.save(makePasskey());
    const loaded = await store.get("key-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.publicKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(loaded!.publicKey)).toEqual([0x04, 5, 6, 7]);
    expect(await store.get("missing")).toBeNull();
  });

  it("queries by contract id via the index", async () => {
    const store = track(freshStore());
    await store.save(makePasskey({ keyId: "a", contractId: "CX" }));
    await store.save(makePasskey({ keyId: "b", contractId: "CX" }));
    await store.save(makePasskey({ keyId: "c", contractId: "CY" }));
    const results = await store.getByContract("CX");
    expect(results.map((p) => p.keyId).sort()).toEqual(["a", "b"]);
  });

  it("updates metadata, deletes, and clears", async () => {
    const store = track(freshStore());
    await store.save(makePasskey());
    await store.update("key-1", { lastUsedAt: 42 });
    expect((await store.get("key-1"))!.lastUsedAt).toBe(42);

    await store.delete("key-1");
    expect(await store.get("key-1")).toBeNull();

    await store.save(makePasskey({ keyId: "x" }));
    await store.clear();
    expect(await store.getAll()).toEqual([]);
  });
});
