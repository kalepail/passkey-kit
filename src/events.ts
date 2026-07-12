/**
 * Typed event emitter for passkey / wallet lifecycle events.
 *
 * `on()` returns an unsubscribe function; a listener that throws is isolated so
 * it never prevents the other listeners from running.
 *
 * @packageDocumentation
 */

import type { SignerStore } from "./types.js";

/**
 * The events the kit can emit, mapped to their payload shapes.
 */
export type PasskeyEventMap = {
  /** A new wallet was deployed. */
  walletCreated: { contractId: string; keyId: string };

  /** An existing wallet was connected. */
  walletConnected: { contractId: string; keyId: string };

  /** The connected wallet was disconnected. */
  walletDisconnected: { contractId: string };

  /** A signer was added to the connected wallet. */
  signerAdded: {
    contractId: string;
    kind: "Policy" | "Ed25519" | "Secp256r1";
    storage: SignerStore;
  };

  /** A signer was updated on the connected wallet. */
  signerUpdated: {
    contractId: string;
    kind: "Policy" | "Ed25519" | "Secp256r1";
    storage: SignerStore;
  };

  /** A signer was removed from the connected wallet. */
  signerRemoved: {
    contractId: string;
    kind: "Policy" | "Ed25519" | "Secp256r1";
  };

  /** An authorization entry was signed. */
  transactionSigned: { contractId: string; keyId?: string };

  /** A transaction was submitted. */
  transactionSubmitted: { hash: string; success: boolean };
};

/** The set of event names the kit emits. */
export type PasskeyEvent = keyof PasskeyEventMap;

/** An event listener. */
export type EventListener<T> = (data: T) => void;

/**
 * Default handler for errors thrown by listeners: log to the console so a
 * misbehaving listener is visible rather than silently swallowed.
 */
function defaultListenerErrorHandler(
  event: PasskeyEvent,
  error: unknown
): void {
  console.error(`[PasskeyKit] Listener for "${event}" threw:`, error);
}

/**
 * A small typed event emitter for passkey lifecycle events.
 *
 * @example
 * ```typescript
 * const events = new PasskeyEventEmitter();
 * const off = events.on("walletConnected", ({ contractId }) => {
 *   console.log("connected", contractId);
 * });
 * events.emit("walletConnected", { contractId: "C…", keyId: "…" });
 * off();
 * ```
 */
export class PasskeyEventEmitter {
  private listeners: Map<
    PasskeyEvent,
    Set<EventListener<PasskeyEventMap[PasskeyEvent]>>
  > = new Map();

  private errorHandler:
    | ((event: PasskeyEvent, error: unknown) => void)
    | undefined = defaultListenerErrorHandler;

  /**
   * Set the handler invoked when a listener throws. Pass `undefined` to silence
   * listener errors entirely.
   */
  setErrorHandler(
    handler: ((event: PasskeyEvent, error: unknown) => void) | undefined
  ): void {
    this.errorHandler = handler;
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<E extends PasskeyEvent>(
    event: E,
    listener: EventListener<PasskeyEventMap[E]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const listeners = this.listeners.get(event)!;
    listeners.add(
      listener as EventListener<PasskeyEventMap[PasskeyEvent]>
    );
    return () => {
      listeners.delete(
        listener as EventListener<PasskeyEventMap[PasskeyEvent]>
      );
    };
  }

  /** Subscribe to an event, firing at most once. Returns an unsubscribe fn. */
  once<E extends PasskeyEvent>(
    event: E,
    listener: EventListener<PasskeyEventMap[E]>
  ): () => void {
    const unsubscribe = this.on(event, (data) => {
      unsubscribe();
      listener(data);
    });
    return unsubscribe;
  }

  /** Unsubscribe a specific listener from an event. */
  off<E extends PasskeyEvent>(
    event: E,
    listener: EventListener<PasskeyEventMap[E]>
  ): void {
    this.listeners
      .get(event)
      ?.delete(listener as EventListener<PasskeyEventMap[PasskeyEvent]>);
  }

  /** Emit an event to all subscribers, isolating any that throw. */
  emit<E extends PasskeyEvent>(event: E, data: PasskeyEventMap[E]): void {
    const listeners = this.listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(data);
      } catch (err) {
        this.errorHandler?.(event, err);
      }
    }
  }

  /** Remove all listeners for an event, or for every event when omitted. */
  removeAllListeners(event?: PasskeyEvent): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  /** Number of listeners registered for an event. */
  listenerCount(event: PasskeyEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}
