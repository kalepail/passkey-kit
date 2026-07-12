/**
 * Browser client for the indexer-proxy (signer discovery, backend toggle).
 *
 * The proxy holds the Mercury / Stellar Indexer credentials; the browser only
 * picks a backend. The JSON wire shape mirrors the SDK's `src/indexer/types.ts`
 * `WalletSigner` (B5 / todo 952) — once B5 exports it under a subpath, swap
 * {@link DiscoveredSigner} for the SDK type. Values are strings/hex because a
 * `SignerKey` class instance and `Uint8Array` can't survive JSON.
 */

import {
  IndexerError,
  PasskeyKitErrorCode,
  type SignerKeyTag,
} from "passkey-kit";

/** The two interchangeable indexer backends. */
export type IndexerBackend = "mercury" | "stellar-indexer";

export const INDEXER_BACKENDS: { id: IndexerBackend; label: string }[] = [
  { id: "mercury", label: "Mercury (Zephyr)" },
  { id: "stellar-indexer", label: "Stellar Indexer" },
];

/** A signer as returned by an indexer backend (JSON wire form). */
export interface DiscoveredSigner {
  key: { kind: SignerKeyTag; value: string };
  /** 65-byte secp256r1 public key, hex-encoded (Secp256r1 signers). */
  publicKey?: string;
  /** Expiration as a UNIX timestamp in seconds (inclusive). */
  expiration?: number;
  /** Per-contract limits: contract id → signer keys (`null`/absent = unlimited). */
  limits?: Record<string, string[] | null> | null;
  storage: "persistent" | "temporary";
  status: "live" | "expired" | "evicted" | "removed";
}

const TIMEOUT_MS = 20_000;

export class IndexerProxyClient {
  constructor(private readonly baseUrl?: string) {}

  /** Whether an indexer-proxy URL is configured (discovery possible). */
  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  /** Enumerate every signer a backend has indexed for a wallet. */
  async getSigners(
    wallet: string,
    backend: IndexerBackend,
  ): Promise<DiscoveredSigner[]> {
    const data = await this.get<DiscoveredSigner[]>("/signers", {
      wallet,
      backend,
    });
    return Array.isArray(data) ? data : [];
  }

  /** Reverse lookup: the wallet contract ids a signer key belongs to. */
  async findWallets(
    key: { kind: SignerKeyTag; value: string },
    backend: IndexerBackend,
  ): Promise<string[]> {
    const data = await this.get<string[]>("/wallets", {
      kind: key.kind,
      value: key.value,
      backend,
    });
    return Array.isArray(data) ? data : [];
  }

  /** Probe backend health (throws IndexerError on transport failure). */
  async health(
    backend: IndexerBackend,
  ): Promise<{ ok: boolean; backend: string; detail?: string }> {
    return this.get("/health", { backend });
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T> {
    if (!this.baseUrl) {
      throw new IndexerError(
        "Indexer proxy is not configured (set VITE_indexerProxyUrl)",
        PasskeyKitErrorCode.INDEXER_NOT_CONFIGURED,
      );
    }

    const url = new URL(
      path.replace(/^\//, ""),
      this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`,
    );
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        throw new IndexerError(
          `Indexer proxy ${path} failed (HTTP ${res.status}): ${text.slice(0, 200)}`,
          PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
          { path, status: res.status, params },
        );
      }
      return (text ? JSON.parse(text) : undefined) as T;
    } catch (err) {
      if (err instanceof IndexerError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new IndexerError(
        aborted
          ? `Indexer proxy ${path} timed out`
          : `Indexer proxy ${path} failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
        PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
        { path, params },
        err instanceof Error ? err : undefined,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
