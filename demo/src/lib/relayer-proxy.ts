/**
 * Browser client for the relayer-proxy worker (todo 954).
 *
 * The worker holds the relayer API key (keyless per-IP minting); the browser
 * sends only transaction material and receives a typed result. Two wire bodies,
 * mirroring `PasskeyServer.send`'s routing:
 *   - `{ func, auth }` — a Soroban invoke without source-account auth.
 *   - `{ xdr }`        — an envelope (deploys / source-account auth) to fee-bump.
 */

import {
  PasskeyKitErrorCode,
  RelayerError,
  contractErrorFromCode,
  decodeContractError,
  type PasskeyKitError,
  type TransactionResult,
} from "passkey-kit";

/** `{ func, auth }` (preferred) or `{ xdr }` (envelope) wire body. */
export type RelayerProxyBody =
  | { func: string; auth: string[] }
  | { xdr: string };

/**
 * The worker's response envelope (relayer-proxy/src/index.ts):
 *   success → `{ success: true, data: { transactionId, hash, status } }`
 *   failure → `{ success: false, error: <message string>, data?: { code, details } }`
 *             with a non-2xx HTTP status.
 * There is no `ledger` field.
 */
interface WorkerEnvelope {
  success?: boolean;
  error?: string;
  data?: {
    transactionId?: string;
    hash?: string;
    status?: string;
    code?: string | number;
    details?: unknown;
  };
}

const TIMEOUT_MS = 6 * 60 * 1000;

export class RelayerProxyClient {
  constructor(private readonly baseUrl?: string) {}

  /** Whether a proxy URL is configured (submission possible). */
  get configured(): boolean {
    return Boolean(this.baseUrl);
  }

  /**
   * Submit transaction material through the proxy. Never throws — returns a
   * discriminated {@link TransactionResult}, matching the SDK's submission
   * contract so the UI can branch on `result.success`.
   */
  async submit(body: RelayerProxyBody): Promise<TransactionResult> {
    if (!this.baseUrl) {
      return fail(
        new RelayerError(
          "Relayer proxy is not configured (set VITE_relayerProxyUrl)",
          PasskeyKitErrorCode.RELAYER_NOT_CONFIGURED,
        ),
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      const payload = text ? (safeParse(text) as WorkerEnvelope | undefined) : undefined;

      // Failure = non-2xx OR an explicit `success: false` (defensive).
      if (!res.ok || payload?.success === false) {
        return fail(toError(payload, res.status, text));
      }

      // Success: unwrap the `data` envelope. The worker returns no `ledger`, so
      // it stays undefined; `transactionId`/`status` come from `data`.
      const ok = payload?.data ?? {};
      if (!ok.hash) {
        return fail(
          new RelayerError(
            `Relayer proxy returned no transaction hash: ${text.slice(0, 200)}`,
            PasskeyKitErrorCode.RELAYER_REQUEST_FAILED,
          ),
        );
      }
      return {
        success: true,
        hash: ok.hash,
        transactionId: ok.transactionId,
      };
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return fail(
        new RelayerError(
          aborted
            ? "Relayer proxy request timed out"
            : `Relayer proxy request failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
          PasskeyKitErrorCode.RELAYER_REQUEST_FAILED,
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function fail(error: PasskeyKitError): TransactionResult {
  return { success: false, error };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Map the worker error envelope to a typed SDK error (ContractError when decodable). */
function toError(
  payload: WorkerEnvelope | undefined,
  status: number,
  raw: string,
): PasskeyKitError {
  const message =
    (typeof payload?.error === "string" && payload.error) ||
    `Relayer proxy failed (HTTP ${status}): ${raw.slice(0, 200)}`;
  const code = payload?.data?.code;
  const details = payload?.data?.details;

  // A numeric `data.code` may be a contract error code; otherwise scan the
  // message + raw body for an `Error(Contract, #N)` marker (the relayer surfaces
  // the contract failure there) so contract-error codes aren't dropped.
  const contract =
    (typeof code === "number"
      ? contractErrorFromCode(code, { status, details })
      : null) ??
    decodeContractError(message) ??
    decodeContractError(raw);
  if (contract) return contract;

  return new RelayerError(message, PasskeyKitErrorCode.RELAYER_REQUEST_FAILED, {
    status,
    code: code === undefined ? undefined : String(code),
    details,
  });
}
