import { describe, expect, it } from "vitest";
import { MemoryStorage } from "./memory.js";
import type { StoredPasskey } from "../types.js";

function makePasskey(overrides: Partial<StoredPasskey> = {}): StoredPasskey {
  return {
    keyId: "key-1",
    publicKey: new Uint8Array([0x04, 1, 2, 3]),
    contractId: "C1",
    createdAt: 1,
    ...overrides,
  };
}

describe("MemoryStorage", () => {
  it("saves and retrieves a passkey by keyId", async () => {
    const store = new MemoryStorage();
    const passkey = makePasskey();
    await store.save(passkey);
    expect(await store.get("key-1")).toEqual(passkey);
    expect(await store.get("missing")).toBeNull();
  });

  it("returns a copy, not the stored reference", async () => {
    const store = new MemoryStorage();
    await store.save(makePasskey());
    const first = await store.get("key-1");
    first!.nickname = "mutated";
    const second = await store.get("key-1");
    expect(second!.nickname).toBeUndefined();
  });

  it("queries by contract id", async () => {
    const store = new MemoryStorage();
    await store.save(makePasskey({ keyId: "a", contractId: "CX" }));
    await store.save(makePasskey({ keyId: "b", contractId: "CX" }));
    await store.save(makePasskey({ keyId: "c", contractId: "CY" }));
    const results = await store.getByContract("CX");
    expect(results.map((p) => p.keyId).sort()).toEqual(["a", "b"]);
  });

  it("updates mutable metadata and deletes", async () => {
    const store = new MemoryStorage();
    await store.save(makePasskey());
    await store.update("key-1", { nickname: "Primary" });
    expect((await store.get("key-1"))!.nickname).toBe("Primary");
    await store.delete("key-1");
    expect(await store.get("key-1")).toBeNull();
  });

  it("clears all records", async () => {
    const store = new MemoryStorage();
    await store.save(makePasskey({ keyId: "a" }));
    await store.save(makePasskey({ keyId: "b" }));
    await store.clear();
    expect(await store.getAll()).toEqual([]);
  });
});
