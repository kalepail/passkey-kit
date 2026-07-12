import { describe, expect, it, vi } from "vitest";
import { PasskeyEventEmitter } from "./events.js";
import { SignerStore } from "./types.js";

describe("PasskeyEventEmitter", () => {
  it("delivers events to subscribers and returns an unsubscribe function", () => {
    const emitter = new PasskeyEventEmitter();
    const listener = vi.fn();

    const off = emitter.on("walletConnected", listener);
    emitter.emit("walletConnected", { contractId: "C1", keyId: "k1" });
    expect(listener).toHaveBeenCalledWith({ contractId: "C1", keyId: "k1" });

    off();
    emitter.emit("walletConnected", { contractId: "C2", keyId: "k2" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("once() fires exactly once", () => {
    const emitter = new PasskeyEventEmitter();
    const listener = vi.fn();
    emitter.once("walletDisconnected", listener);
    emitter.emit("walletDisconnected", { contractId: "C1" });
    emitter.emit("walletDisconnected", { contractId: "C1" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("off() removes a specific listener", () => {
    const emitter = new PasskeyEventEmitter();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on("signerAdded", a);
    emitter.on("signerAdded", b);
    emitter.off("signerAdded", a);
    emitter.emit("signerAdded", {
      contractId: "C1",
      kind: "Ed25519",
      storage: SignerStore.Persistent,
    });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing listener and routes its error to the handler", () => {
    const emitter = new PasskeyEventEmitter();
    const errorHandler = vi.fn();
    emitter.setErrorHandler(errorHandler);

    const good = vi.fn();
    emitter.on("transactionSubmitted", () => {
      throw new Error("bad listener");
    });
    emitter.on("transactionSubmitted", good);

    emitter.emit("transactionSubmitted", { hash: "h1", success: true });
    expect(good).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledTimes(1);
    expect(errorHandler.mock.calls[0]![0]).toBe("transactionSubmitted");
  });

  it("tracks listener counts and clears all listeners", () => {
    const emitter = new PasskeyEventEmitter();
    emitter.on("walletCreated", vi.fn());
    emitter.on("walletCreated", vi.fn());
    expect(emitter.listenerCount("walletCreated")).toBe(2);
    emitter.removeAllListeners("walletCreated");
    expect(emitter.listenerCount("walletCreated")).toBe(0);
  });
});
