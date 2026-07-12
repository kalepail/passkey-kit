/**
 * passkey-kit Relayer Proxy — Cloudflare Worker
 *
 * A keyless proxy in front of the OpenZeppelin Relayer Channels service. It
 * mints and caches one Relayer API key per client IP so the browser can submit
 * fee-sponsored transactions with ZERO secrets in the bundle (this replaces
 * passkey-kit's old defect of inlining VITE_relayerApiKey into client JS).
 *
 * Uses the official `@openzeppelin/relayer-plugin-channels` SDK.
 *
 * Features:
 * - Automatic API-key generation per IP, custody in a per-IP Durable Object so
 *   concurrent first-requests mint at most ONE key (KV has no CAS — review M5).
 * - One API key per IP; the Relayer's usage limits reset every 24h on its side.
 * - Two submission modes: `{ func, auth }` (Address credentials) and `{ xdr }`
 *   (source-account auth, e.g. deploys).
 * - Testnet: funds missing channel accounts via Friendbot and retries.
 * - Separate testnet (default) and mainnet (`--env production`) deployments.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  ChannelsClient,
  PluginExecutionError,
  PluginTransportError,
} from "@openzeppelin/relayer-plugin-channels";
import {
  SERVICE_NAME,
  FRIENDBOT_URL,
  API_KEY_FIELD_NAMES,
  API_KEY_MIN_LENGTH,
  API_KEY_MAX_LENGTH,
  MISSING_ACCOUNT_PATTERN,
  TESTNET_RETRY_DURATION_MS,
  IP_HEADERS,
  UNKNOWN_IP,
} from "./constants";

/** Durable Object storage key holding the IP's Relayer API key. */
const DO_KEY = "apiKey";

// Hono app
const app = new Hono<{ Bindings: Env }>();

// CORS is intentionally open: the browser calls this cross-origin and the
// endpoint holds no secret the caller could exfiltrate (it mints its own keys).
// SECURITY DECISION (endgame, before any MAINNET deploy): decide whether an
// open, keyless, fee-sponsoring `POST /` is acceptable on mainnet, or whether
// it needs an origin allowlist / auth / stricter rate limiting. On testnet the
// open policy is fine.
app.use("*", cors());

app.onError((error, c) => {
  console.error("Unhandled worker error:", error);
  return c.json(
    {
      success: false,
      error: "Internal server error",
    },
    500
  );
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the client IP from the request. Uses ONLY `CF-Connecting-IP`, which
 * Cloudflare always sets at the edge and the client cannot spoof. The
 * `X-Forwarded-For` / `X-Real-IP` headers are client-controlled and must NOT be
 * trusted for per-IP key custody (review LOW).
 */
export function getClientIP(request: Request): string {
  return request.headers.get(IP_HEADERS.CF_CONNECTING_IP) || UNKNOWN_IP;
}

/**
 * Validate API key format before use.
 */
function isValidApiKey(apiKey: string): boolean {
  const trimmed = apiKey.trim();
  return (
    trimmed.length >= API_KEY_MIN_LENGTH && trimmed.length <= API_KEY_MAX_LENGTH
  );
}

/**
 * Generate a new API key from the Relayer service. The /gen endpoint requires
 * no authentication (GET).
 * @see https://docs.openzeppelin.com/relayer/1.5.x/guides/stellar-channels-guide
 */
async function generateApiKey(env: Env): Promise<string | null> {
  try {
    const response = await fetch(`${env.RELAYER_BASE_URL}/gen`, {
      method: "GET",
    });

    const text = await response.text();

    if (response.ok) {
      try {
        const data = JSON.parse(text) as Record<string, unknown>;
        const apiKey = API_KEY_FIELD_NAMES.map((name) => data[name]).find(
          (v) => v
        );
        if (typeof apiKey === "string") {
          return apiKey;
        }
        // Do NOT log the body: it may contain the key under an unexpected
        // field. Log only that extraction failed (review LOW: no secret logs).
        console.error("API key field not found in /gen response");
        return null;
      } catch {
        // Response might be a plain-text API key — never log the raw text.
        if (
          text &&
          text.length > API_KEY_MIN_LENGTH &&
          text.length < API_KEY_MAX_LENGTH
        ) {
          return text.trim();
        }
        console.error(
          `Could not parse /gen response (length ${text.length})`
        );
        return null;
      }
    }

    console.error(
      `Failed to generate API key: status ${response.status} (body length ${text.length})`
    );
    return null;
  } catch (error) {
    console.error("Error generating API key:", error);
    return null;
  }
}

/**
 * Per-IP Relayer API key custody.
 *
 * One Durable Object instance per client IP (`idFromName(ip)`). All access to a
 * given IP's key is serialized by the DO input gate + `blockConcurrencyWhile`,
 * so N concurrent first-requests from one IP mint at most ONE `/gen` key. This
 * is the atomic get-or-create KV cannot provide (KV has no CAS — review M5).
 *
 * Routes:
 * - default (`/get`): get-or-create → 200 with the key, or 502 if minting fails.
 * - `/peek`: report presence WITHOUT minting → `{ hasKey }` (for GET /status).
 */
export class ApiKeyStore implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/peek") {
      const existing = await this.state.storage.get<string>(DO_KEY);
      return Response.json({
        hasKey: !!existing && isValidApiKey(existing),
      });
    }

    // Get-or-create, serialized per instance.
    const apiKey = await this.state.blockConcurrencyWhile(async () => {
      const existing = await this.state.storage.get<string>(DO_KEY);
      if (existing && isValidApiKey(existing)) {
        return existing;
      }
      const minted = await generateApiKey(this.env);
      if (!minted) {
        return null;
      }
      await this.state.storage.put(DO_KEY, minted);
      return minted;
    });

    if (!apiKey) {
      return new Response("Could not mint API key", { status: 502 });
    }
    return new Response(apiKey, { status: 200 });
  }
}

