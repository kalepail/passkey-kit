/**
 * Wallet signer operations: build add/update/remove signer transactions, encode
 * the SDK-side {@link SignerKey}/{@link SignerLimits} helpers into the contract's
 * union types, and read a signer entry back from the ledger.
 *
 * `getSigner` reads the flat top-level `SignerKey → SignerVal` entry directly via
 * RPC (temporary durability before persistent, per the contract's lookup
 * invariant). This doubles as `connectWallet`'s ownership check (#601 F7): a
 * keyId that resolves to a live signer entry proves the wallet actually knows
 * that passkey. When the contract's `get_signer` view lands (A3) this can move
 * onto the view; the ledger read is equivalent and works today.
 *
 * @packageDocumentation
 */

import { Keypair } from "@stellar/stellar-sdk";
import { Durability, type Server } from "@stellar/stellar-sdk/rpc";
import type {
  AssembledTransaction,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import {
  Client as PasskeyClient,
  type Signer as SDKSigner,
  type SignerExpiration,
  type SignerKey as SDKSignerKey,
  type SignerLimits as SDKSignerLimits,
  type SignerVal,
} from "passkey-kit-sdk";
import base64url from "../base64url.js";
import { SignerStore, type SignerKey, type SignerLimits } from "../types.js";
import { signerKeyToScVal, SIGNER_VAL_UDT } from "./auth-payload.js";

/**
 * The result of a signer-write / upgrade transaction. The reworked contract's
 * admin functions are typed `Result<void>` (they return `Ok(())` or a typed
 * contract error), so the AssembledTransaction is generic over that.
 */
export type WalletTx = AssembledTransaction<Result<void>>;

/** Encode an optional expiration into the contract's `Option<u64>` timestamp. */
function toSignerExpiration(expiration?: number): SignerExpiration {
  return [expiration == null ? undefined : BigInt(expiration)];
}

/** Which write the builder targets. */
type SignerFn = "add_signer" | "update_signer";

/** Encode a SDK-side {@link SignerKey} helper into the contract's union. */
export function toContractSignerKey({ key, value }: SignerKey): SDKSignerKey {
  switch (key) {
    case "Policy":
      return { tag: "Policy", values: [value] };
    case "Ed25519":
      return { tag: "Ed25519", values: [Keypair.fromPublicKey(value).rawPublicKey()] };
    case "Secp256r1":
      return { tag: "Secp256r1", values: [base64url.toBuffer(value)] };
  }
}

/** Encode SDK-side {@link SignerLimits} into the contract's `SignerLimits`. */
export function toContractSignerLimits(limits: SignerLimits): SDKSignerLimits {
  if (!limits) {
    return [undefined];
  }

  const map = new Map<string, SDKSignerKey[] | undefined>();
  for (const [contract, signerKeys] of limits.entries()) {
    map.set(
      contract,
      signerKeys?.length ? signerKeys.map(toContractSignerKey) : undefined
    );
  }
  return [map];
}

function buildSecp256r1Signer(
  keyId: string | Uint8Array,
  publicKey: string | Uint8Array,
  limits: SignerLimits,
  store: SignerStore,
  expiration?: number
): SDKSigner {
  const keyIdBuffer =
    typeof keyId === "string" ? base64url.toBuffer(keyId) : Buffer.from(keyId);
  const publicKeyBuffer =
    typeof publicKey === "string"
      ? base64url.toBuffer(publicKey)
      : Buffer.from(publicKey);
  return {
    tag: "Secp256r1",
    values: [
      keyIdBuffer,
      publicKeyBuffer,
      toSignerExpiration(expiration),
      toContractSignerLimits(limits),
      { tag: store, values: undefined },
    ],
  };
}

function buildEd25519Signer(
  publicKey: string,
  limits: SignerLimits,
  store: SignerStore,
  expiration?: number
): SDKSigner {
  return {
    tag: "Ed25519",
    values: [
      Keypair.fromPublicKey(publicKey).rawPublicKey(),
      toSignerExpiration(expiration),
      toContractSignerLimits(limits),
      { tag: store, values: undefined },
    ],
  };
}

function buildPolicySigner(
  policy: string,
  limits: SignerLimits,
  store: SignerStore,
  expiration?: number
): SDKSigner {
  return {
    tag: "Policy",
    values: [
      policy,
      toSignerExpiration(expiration),
      toContractSignerLimits(limits),
      { tag: store, values: undefined },
    ],
  };
}

/** Shared deps for building signer-write transactions. */
export interface WalletWriteDeps {
  wallet: PasskeyClient;
  timeoutInSeconds: number;
}

export function buildSecp256r1SignerTx(
  deps: WalletWriteDeps,
  fn: SignerFn,
  keyId: string | Uint8Array,
  publicKey: string | Uint8Array,
  limits: SignerLimits,
  store: SignerStore,
  expiration?: number
): Promise<WalletTx> {
  return deps.wallet[fn](
    { signer: buildSecp256r1Signer(keyId, publicKey, limits, store, expiration) },
    { timeoutInSeconds: deps.timeoutInSeconds }
  );
}

export function buildEd25519SignerTx(
  deps: WalletWriteDeps,
  fn: SignerFn,
  publicKey: string,
  limits: SignerLimits,
  store: SignerStore,
  expiration?: number
): Promise<WalletTx> {
  return deps.wallet[fn](
    { signer: buildEd25519Signer(publicKey, limits, store, expiration) },
    { timeoutInSeconds: deps.timeoutInSeconds }
  );
}

export function buildPolicySignerTx(
  deps: WalletWriteDeps,
  fn: SignerFn,
  policy: string,
  limits: SignerLimits,
  store: SignerStore,
  expiration?: number
): Promise<WalletTx> {
  return deps.wallet[fn](
    { signer: buildPolicySigner(policy, limits, store, expiration) },
    { timeoutInSeconds: deps.timeoutInSeconds }
  );
}

export function buildRemoveSignerTx(
  deps: WalletWriteDeps,
  signerKey: SignerKey
): Promise<WalletTx> {
  return deps.wallet.remove_signer(
    { signer_key: toContractSignerKey(signerKey) },
    { timeoutInSeconds: deps.timeoutInSeconds }
  );
}

/** Build an `upgrade(new_wasm_hash)` transaction (renamed from update_contract_code). */
export function buildUpgradeTx(
  deps: WalletWriteDeps,
  newWasmHash: Buffer | Uint8Array
): Promise<WalletTx> {
  return deps.wallet.upgrade(
    { new_wasm_hash: Buffer.from(newWasmHash) },
    { timeoutInSeconds: deps.timeoutInSeconds }
  );
}

/**
 * Read a signer entry from the ledger, or `null` if absent.
 *
 * Checks temporary durability before persistent (the contract's lookup order).
 * A non-null result proves the wallet holds this signer — the basis of
 * `connectWallet`'s ownership verification.
 */
export async function getSigner(
  deps: { rpc: Server; spec: ContractSpec },
  contractId: string,
  signerKey: SignerKey
): Promise<SignerVal | null> {
  const scKey = signerKeyToScVal(deps.spec, toContractSignerKey(signerKey));

  for (const durability of [Durability.Temporary, Durability.Persistent]) {
    try {
      const entry = await deps.rpc.getContractData(contractId, scKey, durability);
      const scVal = entry.val.contractData().val();
      return deps.spec.scValToNative(scVal, SIGNER_VAL_UDT) as SignerVal;
    } catch {
      // Not present in this durability class; try the next.
    }
  }

  return null;
}
