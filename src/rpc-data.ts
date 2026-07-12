/**
 * Direct contract-data ledger reads that distinguish a genuine not-found from a
 * transport failure.
 *
 * `Server.getContractData` collapses BOTH a real not-found AND any transport
 * error (429/5xx/timeout, aborted fetch) into an identical `{ code: 404 }`
 * throw, so a caller can't tell "the entry is gone" from "the RPC hiccuped".
 * These helpers go one level lower: `getLedgerEntries` resolves with an empty
 * `entries` array for a genuine not-found and only throws on an actual transport
 * failure. That lets eviction detection and `getSigner`'s ownership check treat
 * the two cases correctly instead of false-evicting live signers (audit H2) or
 * reporting a valid passkey as "not a signer" on a flaky RPC.
 *
 * @packageDocumentation
 */

import { Address, xdr } from "@stellar/stellar-sdk";
import { Durability, type Server } from "@stellar/stellar-sdk/rpc";

/** Build the contract-data `LedgerKey` for a (contract, key, durability) triple. */
export function contractDataLedgerKey(
  contractId: string,
  key: xdr.ScVal,
  durability: Durability
): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: Address.fromString(contractId).toScAddress(),
      key,
      durability:
        durability === Durability.Temporary
          ? xdr.ContractDataDurability.temporary()
          : xdr.ContractDataDurability.persistent(),
    })
  );
}

/**
 * Read a contract-data entry's stored ScVal, or `null` when the entry genuinely
 * does not exist in that durability.
 *
 * Transport errors are NOT swallowed — they propagate so a caller never mistakes
 * a flaky RPC for an absent entry.
 */
export async function readContractData(
  rpc: Server,
  contractId: string,
  key: xdr.ScVal,
  durability: Durability
): Promise<xdr.ScVal | null> {
  const { entries } = await rpc.getLedgerEntries(
    contractDataLedgerKey(contractId, key, durability)
  );
  const entry = entries[0];
  return entry ? entry.val.contractData().val() : null;
}

/**
 * Whether a contract-data entry exists in the given durability.
 *
 * Returns `false` only on a genuine not-found; a transport error throws (so
 * callers conclude eviction exclusively from an authoritative not-found).
 */
export async function contractDataExists(
  rpc: Server,
  contractId: string,
  key: xdr.ScVal,
  durability: Durability
): Promise<boolean> {
  return (await readContractData(rpc, contractId, key, durability)) !== null;
}
