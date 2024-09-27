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

export const Errors = {
  1: { message: "NotFound" },

  2: { message: "MissingContext" },

  3: { message: "MissingSignerLimits" },

  4: { message: "FailedPolicySignerLimits" },

  5: { message: "SignatureKeyValueMismatch" },

  6: { message: "ClientDataJsonChallengeIncorrect" },

  7: { message: "JsonParseError" }
}
export type SignerLimits = readonly [Map<string, Option<Array<SignerKey>>>];
export type SignerKey = { tag: "Policy", values: readonly [string] } | { tag: "Ed25519", values: readonly [Buffer] } | { tag: "Secp256r1", values: readonly [Buffer] };

export type SignerVal = { tag: "Policy", values: readonly [SignerLimits] } | { tag: "Ed25519", values: readonly [SignerLimits] } | { tag: "Secp256r1", values: readonly [Buffer, SignerLimits] };

export type SignerStorage = { tag: "Persistent", values: void } | { tag: "Temporary", values: void };

export type Signer = { tag: "Policy", values: readonly [string, SignerLimits, SignerStorage] } | { tag: "Ed25519", values: readonly [Buffer, SignerLimits, SignerStorage] } | { tag: "Secp256r1", values: readonly [Buffer, Buffer, SignerLimits, SignerStorage] };


export interface Secp256r1Signature {
  authenticator_data: Buffer;
  client_data_json: Buffer;
  signature: Buffer;
}

export type Signature = { tag: "Ed25519", values: readonly [Buffer] } | { tag: "Secp256r1", values: readonly [Secp256r1Signature] };

export type Signatures = readonly [Map<SignerKey, Option<Signature>>];

export interface Client {
  /**
   * Construct and simulate a add transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add: ({ signer }: { signer: Signer }, options?: {
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
      new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABwAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAA5NaXNzaW5nQ29udGV4dAAAAAAAAgAAAAAAAAATTWlzc2luZ1NpZ25lckxpbWl0cwAAAAADAAAAAAAAABhGYWlsZWRQb2xpY3lTaWduZXJMaW1pdHMAAAAEAAAAAAAAABlTaWduYXR1cmVLZXlWYWx1ZU1pc21hdGNoAAAAAAAABQAAAAAAAAAgQ2xpZW50RGF0YUpzb25DaGFsbGVuZ2VJbmNvcnJlY3QAAAAGAAAAAAAAAA5Kc29uUGFyc2VFcnJvcgAAAAAABw==",
        "AAAAAQAAAAAAAAAAAAAADFNpZ25lckxpbWl0cwAAAAEAAAAAAAAAATAAAAAAAAPsAAAAEwAAA+gAAAPqAAAH0AAAAAlTaWduZXJLZXkAAAA=",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lcktleQAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAATAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAABAAAD7gAAACAAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAABAAAADg==",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lclZhbAAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAfQAAAADFNpZ25lckxpbWl0cwAAAAEAAAAAAAAAB0VkMjU1MTkAAAAAAQAAB9AAAAAMU2lnbmVyTGltaXRzAAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAAAgAAA+4AAABBAAAH0AAAAAxTaWduZXJMaW1pdHM=",
        "AAAAAgAAAAAAAAAAAAAADVNpZ25lclN0b3JhZ2UAAAAAAAACAAAAAAAAAAAAAAAKUGVyc2lzdGVudAAAAAAAAAAAAAAAAAAJVGVtcG9yYXJ5AAAA",
        "AAAAAgAAAAAAAAAAAAAABlNpZ25lcgAAAAAAAwAAAAEAAAAAAAAABlBvbGljeQAAAAAAAwAAABMAAAfQAAAADFNpZ25lckxpbWl0cwAAB9AAAAANU2lnbmVyU3RvcmFnZQAAAAAAAAEAAAAAAAAAB0VkMjU1MTkAAAAAAwAAA+4AAAAgAAAH0AAAAAxTaWduZXJMaW1pdHMAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAAAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAAEAAAADgAAA+4AAABBAAAH0AAAAAxTaWduZXJMaW1pdHMAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAA=",
        "AAAAAQAAAAAAAAAAAAAAElNlY3AyNTZyMVNpZ25hdHVyZQAAAAAAAwAAAAAAAAASYXV0aGVudGljYXRvcl9kYXRhAAAAAAAOAAAAAAAAABBjbGllbnRfZGF0YV9qc29uAAAADgAAAAAAAAAJc2lnbmF0dXJlAAAAAAAD7gAAAEA=",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25hdHVyZQAAAAAAAAIAAAABAAAAAAAAAAdFZDI1NTE5AAAAAAEAAAPuAAAAQAAAAAEAAAAAAAAACVNlY3AyNTZyMQAAAAAAAAEAAAfQAAAAElNlY3AyNTZyMVNpZ25hdHVyZQAA",
        "AAAAAQAAAAAAAAAAAAAAClNpZ25hdHVyZXMAAAAAAAEAAAAAAAAAATAAAAAAAAPsAAAH0AAAAAlTaWduZXJLZXkAAAAAAAPoAAAH0AAAAAlTaWduYXR1cmUAAAA=",
        "AAAAAAAAAAAAAAADYWRkAAAAAAEAAAAAAAAABnNpZ25lcgAAAAAH0AAAAAZTaWduZXIAAAAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAGcmVtb3ZlAAAAAAABAAAAAAAAAApzaWduZXJfa2V5AAAAAAfQAAAACVNpZ25lcktleQAAAAAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAGdXBkYXRlAAAAAAABAAAAAAAAAARoYXNoAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAKc2lnbmF0dXJlcwAAAAAH0AAAAApTaWduYXR1cmVzAAAAAAAAAAAADWF1dGhfY29udGV4dHMAAAAAAAPqAAAH0AAAAAdDb250ZXh0AAAAAAEAAAPpAAAD7QAAAAAAAAAD"]),
      options
    )
  }
  public readonly fromJSON = {
    add: this.txFromJSON<Result<void>>,
    remove: this.txFromJSON<Result<void>>,
    update: this.txFromJSON<Result<void>>
  }
}