/**
 * Indexer abstraction: one {@link SignerIndexer} interface, resolved by the
 * keyless {@link MercuryIndexer} backend into the {@link WalletSigner} shape so a
 * signer added through the demo is discoverable and asserted in the browser e2e.
 *
 * @packageDocumentation
 */

import type { SignerKey, SignerLimits } from "../types.js";

/** Storage durability of a signer's ledger entry. */
export type SignerStorageClass = "persistent" | "temporary";

/**
 * Lifecycle status of a signer, derived from the entry + expiration:
 * - `live` — present and not expired.
 * - `expired` — present but past its expiration timestamp.
 * - `evicted` — a temporary entry whose ledger state was evicted (TTL).
 * - `removed` — tombstoned (remove_signer), no live counterpart in either
 *   durability.
 */
export type SignerStatus = "live" | "expired" | "evicted" | "removed";

/** A signer as resolved by an indexer backend. */
export interface WalletSigner {
  /** The signer's key (kind + value). */
  key: SignerKey;
  /** 65-byte secp256r1 public key, for Secp256r1 signers. */
  publicKey?: Uint8Array;
  /**
   * Expiration as a UNIX timestamp in seconds (inclusive), if set. The reworked
   * contract stores expiration as a timestamp, not a ledger sequence (#602).
   */
  expiration?: number;
  /** Per-contract limits (`undefined` = unlimited). */
  limits?: SignerLimits;
  /** Storage durability of the entry. */
  storage: SignerStorageClass;
  /** Derived lifecycle status. */
  status: SignerStatus;
}

/** Health of an indexer backend. */
export interface IndexerHealth {
  /** Whether the backend answered a health probe. */
  ok: boolean;
  /** Backend identifier (e.g. "mercury"). */
  backend: string;
  /** Optional human-readable detail. */
  detail?: string;
}

/**
 * A pluggable signer indexer.
 *
 * Null-tolerant seam (per SAK): a backend that is *not configured* is
 * represented as `null` at the call site (see `forNetwork`); a backend that is
 * configured but *fails* throws; a health/404 degrades to `{ ok: false }`
 * rather than throwing.
 */
export interface SignerIndexer {
  /** Enumerate all signers currently indexed for a wallet. */
  getSigners(wallet: string): Promise<WalletSigner[]>;
  /** Reverse lookup: the wallet contract ids a signer key belongs to. */
  findWallets(key: SignerKey): Promise<string[]>;
  /** Probe backend health (degrades to `{ ok: false }` rather than throwing). */
  health(): Promise<IndexerHealth>;
}

/**
 * Deps for the SDK-side `findWallets` hardening (#598 F3): before trusting a
 * reverse-lookup result, the candidate wallet is confirmed by re-deriving its
 * address from the keyId (deterministic derivation) — no unverified `res[0]`.
 */
export interface FindWalletsHardeningDeps {
  networkPassphrase: string;
  /** The canonical deployer `G…` public key used for derivation. */
  deployerPublicKey: string;
}
