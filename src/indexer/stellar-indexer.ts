/**
 * Stellar Indexer backend (Creit Tech), over `POST /v1/contract-data/`.
 *
 * The wallet stores one top-level contract-data entry per signer
 * (`key = SignerKey ScVal`, `val = SignerVal`), so signer enumeration is a
 * contract-scoped query and reverse lookup is derive-then-confirm: derive the
 * wallet address from the keyId, then confirm the signer entry exists there.
 * Removed signers appear as tombstoned (`deleted_at`) entries.
 *
 * WIRE FORMAT (F2-confirmed, todo 959 c2502 / todo 967):
 * - The live API returns each entry's `key`/`val` as **JSON ScVal**, e.g.
 *   `{"vec":[{"symbol":"Secp256r1"},{"bytes":"<hex>"}]}` — NOT base64 XDR. We
 *   convert JSON ScVal -> `xdr.ScVal` ({@link jsonScValToXdr}) and reuse the
 *   contract-spec decoders (`scValToSignerKey`/`decodeSignerVal`). The JSON
 *   convention is the standard Stellar one: `symbol`, `bytes` (hex), `address`
 *   (strkey), `vec` (array), `map` (`[{key,val}]`), `u64`/`i64` (string),
 *   `u32`/`i32` (number), `bool`, `string`, `void` (None).
 * - Entry fields: `id, contract_id, durability, key, val,
 *   last_modified_ledger_seq, tx_meta_version, timestamp, created_at,
 *   updated_at, deleted_at`.
 *
 * NETWORK: **the Stellar Indexer indexes MAINNET only** — a testnet contract
 * returns HTTP 200 with zero entries (F2). To keep "unsupported network" from
 * masquerading as "wallet has no signers", the backend is network-aware: use
 * {@link StellarIndexerBackend.forNetwork} (returns `null` off mainnet), and a
 * config pinned to a non-mainnet passphrase throws at construction rather than
 * silently returning `[]`. Live validation therefore needs a mainnet v1 wallet
 * (endgame-gated); until then this is unit-tested against the documented shape.
 *
 * @packageDocumentation
 */

import { Address, Networks, nativeToScVal, xdr } from "@stellar/stellar-sdk";
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

/** The only network the Stellar Indexer indexes (mainnet). */
export const STELLAR_INDEXER_NETWORK = Networks.PUBLIC;

/**
 * A raw contract-data entry (F2-confirmed live shape). `key`/`val` are JSON
 * ScVal objects (see {@link jsonScValToXdr}), not base64-XDR strings; the extra
 * fields are carried through untyped since only these four drive decoding.
 */
export interface StellarIndexerEntry {
  /** JSON ScVal of the SignerKey. */
  key: unknown;
  /** JSON ScVal of the SignerVal. */
  val: unknown;
  durability: "persistent" | "temporary";
  deleted_at: string | null;
  id?: string;
  contract_id?: string;
  last_modified_ledger_seq?: number;
  tx_meta_version?: string | number;
  timestamp?: string;
  created_at?: string;
  updated_at?: string;
}

