/**
 * Client-side submission routing.
 *
 * This mirrors `PasskeyServer.send`'s logic — the routing the server-only SDK
 * entry performs — but keeps it in the browser and forwards the transaction
 * material to the relayer-proxy worker instead of holding a relayer key. An
 * `invokeHostFunction` without source-account auth uses the preferred
 * `{ func, auth }` Soroban path; everything else (deploys, source-account auth)
 * is fee-bumped through the `{ xdr }` envelope path.
 */

import {
  Operation,
  TransactionBuilder,
  type Transaction,
} from "@stellar/stellar-sdk";
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import {
  RelayerError,
  PasskeyKitErrorCode,
  type TransactionResult,
} from "passkey-kit";
import { config, relayer } from "./config";

// `any` in the generic slot: submission only touches `.built`, which is
// independent of the result type, and `AssembledTransaction` is invariant in its
// type parameter — so accept whatever the kit/SAC builders return.
type Submittable = AssembledTransaction<any> | Transaction | string;

/** Normalize any submittable input to a built {@link Transaction}. */
function toBuiltTransaction(input: Submittable): Transaction {
  if (typeof input === "string") {
    return TransactionBuilder.fromXDR(
      input,
      config.networkPassphrase,
    ) as Transaction;
  }
  if (input instanceof AssembledTransaction) {
    if (!input.built) {
      throw new RelayerError(
        "AssembledTransaction has not been simulated/built yet",
        PasskeyKitErrorCode.RELAYER_REQUEST_FAILED,
      );
    }
    return input.built;
  }
  return input;
}

/** Whether any invokeHostFunction op carries source-account auth. */
function hasSourceAccountAuth(transaction: Transaction): boolean {
  for (const op of transaction.operations) {
    if (op.type !== "invokeHostFunction") continue;
    for (const entry of (op as Operation.InvokeHostFunction).auth ?? []) {
      if (
        entry.credentials().switch().name === "sorobanCredentialsSourceAccount"
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Submit a signed transaction via the relayer proxy. Never throws — returns a
 * discriminated {@link TransactionResult}.
 */
export async function submit(input: Submittable): Promise<TransactionResult> {
  let built: Transaction;
  try {
    built = toBuiltTransaction(input);
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof RelayerError
          ? err
          : new RelayerError(
              err instanceof Error ? err.message : String(err),
              PasskeyKitErrorCode.RELAYER_REQUEST_FAILED,
            ),
    };
  }

  const op = built.operations[0];
  if (op?.type === "invokeHostFunction" && !hasSourceAccountAuth(built)) {
    const invokeOp = op as Operation.InvokeHostFunction;
    const func = invokeOp.func.toXDR("base64");
    const auth = (invokeOp.auth ?? []).map((entry) => entry.toXDR("base64"));
    return relayer.submit({ func, auth });
  }

  return relayer.submit({ xdr: built.toXDR() });
}
