/**
 * Constants used throughout the Passkey Kit SDK.
 *
 * Cryptographic sizes mirror the smart-wallet contract; the deployer seed is
 * load-bearing for deterministic contract-id derivation (see below).
 *
 * @packageDocumentation
 */

// ============================================================================
// Cryptographic constants (mirror the smart-wallet contract)
// ============================================================================

/** Size of an uncompressed secp256r1 (P-256) public key, in bytes. */
export const SECP256R1_PUBLIC_KEY_SIZE = 65;

/** First byte of an uncompressed secp256r1 public key (0x04). */
export const UNCOMPRESSED_PUBKEY_PREFIX = 0x04;

/** Size of an Ed25519 public key, in bytes. */
export const ED25519_PUBLIC_KEY_SIZE = 32;

/** Size of an Ed25519 signature, in bytes. */
export const ED25519_SIGNATURE_SIZE = 64;

/**
 * Order (n) of the secp256r1 (P-256) curve, used to enforce low-S signatures.
 * @see https://github.com/stellar/stellar-protocol/discussions/1435
 */
export const SECP256R1_CURVE_ORDER = BigInt(
  "0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
);

/** Field prime (p) of the secp256r1 (P-256) curve. */
export const SECP256R1_FIELD_PRIME = BigInt(
  "0xffffffff00000001000000000000000000000000ffffffffffffffffffffffff"
);

/** Curve coefficient `b` of secp256r1 (P-256): y² = x³ − 3x + b (mod p). */
export const SECP256R1_B = BigInt(
  "0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b"
);

// ============================================================================
// WebAuthn configuration
// ============================================================================

/** Default timeout for WebAuthn ceremonies, in milliseconds. */
export const WEBAUTHN_TIMEOUT_MS = 60_000;

/** Length, in bytes, of a randomly generated WebAuthn challenge. */
export const WEBAUTHN_CHALLENGE_SIZE = 32;

// ============================================================================
// Deployer
// ============================================================================

/**
 * Seed for the default (deterministic) deployer keypair.
 *
 * The deployer keypair is derived as
 * `Keypair.fromRawEd25519Seed(sha256(utf8(DEFAULT_DEPLOYER_SEED)))`. Deriving it
 * from a fixed, well-known string makes smart-wallet contract IDs reproducible
 * across clients from a passkey credential ID alone (`salt = sha256(keyId)`,
 * `deployer = this keypair`), which is exactly what the indexer reverse-lookup
 * (keyId → contract) depends on.
 *
 * This value MUST remain `"kalepail"`: every wallet ever deployed by passkey-kit
 * used this deployer, and the derivation is load-bearing for discovery. The
 * deployer only pays fees and salts the deploy — it never controls the wallet —
 * but it IS a shared, publicly-derivable keypair. Provide your own
 * `deploySource` secret for a dedicated fee payer (note: a different deployer
 * changes the derived contract addresses and breaks keyId → contract discovery).
 */
export const DEFAULT_DEPLOYER_SEED = "kalepail";

// ============================================================================
// Transaction timeouts
// ============================================================================

/**
 * Default transaction timeout, in seconds.
 *
 * The OpenZeppelin Relayer requires a time-bound of <= 30s on submitted
 * transactions, so the kit defaults to that.
 */
export const DEFAULT_TIMEOUT_SECONDS = 30;

// ============================================================================
// Storage configuration
// ============================================================================

/** Default IndexedDB database name for passkey credential storage. */
export const DB_NAME = "passkey-kit";

/** Current IndexedDB schema version. */
export const DB_VERSION = 1;

/** IndexedDB object-store name for passkey credentials. */
export const IDB_STORE_CREDENTIALS = "credentials";

/** IndexedDB index name for contract-id lookups. */
export const IDB_INDEX_CONTRACT_ID = "contractId";

/** localStorage key under which passkey credentials are persisted. */
export const LOCALSTORAGE_CREDENTIALS_KEY = "passkey-kit:credentials";

// ============================================================================
// Relayer
// ============================================================================

/**
 * Default relayer request timeout, in milliseconds (6 minutes).
 *
 * Long enough to absorb testnet channel-account funding retries after a network
 * reset. Mainnet requests return quickly; this only bounds the maximum wait.
 */
export const DEFAULT_RELAYER_TIMEOUT_MS = 360_000;

/** OpenZeppelin managed Channels relayer endpoint (mainnet). */
export const CHANNELS_MAINNET_URL = "https://channels.openzeppelin.com";

/** OpenZeppelin managed Channels relayer endpoint (testnet). */
export const CHANNELS_TESTNET_URL = "https://channels.openzeppelin.com/testnet";

// ============================================================================
// Indexer
// ============================================================================

/** Default indexer request timeout, in milliseconds. */
export const DEFAULT_INDEXER_TIMEOUT_MS = 10_000;

/**
 * Mercury's hosted, keyless passkey-indexer base URLs, per network. Public REST
 * (no API key / JWT); covers both the legacy `("sw_v1", …)` and v1
 * `#[contractevent]` signer generations with full history.
 *
 * @see https://docs.mercurydata.app/smart-wallet-indexers/introduction-1
 */
export const MERCURY_PASSKEY_INDEXER_URLS = {
  testnet: "https://testnet.mercurydata.app/rest/passkey-indexer",
  mainnet: "https://mainnet.mercurydata.app/rest/passkey-indexer",
} as const;

// ============================================================================
// Networks
// ============================================================================

/** Stellar Friendbot URL for testnet funding. */
export const FRIENDBOT_URL = "https://friendbot.stellar.org";
