/**
 * Passkey Kit — create and use smart-wallet accounts on Stellar with WebAuthn
 * passkeys.
 *
 * Storage adapters live under the `passkey-kit/storage` subpath; the server-only
 * entrypoint lives under `passkey-kit/server`.
 *
 * @packageDocumentation
 */

// Core client. (The server-only `PasskeyServer` lives at `passkey-kit/server`
// so it — and the relayer secret it holds — can never be bundled into browser
// code.)
export {
  PasskeyKit,
  type PasskeyKitConfig,
  type CreateOptions,
  type ConnectOptions,
} from "./kit.js";
export { SACClient, buildTokenTransferHostFunction } from "./sac.js";

// Generated contract client
export { Client as PasskeyClient } from "passkey-kit-sdk";

// Signer abstraction
export {
  PasskeySigner,
  Ed25519Signer,
  PolicySigner,
  type Signer,
  type SignerContext,
  type PreparedSignature,
  type WebAuthnAuthenticator,
} from "./signers.js";

// Signer-key helpers, storage + result types
export {
  SignerKey,
  SignerStore,
  type SignerKeyTag,
  type SignerLimits,
  type StoredPasskey,
  type StorageAdapter,
  type CreateWalletResult,
  type ConnectWalletResult,
  type TransactionResult,
  type TransactionSuccess,
  type TransactionFailure,
  type SubmissionMethod,
} from "./types.js";

// Typed errors
export {
  PasskeyKitError,
  PasskeyKitErrorCode,
  ConfigurationError,
  WalletNotConnectedError,
  WalletOwnershipError,
  WebAuthnError,
  SigningError,
  SignerNotFoundError,
  SimulationError,
  SubmissionError,
  ValidationError,
  IndexerError,
  RelayerError,
  ContractError,
  wrapError,
} from "./errors.js";

// Contract-error decoding
export {
  CONTRACT_ERROR_REGISTRY,
  contractErrorFromCode,
  decodeContractError,
  type ContractErrorFamily,
  type ContractErrorInfo,
} from "./contract-errors.js";

// Indexer abstraction. Mercury's hosted passkey-indexer is keyless, so the
// `MercuryIndexer` backend is browser-safe and exported here (no `/server` gate).
export {
  MercuryIndexer,
  mercuryPasskeyIndexerUrl,
  MERCURY_PASSKEY_INDEXER_URLS,
  lookupWithRetry,
  type MercuryIndexerConfig,
  type SignerIndexer,
  type WalletSigner,
  type IndexerHealth,
  type SignerStatus,
  type SignerStorageClass,
  type FindWalletsHardeningDeps,
} from "./indexer/index.js";

// Events
export {
  PasskeyEventEmitter,
  type PasskeyEvent,
  type PasskeyEventMap,
  type EventListener,
} from "./events.js";

// Crypto / derivation helpers
export {
  deriveContractAddress,
  extractPublicKeyFromAttestation,
  compactSignature,
  generateChallenge,
  isOnP256Curve,
} from "./utils.js";

// Client-side validation
export {
  validateAddress,
  validateAmount,
  validateExpiration,
  validateSecp256r1PublicKey,
} from "./validation.js";

// Package metadata
export { VERSION, NAME } from "./version.js";
