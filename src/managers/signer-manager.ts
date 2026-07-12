/**
 * Signer manager: the signing pipeline and signer-write builders for the
 * connected wallet.
 *
 * Owns nothing directly — every wallet-dependent value is a late-bound closure
 * ({@link SignerManagerDeps.getWallet} / `getContractId` / `getSpec`) supplied by
 * the kit facade, so the manager is constructed once and always sees current
 * state. That indirection is also what makes it `vi.fn()`-testable.
 *
 * @packageDocumentation
 */

import { xdr } from "@stellar/stellar-sdk";
import type { Server } from "@stellar/stellar-sdk/rpc";
import type {
  AssembledTransaction,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type { Client as PasskeyClient, SignerVal } from "passkey-kit-sdk";
import type { Signer, SignerContext } from "../signers.js";
import { PasskeySigner } from "../signers.js";
import {
  SignerStore,
  type SignerKey,
  type SignerLimits,
} from "../types.js";
import { WalletNotConnectedError } from "../errors.js";
import {
  signAuthEntry as signAuthEntryOp,
  sign as signOp,
  type SignOptions,
} from "../kit/tx-ops.js";
import {
  buildEd25519SignerTx,
  buildPolicySignerTx,
  buildRemoveSignerTx,
  buildSecp256r1SignerTx,
  getSigner as getSignerOp,
} from "../kit/wallet-ops.js";

/** Extract the contract `Spec` from a generated client (not in the public type). */
function specOf(wallet: PasskeyClient): ContractSpec {
  return (wallet as unknown as { spec: ContractSpec }).spec;
}

export interface SignerManagerDeps {
  networkPassphrase: string;
  timeoutInSeconds: number;
  rpc: Server;
  getWallet: () => PasskeyClient | undefined;
  getContractId: () => string | undefined;
  getSignerContext: () => SignerContext;
  calculateExpiration: () => Promise<number>;
}

export class SignerManager {
  constructor(private readonly deps: SignerManagerDeps) {}

  private requireWallet(): { wallet: PasskeyClient; spec: ContractSpec } {
    const wallet = this.deps.getWallet();
    if (!wallet) {
      throw new WalletNotConnectedError("perform a signer operation");
    }
    return { wallet, spec: specOf(wallet) };
  }

  private writeDeps() {
    return {
      wallet: this.requireWallet().wallet,
      timeoutInSeconds: this.deps.timeoutInSeconds,
    };
  }

  // -- Signing pipeline --------------------------------------------------------

  private signAuthEntryDeps() {
    return {
      networkPassphrase: this.deps.networkPassphrase,
      spec: this.requireWallet().spec,
      signerContext: this.deps.getSignerContext(),
      calculateExpiration: this.deps.calculateExpiration,
    };
  }

  /** Sign a single auth entry with `signer` (defaults to the connected passkey). */
  signAuthEntry(
    entry: xdr.SorobanAuthorizationEntry,
    signer: Signer = new PasskeySigner(),
    options?: SignOptions
  ): Promise<xdr.SorobanAuthorizationEntry> {
    return signAuthEntryOp(this.signAuthEntryDeps(), entry, signer, options);
  }

  /** Sign an assembled transaction's wallet auth entries. */
  sign<T>(
    txn: AssembledTransaction<T>,
    signer: Signer = new PasskeySigner(),
    options?: SignOptions
  ): Promise<AssembledTransaction<T>> {
    return signOp(
      { ...this.signAuthEntryDeps(), getContractId: this.deps.getContractId },
      txn,
      signer,
      options
    );
  }

  // -- Signer writes -----------------------------------------------------------

  addSecp256r1(
    keyId: string | Uint8Array,
    publicKey: string | Uint8Array,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<AssembledTransaction<null>> {
    return buildSecp256r1SignerTx(this.writeDeps(), "add_signer", keyId, publicKey, limits, store, expiration);
  }

  updateSecp256r1(
    keyId: string | Uint8Array,
    publicKey: string | Uint8Array,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<AssembledTransaction<null>> {
    return buildSecp256r1SignerTx(this.writeDeps(), "update_signer", keyId, publicKey, limits, store, expiration);
  }

  addEd25519(
    publicKey: string,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<AssembledTransaction<null>> {
    return buildEd25519SignerTx(this.writeDeps(), "add_signer", publicKey, limits, store, expiration);
  }

  updateEd25519(
    publicKey: string,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<AssembledTransaction<null>> {
    return buildEd25519SignerTx(this.writeDeps(), "update_signer", publicKey, limits, store, expiration);
  }

  addPolicy(
    policy: string,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<AssembledTransaction<null>> {
    return buildPolicySignerTx(this.writeDeps(), "add_signer", policy, limits, store, expiration);
  }

  updatePolicy(
    policy: string,
    limits: SignerLimits,
    store: SignerStore,
    expiration?: number
  ): Promise<AssembledTransaction<null>> {
    return buildPolicySignerTx(this.writeDeps(), "update_signer", policy, limits, store, expiration);
  }

  remove(signerKey: SignerKey): Promise<AssembledTransaction<null>> {
    return buildRemoveSignerTx(this.writeDeps(), signerKey);
  }

  // -- Reads -------------------------------------------------------------------

  /** Read a signer entry from the ledger (temporary before persistent). */
  getSigner(signerKey: SignerKey): Promise<SignerVal | null> {
    const { spec } = this.requireWallet();
    const contractId = this.deps.getContractId();
    if (!contractId) {
      throw new WalletNotConnectedError("read a signer");
    }
    return getSignerOp({ rpc: this.deps.rpc, spec }, contractId, signerKey);
  }
}
