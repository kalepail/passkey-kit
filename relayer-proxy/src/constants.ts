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
