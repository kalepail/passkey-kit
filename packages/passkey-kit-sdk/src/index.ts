import { Buffer } from "buffer";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/minimal/contract';
import type {
  u32,
  Option,
} from '@stellar/stellar-sdk/minimal/contract';

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

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
export type SignerExpiration = readonly [Option<u32>];
export type SignerLimits = readonly [Option<Map<string, Option<Array<SignerKey>>>>];
export type SignerStorage = { tag: "Persistent", values: void } | { tag: "Temporary", values: void };
export type Signer = { tag: "Policy", values: readonly [string, SignerExpiration, SignerLimits, SignerStorage] } | { tag: "Ed25519", values: readonly [Buffer, SignerExpiration, SignerLimits, SignerStorage] } | { tag: "Secp256r1", values: readonly [Buffer, Buffer, SignerExpiration, SignerLimits, SignerStorage] };
export type SignerKey = { tag: "Policy", values: readonly [string] } | { tag: "Ed25519", values: readonly [Buffer] } | { tag: "Secp256r1", values: readonly [Buffer] };
export type SignerVal = { tag: "Policy", values: readonly [SignerExpiration, SignerLimits] } | { tag: "Ed25519", values: readonly [SignerExpiration, SignerLimits] } | { tag: "Secp256r1", values: readonly [Buffer, SignerExpiration, SignerLimits] };

export interface Secp256r1Signature {
  authenticator_data: Buffer;
  client_data_json: Buffer;
  signature: Buffer;
}
export type Signature = { tag: "Policy", values: void } | { tag: "Ed25519", values: readonly [Buffer] } | { tag: "Secp256r1", values: readonly [Secp256r1Signature] };
export type Signatures = readonly [Map<SignerKey, Signature>];

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
  static async deploy<T = Client>(
    /** Constructor/Initialization Args for the contract's `__constructor` method */
    { signer }: { signer: Signer },
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
        address?: string;
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({ signer }, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACQAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAA1BbHJlYWR5RXhpc3RzAAAAAAAAAgAAAAAAAAAOTWlzc2luZ0NvbnRleHQAAAAAAAMAAAAAAAAADVNpZ25lckV4cGlyZWQAAAAAAAAEAAAAAAAAABJGYWlsZWRTaWduZXJMaW1pdHMAAAAAAAUAAAAAAAAAGEZhaWxlZFBvbGljeVNpZ25lckxpbWl0cwAAAAYAAAAAAAAAGVNpZ25hdHVyZUtleVZhbHVlTWlzbWF0Y2gAAAAAAAAHAAAAAAAAACBDbGllbnREYXRhSnNvbkNoYWxsZW5nZUluY29ycmVjdAAAAAgAAAAAAAAADkpzb25QYXJzZUVycm9yAAAAAAAJ",
        "AAAAAQAAAAAAAAAAAAAAEFNpZ25lckV4cGlyYXRpb24AAAABAAAAAAAAAAEwAAAAAAAD6AAAAAQ=",
        "AAAAAQAAAAAAAAAAAAAADFNpZ25lckxpbWl0cwAAAAEAAAAAAAAAATAAAAAAAAPoAAAD7AAAABMAAAPoAAAD6gAAB9AAAAAJU2lnbmVyS2V5AAAA",
        "AAAAAgAAAAAAAAAAAAAADVNpZ25lclN0b3JhZ2UAAAAAAAACAAAAAAAAAAAAAAAKUGVyc2lzdGVudAAAAAAAAAAAAAAAAAAJVGVtcG9yYXJ5AAAA",
        "AAAAAgAAAAAAAAAAAAAABlNpZ25lcgAAAAAAAwAAAAEAAAAAAAAABlBvbGljeQAAAAAABAAAABMAAAfQAAAAEFNpZ25lckV4cGlyYXRpb24AAAfQAAAADFNpZ25lckxpbWl0cwAAB9AAAAANU2lnbmVyU3RvcmFnZQAAAAAAAAEAAAAAAAAAB0VkMjU1MTkAAAAABAAAA+4AAAAgAAAH0AAAABBTaWduZXJFeHBpcmF0aW9uAAAH0AAAAAxTaWduZXJMaW1pdHMAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAAAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAAFAAAADgAAA+4AAABBAAAH0AAAABBTaWduZXJFeHBpcmF0aW9uAAAH0AAAAAxTaWduZXJMaW1pdHMAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAA=",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lcktleQAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAATAAAAAQAAAAAAAAAHRWQyNTUxOQAAAAABAAAD7gAAACAAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAABAAAADg==",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25lclZhbAAAAAAAAAMAAAABAAAAAAAAAAZQb2xpY3kAAAAAAAIAAAfQAAAAEFNpZ25lckV4cGlyYXRpb24AAAfQAAAADFNpZ25lckxpbWl0cwAAAAEAAAAAAAAAB0VkMjU1MTkAAAAAAgAAB9AAAAAQU2lnbmVyRXhwaXJhdGlvbgAAB9AAAAAMU2lnbmVyTGltaXRzAAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAAAwAAA+4AAABBAAAH0AAAABBTaWduZXJFeHBpcmF0aW9uAAAH0AAAAAxTaWduZXJMaW1pdHM=",
        "AAAAAQAAAAAAAAAAAAAAElNlY3AyNTZyMVNpZ25hdHVyZQAAAAAAAwAAAAAAAAASYXV0aGVudGljYXRvcl9kYXRhAAAAAAAOAAAAAAAAABBjbGllbnRfZGF0YV9qc29uAAAADgAAAAAAAAAJc2lnbmF0dXJlAAAAAAAD7gAAAEA=",
        "AAAAAgAAAAAAAAAAAAAACVNpZ25hdHVyZQAAAAAAAAMAAAAAAAAAAAAAAAZQb2xpY3kAAAAAAAEAAAAAAAAAB0VkMjU1MTkAAAAAAQAAA+4AAABAAAAAAQAAAAAAAAAJU2VjcDI1NnIxAAAAAAAAAQAAB9AAAAASU2VjcDI1NnIxU2lnbmF0dXJlAAA=",
        "AAAAAQAAAAAAAAAAAAAAClNpZ25hdHVyZXMAAAAAAAEAAAAAAAAAATAAAAAAAAPsAAAH0AAAAAlTaWduZXJLZXkAAAAAAAfQAAAACVNpZ25hdHVyZQAAAA==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABnNpZ25lcgAAAAAH0AAAAAZTaWduZXIAAAAAAAA=",
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