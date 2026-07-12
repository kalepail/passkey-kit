/**
 * Shared SignerKey/SignerVal codec used by both indexer backends.
 *
 * Centralizes the encoding both backends need: the contract `SignerKey` ScVal
 * (for a Stellar Indexer key predicate), the JSON predicate shape, decoding a
 * stored `SignerVal` into {@link WalletSigner} parts, and the status derivation.
 *
 * WIRE NOTE: the Stellar Indexer key/val predicate JSON shape (and whether bytes
 * are hex- or base64-encoded) is confirmed live against the beta API in F2. The
 * documented `{ vec: [{ symbol }, { bytes|address }] }` shape (with hex bytes)
 * is implemented here; adjust in one place if F2 shows otherwise.
 *
 * @packageDocumentation
 */

import { Address, StrKey, xdr } from "@stellar/stellar-sdk";
import type { Spec as ContractSpec } from "@stellar/stellar-sdk/contract";
import { Client as PasskeyClient, type SignerVal } from "passkey-kit-sdk";
import {
  SignerKey,
  type SignerKeyTag,
  type SignerLimits,
} from "../types.js";
import { signerKeyToScVal, SIGNER_VAL_UDT } from "../kit/auth-payload.js";
import { toContractSignerKey } from "../kit/wallet-ops.js";
import type { SignerStatus, SignerStorageClass, WalletSigner } from "./types.js";

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

/**
 * Build the JSON key predicate for the Stellar Indexer contract-data query.
 *
 * @see WIRE NOTE at the top of this module.
 */
export function signerKeyToIndexerJson(key: SignerKey): unknown {
  const contractKey = toContractSignerKey(key);
  if (contractKey.tag === "Policy") {
    return {
      vec: [{ symbol: "Policy" }, { address: contractKey.values[0] }],
    };
  }
  const bytes = Buffer.from(contractKey.values[0]).toString("hex");
  return { vec: [{ symbol: contractKey.tag }, { bytes }] };
}

/**
 * Decode a contract `SignerKey` ScVal (`scvVec([symbol, bytes|address])`) back
 * into an SDK-side {@link SignerKey}. Used by the Stellar Indexer backend, which
 * returns the stored ledger-entry key.
 */
export function scValToSignerKey(scVal: xdr.ScVal): SignerKey {
  const vec = scVal.vec();
  if (!vec || vec.length < 2 || vec[0]!.switch().name !== "scvSymbol") {
    throw new Error("SignerKey ScVal is not a tagged vector");
  }
  const tag = vec[0]!.sym().toString() as SignerKeyTag;
  switch (tag) {
    case "Secp256r1":
      return SignerKey.Secp256r1(
        Buffer.from(vec[1]!.bytes()).toString("base64url")
      );
    case "Ed25519":
      return SignerKey.Ed25519(
        StrKey.encodeEd25519PublicKey(Buffer.from(vec[1]!.bytes()))
      );
    case "Policy":
      return SignerKey.Policy(
        Address.fromScAddress(vec[1]!.address()).toString()
      );
    default:
      throw new Error(`Unknown SignerKey tag: ${tag}`);
  }
}

/** Decode a stored `SignerVal` ScVal into WalletSigner value parts. */
export function decodeSignerVal(valScVal: xdr.ScVal): {
  kind: SignerKeyTag;
  publicKey?: Uint8Array;
  expiration?: number;
  limits?: SignerLimits;
} {
  const native = walletSpec().scValToNative(valScVal, SIGNER_VAL_UDT) as SignerVal;

  // SignerExpiration = [Option<u32|u64>]; SignerLimits = [Option<Map>].
  const expiration = expirationOf(native);
  const limits = limitsOf(native);

  if (native.tag === "Secp256r1") {
    return {
      kind: "Secp256r1",
      publicKey: new Uint8Array(native.values[0]),
      expiration,
      limits,
    };
  }
  return { kind: native.tag, expiration, limits };
}

function expirationOf(native: SignerVal): number | undefined {
  const exp =
    native.tag === "Secp256r1" ? native.values[1] : native.values[0];
  const value = exp?.[0];
  return value == null ? undefined : Number(value);
}

function limitsOf(native: SignerVal): SignerLimits {
  const rawLimits =
    native.tag === "Secp256r1" ? native.values[2] : native.values[1];
  const map = rawLimits?.[0];
  if (!map) return undefined;

  const out: SignerLimits = new Map();
  // `spec.scValToNative` decodes an ScMap to an ARRAY of `[key, value]` pairs
  // (spec.js), not a JS Map — despite the `Map` static type. Iterate the pairs
  // directly; `map.entries()` would yield `[index, pair]` and mis-key every
  // entry under a numeric index. Direct iteration is correct for both an
  // array-of-pairs and a real Map, so it stays robust if the SDK ever changes.
  for (const [contract, keys] of map) {
    out.set(
      contract,
      keys
        ? keys.map((k) => {
            switch (k.tag) {
              case "Policy":
                return SignerKey.Policy(k.values[0]);
              case "Ed25519":
                // Ed25519 SignerKey.value is a `G…` strkey (matches
                // scValToSignerKey and types.ts), NOT hex — a hex value throws
                // in Keypair.fromPublicKey when re-encoded (audit M1).
                return SignerKey.Ed25519(
                  StrKey.encodeEd25519PublicKey(Buffer.from(k.values[0]))
                );
              case "Secp256r1":
                return SignerKey.Secp256r1(
                  Buffer.from(k.values[0]).toString("base64url")
                );
            }
          })
        : undefined
    );
  }
  return out;
}

/**
 * Derive a signer's lifecycle status.
 *
 * @param nowSeconds - Current UNIX time in seconds (compared against expiration)
 */
export function deriveStatus(args: {
  expiration?: number;
  evicted?: boolean;
  tombstoned?: boolean;
  nowSeconds: number;
}): SignerStatus {
  if (args.tombstoned) return "removed";
  if (args.evicted) return "evicted";
  // Expiration is inclusive: valid while now <= expiration (contract semantics).
  if (args.expiration != null && args.nowSeconds > args.expiration) {
    return "expired";
  }
  return "live";
}

/** Assemble a {@link WalletSigner} from a key, decoded value, storage, status. */
export function buildWalletSigner(
  key: SignerKey,
  decoded: ReturnType<typeof decodeSignerVal>,
  storage: SignerStorageClass,
  status: SignerStatus
): WalletSigner {
  return {
    key,
    ...(decoded.publicKey ? { publicKey: decoded.publicKey } : {}),
    ...(decoded.expiration != null ? { expiration: decoded.expiration } : {}),
    limits: decoded.limits,
    storage,
    status,
  };
}