/**
 * Get (or lazily mint) the Relayer API key for an IP via its Durable Object.
 */
async function getApiKeyForIp(env: Env, ip: string): Promise<string | null> {
  const id = env.API_KEY_DO.idFromName(ip);
  const stub = env.API_KEY_DO.get(id);
  const res = await stub.fetch("https://api-key-store/get");
  if (!res.ok) {
    return null;
  }
  const apiKey = (await res.text()).trim();
  return isValidApiKey(apiKey) ? apiKey : null;
}

/**
 * Create a ChannelsClient for the configured network.
 */
function createClient(env: Env, apiKey: string): ChannelsClient {
  return new ChannelsClient({
    baseUrl: env.RELAYER_BASE_URL,
    apiKey,
  });
}

/**
 * Extract the account address from an "Account not found" error message.
 */
export function extractMissingAccount(errorMessage: string): string | null {
  const match = errorMessage.match(MISSING_ACCOUNT_PATTERN);
  return match ? match[1] : null;
}

/**
 * Fund an account via Friendbot (testnet only).
 */
async function fundWithFriendbot(account: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${FRIENDBOT_URL}?addr=${encodeURIComponent(account)}`
    );
    return response.ok;
  } catch (error) {
    console.error("Friendbot funding failed:", error);
    return false;
  }
}

// ============================================================================
// API Endpoints
// ============================================================================

// Health check
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: SERVICE_NAME,
    network: c.env.NETWORK,
  });
});

/**
 * Submit a transaction via the Relayer.
 * POST /
 *
 * Two modes:
 * 1. { func: string, auth: string[] } — Relayer builds the tx with channel
 *    accounts (Address credentials: transfers, wallet operations).
 * 2. { xdr: string } — Relayer fee-bumps an already-signed transaction
 *    (source-account auth: deploys).
 *
 * On testnet, if channel accounts are missing (after a testnet reset), fund
 * them via Friendbot and retry for up to 5 minutes.
 */
app.post("/", async (c) => {
  try {
    const ip = getClientIP(c.req.raw);
    const apiKey = await getApiKeyForIp(c.env, ip);

    if (!apiKey) {
      return c.json(
        {
          success: false,
          error: "Could not obtain API key. Service may be misconfigured.",
        },
        500
      );
    }

    const body = await c.req.json<{
      func?: string;
      auth?: string[];
      xdr?: string;
    }>();

    // Validate: must have either xdr OR (func AND auth).
    const hasXdr = !!body.xdr;
    const hasFuncAuth = !!body.func && !!body.auth;

    if (!hasXdr && !hasFuncAuth) {
      return c.json(
        {
          success: false,
          error: "Request must include 'xdr' OR ('func' and 'auth')",
        },
        400
      );
    }

    if (hasXdr && hasFuncAuth) {
      return c.json(
        {
          success: false,
          error: "Request must include 'xdr' OR ('func' and 'auth'), not both",
        },
        400
      );
    }

    const client = createClient(c.env, apiKey);
    const isTestnet = c.env.NETWORK === "testnet";

    // On testnet, retry for up to 5 minutes to handle channel accounts needing
    // funding. On mainnet, only try once (no Friendbot). Network wait time does
    // not count toward the worker CPU limit.
    const deadline = isTestnet ? Date.now() + TESTNET_RETRY_DURATION_MS : 0;
    const fundedAccounts = new Set<string>();

    while (true) {
      try {
        const result = hasXdr
          ? await client.submitTransaction({ xdr: body.xdr! })
          : await client.submitSorobanTransaction({
              func: body.func!,
              auth: body.auth!,
            });

        return c.json({
          success: true,
          data: {
            transactionId: result.transactionId,
            hash: result.hash,
            status: result.status,
          },
        });
      } catch (submitError) {
        const errorMessage =
          submitError instanceof Error
            ? submitError.message
            : String(submitError);

        const missingAccount = extractMissingAccount(errorMessage);
        const timeRemaining = deadline - Date.now();

        if (missingAccount && isTestnet && timeRemaining > 0) {
          if (!fundedAccounts.has(missingAccount)) {
            console.log(
              `Account ${missingAccount} not found. Funding via friendbot (${Math.round(
                timeRemaining / 1000
              )}s remaining)...`
            );

            const funded = await fundWithFriendbot(missingAccount);
            if (funded) {
              console.log(
                `Successfully funded ${missingAccount}. Retrying submission...`
              );
              fundedAccounts.add(missingAccount);
            } else {
              console.error(`Failed to fund ${missingAccount}`);
            }
          } else {
            console.log(`Account ${missingAccount} already funded, retrying...`);
          }

          continue; // Retry immediately.
        }

        // Not a recoverable error or deadline exceeded — throw to outer handler.
        throw submitError;
      }
    }
  } catch (error) {
    console.error("Relayer submission error:", error);

    if (error instanceof SyntaxError) {
      return c.json(
        {
          success: false,
          error: "Invalid JSON body",
        },
        400
      );
    }

    if (error instanceof PluginExecutionError) {
      return c.json(
        {
          success: false,
          error: error.message,
          data: {
            code: error.errorDetails?.code,
            details: error.errorDetails?.details,
          },
        },
        400
      );
    }

    if (error instanceof PluginTransportError) {
      const status = error.statusCode || 500;
      return c.json(
        {
          success: false,
          error: error.message,
        },
        status as 400 | 401 | 403 | 404 | 500 | 502 | 503
      );
    }

    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Relayer request failed",
      },
      500
    );
  }
});

/**
 * Get proxy status and client info.
 * GET /status
 */
app.get("/status", async (c) => {
  try {
    const ip = getClientIP(c.req.raw);
    const id = c.env.API_KEY_DO.idFromName(ip);
    const stub = c.env.API_KEY_DO.get(id);
    const res = await stub.fetch("https://api-key-store/peek");
    const peek = (res.ok ? await res.json() : { hasKey: false }) as {
      hasKey: boolean;
    };

    return c.json({
      success: true,
      data: {
        clientIP: ip,
        network: c.env.NETWORK,
        hasKey: peek.hasKey,
      },
    });
  } catch (error) {
    console.error("Status endpoint failed:", error);
    return c.json(
      {
        success: false,
        error: "Could not read status",
      },
      500
    );
  }
});

// ============================================================================
// Worker Export
// ============================================================================

export default {
  fetch: app.fetch,
};
