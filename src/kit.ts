/**
 * `PasskeyKit` — the browser-side facade for creating and using smart-wallet
 * accounts with WebAuthn passkeys.
 *
 * This is a ground-up rewrite of the old monolithic `kit.ts`. The signing
 * pipeline, WebAuthn ceremonies, deploy path, and signer writes now live in
 * dependency-injected managers ({@link CredentialManager}, {@link SignerManager},
 * {@link SubmissionManager}) wired here with late-bound closures. All Protocol-27
 * probe shims, dead commented experiments, and the legacy factory-address
 * fallback are gone — the kit targets stellar-sdk >= 16 and the current wallet.
 *
 * @packageDocumentation
 */

import { xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import {
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type AuthenticatorSelectionCriteria,
} from "@simplewebauthn/browser";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Client as PasskeyClient } from "passkey-kit-sdk";
import base64url from "./base64url.js";
import {
  SignerKey,
  SignerStore,
  type ConnectWalletResult,
  type CreateWalletResult,
  type SignerLimits,
  type StorageAdapter,
} from "./types.js";
import {
  ConfigurationError,
  PasskeyKitError,
  PasskeyKitErrorCode,
  WalletNotConnectedError,
  WalletOwnershipError,
} from "./errors.js";
import { PasskeyEventEmitter } from "./events.js";
import { DEFAULT_TIMEOUT_SECONDS } from "./constants.js";
import { PasskeySigner, type Signer, type SignerContext } from "./signers.js";
import type { WebAuthnClient } from "./kit/webauthn-ops.js";
import type { CreatedPasskey } from "./kit/webauthn-ops.js";
import type { SignOptions } from "./kit/tx-ops.js";
import { calculateExpiration } from "./kit/tx-ops.js";
import {
  CredentialManager,
  SignerManager,
  SubmissionManager,
} from "./managers/index.js";
import { resolveDeployer } from "./kit/deploy-ops.js";
import type { WalletTx } from "./kit/wallet-ops.js";

/** Configuration for a {@link PasskeyKit} client. */
export interface PasskeyKitConfig {
  /** Stellar RPC URL. */
  rpcUrl: string;
  /** Network passphrase. */
  networkPassphrase: string;
  /** Smart-wallet WASM hash (hex) used to deploy new wallets. */
  walletWasmHash: string;
  /** WebAuthn Relying Party id (domain); defaults to the current origin. */
  rpId?: string;
  /**
   * Secret key (`S…`) for the fee-paying deployer. Defaults to the canonical
   * deterministic deployer (see {@link resolveDeployer}); overriding it changes
   * derived wallet addresses.
   */
  deploySource?: string;
  /** Transaction timeout, in seconds (default 30). */
  timeoutInSeconds?: number;
  /** Optional passkey-record storage adapter (see `passkey-kit/storage`). */
  storage?: StorageAdapter;
  /** Custom WebAuthn implementation (for testing). */
  WebAuthn?: WebAuthnClient;
}

/** Options for {@link PasskeyKit.createKey}/{@link PasskeyKit.createWallet}. */
export interface CreateOptions {
  authenticatorSelection?: AuthenticatorSelectionCriteria;
}

/** Options for {@link PasskeyKit.connectWallet}. */
export interface ConnectOptions {
  /** A specific keyId to connect (skips the discovery ceremony). */
  keyId?: string | Uint8Array;
  /** Indexer-backed keyId → contract lookup, used when derivation misses. */
  getContractId?: (keyId: string) => Promise<string | undefined>;
  /**
   * Also assert the wallet's on-chain WASM hash equals `walletWasmHash`.
   * Off by default: an upgraded wallet legitimately runs a different hash.
   */
  verifyWasmHash?: boolean;
}

export class PasskeyKit {
  readonly rpc: Server;
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
  readonly walletWasmHash: string;
  readonly rpId?: string;

  /** Lifecycle event emitter (walletCreated, walletConnected, …). */
  readonly events = new PasskeyEventEmitter();

  private readonly timeoutInSeconds: number;
  private readonly webAuthn: WebAuthnClient;

  private readonly credentialManager: CredentialManager;
  private readonly signerManager: SignerManager;
  private readonly submissionManager: SubmissionManager;

  /** The connected passkey's base64url keyId, if any. */
  keyId: string | undefined;
  /** The connected wallet client, if any. */
  wallet: PasskeyClient | undefined;

