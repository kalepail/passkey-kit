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
 * - Automatic API-key generation per IP (persisted indefinitely in KV).
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
  API_KEY_PREFIX,
  API_KEY_FIELD_NAMES,
  API_KEY_MIN_LENGTH,
  API_KEY_MAX_LENGTH,
  MISSING_ACCOUNT_PATTERN,
  TESTNET_RETRY_DURATION_MS,
  IP_HEADERS,
  UNKNOWN_IP,
} from "./constants";

interface StoredApiKey {
  apiKey: string;
  createdAt: number;
}

interface ApiKeyReadResult {
  storedKey: StoredApiKey;
  needsMigration: boolean;
}

// Hono app
const app = new Hono<{ Bindings: Env }>();

// Enable CORS
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
 * Get the client IP from the request, preferring Cloudflare's trusted header.
 */
export function getClientIP(request: Request): string {
  return (
    request.headers.get(IP_HEADERS.CF_CONNECTING_IP) ||
    request.headers.get(IP_HEADERS.X_FORWARDED_FOR)?.split(",")[0]?.trim() ||
    request.headers.get(IP_HEADERS.X_REAL_IP) ||
    UNKNOWN_IP
  );
}

/**
 * Generate a unique KV key for an IP.
 */
function getKVKey(ip: string): string {
  return `${API_KEY_PREFIX}${ip}`;
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
 * Runtime type guard for stored API key records.
 */
function isStoredApiKey(value: unknown): value is StoredApiKey {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StoredApiKey>;
  return (
    typeof candidate.apiKey === "string" &&
    typeof candidate.createdAt === "number" &&
    isValidApiKey(candidate.apiKey)
  );
}

/**
 * Read and normalize a stored API key record.
 *
 * Supports legacy plain-text / JSON-string values and migrates them lazily.
 */
async function readStoredApiKey(
  env: Env,
  kvKey: string
): Promise<ApiKeyReadResult | null> {
  try {
    const raw = await env.API_KEYS.get(kvKey);
    if (!raw) {
      return null;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      console.error(`Empty API key value in KV for ${kvKey}. Deleting record.`);
      await env.API_KEYS.delete(kvKey);
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (isStoredApiKey(parsed)) {
        return { storedKey: parsed, needsMigration: false };
      }

      // Backward compatibility: JSON string value, e.g. "\"sk_...\""
      if (typeof parsed === "string" && isValidApiKey(parsed)) {
        return {
          storedKey: {
            apiKey: parsed.trim(),
            createdAt: Date.now(),
          },
          needsMigration: true,
        };
      }
    } catch {
      // Backward compatibility: plain text value, e.g. "sk_..."
      if (isValidApiKey(trimmed)) {
        return {
          storedKey: {
            apiKey: trimmed,
            createdAt: Date.now(),
          },
          needsMigration: true,
        };
      }
    }

    console.error(
      `Corrupted API key KV value for ${kvKey}. Deleting invalid record.`
    );
    await env.API_KEYS.delete(kvKey);
    return null;
  } catch (error) {
    console.error(`Failed reading API key from KV for ${kvKey}:`, error);
    return null;
  }
}

/**
 * Get or generate an API key for the given IP.
 * Keys are stored indefinitely — one key per IP address.
 * The Relayer's usage limits reset every 24 hours on their side.
 */
async function getOrCreateApiKey(
  env: Env,
  ip: string
): Promise<{ apiKey: string; isNew: boolean } | null> {
  const kvKey = getKVKey(ip);

  // Check if we already have an API key for this IP.
  const cached = await readStoredApiKey(env, kvKey);
  if (cached) {
    if (cached.needsMigration) {
      try {
        await env.API_KEYS.put(kvKey, JSON.stringify(cached.storedKey));
      } catch (error) {
        console.error(
          `Failed migrating legacy API key format for ${kvKey}:`,
          error
        );
      }
    }

    return { apiKey: cached.storedKey.apiKey, isNew: false };
  }

  // No existing key — generate a new one from the Relayer's /gen endpoint.
  const newApiKey = await generateApiKey(env);
  if (!newApiKey) {
    return null;
  }

  const storedKey: StoredApiKey = {
    apiKey: newApiKey,
    createdAt: Date.now(),
  };

  // Store without expiration TTL — key persists until manually deleted.
  try {
    await env.API_KEYS.put(kvKey, JSON.stringify(storedKey));
  } catch (error) {
    console.error(`Failed storing API key in KV for ${kvKey}:`, error);
    return null;
  }

  return { apiKey: newApiKey, isNew: true };
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
        console.error("API key not found in response:", data);
        return null;
      } catch {
        // Response might be a plain-text API key.
        if (
          text &&
          text.length > API_KEY_MIN_LENGTH &&
          text.length < API_KEY_MAX_LENGTH
        ) {
          return text.trim();
        }
        console.error("Could not parse API key response:", text);
        return null;
      }
    }

    console.error("Failed to generate API key:", response.status, text);
    return null;
  } catch (error) {
    console.error("Error generating API key:", error);
    return null;
  }
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
    const apiKeyResult = await getOrCreateApiKey(c.env, ip);

    if (!apiKeyResult) {
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

    const client = createClient(c.env, apiKeyResult.apiKey);
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
    const kvKey = getKVKey(ip);

    const apiKey = await readStoredApiKey(c.env, kvKey);

    return c.json({
      success: true,
      data: {
        clientIP: ip,
        network: c.env.NETWORK,
        hasKey: !!apiKey,
        keyCreatedAt: apiKey?.storedKey.createdAt,
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
