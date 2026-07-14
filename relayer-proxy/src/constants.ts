/**
 * Constants for the passkey-kit Relayer Proxy.
 */

// ============================================================================
// Service Metadata
// ============================================================================

/** Service name for health checks */
export const SERVICE_NAME = "passkey-kit-relayer-proxy";

// ============================================================================
// Network URLs
// ============================================================================

/** Stellar Friendbot URL for testnet funding */
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

// ============================================================================
// API Key Configuration
// ============================================================================

/** Possible field names for the API key in the /gen response */
export const API_KEY_FIELD_NAMES = ["apiKey", "api_key", "key", "token"] as const;

/** Minimum length for a valid API key response */
export const API_KEY_MIN_LENGTH = 10;

/** Maximum length for a valid API key response */
export const API_KEY_MAX_LENGTH = 200;

// ============================================================================
// Stellar Address Validation
// ============================================================================

/** Length of a Stellar account address (G-address), excluding the leading G */
export const STELLAR_ADDRESS_LENGTH = 55;

/** Regex pattern for extracting a missing account from a Relayer error */
export const MISSING_ACCOUNT_PATTERN = /Account not found:\s*(G[A-Z0-9]{55})/;

// ============================================================================
// Retry Configuration
// ============================================================================

/** How long to retry on testnet when channel accounts need funding (5 minutes) */
export const TESTNET_RETRY_DURATION_MS = 5 * 60 * 1000;

/** Initial delay between recoverable testnet submission attempts. */
export const TESTNET_RETRY_BASE_DELAY_MS = 500;

/** Maximum exponential-backoff delay between testnet submission attempts. */
export const TESTNET_RETRY_MAX_DELAY_MS = 5_000;

// ============================================================================
// Abuse-prevention defaults
// ============================================================================

/** Fixed-window duration used when RATE_LIMIT_WINDOW_SECONDS is unset. */
export const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;

/** Per-IP submissions per fixed window. */
export const DEFAULT_RATE_LIMIT_PER_IP = 10;

/** Global submissions per fixed window (also bounds IP rotation). */
export const DEFAULT_RATE_LIMIT_GLOBAL = 100;

/** Maximum resource fee, in stroops, when MAX_RESOURCE_FEE_STROOPS is unset. */
export const DEFAULT_MAX_RESOURCE_FEE_STROOPS = 1_000_000n;

/** Maximum JSON request size accepted by the Worker. */
export const MAX_REQUEST_BODY_BYTES = 256 * 1024;

/** Account used only to simulate the Relayer-built `{ func, auth }` request. */
export const SIMULATION_SOURCE =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

/** Smart-wallet entrypoints the proxy may sponsor by default. */
export const DEFAULT_WALLET_FUNCTIONS = [
  "add_signer",
  "update_signer",
  "remove_signer",
  "upgrade",
] as const;

/**
 * Terminal statuses mirrored from src/relayer.ts (keep identical). Success is
 * word-bounded so negated forms ("unsuccessful", "unconfirmed") and
 * non-terminal forms ("confirming") never match.
 */
export const SUCCESS_STATUS = /\b(?:confirm(?:ed)?|success(?:ful)?)\b/i;
export const FAILURE_STATUS = /fail|error|revert|reject/i;

// ============================================================================
// HTTP Headers
// ============================================================================

// Only CF-Connecting-IP is trusted: Cloudflare always sets it at the edge and
// the client cannot spoof it. X-Forwarded-For / X-Real-IP are client-controlled
// and deliberately NOT used for per-IP key custody (review LOW).
export const IP_HEADERS = {
  CF_CONNECTING_IP: "CF-Connecting-IP",
} as const;

/** Default IP value when none can be determined */
export const UNKNOWN_IP = "unknown";