  constructor(config: PasskeyKitConfig) {
    if (!config.rpcUrl) {
      throw new ConfigurationError(
        "rpcUrl is required",
        PasskeyKitErrorCode.MISSING_CONFIG
      );
    }
    if (!config.networkPassphrase) {
      throw new ConfigurationError(
        "networkPassphrase is required",
        PasskeyKitErrorCode.MISSING_CONFIG
      );
    }
    if (!config.walletWasmHash) {
      throw new ConfigurationError(
        "walletWasmHash is required",
        PasskeyKitErrorCode.MISSING_CONFIG
      );
    }

    this.rpc = new Server(config.rpcUrl);
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.walletWasmHash = config.walletWasmHash;
    this.rpId = config.rpId;
    this.timeoutInSeconds = config.timeoutInSeconds ?? DEFAULT_TIMEOUT_SECONDS;
    this.webAuthn =
      config.WebAuthn ?? ({ startRegistration, startAuthentication } as WebAuthnClient);

    const deployerKeypair = resolveDeployer(config.deploySource);

    this.credentialManager = new CredentialManager({
      rpId: this.rpId,
      webAuthn: this.webAuthn,
      storage: config.storage,
    });

    this.signerManager = new SignerManager({
      networkPassphrase: this.networkPassphrase,
      timeoutInSeconds: this.timeoutInSeconds,
      rpc: this.rpc,
      getWallet: () => this.wallet,
      getContractId: () => this.wallet?.options.contractId,
      getSignerContext: () => this.signerContext(),
      calculateExpiration: () =>
        calculateExpiration({ rpc: this.rpc, timeoutInSeconds: this.timeoutInSeconds }),
    });

    this.submissionManager = new SubmissionManager({
      rpc: this.rpc,
      rpcUrl: config.rpcUrl,
      networkPassphrase: this.networkPassphrase,
      walletWasmHash: this.walletWasmHash,
      deployerKeypair,
      timeoutInSeconds: this.timeoutInSeconds,
    });
  }

  /** The connected wallet's contract id, if any. */
  get contractId(): string | undefined {
    return this.wallet?.options.contractId;
  }

  /** The fee-paying deployer's `G…` public key. */
  get deployerPublicKey(): string {
    return this.submissionManager.deployerPublicKey;
  }

  private signerContext(): SignerContext {
    return { rpId: this.rpId, webAuthn: this.webAuthn, defaultKeyId: this.keyId };
  }

  // -- Passkey / wallet lifecycle ---------------------------------------------

  /** Run a passkey registration ceremony without deploying a wallet. */
  createKey(
    appName: string,
    userName: string,
    options?: CreateOptions
  ): Promise<CreatedPasskey> {
    return this.credentialManager.createKey(
      appName,
      userName,
      options?.authenticatorSelection
    );
  }

  /**
   * Register a passkey and deploy a smart wallet initialized with it as the
   * first signer. Returns the signed deploy transaction (submit it via
   * `PasskeyServer`).
   */
  async createWallet(
    appName: string,
    userName: string,
    options?: CreateOptions
  ): Promise<CreateWalletResult> {
    const created = await this.createKey(appName, userName, options);

    const deployTx = await this.submissionManager.buildDeployTransaction(
      created.keyIdBuffer,
      created.publicKey
    );
    const contractId = deployTx.result.options.contractId;

    this.wallet = new PasskeyClient({
      contractId,
      rpcUrl: this.rpcUrl,
      networkPassphrase: this.networkPassphrase,
    });
    this.keyId = created.keyId;

    const signedTx = await this.submissionManager.signDeploy(deployTx);

    await this.credentialManager.rememberPasskey({
      keyId: created.keyId,
      publicKey: created.publicKey,
      contractId,
      createdAt: Date.now(),
    });

    this.events.emit("walletCreated", { contractId, keyId: created.keyId });

    return {
      rawResponse: created.rawResponse,
      keyId: created.keyIdBuffer,
      keyIdBase64: created.keyId,
      contractId,
      signedTx,
    };
  }

  /**
   * Connect an existing wallet from a passkey.
   *
   * Resolves the wallet address by (1) deterministic derivation from the keyId,
   * (2) local storage, then (3) an injected indexer lookup — and then VERIFIES
   * ownership: the keyId must resolve to a live signer on the wallet (#601 F7).
   * This closes the unverified reverse-lookup hole (#598 F3) at the SDK layer.
   *
   * @throws {WalletOwnershipError} If the keyId is not a signer on the wallet.
   */
  async connectWallet(options?: ConnectOptions): Promise<ConnectWalletResult> {
    let rawResponse: AuthenticationResponseJSON | undefined;
    let keyId = options?.keyId;

    if (!keyId) {
      const auth = await this.credentialManager.authenticate();
      keyId = auth.keyId;
      rawResponse = auth.rawResponse;
    }

    const keyIdBase64 =
      keyId instanceof Uint8Array ? base64url(Buffer.from(keyId)) : keyId;
    const keyIdBuffer =
      keyId instanceof Uint8Array ? Buffer.from(keyId) : base64url.toBuffer(keyId);

    // 1) Deterministic derivation, confirmed by an on-chain instance read.
    let contractId: string | undefined =
      this.submissionManager.deriveWalletAddress(keyIdBuffer);
    try {
      await this.rpc.getContractData(
        contractId,
        xdr.ScVal.scvLedgerKeyContractInstance()
      );
    } catch {
      // 2) local storage, then 3) injected indexer lookup.
      contractId =
        (await this.credentialManager.lookupContractId(keyIdBase64)) ??
        (options?.getContractId
          ? await options.getContractId(keyIdBase64)
          : undefined);
    }

    if (!contractId) {
      throw new PasskeyKitError(
        "Could not resolve a wallet for the given passkey",
        PasskeyKitErrorCode.WALLET_NOT_FOUND,
        { context: { keyId: keyIdBase64 } }
      );
    }

    this.wallet = new PasskeyClient({
      contractId,
      rpcUrl: this.rpcUrl,
      networkPassphrase: this.networkPassphrase,
    });
    this.keyId = keyIdBase64;

    // 3) Ownership verification (F7): the keyId must be a live signer.
    const signerVal = await this.signerManager.getSigner(
      SignerKey.Secp256r1(keyIdBase64)
    );
    if (!signerVal) {
      this.wallet = undefined;
      this.keyId = undefined;
      throw new WalletOwnershipError(
        "The passkey is not a signer on the resolved wallet",
        { contractId, keyId: keyIdBase64 }
      );
    }

    // 4) Optional wasm-hash check (opt-in; upgraded wallets differ by design).
    if (options?.verifyWasmHash) {
      await this.assertWalletWasmHash(contractId);
    }

    this.events.emit("walletConnected", { contractId, keyId: keyIdBase64 });

    return { rawResponse, keyId: keyIdBuffer, keyIdBase64, contractId };
  }

