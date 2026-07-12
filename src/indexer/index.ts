/**
 * Indexer abstraction barrel.
 *
 * The {@link SignerIndexer} interface + {@link WalletSigner} types and the pure
 * {@link lookupWithRetry} helper are browser-safe. The concrete backends
 * ({@link MercuryIndexer}, {@link StellarIndexerBackend}) take server-side
 * tokens, so they are re-exported from the `passkey-kit/server` entrypoint.
 *
 * @packageDocumentation
 */

export type {
  SignerIndexer,
  WalletSigner,
  IndexerHealth,
  SignerStatus,
  SignerStorageClass,
  FindWalletsHardeningDeps,
} from "./types.js";

export {
  MercuryIndexer,
  type MercuryIndexerConfig,
  type MercurySignerRow,
} from "./mercury.js";
export {
  StellarIndexerBackend,
  type StellarIndexerConfig,
  type StellarIndexerEntry,
  MAX_CONTRACTS_PER_QUERY,
} from "./stellar-indexer.js";

export {
  signerKeyToContractScVal,
  signerKeyToIndexerJson,
  scValToSignerKey,
  decodeSignerVal,
  deriveStatus,
} from "./codec.js";

import type { SignerIndexer } from "./types.js";
import { MercuryIndexer, type MercuryIndexerConfig } from "./mercury.js";
import {
  StellarIndexerBackend,
  type StellarIndexerConfig,
} from "./stellar-indexer.js";

/**
 * Null-tolerant factory: returns the configured backend, or `null` when no
 * indexer is configured (callers treat `null` as "discovery disabled").
 */
export function indexerForConfig(config?: {
  mercury?: MercuryIndexerConfig;
  stellarIndexer?: StellarIndexerConfig;
}): SignerIndexer | null {
  if (config?.mercury) return new MercuryIndexer(config.mercury);
  if (config?.stellarIndexer) return new StellarIndexerBackend(config.stellarIndexer);
  return null;
}

/**
 * Poll a lookup until it satisfies `predicate` (defaults to "non-empty"), for
 * post-write discovery assertions where the indexer lags the ledger. Defaults
 * to 20 attempts × 2s.
 */
export async function lookupWithRetry<T>(
  fn: () => Promise<T[]>,
  options?: {
    attempts?: number;
    delayMs?: number;
    predicate?: (result: T[]) => boolean;
  }
): Promise<T[]> {
  const attempts = options?.attempts ?? 20;
  const delayMs = options?.delayMs ?? 2000;
  const predicate = options?.predicate ?? ((r) => r.length > 0);

  let last: T[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await fn();
    if (predicate(last)) return last;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return last;
}
