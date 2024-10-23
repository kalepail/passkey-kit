import { Buffer } from "buffer";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/minimal/contract';
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
} from '@stellar/stellar-sdk/minimal/contract';

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "NIL",
  }
} as const

export const Errors = {
  1: { message: "NotFound" },

  2: { message: "AlreadyExists" },

  3: { message: "MissingContext" },

  4: { message: "SignerExpired" },

  5: { message: "FailedSignerLimits" },

  6: { message: "FailedPolicySignerLimits" },

  7: { message: "SignatureKeyValueMismatch" },

  8: { message: "ClientDataJsonChallengeIncorrect" },

  9: { message: "JsonParseError" }
}
export type SignerLimits = readonly [Map<string, Option<Array<SignerKey>>>];
export type SignerKey = { tag: "Policy", values: readonly [string] } | { tag: "Ed25519", values: readonly [Buffer] } | { tag: "Secp256r1", values: readonly [Buffer] };

export type SignerVal = { tag: "Policy", values: readonly [Option<u32>, SignerLimits] } | { tag: "Ed25519", values: readonly [Option<u32>, SignerLimits] } | { tag: "Secp256r1", values: readonly [Buffer, Option<u32>, SignerLimits] };

export type SignerStorage = { tag: "Persistent", values: void } | { tag: "Temporary", values: void };

export type Signer = { tag: "Policy", values: readonly [string, Option<u32>, SignerLimits, SignerStorage] } | { tag: "Ed25519", values: readonly [Buffer, Option<u32>, SignerLimits, SignerStorage] } | { tag: "Secp256r1", values: readonly [Buffer, Buffer, Option<u32>, SignerLimits, SignerStorage] };


export interface Secp256r1Signature {
  authenticator_data: Buffer;
  client_data_json: Buffer;
  signature: Buffer;
}

export type Signature = { tag: "Ed25519", values: readonly [Buffer] } | { tag: "Secp256r1", values: readonly [Secp256r1Signature] };

export type Signatures = readonly [Map<SignerKey, Option<Signature>>];

export interface Client {
  /**
   * Construct and simulate a add_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_signer: ({ signer }: { signer: Signer }, options?: {
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
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_signer: ({ signer }: { signer: Signer }, options?: {
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
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a remove_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_signer: ({ signer_key }: { signer_key: SignerKey }, options?: {
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
  }) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a update_contract_code transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_contract_code: ({ hash }: { hash: Buffer }, options?: {
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
  }) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAA1BbHJlYWR5RXhpc3RzAAAAAAAAAgAAAAAAAAAOTWlzc2luZ0NvbnRleHQAAAAAAAMAAAAAAAAADVNpZ25lckV4cGlyZWQAAAAAAAAEAAAAAAAAABJGYWlsZWRTaWduZXJMaW1pdHMAAAAAAAUAAAAAAAAAGEZhaWxlZFBvbGljeVNpZ25lckxpbWl0cwAAAAYAAAAAAAAAGVNpZ25hdHVyZUtleVZhbHVlTWlzbWF0Y2gAAAAAAAAHAAAAAAAAACBDbGllbnREYXRhSnNvbkNoYWxsZW5nZUluY29ycmVjdAAAAAgAAAAAAAAADkpzb25QYXJzZUVycm9yAAAAAAAJ",
        "AAAAAQAAAAAAAAAAAAAADFNpZ25lckxpbWl0cwAAAAEAAAAAAAAAATAAAAAAAAPsAAAAEwAAA+gAAAPqAAAH0AAAAAlTaWduZXJLZXkAAAA=",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lcktleQAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAATAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAABAAAD7gAAACAAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAABAAAADg==",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lclZhbAAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAIAAAPoAAAABAAAB9AAAAAMU2lnbmVyTGltaXRzAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAACAAAD6AAAAAQAAAfQAAAADFNpZ25lckxpbWl0cwAAAAEAAAAAAAAACVNlY3AyNTZyMQAAAAAAAAMAAAPuAAAAQQAAA+gAAAAEAAAH0AAAAAxTaWduZXJMaW1pdHM=",
        "AAAAAgAAAAAAAAAAAAAADVNpZ25lclN0b3JhZ2UAAAAAAAACAAAAAAAAAAAAAAAKUGVyc2lzdGVudAAAAAAAAAAAAAAAAAAJVGVtcG9yYXJ5AAAA",
        "AAAAAgAAAAAAAAAAAAAABlNpZ25lcgAAAAAAAwAAAAEAAAAAAAAABlBvbGljeQAAAAAABAAAABMAAAPoAAAABAAAB9AAAAAMU2lnbmVyTGltaXRzAAAH0AAAAA1TaWduZXJTdG9yYWdlAAAAAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAAEAAAD7gAAACAAAAPoAAAABAAAB9AAAAAMU2lnbmVyTGltaXRzAAAH0AAAAA1TaWduZXJTdG9yYWdlAAAAAAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAABQAAAA4AAAPuAAAAQQAAA+gAAAAEAAAH0AAAAAxTaWduZXJMaW1pdHMAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAA=",
        "AAAAAQAAAAAAAAAAAAAAElNlY3AyNTZyMVNpZ25hdHVyZQAAAAAAAwAAAAAAAAASYXV0aGVudGljYXRvcl9kYXRhAAAAAAAOAAAAAAAAABBjbGllbnRfZGF0YV9qc29uAAAADgAAAAAAAAAJc2lnbmF0dXJlAAAAAAAD7gAAAEA=",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25hdHVyZQAAAAAAAAIAAAABAAAAAAAAAAdFZDI1NTE5AAAAAAEAAAPuAAAAQAAAAAEAAAAAAAAACVNlY3AyNTZyMQAAAAAAAAEAAAfQAAAAElNlY3AyNTZyMVNpZ25hdHVyZQAA",
        "AAAAAQAAAAAAAAAAAAAAClNpZ25hdHVyZXMAAAAAAAEAAAAAAAAAATAAAAAAAAPsAAAH0AAAAAlTaWduZXJLZXkAAAAAAAPoAAAH0AAAAAlTaWduYXR1cmUAAAA=",
        "AAAAAAAAAAAAAAAKYWRkX3NpZ25lcgAAAAAAAQAAAAAAAAAGc2lnbmVyAAAAAAfQAAAABlNpZ25lcgAAAAAAAA==",
        "AAAAAAAAAAAAAAANdXBkYXRlX3NpZ25lcgAAAAAAAAEAAAAAAAAABnNpZ25lcgAAAAAH0AAAAAZTaWduZXIAAAAAAAA=",
        "AAAAAAAAAAAAAAANcmVtb3ZlX3NpZ25lcgAAAAAAAAEAAAAAAAAACnNpZ25lcl9rZXkAAAAAB9AAAAAJU2lnbmVyS2V5AAAAAAAAAA==",
        "AAAAAAAAAAAAAAAUdXBkYXRlX2NvbnRyYWN0X2NvZGUAAAABAAAAAAAAAARoYXNoAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAKc2lnbmF0dXJlcwAAAAAH0AAAAApTaWduYXR1cmVzAAAAAAAAAAAADWF1dGhfY29udGV4dHMAAAAAAAPqAAAH0AAAAAdDb250ZXh0AAAAAAEAAAPpAAAD7QAAAAAAAAAD"]),
      options
    )
  }
  public readonly fromJSON = {
    add_signer: this.txFromJSON<null>,
    update_signer: this.txFromJSON<null>,
    remove_signer: this.txFromJSON<null>,
    update_contract_code: this.txFromJSON<null>
  }
}