  private async assertWalletWasmHash(contractId: string): Promise<void> {
    const instance = await this.rpc.getContractData(
      contractId,
      xdr.ScVal.scvLedgerKeyContractInstance()
    );
    const executable = instance.val
      .contractData()
      .val()
      .instance()
      .executable();
    if (executable.switch().name !== "contractExecutableWasm") {
      throw new WalletOwnershipError("Wallet is not a WASM contract", {
        contractId,
      });
    }
    const wasmHash = executable.wasmHash().toString("hex");
    if (wasmHash !== this.walletWasmHash.toLowerCase()) {
      throw new WalletOwnershipError("Wallet WASM hash does not match", {
        contractId,
        expected: this.walletWasmHash,
        actual: wasmHash,
      });
    }
  }

  /** Disconnect the current wallet. */
  disconnect(): void {
    const contractId = this.contractId;
    this.wallet = undefined;
    this.keyId = undefined;
    if (contractId) {
      this.events.emit("walletDisconnected", { contractId });
    }
  }

  // -- Signing -----------------------------------------------------------------

  /** Sign a single auth entry (defaults to the connected passkey signer). */
  signAuthEntry(
    entry: xdr.SorobanAuthorizationEntry,
    signer?: Signer,
    options?: SignOptions
  ): Promise<xdr.SorobanAuthorizationEntry> {
    return this.signerManager.signAuthEntry(entry, signer, options);
  }

  /** Sign an assembled transaction's wallet auth entries. */
  sign<T>(
    txn: AssembledTransaction<T>,
    signer?: Signer,
    options?: SignOptions
  ): Promise<AssembledTransaction<T>> {
    return this.signerManager.sign(txn, signer, options);
  }

  // -- Signer management -------------------------------------------------------

  addSecp256r1(
    keyId: string | Uint8Array,
    publicKey: string | Uint8Array,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<WalletTx> {
    return this.signerManager.addSecp256r1(keyId, publicKey, limits, store, expiration);
  }
  updateSecp256r1(
    keyId: string | Uint8Array,
    publicKey: string | Uint8Array,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<WalletTx> {
    return this.signerManager.updateSecp256r1(keyId, publicKey, limits, store, expiration);
  }
  addEd25519(
    publicKey: string,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<WalletTx> {
    return this.signerManager.addEd25519(publicKey, limits, store, expiration);
  }
  updateEd25519(
    publicKey: string,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<WalletTx> {
    return this.signerManager.updateEd25519(publicKey, limits, store, expiration);
  }
  addPolicy(
    policy: string,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<WalletTx> {
    return this.signerManager.addPolicy(policy, limits, store, expiration);
  }
  updatePolicy(
    policy: string,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<WalletTx> {
    return this.signerManager.updatePolicy(policy, limits, store, expiration);
  }
  remove(signerKey: SignerKey): Promise<WalletTx> {
    return this.signerManager.remove(signerKey);
  }

  /** Build an `upgrade(new_wasm_hash)` transaction for the connected wallet. */
  upgrade(newWasmHash: Buffer | Uint8Array): Promise<WalletTx> {
    return this.signerManager.upgrade(newWasmHash);
  }

  /** Read a signer entry from the ledger (temporary before persistent). */
  getSigner(signerKey: SignerKey) {
    return this.signerManager.getSigner(signerKey);
  }

  /** Require a connected wallet, or throw. */
  requireWallet(): PasskeyClient {
    if (!this.wallet) {
      throw new WalletNotConnectedError();
    }
    return this.wallet;
  }
}
