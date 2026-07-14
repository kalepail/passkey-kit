/**
 * Transaction-signing operations: the auth-entry signing pipeline and the
 * `AssembledTransaction` signing entrypoint.
 *
 * Two deliberate changes from the old kit:
 * - `sign` takes a single explicit `AssembledTransaction<T>` instead of the
 *   lossy `AssembledTransaction | Tx | string` tri-input that silently dropped
 *   memo/fee/operations on its fallback path (#599 §6). Callers holding XDR use
 *   `AssembledTransaction.fromXDR` first.
 * - The `Signatures` map is sorted with the host-order `compareScVal`, not the
 *   old `localeCompare` string approximation.
 * - Signing is address-bound only: V1 address credentials are upgraded to
 *   CAP-0071-02 V2 before the payload is hashed (`toAddressBoundCredentials`),
 *   and there is no V1 signing path.
 *
 * @packageDocumentation
 */

import { Operation, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { Keypair } from "@stellar/stellar-sdk";
import type { Server } from "@stellar/stellar-sdk/rpc";
import type {
  AssembledTransaction,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type { Signer, SignerContext } from "../signers.js";
import {
  buildSignaturePayload,
  getAddressCredentials,
  signatureToScVal,
  signerKeyToScVal,
  toAddressBoundCredentials,
  upsertSignatureEntry,
  usesAddressBoundPayload,
} from "./auth-payload.js";
import { SigningError, PasskeyKitError, PasskeyKitErrorCode } from "../errors.js";

/** Deps for computing a default signature-expiration ledger. */
export interface ExpirationDeps {
  rpc: Server;
  timeoutInSeconds: number;
}

/**
 * Compute a default signature-expiration ledger: the latest ledger plus the
 * timeout window (assuming ~5s ledgers), rounded up.
 */
export async function calculateExpiration(deps: ExpirationDeps): Promise<number> {
  const { sequence } = await deps.rpc.getLatestLedger();
  return Math.ceil(sequence + deps.timeoutInSeconds / 5);
}

/** Deps for signing a single auth entry. */
export interface SignAuthEntryDeps {
  networkPassphrase: string;
  spec: ContractSpec;
  signerContext: SignerContext;
  calculateExpiration: () => Promise<number>;
}

/** Per-call signing options. */
export interface SignOptions {
  /** Signature expiration ledger (defaults to the configured window). */
  expiration?: number;
}

/**
 * Sign a single Soroban authorization entry with a {@link Signer}, merging the
 * resulting `(SignerKey, Signature)` pair into the entry's flat `Signatures`
 * map (host-ordered).
 *
 * Mutates and returns the passed entry.
 */
export async function signAuthEntry(
  deps: SignAuthEntryDeps,
  entry: xdr.SorobanAuthorizationEntry,
  signer: Signer,
  options?: SignOptions
): Promise<xdr.SorobanAuthorizationEntry> {
  if (
    entry.credentials().switch().name === "sorobanCredentialsAddressWithDelegates"
  ) {
    throw new SigningError(
      "ADDRESS_WITH_DELEGATES auth entries are not supported by passkey signing",
      PasskeyKitErrorCode.UNSUPPORTED_CREDENTIALS
    );
  }

  // Address-bound credentials only (CAP-0071-02): a legacy V1 address entry is
  // upgraded to V2 before anything is hashed, so the wallet address is bound
  // into the signed preimage. There is deliberately NO V1 signing path — a V1
  // payload hash is identical across wallets for an address-free invocation,
  // so it does not bind the signature to this wallet.
  entry.credentials(toAddressBoundCredentials(entry.credentials()));
  if (!usesAddressBoundPayload(entry.credentials())) {
    throw new SigningError(
      `Refusing to sign a non-address-bound auth entry: ${entry.credentials().switch().name}`,
      PasskeyKitErrorCode.UNSUPPORTED_CREDENTIALS
    );
  }

  const credentials = getAddressCredentials(entry.credentials());

  // `== null`, not `!expiration`: an explicit `expiration: 0` is a caller-chosen
  // value, not "unset" — only undefined/null falls through to the entry's
  // existing ledger or a freshly computed default.
  let expiration = options?.expiration;
  if (expiration == null) {
    expiration = credentials.signatureExpirationLedger();
    if (!expiration) {
      expiration = await deps.calculateExpiration();
    }
  }

  // Sets credentials.signatureExpirationLedger(expiration) as a side effect.
  const payload = buildSignaturePayload(deps.networkPassphrase, entry, expiration);

  const prepared = await signer.sign(payload, deps.signerContext);
  const scKey = signerKeyToScVal(deps.spec, prepared.key);
  const scVal = signatureToScVal(deps.spec, prepared.value);
  upsertSignatureEntry(credentials, scKey, scVal);

  return entry;
}

/** Deps for signing an assembled transaction's auth entries. */
export interface SignTxDeps extends SignAuthEntryDeps {
  getContractId: () => string | undefined;
}

/**
 * Sign every auth entry of an {@link AssembledTransaction} that is authorized by
 * the connected wallet, using `signer`. Returns the same transaction with its
 * auth entries signed.
 *
 * @throws {SigningError} If no wallet is connected.
 */
export async function sign<T>(
  deps: SignTxDeps,
  txn: AssembledTransaction<T>,
  signer: Signer,
  options?: SignOptions
): Promise<AssembledTransaction<T>> {
  const contractId = deps.getContractId();
  if (!contractId) {
    throw new SigningError(
      "A wallet must be connected to sign a transaction",
      PasskeyKitErrorCode.SIGNING_FAILED
    );
  }

  await txn.signAuthEntries({
    address: contractId,
    authorizeEntry: async (entry) => {
      const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
      return signAuthEntry(deps, clone, signer, options);
    },
  });

  return txn;
}

/**
 * The `restorePreamble` shape Soroban simulation returns when a transaction
 * touches archived entries (a subset of the SDK's `SimulateTransactionResponse`).
 */
export interface RestorePreamble {
  minResourceFee: string;
  transactionData: { build(): xdr.SorobanTransactionData };
}

/**
 * Restore an archived contract-data footprint reported by simulation, paying
 * with the deployer keypair.
 *
 * Soroban simulation returns a `restorePreamble` when the transaction touches
 * archived entries; the footprint must be restored (a separate, fee-bearing
 * transaction) before the real transaction can succeed. The deployer keypair
 * pays because it is the on-chain fee source the kit already controls.
 *
 * Returns the restore transaction hash. This path is exercised live in F2 (it
 * requires archived on-chain state to trigger).
 *
 * @throws {SigningError} On submission/confirmation failure.
 */
export async function restoreFootprint(
  deps: {
    rpc: Server;
    networkPassphrase: string;
    deployerKeypair: Keypair;
    timeoutInSeconds: number;
  },
  restorePreamble: RestorePreamble
): Promise<string> {
  const account = await deps.rpc.getAccount(deps.deployerKeypair.publicKey());
  const fee = (Number(restorePreamble.minResourceFee) + 100_000).toString();

  const restoreTx = new TransactionBuilder(account, {
    fee,
    networkPassphrase: deps.networkPassphrase,
  })
    .addOperation(Operation.restoreFootprint({}))
    .setSorobanData(restorePreamble.transactionData.build())
    .setTimeout(deps.timeoutInSeconds)
    .build();

  restoreTx.sign(deps.deployerKeypair);

  const sendResult = await deps.rpc.sendTransaction(restoreTx);
  if (sendResult.status === "ERROR") {
    throw new PasskeyKitError(
      `Footprint restore submission failed: ${sendResult.errorResult?.toXDR("base64") ?? "unknown"}`,
      PasskeyKitErrorCode.RESTORE_REQUIRED,
      { context: { hash: sendResult.hash } }
    );
  }

  const result = await deps.rpc.pollTransaction(sendResult.hash, { attempts: 10 });
  if (result.status !== "SUCCESS") {
    throw new PasskeyKitError(
      `Footprint restore did not confirm (status ${result.status})`,
      PasskeyKitErrorCode.RESTORE_REQUIRED,
      { context: { hash: sendResult.hash } }
    );
  }

  return sendResult.hash;
}
