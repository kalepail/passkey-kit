/**
 * Stellar Asset Contract (SEP-41) helpers.
 *
 * DECISION (todo 950): keep the generated `sac-sdk` client rather than collapsing
 * it to a bare `buildTokenTransferHostFunction` helper. The demo needs the full
 * SEP-41 surface (balance, name/symbol/decimals reads, transfer) for token UX,
 * which a transfer-only host-function builder cannot provide. We ALSO expose
 * {@link buildTokenTransferHostFunction} for the low-level relayer `{func,auth}`
 * path. (`sac-sdk` regeneration from a canonical source is handled in B4.)
 *
 * @packageDocumentation
 */

import { Address, xdr, nativeToScVal } from "@stellar/stellar-sdk";
import { Client as SacClient } from "sac-sdk";

/** A thin factory around the generated SEP-41 `sac-sdk` client. */
export class SACClient {
  readonly networkPassphrase: string;
  readonly rpcUrl: string;

  constructor(options: { networkPassphrase: string; rpcUrl: string }) {
    this.networkPassphrase = options.networkPassphrase;
    this.rpcUrl = options.rpcUrl;
  }

  /** Build a SEP-41 client for a specific SAC/token contract. */
  getSACClient(sacContractId: string): SacClient {
    return new SacClient({
      contractId: sacContractId,
      networkPassphrase: this.networkPassphrase,
      rpcUrl: this.rpcUrl,
    });
  }
}

/**
 * Build a raw SEP-41 `transfer(from, to, amount)` host function, for the
 * low-level relayer `{ func, auth }` submission path (no client instance needed).
 */
export function buildTokenTransferHostFunction(
  tokenContract: string,
  from: string,
  to: string,
  amountInStroops: bigint
): xdr.HostFunction {
  return xdr.HostFunction.hostFunctionTypeInvokeContract(
    new xdr.InvokeContractArgs({
      contractAddress: Address.fromString(tokenContract).toScAddress(),
      functionName: "transfer",
      args: [
        xdr.ScVal.scvAddress(Address.fromString(from).toScAddress()),
        xdr.ScVal.scvAddress(Address.fromString(to).toScAddress()),
        nativeToScVal(amountInStroops, { type: "i128" }),
      ],
    })
  );
}
