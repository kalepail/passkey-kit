/**
 * `PasskeyServer` — the SERVER-ONLY counterpart to {@link PasskeyKit}.
 *
 * It holds the relayer API key and therefore must never run in a browser
 * bundle: it is exported exclusively from the `passkey-kit/server` subpath so a
 * bundler can't pull it into client code, and its config must come from
 * server-side environment variables (never `VITE_`-prefixed).
 *
 * Responsibilities: fee-sponsored submission via {@link RelayerClient} and
 * convenience signer-discovery helpers that delegate to a {@link MercuryIndexer}
 * over Mercury's keyless hosted passkey-indexer. (`MercuryIndexer` itself is
 * keyless and browser-safe — exported from the main `passkey-kit` entry; these
 * server methods are a thin convenience over it.)
 *
 * @packageDocumentation
 */

import {
  Operation,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { RelayerClient, type RelayerClientConfig, type RelayerSubmitOptions } from "./relayer.js";
import {
  ConfigurationError,
  IndexerError,
  RelayerError,
  PasskeyKitErrorCode,
} from "./errors.js";
import { failedTransaction } from "./contract-errors.js";
import { MercuryIndexer } from "./indexer/index.js";
import type { WalletSigner } from "./indexer/index.js";
import { SignerKey } from "./types.js";
import type { TransactionResult } from "./types.js";

// Re-export the relayer surface so `passkey-kit/server` is the single
// server-only entrypoint (secrets never reach the browser bundle).
export {
  RelayerClient,
  type RelayerClientConfig,
  type RelayerSubmitOptions,
} from "./relayer.js";

/** Mercury hosted passkey-indexer configuration (keyless). */
export interface MercuryConfig {
  /**
   * Passkey-indexer base URL. Defaults to the network's hosted endpoint
   * (`https://{testnet,mainnet}.mercurydata.app/rest/passkey-indexer`); set it
   * only to point at a self-hosted instance.
   */
  url?: string;
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
  private readonly mercury?: MercuryIndexer;

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
      const mercury = MercuryIndexer.forNetwork(
        { url: config.mercury.url, rpc: this.rpc },
        this.networkPassphrase
      );
      if (!mercury) {
        throw new ConfigurationError(
          "Mercury has no hosted passkey-indexer for this network; pass mercury.url to point at a self-hosted instance",
          PasskeyKitErrorCode.INVALID_CONFIG
        );
      }
      this.mercury = mercury;
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

  // -- Indexer (convenience delegation to the keyless Mercury passkey-indexer) --

  private requireMercury(): MercuryIndexer {
    if (!this.mercury) {
      throw new IndexerError(
        "Mercury indexer is not configured on this PasskeyServer",
        PasskeyKitErrorCode.INDEXER_NOT_CONFIGURED
      );
    }
    return this.mercury;
  }

  /**
   * Enumerate a wallet's signers via Mercury. Temporary signers whose ledger
   * entry has been evicted are flagged `status: "evicted"` when this server was
   * given an `rpcUrl` (the indexer can't observe TTL eviction directly).
   */
  getSigners(contractId: string): Promise<WalletSigner[]> {
    return this.requireMercury().getSigners(contractId);
  }

  /**
   * Reverse lookup: find the wallet(s) a signer belongs to via Mercury.
   *
   * @returns the confirmed address at `index`, or `undefined` if there are none.
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

    let key: SignerKey;
    if (options.keyId) key = SignerKey.Secp256r1(options.keyId);
    else if (options.publicKey) key = SignerKey.Ed25519(options.publicKey);
    else key = SignerKey.Policy(options.policy!);

    const wallets = await this.requireMercury().findWallets(key);
    return wallets[index];
  }
}
