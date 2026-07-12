/**
 * `PasskeyServer` — the SERVER-ONLY counterpart to {@link PasskeyKit}.
 *
 * It holds secrets (the relayer API key, indexer JWTs) and therefore must never
 * run in a browser bundle: it is exported exclusively from the
 * `passkey-kit/server` subpath so a bundler can't pull it into client code, and
 * its config must come from server-side environment variables (never
 * `VITE_`-prefixed).
 *
 * Responsibilities: fee-sponsored submission via {@link RelayerClient} and
 * signer discovery via an indexer. The indexer methods here are a server-side
 * Mercury port; B5 (todo 952) replaces them with the `SignerIndexer` abstraction
 * over both Mercury and Stellar Indexer backends.
 *
 * @packageDocumentation
 */

import {
  Operation,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { Durability, Server } from "@stellar/stellar-sdk/rpc";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { RelayerClient, type RelayerClientConfig, type RelayerSubmitOptions } from "./relayer.js";
import {
  ConfigurationError,
  IndexerError,
  RelayerError,
  PasskeyKitErrorCode,
} from "./errors.js";
import { failedTransaction } from "./contract-errors.js";
import { contractDataExists } from "./rpc-data.js";
import { signerKeyToContractScVal } from "./indexer/codec.js";
import { DEFAULT_INDEXER_TIMEOUT_MS } from "./constants.js";
import { SignerKey } from "./types.js";
import type { IndexedSigner, TransactionResult } from "./types.js";

// Re-export the relayer surface so `passkey-kit/server` is the single
// server-only entrypoint (secrets never reach the browser bundle).
export {
  RelayerClient,
  type RelayerClientConfig,
  type RelayerSubmitOptions,
} from "./relayer.js";

// Token-holding indexer backends (server-side only).
export {
  MercuryIndexer,
  StellarIndexerBackend,
  indexerForConfig,
  type MercuryIndexerConfig,
  type StellarIndexerConfig,
} from "./indexer/index.js";

/** Mercury indexer (Zephyr) configuration. */
export interface MercuryConfig {
  /** Mercury base URL (e.g. https://api.mercurydata.app). */
  url: string;
  /** Deployed Zephyr project name. */
  projectName: string;
  /** Bearer JWT (server-side secret). Prefer this over `apiKey`. */
  jwt?: string;
  /** Raw API key (server-side secret). */
  apiKey?: string;
}

/** Configuration for a {@link PasskeyServer}. */
export interface PasskeyServerConfig {
  /** Network passphrase (required). */
  networkPassphrase: string;
  /** Stellar RPC URL (needed for temporary-signer eviction probes). */
  rpcUrl?: string;
  /** Relayer configuration for fee-sponsored submission. */
  relayer?: RelayerClientConfig;
  /** Mercury indexer configuration. */
  mercury?: MercuryConfig;
}

/** Normalize any submittable input to a built {@link Transaction}. */
function toBuiltTransaction(
  input: AssembledTransaction<unknown> | Transaction | string,
  networkPassphrase: string
): Transaction {
  if (typeof input === "string") {
    return TransactionBuilder.fromXDR(input, networkPassphrase) as Transaction;
  }
  if (input instanceof AssembledTransaction) {
    if (!input.built) {
      throw new RelayerError(
        "AssembledTransaction has not been built/simulated yet",
        PasskeyKitErrorCode.RELAYER_REQUEST_FAILED
      );
    }
    return input.built;
  }
  return input;
}

/** Map an indexer row's `{ kind, key }` to the SDK-side {@link SignerKey}. */
function indexedSignerToKey(signer: IndexedSigner): SignerKey {
  switch (signer.kind) {
    case "Ed25519":
      return SignerKey.Ed25519(signer.key);
    case "Policy":
      return SignerKey.Policy(signer.key);
    default:
      return SignerKey.Secp256r1(signer.key);
  }
}

/** Whether any invokeHostFunction op carries source-account auth. */
function hasSourceAccountAuth(transaction: Transaction): boolean {
  for (const op of transaction.operations) {
    if (op.type !== "invokeHostFunction") continue;
    for (const entry of (op as Operation.InvokeHostFunction).auth ?? []) {
      if (entry.credentials().switch().name === "sorobanCredentialsSourceAccount") {
        return true;
      }
    }
  }
  return false;
}

export class PasskeyServer {
  readonly networkPassphrase: string;
  readonly rpc?: Server;

  private readonly relayer?: RelayerClient;
  private readonly mercury?: MercuryConfig;

  constructor(config: PasskeyServerConfig) {
    if (!config.networkPassphrase) {
      throw new ConfigurationError(
        "networkPassphrase is required",
        PasskeyKitErrorCode.MISSING_CONFIG
      );
    }
    this.networkPassphrase = config.networkPassphrase;

    if (config.rpcUrl) {
      this.rpc = new Server(config.rpcUrl);
    }
    if (config.relayer) {
      this.relayer = new RelayerClient(config.relayer);
    }
    if (config.mercury) {
      if (!config.mercury.jwt && !config.mercury.apiKey) {
        throw new ConfigurationError(
          "Mercury config requires a jwt or apiKey",
          PasskeyKitErrorCode.INVALID_CONFIG
        );
      }
      this.mercury = config.mercury;
    }
  }

  // -- Submission --------------------------------------------------------------

  /**
   * Submit a transaction via the relayer for fee sponsorship.
   *
   * invokeHostFunction transactions without source-account auth use the preferred
   * `{ func, auth }` Soroban path; everything else (deploys, source-account auth)
   * is fee-bumped via the `{ xdr }` envelope path. Never throws — returns a typed
   * {@link TransactionResult}.
   */
  async send(
    input: AssembledTransaction<unknown> | Transaction | string,
    options?: RelayerSubmitOptions
  ): Promise<TransactionResult> {
    if (!this.relayer) {
      return failedTransaction(
        new RelayerError(
          "Relayer is not configured on this PasskeyServer",
          PasskeyKitErrorCode.RELAYER_NOT_CONFIGURED
        )
      );
    }

    let built: Transaction;
    try {
      built = toBuiltTransaction(input, this.networkPassphrase);
    } catch (err) {
      return failedTransaction(
        err instanceof RelayerError
          ? err
          : new RelayerError(
              err instanceof Error ? err.message : String(err),
              PasskeyKitErrorCode.RELAYER_REQUEST_FAILED
            )
      );
    }

    const op = built.operations[0];
    if (op?.type === "invokeHostFunction" && !hasSourceAccountAuth(built)) {
      const invokeOp = op as Operation.InvokeHostFunction;
      const func = invokeOp.func.toXDR("base64");
      const auth = (invokeOp.auth ?? []).map((entry) => entry.toXDR("base64"));
      return this.relayer.send(func, auth, options);
    }

    return this.relayer.sendTransaction(built.toXDR(), options);
  }

  /** Poll a `skipWait` submission by its relayer transaction id. */
  getTransaction(transactionId: string): Promise<TransactionResult> {
    if (!this.relayer) {
      return Promise.resolve(
        failedTransaction(
          new RelayerError(
            "Relayer is not configured on this PasskeyServer",
            PasskeyKitErrorCode.RELAYER_NOT_CONFIGURED
          )
        )
      );
    }
    return this.relayer.getTransaction(transactionId);
  }

  // -- Indexer (server-side Mercury; superseded by SignerIndexer in B5) --------

  private async mercuryExecute<T>(fname: string, args: unknown): Promise<T> {
    if (!this.mercury) {
      throw new IndexerError(
        "Mercury indexer is not configured",
        PasskeyKitErrorCode.INDEXER_NOT_CONFIGURED
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DEFAULT_INDEXER_TIMEOUT_MS
    );

    try {
      const response = await fetch(`${this.mercury.url}/zephyr/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.mercury.jwt
            ? `Bearer ${this.mercury.jwt}`
            : this.mercury.apiKey!,
        },
        body: JSON.stringify({
          project_name: this.mercury.projectName,
          mode: { Function: { fname, arguments: JSON.stringify(args) } },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new IndexerError(
          `Mercury request failed (${response.status}): ${body.slice(0, 200)}`,
          PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
          { fname, status: response.status }
        );
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof IndexerError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new IndexerError(
          "Mercury request timed out",
          PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
          { fname }
        );
      }
      throw new IndexerError(
        err instanceof Error ? err.message : String(err),
        PasskeyKitErrorCode.INDEXER_REQUEST_FAILED,
        { fname },
        err instanceof Error ? err : undefined
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Enumerate a wallet's signers via Mercury, flagging temporary signers whose
   * ledger entry has been evicted (Mercury can't observe eviction directly).
   */
  async getSigners(contractId: string): Promise<IndexedSigner[]> {
    const signers = await this.mercuryExecute<IndexedSigner[]>(
      "get_signers_by_address",
      { address: contractId }
    );

    if (this.rpc) {
      for (const signer of signers) {
        if (signer.storage === "Temporary" && !signer.evicted) {
          try {
            // Probe by the SignerKey ScVal the contract stores the entry under,
            // NOT the raw keyId bytes (audit H2). A genuine not-found means
            // evicted; a transport error is left as reported.
            const exists = await contractDataExists(
              this.rpc,
              contractId,
              signerKeyToContractScVal(indexedSignerToKey(signer)),
              Durability.Temporary
            );
            if (!exists) signer.evicted = true;
          } catch {
            // Transport error (429/5xx/timeout): eviction undeterminable.
          }
        }
      }
    }

    return signers;
  }

  /**
   * Reverse lookup: find the wallet(s) a signer belongs to via Mercury.
   *
   * @returns the address at `index`, or `undefined` if there are none.
   */
  async getContractId(
    options: { keyId?: string; publicKey?: string; policy?: string },
    index = 0
  ): Promise<string | undefined> {
    const provided = [options.keyId, options.publicKey, options.policy].filter(
      Boolean
    );
    if (provided.length !== 1) {
      throw new IndexerError(
        "Provide exactly one of keyId, publicKey, or policy",
        PasskeyKitErrorCode.INDEXER_REQUEST_FAILED
      );
    }

    let args: { key: string; kind: "Secp256r1" | "Ed25519" | "Policy" };
    if (options.keyId) args = { key: options.keyId, kind: "Secp256r1" };
    else if (options.publicKey) args = { key: options.publicKey, kind: "Ed25519" };
    else args = { key: options.policy!, kind: "Policy" };

    const addresses = await this.mercuryExecute<string[]>(
      "get_addresses_by_signer",
      args
    );

    return addresses[index];
  }
}
