/**
 * Mercury (Zephyr) indexer backend.
 *
 * Calls the deployed Zephyr program's serverless functions
 * (`get_signers_by_address`, `get_addresses_by_signer`) via
 * `POST {url}/zephyr/execute`. Expiration is treated as a UNIX timestamp
 * (seconds), per the reworked contract (#602).
 *
 * ⚠️ RECONCILIATION NOTE — the query endpoint is STALE (F2b, todo 967).
 * F2 (todo 959 c2502) confirmed `POST /zephyr/execute` returns **404** on the
 * current Mercury `/rest` backend, and Mercury's current docs no longer document
 * the Zephyr execute route at all — custom-program querying moved to
 * "Retroshades" (`POST /rest/retroshade/query` with SQL, e.g.
 * `SELECT * FROM retroshade.program_<id>_<table>`), which requires the reworked
 * `passkey-kit-indexer` program to be deployed (its deploy path is the blocked
 * opus-services workstream).
 *
 * Separately, Mercury now ships a **public, no-auth Smart Account Indexer** for
 * passkey wallets on BOTH networks:
 *   `https://{testnet,mainnet}.mercurydata.app/rest/smart-account-indexer`
 *     GET /api/contract/:contractId        -> signers (this backend's getSigners)
 *     GET /api/lookup/:credentialId        -> wallets by passkey keyId (findWallets)
 *     GET /api/lookup/address/:address     -> wallets by signer address
 * That likely obviates the custom Zephyr deploy entirely. It is NOT wired here
 * yet because (a) its `GET /api/contract/:contractId` signer response schema is
 * not published, and (b) its data model (context rules; native/external/
 * delegated signers; policies) may not map 1:1 onto this backend's v1
 * `SignerKey`/`SignerVal`/`SignerLimits`/durability/status. Reconciling needs a
 * captured live response + a model-mapping decision — coordinated with
 * opus-services' deploy characterization on todo 967.
 *
 * Because A-vs-B is a pending USER decision, this backend is NOT re-pointed at
 * either surface. Instead it is GATED: unless {@link MercuryIndexerConfig.zephyrExecuteConfirmed}
 * is set, every query throws a clear "pending" error (todo 967) rather than
 * firing at the dead `/zephyr/execute` route — honest failure, no silent 404.
 *
 * @packageDocumentation
 */

import { xdr } from "@stellar/stellar-sdk";
import { Durability, type Server } from "@stellar/stellar-sdk/rpc";
import { SignerKey } from "../types.js";
import { IndexerError, PasskeyKitErrorCode } from "../errors.js";
import { DEFAULT_INDEXER_TIMEOUT_MS } from "../constants.js";
import { getSigner } from "../kit/wallet-ops.js";
import { contractDataExists } from "../rpc-data.js";
import base64url from "../base64url.js";
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
  signerKeyToContractScVal,
  walletSpec,
} from "./codec.js";
import { deriveContractAddress } from "../utils.js";

/** A raw signer row returned by the Zephyr program (documented shape). */
export interface MercurySignerRow {
  kind: "Secp256r1" | "Ed25519" | "Policy";
  /** Signer key: base64url keyId (Secp256r1), hex pubkey (Ed25519), or address. */
  key: string;
  /** Base64 XDR of the stored SignerVal. */
  val: string;
  /** Storage durability. */
  storage: "Persistent" | "Temporary";
  evicted?: boolean;
}

export interface MercuryIndexerConfig {
  url: string;
  projectName: string;
  jwt?: string;
  apiKey?: string;
  /** RPC server — enables the temporary-signer eviction probe + findWallets hardening. */
  rpc?: Server;
  /** Deps that let findWallets confirm candidates by deterministic derivation. */
  hardening?: FindWalletsHardeningDeps;
  /** Clock source (seconds); injectable for tests. Defaults to `Date.now()`. */
  now?: () => number;
  /**
   * OPT-IN to the (currently non-functional) `POST /zephyr/execute` query path.
   *
   * The Mercury query integration is PENDING a strategy decision the USER owns
   * (todo 967): the SDK's assumed `/zephyr/execute` route is RETIRED — it 404s
   * even with a valid JWT (F2b, todo 959 c2502/2504). The two unresolved options:
   *   A. Mercury's hosted Smart Account Indexer REST surface
   *      (`/rest/smart-account-indexer/api/lookup/*`) — the same product
   *      smart-account-kit uses; would need Mercury to index passkey-kit's wasm.
   *   B. Keep this self-deployed zephyr program model and obtain the current
   *      Mercury deploy + query tooling.
   * Until that lands the backend is GATED: unless this is `true`, every query
   * throws a clear "pending" {@link IndexerError} instead of silently 404-ing.
   * Set it to `true` only once strategy B has a live endpoint at `url`.
   */
  zephyrExecuteConfirmed?: boolean;
}

export class MercuryIndexer implements SignerIndexer {
  constructor(private readonly config: MercuryIndexerConfig) {
    if (!config.url || !config.projectName) {
      throw new IndexerError(
        "MercuryIndexer requires url and projectName",
        PasskeyKitErrorCode.INDEXER_NOT_CONFIGURED
      );
    }
  }

  private nowSeconds(): number {
    return this.config.now ? this.config.now() : Math.floor(Date.now() / 1000);
  }

