/**
 * ScVal encoding helpers for the Mercury indexer backend.
 *
 * The hosted passkey-indexer returns fully-decoded signer JSON, so the only
 * on-chain encoding the backend still needs is the contract `SignerKey` ScVal —
 * for the temporary-signer eviction probe (`contractDataExists`) and the
 * reverse-lookup on-chain confirmation (`getSigner`). Both go through the
 * contract Spec built from a throwaway client.
 *
 * @packageDocumentation
 */

import { xdr } from "@stellar/stellar-sdk";
import type { Spec as ContractSpec } from "@stellar/stellar-sdk/contract";
import { Client as PasskeyClient } from "passkey-kit-sdk";
import { SignerKey } from "../types.js";
import { signerKeyToScVal } from "../kit/auth-payload.js";
import { toContractSignerKey } from "../kit/wallet-ops.js";

// The contract Spec is network-independent, so memoize a single instance built
// from a throwaway client (constructing a client does not touch the network).
let cachedSpec: ContractSpec | undefined;
export function walletSpec(): ContractSpec {
  if (!cachedSpec) {
    cachedSpec = (
      new PasskeyClient({
        contractId:
          "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL",
        networkPassphrase: "Test SDF Network ; September 2015",
        rpcUrl: "https://rpc.invalid",
      }) as unknown as { spec: ContractSpec }
    ).spec;
  }
  return cachedSpec;
}

/** Encode an SDK-side {@link SignerKey} into its contract `SignerKey` ScVal. */
export function signerKeyToContractScVal(key: SignerKey): xdr.ScVal {
  return signerKeyToScVal(walletSpec(), toContractSignerKey(key));
}
