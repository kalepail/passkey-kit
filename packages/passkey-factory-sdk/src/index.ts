import { Buffer } from "buffer";
import { Address } from '@stellar/stellar-sdk';
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Typepoint,
  Duration,
} from '@stellar/stellar-sdk/contract';

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CB5BITCRTHNBM2QPXSWZVTM3A5BGFYXGIYXHJ5ZAVNRO624QTRYVWV6A",
  }
} as const

export type Policy = readonly [string];
export type Ed25519PublicKey = readonly [Buffer];
export type Secp256r1Id = readonly [Buffer];
export type Secp256r1PublicKey = readonly [Buffer];
export type SignerKey = { tag: "Policy", values: readonly [Policy] } | { tag: "Ed25519", values: readonly [Ed25519PublicKey] } | { tag: "Secp256r1", values: readonly [Secp256r1Id] };

export type PolicySigner = { tag: "Policy", values: readonly [Policy] } | { tag: "Ed25519", values: readonly [Ed25519PublicKey] } | { tag: "Secp256r1", values: readonly [Secp256r1Id, Secp256r1PublicKey] };

export type Signer = { tag: "Policy", values: readonly [Policy, Array<PolicySigner>] } | { tag: "Ed25519", values: readonly [Ed25519PublicKey] } | { tag: "Secp256r1", values: readonly [Secp256r1Id, Secp256r1PublicKey] };

export const Errors = {
  1: { message: "NotInitialized" },

  2: { message: "AlreadyInitialized" }
}

export interface Client {
  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  init: ({ wasm_hash }: { wasm_hash: Buffer }, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a deploy transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  deploy: ({ salt, signer }: { salt: Buffer, signer: Signer }, options?: {
    /**
     * The fee to pay for the transaction. Default: BASE_FEE
     */
    fee?: number;

    /**
     * The maximum amount of time to wait for the transaction to complete. Default: DEFAULT_TIMEOUT
     */
    timeoutInSeconds?: number;

    /**
     * Whether to automatically simulate the transaction when constructing the AssembledTransaction. Default: true
     */
    simulate?: boolean;
  }) => Promise<AssembledTransaction<Result<string>>>

}
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec(["AAAAAQAAAAAAAAAAAAAABlBvbGljeQAAAAAAAQAAAAAAAAABMAAAAAAAABM=",
        "AAAAAQAAAAAAAAAAAAAAEEVkMjU1MTlQdWJsaWNLZXkAAAABAAAAAAAAAAEwAAAAAAAD7gAAACA=",
        "AAAAAQAAAAAAAAAAAAAAC1NlY3AyNTZyMUlkAAAAAAEAAAAAAAAAATAAAAAAAAAO",
        "AAAAAQAAAAAAAAAAAAAAElNlY3AyNTZyMVB1YmxpY0tleQAAAAAAAQAAAAAAAAABMAAAAAAAA+4AAABB",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lcktleQAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAfQAAAABlBvbGljeQAAAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAABAAAH0AAAABBFZDI1NTE5UHVibGljS2V5AAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAAAQAAB9AAAAALU2VjcDI1NnIxSWQA",
        "AAAAAgAAAAAAAAAAAAAADFBvbGljeVNpZ25lcgAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAfQAAAABlBvbGljeQAAAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAABAAAH0AAAABBFZDI1NTE5UHVibGljS2V5AAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAAAgAAB9AAAAALU2VjcDI1NnIxSWQAAAAH0AAAABJTZWNwMjU2cjFQdWJsaWNLZXkAAA==",
        "AAAAAgAAAAAAAAAAAAAABlNpZ25lcgAAAAAAAwAAAAEAAAAAAAAABlBvbGljeQAAAAAAAgAAB9AAAAAGUG9saWN5AAAAAAPqAAAH0AAAAAxQb2xpY3lTaWduZXIAAAABAAAAAAAAAAdFZDI1NTE5AAAAAAEAAAfQAAAAEEVkMjU1MTlQdWJsaWNLZXkAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAACAAAH0AAAAAtTZWNwMjU2cjFJZAAAAAfQAAAAElNlY3AyNTZyMVB1YmxpY0tleQAA",
        "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAAAgAAAAAAAAAOTm90SW5pdGlhbGl6ZWQAAAAAAAEAAAAAAAAAEkFscmVhZHlJbml0aWFsaXplZAAAAAAAAg==",
        "AAAAAAAAAAAAAAAEaW5pdAAAAAEAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAGZGVwbG95AAAAAAACAAAAAAAAAARzYWx0AAAD7gAAACAAAAAAAAAABnNpZ25lcgAAAAAH0AAAAAZTaWduZXIAAAAAAAEAAAPpAAAAEwAAAAM="]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<Result<void>>,
    deploy: this.txFromJSON<Result<string>>
  }
}