  private async execute<T>(fname: string, args: unknown): Promise<T> {
    // Gate: the `/zephyr/execute` route is retired (404) and the replacement is
    // a pending user decision (todo 967). Fail loud + actionable rather than
    // firing a request that just 404s. `health()` catches this → `{ ok: false }`.
    if (!this.config.zephyrExecuteConfirmed) {
      throw new IndexerError(
        "Mercury query integration is pending a strategy decision (todo 967): the assumed " +
          "POST /zephyr/execute route is retired (404 with a valid JWT). Resolve strategy A " +
          "(hosted Smart Account Indexer /rest/smart-account-indexer) vs B (self-deployed zephyr " +
          "program + current tooling), then wire the chosen endpoint. Set " +
          "zephyrExecuteConfirmed:true to force the legacy path once B has a live endpoint.",
        PasskeyKitErrorCode.INDEXER_NOT_CONFIGURED
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DEFAULT_INDEXER_TIMEOUT_MS
    );
    try {
      const response = await fetch(`${this.config.url}/zephyr/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.config.jwt
            ? `Bearer ${this.config.jwt}`
            : this.config.apiKey ?? "",
        },
        body: JSON.stringify({
          project_name: this.config.projectName,
          mode: { Function: { fname, arguments: JSON.stringify(args) } },
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new IndexerError(
          `Mercury ${fname} failed (${response.status}): ${body.slice(0, 200)}`,
          PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
          { fname, status: response.status }
        );
      }
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof IndexerError) throw err;
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new IndexerError(
        aborted ? `Mercury ${fname} timed out` : String(err),
        PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
        { fname },
        err instanceof Error ? err : undefined
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private rowToWalletSigner(row: MercurySignerRow): WalletSigner {
    const key = signerKeyFromRow(row);
    const decoded = decodeSignerVal(
      xdr.ScVal.fromXDR(Buffer.from(row.val, "base64"))
    );
    const storage: SignerStorageClass =
      row.storage === "Temporary" ? "temporary" : "persistent";
    const status = deriveStatus({
      expiration: decoded.expiration,
      evicted: row.evicted,
      nowSeconds: this.nowSeconds(),
    });
    return buildWalletSigner(key, decoded, storage, status);
  }

  async getSigners(wallet: string): Promise<WalletSigner[]> {
    const rows = await this.execute<MercurySignerRow[]>(
      "get_signers_by_address",
      { address: wallet }
    );

    // Eviction probe: Mercury cannot observe temporary-entry eviction, so
    // confirm temporary signers still exist on-chain (per #598 F6).
    if (this.config.rpc) {
      for (const row of rows) {
        if (row.storage === "Temporary" && !row.evicted) {
          try {
            row.evicted = !(await this.entryExists(wallet, row));
          } catch {
            // Transport error (429/5xx/timeout): eviction is undeterminable, so
            // leave the row as the indexer reported it rather than
            // false-evicting a live signer.
          }
        }
      }
    }

    return rows.map((row) => this.rowToWalletSigner(row));
  }

  /**
   * Whether the signer's temporary ledger entry still exists on-chain. Probes by
   * the `SignerKey` ScVal — the exact key the contract stores the entry under
   * (`storage().temporary().set::<SignerKey, SignerVal>`), NOT the raw keyId
   * bytes — so it actually matches. Throws on a transport error (caller decides
   * eviction only from a genuine not-found).
   */
  private async entryExists(
    wallet: string,
    row: MercurySignerRow
  ): Promise<boolean> {
    return contractDataExists(
      this.config.rpc!,
      wallet,
      signerKeyToContractScVal(signerKeyFromRow(row)),
      Durability.Temporary
    );
  }

  async findWallets(key: SignerKey): Promise<string[]> {
    const args = signerToReverseArgs(key);
    const candidates = await this.execute<string[]>(
      "get_addresses_by_signer",
      args
    );
    return this.confirmCandidates(candidates, key);
  }

  /**
   * Harden the reverse lookup (#598 F3): keep a candidate only if it is either
   * the deterministic derivation of the keyId OR still holds the signer entry
   * on-chain — never trust an unverified indexer row.
   */
  private async confirmCandidates(
    candidates: string[],
    key: SignerKey
  ): Promise<string[]> {
    const { rpc, hardening } = this.config;
    if (!rpc && !hardening) return candidates; // nothing to verify with

    const derived =
      hardening && key.key === "Secp256r1"
        ? deriveContractAddress(
            base64url.toBuffer(key.value),
            hardening.deployerPublicKey,
            hardening.networkPassphrase
          )
        : undefined;

    const confirmed: string[] = [];
    for (const candidate of candidates) {
      if (candidate === derived) {
        confirmed.push(candidate);
        continue;
      }
      if (rpc) {
        const signer = await getSigner({ rpc, spec: walletSpec() }, candidate, key);
        if (signer) confirmed.push(candidate);
      }
    }
    return confirmed;
  }

  async health(): Promise<IndexerHealth> {
    try {
      await this.execute<unknown>("get_signers_by_address", {
        address: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      });
      return { ok: true, backend: "mercury" };
    } catch (err) {
      return {
        ok: false,
        backend: "mercury",
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function signerKeyFromRow(row: MercurySignerRow): SignerKey {
  switch (row.kind) {
    case "Secp256r1":
      return SignerKey.Secp256r1(row.key);
    case "Ed25519":
      return SignerKey.Ed25519(row.key);
    case "Policy":
      return SignerKey.Policy(row.key);
  }
}

function signerToReverseArgs(key: SignerKey): {
  key: string;
  kind: "Secp256r1" | "Ed25519" | "Policy";
} {
  return { key: key.value, kind: key.key };
}