export interface StellarIndexerConfig {
  /** Base URL, e.g. https://api.stellarindexer.com */
  url: string;
  /** Bearer access token (server-side secret). */
  accessToken: string;
  /**
   * Network passphrase this backend serves. The Stellar Indexer indexes mainnet
   * only; a non-mainnet passphrase throws at construction (prefer
   * {@link StellarIndexerBackend.forNetwork} to get a `null` off mainnet). When
   * omitted, mainnet is assumed.
   */
  networkPassphrase?: string;
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
    if (
      config.networkPassphrase &&
      config.networkPassphrase !== STELLAR_INDEXER_NETWORK
    ) {
      throw new IndexerError(
        `Stellar Indexer indexes mainnet only; refusing a backend pinned to "${config.networkPassphrase}". ` +
          `Use StellarIndexerBackend.forNetwork(...) to get null off mainnet.`,
        PasskeyKitErrorCode.INDEXER_NOT_CONFIGURED
      );
    }
  }

  /**
   * Network-aware factory: the backend for mainnet, or `null` for any other
   * network (the Stellar Indexer doesn't index testnet, so "discovery disabled"
   * is the honest answer — callers treat `null` as no-indexer rather than an
   * empty signer set).
   */
  static forNetwork(
    config: Omit<StellarIndexerConfig, "networkPassphrase">,
    networkPassphrase: string
  ): StellarIndexerBackend | null {
    if (networkPassphrase !== STELLAR_INDEXER_NETWORK) return null;
    return new StellarIndexerBackend({ ...config, networkPassphrase });
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
      // Group on the raw JSON ScVal of the key (identical signer keys serialize
      // identically); decode once per group below.
      const groupKey = JSON.stringify(entry.key);
      const list = groups.get(groupKey) ?? [];
      list.push(entry);
      groups.set(groupKey, list);
    }

    const signers: WalletSigner[] = [];
    for (const [, group] of groups) {
      const live = group.find((e) => e.deleted_at == null);
      const chosen = live ?? group[0]!;
      const key = scValToSignerKey(jsonScValToXdr(chosen.key));
      const decoded = decodeSignerVal(jsonScValToXdr(chosen.val));
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

/**
 * Pull the entries array out of a few known response shapes.
 *
 * A genuinely empty response (`null`/`undefined` or `{}`) yields `[]`, but an
 * UNRECOGNIZED non-empty envelope throws rather than silently degrading to `[]`:
 * conflating "shape changed" with "wallet has no signers" would burn the whole
 * retry budget and then report a valid wallet as signer-less (audit LOW).
 */
function extractEntries(json: unknown): StellarIndexerEntry[] {
  if (Array.isArray(json)) return json as StellarIndexerEntry[];
  if (json == null) return [];
  if (typeof json === "object") {
    const obj = json as { entries?: unknown; data?: unknown };
    if (Array.isArray(obj.entries)) return obj.entries as StellarIndexerEntry[];
    if (Array.isArray(obj.data)) return obj.data as StellarIndexerEntry[];
    if (Object.keys(obj).length === 0) return []; // genuinely-empty object
  }
  throw new IndexerError(
    "Unrecognized Stellar Indexer response shape (expected an array or { entries | data: [...] })",
    PasskeyKitErrorCode.INDEXER_REQUEST_FAILED
  );
}

/**
 * Convert a Stellar JSON-ScVal object into an `xdr.ScVal`.
 *
 * The Stellar Indexer serializes ledger-entry `key`/`val` as JSON ScVal — a
 * single-key object per value (`{"vec":[...]}`, `{"symbol":"…"}`, …). This is
 * the inverse of that serialization for the variants a smart-wallet
 * SignerKey/SignerVal can contain, letting the contract-spec decoders take over.
 *
 * Unknown variant keys THROW (never silently misdecode): an unexpected wire
 * shape must surface as an error, not a wrong signer.
 */
export function jsonScValToXdr(json: unknown): xdr.ScVal {
  // Some encoders represent `void`/None as a bare null.
  if (json === null || json === undefined) return xdr.ScVal.scvVoid();
  if (typeof json !== "object") {
    throw new IndexerError(
      `Unrecognized JSON ScVal (not an object): ${JSON.stringify(json)}`,
      PasskeyKitErrorCode.INDEXER_REQUEST_FAILED
    );
  }

  const obj = json as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length !== 1) {
    throw new IndexerError(
      `Unrecognized JSON ScVal (expected exactly one type key): ${JSON.stringify(keys)}`,
      PasskeyKitErrorCode.INDEXER_REQUEST_FAILED
    );
  }
  const tag = keys[0]!;
  const v = obj[tag];

  switch (tag) {
    case "void":
      return xdr.ScVal.scvVoid();
    case "bool":
      return xdr.ScVal.scvBool(Boolean(v));
    case "u32":
      return xdr.ScVal.scvU32(Number(v));
    case "i32":
      return xdr.ScVal.scvI32(Number(v));
    case "u64":
      return nativeToScVal(BigInt(v as string | number), { type: "u64" });
    case "i64":
      return nativeToScVal(BigInt(v as string | number), { type: "i64" });
    case "timepoint":
      return nativeToScVal(BigInt(v as string | number), { type: "timepoint" });
    case "duration":
      return nativeToScVal(BigInt(v as string | number), { type: "duration" });
    case "u128":
      return nativeToScVal(bigIntOfParts(v), { type: "u128" });
    case "i128":
      return nativeToScVal(bigIntOfParts(v), { type: "i128" });
    case "u256":
      return nativeToScVal(bigIntOfParts(v), { type: "u256" });
    case "i256":
      return nativeToScVal(bigIntOfParts(v), { type: "i256" });
    case "bytes":
      return xdr.ScVal.scvBytes(Buffer.from(String(v), "hex"));
    case "string":
      return xdr.ScVal.scvString(String(v));
    case "symbol":
      return xdr.ScVal.scvSymbol(String(v));
    case "address":
      return Address.fromString(String(v)).toScVal();
    case "vec":
      return xdr.ScVal.scvVec((v as unknown[]).map(jsonScValToXdr));
    case "map":
      return xdr.ScVal.scvMap(
        (v as Array<{ key: unknown; val: unknown }>).map(
          (e) =>
            new xdr.ScMapEntry({
              key: jsonScValToXdr(e.key),
              val: jsonScValToXdr(e.val),
            })
        )
      );
    default:
      throw new IndexerError(
        `Unsupported JSON ScVal type "${tag}"`,
        PasskeyKitErrorCode.INDEXER_REQUEST_FAILED
      );
  }
}

/**
 * Coerce a large-integer JSON ScVal value to a bigint, accepting either a
 * decimal string/number or a `{ hi, lo }` multi-part object (the exact 128/256
 * wire shape is undocumented and unused by SignerVal — u64 covers expiration —
 * so this stays tolerant).
 */
function bigIntOfParts(v: unknown): bigint {
  if (typeof v === "string" || typeof v === "number") return BigInt(v);
  if (v && typeof v === "object" && "hi" in v && "lo" in v) {
    const { hi, lo } = v as { hi: string | number; lo: string | number };
    return (BigInt(hi) << 64n) | BigInt(lo);
  }
  throw new IndexerError(
    `Unrecognized large-integer JSON ScVal value: ${JSON.stringify(v)}`,
    PasskeyKitErrorCode.INDEXER_REQUEST_FAILED
  );
}
