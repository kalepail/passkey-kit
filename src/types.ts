/**
 * Core type definitions for the Passkey Kit SDK.
 *
 * @packageDocumentation
 */

import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import type { PasskeyKitError } from "./errors.js";

// ============================================================================
// Signer-key helpers (SDK-side mirror of the contract's SignerKey union)
// ============================================================================

/**
 * The three signer kinds the smart wallet understands.
 */
export type SignerKeyTag = "Policy" | "Ed25519" | "Secp256r1";

/**
 * A convenience wrapper describing which signer a key/limits entry refers to.
 *
 * The `value` is the string form the caller works with: a `C…`/`G…` address for
 * `Policy`, a `G…` public key for `Ed25519`, or a base64url credential id for
 * `Secp256r1`. The signing pipeline converts these into the contract's
 * `SignerKey` ScVals.
 */
export class SignerKey {
  private constructor(
    public key: SignerKeyTag,
    public value: string
  ) {}

  static Policy(policy: string): SignerKey {
    return new SignerKey("Policy", policy);
  }

  static Ed25519(publicKey: string): SignerKey {
    return new SignerKey("Ed25519", publicKey);
  }

  static Secp256r1(keyId: string): SignerKey {
    return new SignerKey("Secp256r1", keyId);
  }
}

/**
 * Per-signer limits: a map of contract address → the signer keys that signer may
 * co-authorize on that contract (`undefined` value = unrestricted on that
 * contract). `undefined` for the whole map = a fully unlimited signer.
 */
export type SignerLimits = Map<string, SignerKey[] | undefined> | undefined;

/**
 * Storage durability for a signer entry.
 */
export enum SignerStore {
  Persistent = "Persistent",
  Temporary = "Temporary",
}

// ============================================================================
// Indexer row (renamed from the old `Signer` to avoid colliding with the
// bindings' `Signer` union — #599)
// ============================================================================

/**
 * A signer row as returned by an indexer backend (Mercury or Stellar Indexer).
 *
 * Renamed from the old `Signer` type, which name-collided with the generated
 * bindings' `Signer` union. The richer cross-backend shape lives in
 * `indexer/types.ts` (`WalletSigner`); this remains the wire-row shape the
 * current server helpers return.
 */
export interface IndexedSigner {
  kind: string;
  key: string;
  val: string;
  expiration: number | null;
  storage: "Persistent" | "Temporary";
  limits: string;
  evicted?: boolean;
}

// ============================================================================
// Stored passkey records
// ============================================================================

/**
 * A persisted passkey → smart-wallet association.
 *
 * The `keyId` (base64url credential id) is essential for re-authenticating the
 * passkey later; the `contractId` lets the kit reconnect a wallet from a keyId
 * without an indexer round-trip.
 */
export interface StoredPasskey {
  /** Base64URL-encoded credential id (the passkey keyId) — the unique key. */
  keyId: string;

  /** 65-byte uncompressed secp256r1 public key (0x04 prefix + x + y). */
  publicKey: Uint8Array;

  /** Smart-wallet contract address this passkey controls. */
  contractId: string;

  /** User-friendly label for this passkey. */
  nickname?: string;

  /** Unix-ms timestamp when the passkey was created. */
  createdAt: number;

  /** Unix-ms timestamp when the passkey was last used. */
  lastUsedAt?: number;
}

/**
 * Interface for passkey storage adapters.
 *
 * Implementations persist the passkey → wallet association in various backends
 * (IndexedDB, localStorage, memory). See `./storage`.
 */
export interface StorageAdapter {
  /** Save a new passkey record or overwrite an existing one (keyed by keyId). */
  save(passkey: StoredPasskey): Promise<void>;

  /** Get a passkey record by its keyId. */
  get(keyId: string): Promise<StoredPasskey | null>;

  /** Get all passkey records associated with a contract. */
  getByContract(contractId: string): Promise<StoredPasskey[]>;

  /** Get every stored passkey record. */
  getAll(): Promise<StoredPasskey[]>;

  /** Delete a passkey record by its keyId. */
  delete(keyId: string): Promise<void>;

  /** Update mutable metadata on a stored passkey record. */
  update(
    keyId: string,
    updates: Partial<Omit<StoredPasskey, "keyId" | "publicKey">>
  ): Promise<void>;

  /** Remove every stored passkey record. */
  clear(): Promise<void>;
}

// ============================================================================
// Result types
// ============================================================================

/** Result of creating (deploying) a new smart wallet. */
export interface CreateWalletResult {
  /** The raw WebAuthn registration response. */
  rawResponse: RegistrationResponseJSON;

  /** Raw credential id bytes. */
  keyId: Uint8Array;

  /** Base64URL-encoded credential id. */
  keyIdBase64: string;

  /** Deployed smart-wallet contract address. */
  contractId: string;

  /** Signed deployment transaction, ready to submit (base64 XDR). */
  signedTx: string;
}

/** Result of connecting to an existing smart wallet. */
export interface ConnectWalletResult {
  /** Raw WebAuthn authentication response, when a ceremony was performed. */
  rawResponse?: AuthenticationResponseJSON;

  /** Raw credential id bytes. */
  keyId: Uint8Array;

  /** Base64URL-encoded credential id. */
  keyIdBase64: string;

  /** Connected smart-wallet contract address. */
  contractId: string;
}

/** Successful result of a submission operation. */
export interface TransactionSuccess {
  success: true;
  /** Transaction hash (may be empty for a `skipWait` submission not yet polled). */
  hash: string;
  /** Ledger the transaction was included in, when known. */
  ledger?: number;
  /** Relayer transaction id, for polling a `skipWait` submission. */
  transactionId?: string;
}

/**
 * Failed result of a submission operation.
 *
 * Submission methods never throw for expected on-chain/relayer failures; they
 * return this shape with a typed {@link PasskeyKitError} (a `ContractError` when
 * an on-chain contract code was decoded). All other SDK methods throw.
 */
export interface TransactionFailure {
  success: false;
  /** The typed error describing the failure. Branch on `error.code`. */
  error: PasskeyKitError;
  /** Transaction hash, when one was assigned before the failure. */
  hash?: string;
}

/** Result of a submission operation: a discriminated union on `success`. */
export type TransactionResult = TransactionSuccess | TransactionFailure;

/** How a transaction is submitted to the network. */
export type SubmissionMethod = "relayer" | "rpc";
