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

export const Errors = {
  1: { message: "NotFound" },

  2: { message: "NotPermitted" },

  3: { message: "BadSignatureOrder" },

  4: { message: "ClientDataJsonChallengeIncorrect" },

  5: { message: "Secp256r1PublicKeyParse" },

  6: { message: "Secp256r1SignatureParse" },

  7: { message: "Secp256r1VerifyFailed" },

  8: { message: "JsonParseError" }
}
export type Policy = readonly [string];
export type Ed25519PublicKey = readonly [Buffer];
export type Secp256r1Id = readonly [Buffer];
export type Secp256r1PublicKey = readonly [Buffer];
export type SignerKey = { tag: "Policy", values: readonly [Policy] } | { tag: "Ed25519", values: readonly [Ed25519PublicKey] } | { tag: "Secp256r1", values: readonly [Secp256r1Id] };

export type PolicySigner = { tag: "Policy", values: readonly [Policy] } | { tag: "Ed25519", values: readonly [Ed25519PublicKey] } | { tag: "Secp256r1", values: readonly [Secp256r1Id, Secp256r1PublicKey] };

export type SignerVal = { tag: "Policy", values: readonly [Array<PolicySigner>] } | { tag: "Secp256r1", values: readonly [Secp256r1PublicKey] };

export type Signer = { tag: "Policy", values: readonly [Policy, Array<PolicySigner>] } | { tag: "Ed25519", values: readonly [Ed25519PublicKey] } | { tag: "Secp256r1", values: readonly [Secp256r1Id, Secp256r1PublicKey] };


export interface Ed25519Signature {
  public_key: Ed25519PublicKey;
  signature: Buffer;
}


export interface Secp256r1Signature {
  authenticator_data: Buffer;
  client_data_json: Buffer;
  id: Secp256r1Id;
  signature: Buffer;
}

export type Signature = { tag: "Policy", values: readonly [Policy] } | { tag: "Ed25519", values: readonly [Ed25519Signature] } | { tag: "Secp256r1", values: readonly [Secp256r1Signature] };


export interface Client {
  /**
   * Construct and simulate a add transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add: ({ signer, admin }: { signer: Signer, admin: boolean }, options?: {
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
   * Construct and simulate a remove transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove: ({ signer_key }: { signer_key: SignerKey }, options?: {
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
   * Construct and simulate a update transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update: ({ hash }: { hash: Buffer }, options?: {
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

}
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAAxOb3RQZXJtaXR0ZWQAAAACAAAAAAAAABFCYWRTaWduYXR1cmVPcmRlcgAAAAAAAAMAAAAAAAAAIENsaWVudERhdGFKc29uQ2hhbGxlbmdlSW5jb3JyZWN0AAAABAAAAAAAAAAXU2VjcDI1NnIxUHVibGljS2V5UGFyc2UAAAAABQAAAAAAAAAXU2VjcDI1NnIxU2lnbmF0dXJlUGFyc2UAAAAABgAAAAAAAAAVU2VjcDI1NnIxVmVyaWZ5RmFpbGVkAAAAAAAABwAAAAAAAAAOSnNvblBhcnNlRXJyb3IAAAAAAAg=",
        "AAAAAQAAAAAAAAAAAAAABlBvbGljeQAAAAAAAQAAAAAAAAABMAAAAAAAABM=",
        "AAAAAQAAAAAAAAAAAAAAEEVkMjU1MTlQdWJsaWNLZXkAAAABAAAAAAAAAAEwAAAAAAAD7gAAACA=",
        "AAAAAQAAAAAAAAAAAAAAC1NlY3AyNTZyMUlkAAAAAAEAAAAAAAAAATAAAAAAAAAO",
        "AAAAAQAAAAAAAAAAAAAAElNlY3AyNTZyMVB1YmxpY0tleQAAAAAAAQAAAAAAAAABMAAAAAAAA+4AAABB",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lcktleQAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAfQAAAABlBvbGljeQAAAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAABAAAH0AAAABBFZDI1NTE5UHVibGljS2V5AAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAAAQAAB9AAAAALU2VjcDI1NnIxSWQA",
        "AAAAAgAAAAAAAAAAAAAADFBvbGljeVNpZ25lcgAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAfQAAAABlBvbGljeQAAAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAABAAAH0AAAABBFZDI1NTE5UHVibGljS2V5AAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAAAgAAB9AAAAALU2VjcDI1NnIxSWQAAAAH0AAAABJTZWNwMjU2cjFQdWJsaWNLZXkAAA==",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lclZhbAAAAAAAAAIAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAPqAAAH0AAAAAxQb2xpY3lTaWduZXIAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAABAAAH0AAAABJTZWNwMjU2cjFQdWJsaWNLZXkAAA==",
        "AAAAAgAAAAAAAAAAAAAABlNpZ25lcgAAAAAAAwAAAAEAAAAAAAAABlBvbGljeQAAAAAAAgAAB9AAAAAGUG9saWN5AAAAAAPqAAAH0AAAAAxQb2xpY3lTaWduZXIAAAABAAAAAAAAAAdFZDI1NTE5AAAAAAEAAAfQAAAAEEVkMjU1MTlQdWJsaWNLZXkAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAACAAAH0AAAAAtTZWNwMjU2cjFJZAAAAAfQAAAAElNlY3AyNTZyMVB1YmxpY0tleQAA",
        "AAAAAQAAAAAAAAAAAAAAEEVkMjU1MTlTaWduYXR1cmUAAAACAAAAAAAAAApwdWJsaWNfa2V5AAAAAAfQAAAAEEVkMjU1MTlQdWJsaWNLZXkAAAAAAAAACXNpZ25hdHVyZQAAAAAAA+4AAABA",
        "AAAAAQAAAAAAAAAAAAAAElNlY3AyNTZyMVNpZ25hdHVyZQAAAAAABAAAAAAAAAASYXV0aGVudGljYXRvcl9kYXRhAAAAAAAOAAAAAAAAABBjbGllbnRfZGF0YV9qc29uAAAADgAAAAAAAAACaWQAAAAAB9AAAAALU2VjcDI1NnIxSWQAAAAAAAAAAAlzaWduYXR1cmUAAAAAAAPuAAAAQA==",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25hdHVyZQAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAfQAAAABlBvbGljeQAAAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAABAAAH0AAAABBFZDI1NTE5U2lnbmF0dXJlAAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAAAQAAB9AAAAASU2VjcDI1NnIxU2lnbmF0dXJlAAA=",
        "AAAAAAAAAAAAAAADYWRkAAAAAAIAAAAAAAAABnNpZ25lcgAAAAAH0AAAAAZTaWduZXIAAAAAAAAAAAAFYWRtaW4AAAAAAAABAAAAAQAAA+kAAAPtAAAAAAAAAAM=",
        "AAAAAAAAAAAAAAAGcmVtb3ZlAAAAAAABAAAAAAAAAApzaWduZXJfa2V5AAAAAAfQAAAACVNpZ25lcktleQAAAAAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAGdXBkYXRlAAAAAAABAAAAAAAAAARoYXNoAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAKc2lnbmF0dXJlcwAAAAAD6gAAB9AAAAAJU2lnbmF0dXJlAAAAAAAAAAAAAA1hdXRoX2NvbnRleHRzAAAAAAAD6gAAB9AAAAAHQ29udGV4dAAAAAABAAAD6QAAA+0AAAAAAAAAAw=="]),
      options
    )
  }
  public readonly fromJSON = {
    add: this.txFromJSON<Result<void>>,
    remove: this.txFromJSON<Result<void>>,
    update: this.txFromJSON<Result<void>>
  }
}