/**
 * Passkey Kit — create and use smart-wallet accounts on Stellar with WebAuthn
 * passkeys.
 *
 * Storage adapters live under the `passkey-kit/storage` subpath; the server-only
 * entrypoint lives under `passkey-kit/server`.
 *
 * @packageDocumentation
 */

// Core clients
export { PasskeyKit } from "./kit.js";
export { PasskeyServer } from "./server.js";
export { SACClient } from "./sac.js";

// Generated contract client
export { Client as PasskeyClient } from "passkey-kit-sdk";

// Signer-key helpers, indexer row, storage + result types
export {
  SignerKey,
  SignerStore,
  type SignerKeyTag,
  type SignerLimits,
  type IndexedSigner,
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
