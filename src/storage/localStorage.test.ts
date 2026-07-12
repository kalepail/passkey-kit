import { beforeEach, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "./localStorage.js";
import type { StoredPasskey } from "../types.js";

/** Minimal in-memory localStorage shim for the Node test environment. */
class LocalStorageShim {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

function makePasskey(overrides: Partial<StoredPasskey> = {}): StoredPasskey {
  return {
    keyId: "key-1",
    publicKey: new Uint8Array([0x04, 9, 8, 7]),
    contractId: "C1",
    createdAt: 1,
    ...overrides,
  };
}

describe("LocalStorageAdapter", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage =
      new LocalStorageShim();
  });

  it("persists a passkey across adapter instances (round-trips Uint8Array)", async () => {
    const a = new LocalStorageAdapter();
    await a.save(makePasskey());

    const b = new LocalStorageAdapter();
    const loaded = await b.get("key-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.publicKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(loaded!.publicKey)).toEqual([0x04, 9, 8, 7]);
    expect(loaded!.contractId).toBe("C1");
  });

  it("queries by contract, updates, deletes, and clears", async () => {
    const store = new LocalStorageAdapter();
    await store.save(makePasskey({ keyId: "a", contractId: "CX" }));
    await store.save(makePasskey({ keyId: "b", contractId: "CY" }));

    expect((await store.getByContract("CX")).map((p) => p.keyId)).toEqual(["a"]);

    await store.update("a", { nickname: "renamed" });
    expect((await store.get("a"))!.nickname).toBe("renamed");

    await store.delete("a");
    expect(await store.get("a")).toBeNull();

    await store.clear();
    expect(await store.getAll()).toEqual([]);
  });

  it("treats corrupt storage as empty without throwing", async () => {
    (globalThis as { localStorage: LocalStorageShim }).localStorage.setItem(
      "passkey-kit:credentials",
      "{not valid json"
    );
    const store = new LocalStorageAdapter();
    expect(await store.getAll()).toEqual([]);
  });
});
