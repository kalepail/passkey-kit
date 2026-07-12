/**
 * Stellar Indexer backend (Creit Tech), over `POST /v1/contract-data/`.
 *
 * The wallet stores one top-level contract-data entry per signer
 * (`key = SignerKey ScVal`, `val = SignerVal`), so signer enumeration is a
 * contract-scoped query and reverse lookup is derive-then-confirm: derive the
 * wallet address from the keyId, then confirm the signer entry exists there.
 * Removed signers appear as tombstoned (`deleted_at`) entries.
 *
 * WIRE NOTE: the exact request/response field names, key/val encoding (base64
 * XDR vs JSON ScVal), and the `deleted_at` shape are confirmed live against the
 * beta API in F2. This codes to the documented shape; adjust the small
 * `parseEntry`/`buildBody` seams if F2 shows otherwise.
 *
 * @packageDocumentation
 */

import { xdr } from "@stellar/stellar-sdk";
import { SignerKey } from "../types.js";
import { IndexerError, PasskeyKitErrorCode } from "../errors.js";
import { DEFAULT_INDEXER_TIMEOUT_MS } from "../constants.js";
import { deriveContractAddress } from "../utils.js";
import type {
  FindWalletsHardeningDeps,
  IndexerHealth,
  SignerIndexer,
  SignerStorageClass,
  WalletSigner,
} from "./types.js";
import {
  buildWalletSigner,
  decodeSignerVal,
  deriveStatus,
  scValToSignerKey,
  signerKeyToIndexerJson,
} from "./codec.js";

/** Max contract ids per contract-data request (API cap). */
export const MAX_CONTRACTS_PER_QUERY = 25;

/** A raw contract-data entry (documented shape; F2-confirmed). */
export interface StellarIndexerEntry {
  key: string; // base64 XDR of the SignerKey ScVal
  val: string; // base64 XDR of the SignerVal ScVal
  durability: "persistent" | "temporary";
  deleted_at: string | null;
}

export interface StellarIndexerConfig {
  /** Base URL, e.g. https://api.stellarindexer.com */
  url: string;
  /** Bearer access token (server-side secret). */
  accessToken: string;
  /** Deps enabling derive-then-confirm reverse lookup. */
  hardening?: FindWalletsHardeningDeps;
  /** Clock source (seconds); injectable for tests. */
  now?: () => number;
}

export class StellarIndexerBackend implements SignerIndexer {
  constructor(private readonly config: StellarIndexerConfig) {
    if (!config.url || !config.accessToken) {
      throw new IndexerError(
        "StellarIndexerBackend requires url and accessToken",
        PasskeyKitErrorCode.INDEXER_NOT_CONFIGURED
      );
    }
  }

  private nowSeconds(): number {
    return this.config.now ? this.config.now() : Math.floor(Date.now() / 1000);
  }

  private async query(body: {
    contracts: string[];
    key?: unknown;
  }): Promise<StellarIndexerEntry[]> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DEFAULT_INDEXER_TIMEOUT_MS
    );
    try {
      const response = await fetch(`${this.config.url}/v1/contract-data/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new IndexerError(
          `Stellar Indexer request failed (${response.status}): ${text.slice(0, 200)}`,
          PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
          { status: response.status }
        );
      }
      const json = (await response.json()) as unknown;
      return extractEntries(json);
    } catch (err) {
      if (err instanceof IndexerError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new IndexerError(
        aborted ? "Stellar Indexer request timed out" : String(err),
        PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
        undefined,
        err instanceof Error ? err : undefined
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getSigners(wallet: string): Promise<WalletSigner[]> {
    const entries = await this.query({ contracts: [wallet] });
    return this.entriesToSigners(entries);
  }

  /**
   * Group entries by signer key and resolve status. A key with any live entry
   * is live/expired; a key whose every entry is tombstoned (no live counterpart
   * in either durability) is `removed`.
   */
  entriesToSigners(entries: StellarIndexerEntry[]): WalletSigner[] {
    const groups = new Map<string, StellarIndexerEntry[]>();
    for (const entry of entries) {
      const list = groups.get(entry.key) ?? [];
      list.push(entry);
      groups.set(entry.key, list);
    }

    const signers: WalletSigner[] = [];
    for (const [, group] of groups) {
      const live = group.find((e) => e.deleted_at == null);
      const chosen = live ?? group[0]!;
      const key = scValToSignerKey(
        xdr.ScVal.fromXDR(Buffer.from(chosen.key, "base64"))
      );
      const decoded = decodeSignerVal(
        xdr.ScVal.fromXDR(Buffer.from(chosen.val, "base64"))
      );
      const storage: SignerStorageClass = chosen.durability;
      const status = live
        ? deriveStatus({
            expiration: decoded.expiration,
            nowSeconds: this.nowSeconds(),
          })
        : "removed";
      signers.push(buildWalletSigner(key, decoded, storage, status));
    }
    return signers;
  }

  /**
   * Reverse lookup via derive-then-confirm. Only Secp256r1 keyIds are
   * derivable; Ed25519/Policy signers are not discoverable through this backend
   * (use Mercury's event-driven index for those).
   */
  async findWallets(key: SignerKey): Promise<string[]> {
    if (key.key !== "Secp256r1") {
      return [];
    }
    if (!this.config.hardening) {
      throw new IndexerError(
        "findWallets requires hardening deps (networkPassphrase + deployerPublicKey) to derive candidates",
        PasskeyKitErrorCode.INDEXER_NOT_CONFIGURED
      );
    }

    const candidate = deriveContractAddress(
      Buffer.from(key.value, "base64url"),
      this.config.hardening.deployerPublicKey,
      this.config.hardening.networkPassphrase
    );

    const entries = await this.query({
      contracts: [candidate],
      key: signerKeyToIndexerJson(key),
    });

    // Confirmed only if the derived wallet holds a live entry for this key.
    const live = entries.some((e) => e.deleted_at == null);
    return live ? [candidate] : [];
  }

  async health(): Promise<IndexerHealth> {
    try {
      await this.query({
        contracts: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"],
      });
      return { ok: true, backend: "stellar-indexer" };
    } catch (err) {
      return {
        ok: false,
        backend: "stellar-indexer",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/** Tolerantly pull the entries array out of a few likely response shapes. */
function extractEntries(json: unknown): StellarIndexerEntry[] {
  if (Array.isArray(json)) return json as StellarIndexerEntry[];
  const obj = json as { entries?: unknown; data?: unknown } | null;
  if (obj && Array.isArray(obj.entries)) return obj.entries as StellarIndexerEntry[];
  if (obj && Array.isArray(obj.data)) return obj.data as StellarIndexerEntry[];
  return [];
}
