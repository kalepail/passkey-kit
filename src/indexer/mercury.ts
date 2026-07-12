/**
 * Mercury (Zephyr) indexer backend.
 *
 * Calls the deployed Zephyr program's serverless functions
 * (`get_signers_by_address`, `get_addresses_by_signer`) via
 * `POST {url}/zephyr/execute`.
 *
 * C1 ALIGNMENT: the exact row/argument shapes are finalized by the reworked
 * Zephyr program (todo C1). This maps the documented shapes and is reconciled in
 * F2's live cross-backend check. Expiration is treated as a UNIX timestamp
 * (seconds), per the reworked contract (#602).
 *
 * @packageDocumentation
 */

import { xdr } from "@stellar/stellar-sdk";
import { Durability, type Server } from "@stellar/stellar-sdk/rpc";
import { SignerKey } from "../types.js";
import { IndexerError, PasskeyKitErrorCode } from "../errors.js";
import { DEFAULT_INDEXER_TIMEOUT_MS } from "../constants.js";
import { getSigner } from "../kit/wallet-ops.js";
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
          row.evicted = !(await this.entryExists(wallet, row));
        }
      }
    }

    return rows.map((row) => this.rowToWalletSigner(row));
  }

  private async entryExists(
    wallet: string,
    row: MercurySignerRow
  ): Promise<boolean> {
    try {
      await this.config.rpc!.getContractData(
        wallet,
        xdr.ScVal.scvBytes(base64url.toBuffer(row.key)),
        Durability.Temporary
      );
      return true;
    } catch {
      return false;
    }
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
