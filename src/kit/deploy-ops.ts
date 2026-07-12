/**
 * Smart-wallet deployment operations.
 *
 * The deployer keypair is now configurable (`config.deploySource`) instead of a
 * hard-coded `Keypair.fromRawEd25519Seed(hash("kalepail"))`. The default still
 * derives from {@link DEFAULT_DEPLOYER_SEED} = `"kalepail"` so contract-id
 * determinism (and indexer reverse-lookup) is preserved out of the box.
 *
 * @packageDocumentation
 */

import { Keypair, hash } from "@stellar/stellar-sdk";
import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import {
  Client as PasskeyClient,
  type Signer as SDKSigner,
} from "passkey-kit-sdk";
import { DEFAULT_DEPLOYER_SEED } from "../constants.js";
import { deriveContractAddress } from "../utils.js";
import { ConfigurationError, PasskeyKitErrorCode } from "../errors.js";

/**
 * Resolve the fee-paying deployer keypair from an optional secret.
 *
 * With no secret, derives the canonical deterministic deployer from
 * {@link DEFAULT_DEPLOYER_SEED}. The deployer only pays fees and salts the
 * deploy; it never controls the wallet. Supplying a different `deploySource`
 * changes the derived contract addresses (and breaks keyId → contract
 * discovery), so this is documented as an advanced option.
 *
 * @throws {ConfigurationError} If `deploySource` is not a valid secret key.
 */
export function resolveDeployer(deploySource?: string): Keypair {
  if (deploySource) {
    try {
      return Keypair.fromSecret(deploySource);
    } catch {
      throw new ConfigurationError(
        "deploySource must be a valid Stellar secret key (S…)",
        PasskeyKitErrorCode.INVALID_CONFIG
      );
    }
  }
  return Keypair.fromRawEd25519Seed(hash(Buffer.from(DEFAULT_DEPLOYER_SEED)));
}

/** Deterministically derive a smart-wallet address for a passkey credential. */
export function deriveWalletAddress(
  deps: { networkPassphrase: string; deployerPublicKey: string },
  keyId: Buffer
): string {
  return deriveContractAddress(keyId, deps.deployerPublicKey, deps.networkPassphrase);
}

/**
 * Build the smart-wallet deploy transaction, initializing it with the passkey as
 * the first (unlimited, persistent) Secp256r1 signer via `__constructor`.
 *
 * The returned {@link AssembledTransaction} still needs to be signed by the
 * deployer keypair (the fee source) before submission.
 */
export async function buildDeployTransaction(
  deps: {
    rpcUrl: string;
    networkPassphrase: string;
    walletWasmHash: string;
    deployerPublicKey: string;
    timeoutInSeconds: number;
  },
  keyId: Buffer,
  publicKey: Uint8Array
): Promise<AssembledTransaction<PasskeyClient>> {
  const signer: SDKSigner = {
    tag: "Secp256r1",
    values: [
      Buffer.from(keyId),
      Buffer.from(publicKey),
      [undefined], // SignerExpiration: none
      [undefined], // SignerLimits: unlimited
      { tag: "Persistent", values: undefined },
    ],
  };

  return PasskeyClient.deploy(
    { signer },
    {
      rpcUrl: deps.rpcUrl,
      wasmHash: deps.walletWasmHash,
      networkPassphrase: deps.networkPassphrase,
      publicKey: deps.deployerPublicKey,
      salt: hash(keyId),
      timeoutInSeconds: deps.timeoutInSeconds,
    }
  );
}
