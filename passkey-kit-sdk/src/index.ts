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
export * from '@stellar/stellar-sdk'
export * as contract from '@stellar/stellar-sdk/contract'
export * as rpc from '@stellar/stellar-sdk/rpc'

if (typeof window !== 'undefined') {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  
} as const

export const Errors = {
  1: {message:""},
  2: {message:""},
  3: {message:""},
  4: {message:""},
  5: {message:""},
  6: {message:""},
  7: {message:""},
  8: {message:""}
}

export interface Signature {
  authenticator_data: Buffer;
  client_data_json: Buffer;
  id: Buffer;
  signature: Buffer;
}


export interface Client {
  /**
   * Construct and simulate a extend_ttl transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  extend_ttl: (options?: {
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
   * Construct and simulate a resudo transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resudo: ({id}: {id: Buffer}, options?: {
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
   * Construct and simulate a rm_sig transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  rm_sig: ({id}: {id: Buffer}, options?: {
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
   * Construct and simulate a add_sig transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_sig: ({id, pk}: {id: Buffer, pk: Buffer}, options?: {
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
   * Construct and simulate a list_sigs transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  list_sigs: (options?: {
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
  }) => Promise<AssembledTransaction<Array<Buffer>>>
}
export class Client extends ContractClient {
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAABUVycm9yAAAAAAAACAAAAAAAAAAITm90Rm91bmQAAAABAAAAAAAAAAxOb3RQZXJtaXR0ZWQAAAACAAAAAAAAACBDbGllbnREYXRhSnNvbkNoYWxsZW5nZUluY29ycmVjdAAAAAMAAAAAAAAAF1NlY3AyNTZyMVB1YmxpY0tleVBhcnNlAAAAAAQAAAAAAAAAF1NlY3AyNTZyMVNpZ25hdHVyZVBhcnNlAAAAAAUAAAAAAAAAFVNlY3AyNTZyMVZlcmlmeUZhaWxlZAAAAAAAAAYAAAAAAAAADkpzb25QYXJzZUVycm9yAAAAAAAHAAAAAAAAAA5JbnZhbGlkQ29udGV4dAAAAAAACA==",
        "AAAAAAAAAAAAAAAKZXh0ZW5kX3R0bAAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAAGcmVzdWRvAAAAAAABAAAAAAAAAAJpZAAAAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAGcm1fc2lnAAAAAAABAAAAAAAAAAJpZAAAAAAD7gAAACAAAAABAAAD6QAAA+0AAAAAAAAAAw==",
        "AAAAAAAAAAAAAAAHYWRkX3NpZwAAAAACAAAAAAAAAAJpZAAAAAAD7gAAACAAAAAAAAAAAnBrAAAAAAPuAAAAQQAAAAEAAAPpAAAD7QAAAAAAAAAD",
        "AAAAAAAAAAAAAAAJbGlzdF9zaWdzAAAAAAAAAAAAAAEAAAPqAAAD7gAAACA=",
        "AAAAAQAAAAAAAAAAAAAACVNpZ25hdHVyZQAAAAAAAAQAAAAAAAAAEmF1dGhlbnRpY2F0b3JfZGF0YQAAAAAADgAAAAAAAAAQY2xpZW50X2RhdGFfanNvbgAAAA4AAAAAAAAAAmlkAAAAAAPuAAAAIAAAAAAAAAAJc2lnbmF0dXJlAAAAAAAD7gAAAEA=",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAJc2lnbmF0dXJlAAAAAAAH0AAAAAlTaWduYXR1cmUAAAAAAAAAAAAADWF1dGhfY29udGV4dHMAAAAAAAPqAAAH0AAAAAdDb250ZXh0AAAAAAEAAAPpAAAD7QAAAAAAAAAD" ]),
      options
    )
  }
  public readonly fromJSON = {
    extend_ttl: this.txFromJSON<null>,
        resudo: this.txFromJSON<Result<void>>,
        rm_sig: this.txFromJSON<Result<void>>,
        add_sig: this.txFromJSON<Result<void>>,
        list_sigs: this.txFromJSON<Array<Buffer>>
  }
}