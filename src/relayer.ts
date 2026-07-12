/**
 * Server-side relayer client.
 *
 * A thin, typed wrapper over the OpenZeppelin Channels client
 * (`@openzeppelin/relayer-plugin-channels` ^0.20) for fee-sponsored submission.
 * It holds the relayer API key, so it MUST run server-side only (it is reached
 * through `PasskeyServer`, exported from the `passkey-kit/server` subpath).
 *
 * Two submission modes:
 * - {@link RelayerClient.send} — `{ func, auth }` for invokeHostFunction flows
 *   (the preferred Soroban path; the relayer builds the envelope + pays fees).
 * - {@link RelayerClient.sendTransaction} — `{ xdr }` for a signed envelope
 *   (e.g. a deploy transaction that needs source-account auth + a fee bump).
 *
 * Every method returns a discriminated {@link TransactionResult} and NEVER
 * throws for expected relayer/on-chain failures — a `PluginClientError` is
 * mapped to a typed {@link RelayerError} (or a {@link ContractError} when a
 * contract code can be decoded from its details).
 *
 * @packageDocumentation
 */

import {
  ChannelsClient,
  PluginClientError,
  type ChannelsTransactionResponse,
} from "@openzeppelin/relayer-plugin-channels";
import type { TransactionResult, TransactionFailure } from "./types.js";
import { RelayerError, PasskeyKitErrorCode } from "./errors.js";
import {
  decodeContractError,
  failedTransaction,
} from "./contract-errors.js";
import { DEFAULT_RELAYER_TIMEOUT_MS } from "./constants.js";

/** Configuration for a {@link RelayerClient}. */
export interface RelayerClientConfig {
  /** Base URL of the Channels relayer service. */
  baseUrl: string;
  /** API key for the relayer service (server-side secret). */
  apiKey: string;
  /** Optional admin secret for management operations. */
  adminSecret?: string;
  /** Request timeout in ms (default {@link DEFAULT_RELAYER_TIMEOUT_MS}). */
  timeout?: number;
}

/** Per-submission relayer options. */
export interface RelayerSubmitOptions {
  /** Return immediately after submission; poll {@link RelayerClient.getTransaction}. */
  skipWait?: boolean;
  /** Alternative fund-relayer id for the fee bump (must be allow-listed). */
  fundRelayerId?: string;
}

/** A relayer status string that indicates on-chain failure. */
const FAILURE_STATUS = /fail|error|revert|reject/i;

export class RelayerClient {
  private readonly channels: ChannelsClient;

  constructor(config: RelayerClientConfig) {
    if (!config.baseUrl || !config.apiKey) {
      throw new RelayerError(
        "RelayerClient requires both baseUrl and apiKey",
        PasskeyKitErrorCode.RELAYER_NOT_CONFIGURED
      );
    }
    this.channels = new ChannelsClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      adminSecret: config.adminSecret,
      timeout: config.timeout ?? DEFAULT_RELAYER_TIMEOUT_MS,
    });
  }

  /**
   * Submit an invokeHostFunction via `{ func, auth }` (the preferred Soroban
   * path). The relayer builds the transaction envelope with a channel account
   * and pays the fees.
   */
  async send(
    func: string,
    auth: string[],
    options?: RelayerSubmitOptions
  ): Promise<TransactionResult> {
    return this.run(() =>
      this.channels.submitSorobanTransaction({
        func,
        auth,
        skipWait: options?.skipWait,
        fundRelayerId: options?.fundRelayerId,
      })
    );
  }

  /**
   * Submit a signed transaction envelope via `{ xdr }` for a fee bump (preserves
   * the inner signature; use for deploys / source-account-auth transactions).
   */
  async sendTransaction(
    xdr: string,
    options?: RelayerSubmitOptions
  ): Promise<TransactionResult> {
    return this.run(() =>
      this.channels.submitTransaction({
        xdr,
        skipWait: options?.skipWait,
        fundRelayerId: options?.fundRelayerId,
      })
    );
  }

  /** Poll a previously-submitted (`skipWait`) transaction by its relayer id. */
  async getTransaction(transactionId: string): Promise<TransactionResult> {
    return this.run(() => this.channels.getTransaction({ transactionId }));
  }

  private async run(
    fn: () => Promise<ChannelsTransactionResponse>
  ): Promise<TransactionResult> {
    try {
      return this.toResult(await fn());
    } catch (err) {
      return this.mapError(err);
    }
  }

  private toResult(res: ChannelsTransactionResponse): TransactionResult {
    if (res.status && FAILURE_STATUS.test(res.status)) {
      return failedTransaction(
        new RelayerError(
          `Relayer reported status "${res.status}"`,
          PasskeyKitErrorCode.RELAYER_REQUEST_FAILED,
          { status: res.status, transactionId: res.transactionId }
        ),
        res.hash ?? undefined
      );
    }

    return {
      success: true,
      hash: res.hash ?? "",
      ...(res.transactionId ? { transactionId: res.transactionId } : {}),
    };
  }

  private mapError(err: unknown): TransactionFailure {
    // Prefer a decoded contract error when the relayer surfaced one.
    const details =
      err instanceof PluginClientError
        ? (err as { errorDetails?: unknown }).errorDetails
        : undefined;
    const contractError =
      (err instanceof Error && decodeContractError(err.message)) ||
      decodeContractError(details);
    if (contractError) {
      return failedTransaction(contractError);
    }

    if (err instanceof PluginClientError) {
      return failedTransaction(
        new RelayerError(
          err.message,
          PasskeyKitErrorCode.RELAYER_REQUEST_FAILED,
          { category: err.category, details },
          err
        )
      );
    }

    return failedTransaction(
      new RelayerError(
        err instanceof Error ? err.message : String(err),
        PasskeyKitErrorCode.RELAYER_REQUEST_FAILED,
        undefined,
        err instanceof Error ? err : undefined
      )
    );
  }
}
