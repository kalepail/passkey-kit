import { Buffer } from "buffer";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  Result,
  Spec as ContractSpec,
} from '@stellar/stellar-sdk/contract';

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}

export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CCPLERXCJZB7LX2VOSOCBNRN754FRLHI6Y2AVOQBA5L7C2ZJX5RFVVET",
  }
} as const

export const Errors = {
  1: { message: "NotFound" },
  2: { message: "NotPermitted" },
  3: { message: "ClientDataJsonChallengeIncorrect" },
  4: { message: "Secp256r1PublicKeyParse" },
  5: { message: "Secp256r1SignatureParse" },
  6: { message: "Secp256r1VerifyFailed" },
  7: { message: "JsonParseError" }
}

export interface Signature {
  authenticator_data: Buffer;
  client_data_json: Buffer;
  id: Buffer;
  signature: Buffer;
}

export interface Client {
  /**
   * Construct and simulate a add transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add: ({ id, pk, admin }: { id: Buffer, pk: Buffer, admin: boolean }, options?: {
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
  remove: ({ id }: { id: Buffer }, options?: {
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
      new ContractSpec(["AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAABwAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAAxOb3RQZXJtaXR0ZWQAAAACAAAAAAAAACBDbGllbnREYXRhSnNvbkNoYWxsZW5nZUluY29ycmVjdAAAAAMAAAAAAAAAF1NlY3AyNTZyMVB1YmxpY0tleVBhcnNlAAAAAAQAAAAAAAAAF1NlY3AyNTZyMVNpZ25hdHVyZVBhcnNlAAAAAAUAAAAAAAAAFVNlY3AyNTZyMVZlcmlmeUZhaWxlZAAAAAAAAAYAAAAAAAAADkpzb25QYXJzZUVycm9yAAAAAAAH",
        "AAAAAAAAAAAAAAADYWRkAAAAAAMAAAAAAAAAAmlkAAAAAAAOAAAAAAAAAAJwawAAAAAD7gAAAEEAAAAAAAAABWFkbWluAAAAAAAAAQAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAGcmVtb3ZlAAAAAAABAAAAAAAAAAJpZAAAAAAADgAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAGdXBkYXRlAAAAAAABAAAAAAAAAARoYXNoAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAQAAAAAAAAAAAAAACVNpZ25hdHVyZQAAAAAAAAQAAAAAAAAAEmF1dGhlbnRpY2F0b3JfZGF0YQAAAAAADgAAAAAAAAAQY2xpZW50X2RhdGFfanNvbgAAAA4AAAAAAAAAAmlkAAAAAAAOAAAAAAAAAAlzaWduYXR1cmUAAAAAAAPuAAAAQA==",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAJc2lnbmF0dXJlAAAAAAAH0AAAAAlTaWduYXR1cmUAAAAAAAAAAAAADWF1dGhfY29udGV4dHMAAAAAAAPqAAAH0AAAAAdDb250ZXh0AAAAAAEAAAPpAAAD7QAAAAAAAAAD"]),
      options
    )
  }
  public readonly fromJSON = {
    add: this.txFromJSON<Result<void>>,
    remove: this.txFromJSON<Result<void>>,
    update: this.txFromJSON<Result<void>>
  }
}