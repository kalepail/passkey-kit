/**
 * Shared reactive application state (Svelte 5 runes).
 *
 * A single deeply-reactive `$state` object mutated by `actions.ts` and read by
 * components. Kept intentionally small — flows live in `actions.ts`, config +
 * singletons in `config.ts`.
 */

import type { StoredPasskey } from "passkey-kit";
import type { LocalSigner } from "./signers";
import type { DiscoveredSigner, IndexerBackend } from "./indexer-proxy";

export type ConnectionStatus = "disconnected" | "connecting" | "connected";
export type LogLevel = "info" | "success" | "error";

export interface LogEntry {
  id: number;
  at: number;
  level: LogLevel;
  message: string;
  /** Transaction hash → block explorer link. */
  hash?: string;
  /** Secondary line: error code / contract error / ids. */
  detail?: string;
}

export interface AppState {
  ready: boolean;
  status: ConnectionStatus;
  /** Connected passkey keyId (base64url). */
  keyId?: string;
  /** Connected wallet contract id (C…). */
  contractId?: string;
  /** Passkey keyId currently used to authorize writes (admin rotation target). */
  activeKeyId?: string;
  /** Optimistic registry of known signers. */
  signers: LocalSigner[];
  /** Passkeys persisted in the storage adapter (for reconnect UI). */
  knownPasskeys: StoredPasskey[];
  /** Token contract id → balance (stroops). */
  balances: Record<string, string>;
  /** Selected token for transfers/balance. */
  selectedToken: string;
  /** Discovery results from the last indexer query. */
  discovered: DiscoveredSigner[];
  discoverBackend: IndexerBackend;
  /** Runtime-generated ephemeral Ed25519 keypair (demo only; never persisted). */
  ed25519Secret?: string;
  ed25519Public?: string;
  /** Label of the in-flight operation, or null when idle. */
  busy: string | null;
  log: LogEntry[];
}

export const app = $state<AppState>({
  ready: false,
  status: "disconnected",
  signers: [],
  knownPasskeys: [],
  balances: {},
  selectedToken: "",
  discovered: [],
  discoverBackend: "mercury",
  busy: null,
  log: [],
});

let logSeq = 0;

/** Append a log entry (newest first, capped). */
export function pushLog(
  level: LogLevel,
  message: string,
  extra?: { hash?: string; detail?: string },
): void {
  app.log.unshift({
    id: ++logSeq,
    at: Date.now(),
    level,
    message,
    hash: extra?.hash,
    detail: extra?.detail,
  });
  if (app.log.length > 80) app.log.length = 80;
}

/** True when a wallet is connected. */
export function isConnected(): boolean {
  return app.status === "connected" && Boolean(app.contractId);
}
