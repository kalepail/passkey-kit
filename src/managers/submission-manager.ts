/**
 * Submission manager: builds and signs the deploy transaction with the fee-
 * paying deployer keypair, derives deterministic wallet addresses, and drives
 * the footprint-restore flow.
 *
 * Network submission itself is the server's job (`PasskeyServer` / relayer); this
 * manager owns the deployer keypair and the fee-payer signature that make a
 * deploy transaction submittable.
 *
 * @packageDocumentation
 */

import type { Keypair } from "@stellar/stellar-sdk";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import type { Server } from "@stellar/stellar-sdk/rpc";
import type { Client as PasskeyClient } from "passkey-kit-sdk";
import {
  buildDeployTransaction as buildDeployTransactionOp,
  deriveWalletAddress as deriveWalletAddressOp,
} from "../kit/deploy-ops.js";
import {
  restoreFootprint as restoreFootprintOp,
  type RestorePreamble,
} from "../kit/tx-ops.js";

export interface SubmissionManagerDeps {
  rpc: Server;
  rpcUrl: string;
  networkPassphrase: string;
  walletWasmHash: string;
  deployerKeypair: Keypair;
  timeoutInSeconds: number;
}

export class SubmissionManager {
  constructor(private readonly deps: SubmissionManagerDeps) {}

  /** The deployer's `G…` public key (fee source + derivation deployer). */
  get deployerPublicKey(): string {
    return this.deps.deployerKeypair.publicKey();
  }

  /** Deterministically derive the wallet address for a passkey credential. */
  deriveWalletAddress(keyId: Buffer): string {
    return deriveWalletAddressOp(
      {
        networkPassphrase: this.deps.networkPassphrase,
        deployerPublicKey: this.deployerPublicKey,
      },
      keyId
    );
  }

  /** Build the wallet deploy transaction (initial Secp256r1 signer). */
  buildDeployTransaction(
    keyId: Buffer,
    publicKey: Uint8Array
  ): Promise<AssembledTransaction<PasskeyClient>> {
    return buildDeployTransactionOp(
      {
        rpcUrl: this.deps.rpcUrl,
        networkPassphrase: this.deps.networkPassphrase,
        walletWasmHash: this.deps.walletWasmHash,
        deployerPublicKey: this.deployerPublicKey,
        timeoutInSeconds: this.deps.timeoutInSeconds,
      },
      keyId,
      publicKey
    );
  }

  /**
   * Sign a deploy transaction with the deployer keypair (the fee source) and
   * return the signed transaction XDR.
   */
  async signDeploy(tx: AssembledTransaction<PasskeyClient>): Promise<string> {
    await tx.sign({
      signTransaction: basicNodeSigner(
        this.deps.deployerKeypair,
        this.deps.networkPassphrase
      ).signTransaction,
    });
    return tx.signed!.toXDR();
  }

  /** Restore an archived footprint reported by simulation. */
  restoreFootprint(restorePreamble: RestorePreamble): Promise<string> {
    return restoreFootprintOp(
      {
        rpc: this.deps.rpc,
        networkPassphrase: this.deps.networkPassphrase,
        deployerKeypair: this.deps.deployerKeypair,
        timeoutInSeconds: this.deps.timeoutInSeconds,
      },
      restorePreamble
    );
  }
}
