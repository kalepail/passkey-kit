/**
 * Indexer abstraction barrel.
 *
 * The {@link SignerIndexer} interface + {@link WalletSigner} types, the pure
 * {@link lookupWithRetry} helper, and the {@link MercuryIndexer} backend are all
 * browser-safe — Mercury's hosted passkey-indexer is keyless, so nothing here
 * holds a secret — and the whole module is re-exported from the main
 * `passkey-kit` entry.
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
  mercuryPasskeyIndexerUrl,
  type MercuryIndexerConfig,
} from "./mercury.js";
export { MERCURY_PASSKEY_INDEXER_URLS } from "../constants.js";

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
