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
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  }
} as const

export const Errors = {

}

export interface Client {
  /**
   * Construct and simulate a allowance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the allowance for `spender` to transfer from `from`.
   * 
   * The amount returned is the amount that spender is allowed to transfer
   * out of from's balance. When the spender transfers amounts, the allowance
   * will be reduced by the amount transfered.
   * 
   * # Arguments
   * 
   * * `from` - The address holding the balance of tokens to be drawn from.
   * * `spender` - The address spending the tokens held by `from`.
   */
  allowance: ({from, spender}: {from: string, spender: string}, options?: {
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
  }) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a authorized transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns true if `id` is authorized to use its balance.
   * 
   * # Arguments
   * 
   * * `id` - The address for which token authorization is being checked.
   */
  authorized: ({id}: {id: string}, options?: {
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
  }) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a approve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Set the allowance by `amount` for `spender` to transfer/burn from
   * `from`.
   * 
   * The amount set is the amount that spender is approved to transfer out of
   * from's balance. The spender will be allowed to transfer amounts, and
   * when an amount is transferred the allowance will be reduced by the
   * amount transfered.
   * 
   * # Arguments
   * 
   * * `from` - The address holding the balance of tokens to be drawn from.
   * * `spender` - The address being authorized to spend the tokens held by
   * `from`.
   * * `amount` - The tokens to be made available to `spender`.
   * * `expiration_ledger` - The ledger number where this allowance expires. Cannot
   * be less than the current ledger number unless the amount is being set to 0.
   * An expired entry (where expiration_ledger < the current ledger number)
   * should be treated as a 0 amount allowance.
   * 
   * # Events
   * 
   * Emits an event with topics `["approve", from: Address,
   * spender: Address], data = [amount: i128, expiration_ledger: u32]`
   */
  approve: ({from, spender, amount, expiration_ledger}: {from: string, spender: string, amount: i128, expiration_ledger: u32}, options?: {
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
   * Construct and simulate a balance transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the balance of `id`.
   * 
   * # Arguments
   * 
   * * `id` - The address for which a balance is being queried. If the
   * address has no existing balance, returns 0.
   */
  balance: ({id}: {id: string}, options?: {
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
  }) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a burn transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burn `amount` from `from`.
   * 
   * Reduces from's balance by the amount, without transferring the balance
   * to another holder's balance.
   * 
   * # Arguments
   * 
   * * `from` - The address holding the balance of tokens which will be
   * burned from.
   * * `amount` - The amount of tokens to be burned.
   * 
   * # Events
   * 
   * Emits an event with topics `["burn", from: Address], data = [amount:
   * i128]`
   */
  burn: ({from, amount}: {from: string, amount: i128}, options?: {
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
   * Construct and simulate a burn_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Burn `amount` from `from`, consuming the allowance of `spender`.
   * 
   * Reduces from's balance by the amount, without transferring the balance
   * to another holder's balance.
   * 
   * The spender will be allowed to burn the amount from from's balance, if
   * the amount is less than or equal to the allowance that the spender has
   * on the from's balance. The spender's allowance on from's balance will be
   * reduced by the amount.
   * 
   * # Arguments
   * 
   * * `spender` - The address authorizing the burn, and having its allowance
   * consumed during the burn.
   * * `from` - The address holding the balance of tokens which will be
   * burned from.
   * * `amount` - The amount of tokens to be burned.
   * 
   * # Events
   * 
   * Emits an event with topics `["burn", from: Address], data = [amount:
   * i128]`
   */
  burn_from: ({spender, from, amount}: {spender: string, from: string, amount: i128}, options?: {
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
   * Construct and simulate a clawback transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Clawback `amount` from `from` account. `amount` is burned in the
   * clawback process.
   * 
   * # Arguments
   * 
   * * `from` - The address holding the balance from which the clawback will
   * take tokens.
   * * `amount` - The amount of tokens to be clawed back.
   * 
   * # Events
   * 
   * Emits an event with topics `["clawback", admin: Address, to: Address],
   * data = [amount: i128]`
   */
  clawback: ({from, amount}: {from: string, amount: i128}, options?: {
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
   * Construct and simulate a decimals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the number of decimals used to represent amounts of this token.
   * 
   * # Panics
   * 
   * If the contract has not yet been initialized.
   */
  decimals: (options?: {
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
  }) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a mint transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Mints `amount` to `to`.
   * 
   * # Arguments
   * 
   * * `to` - The address which will receive the minted tokens.
   * * `amount` - The amount of tokens to be minted.
   * 
   * # Events
   * 
   * Emits an event with topics `["mint", admin: Address, to: Address], data
   * = [amount: i128]`
   */
  mint: ({to, amount}: {to: string, amount: i128}, options?: {
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
   * Construct and simulate a name transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the name for this token.
   * 
   * # Panics
   * 
   * If the contract has not yet been initialized.
   */
  name: (options?: {
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
  }) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets the administrator to the specified address `new_admin`.
   * 
   * # Arguments
   * 
   * * `new_admin` - The address which will henceforth be the administrator
   * of this token contract.
   * 
   * # Events
   * 
   * Emits an event with topics `["set_admin", admin: Address], data =
   * [new_admin: Address]`
   */
  set_admin: ({new_admin}: {new_admin: string}, options?: {
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
   * Construct and simulate a admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the admin of the contract.
   * 
   * # Panics
   * 
   * If the admin is not set.
   */
  admin: (options?: {
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
  }) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_authorized transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Sets whether the account is authorized to use its balance. If
   * `authorized` is true, `id` should be able to use its balance.
   * 
   * # Arguments
   * 
   * * `id` - The address being (de-)authorized.
   * * `authorize` - Whether or not `id` can use its balance.
   * 
   * # Events
   * 
   * Emits an event with topics `["set_authorized", id: Address], data =
   * [authorize: bool]`
   */
  set_authorized: ({id, authorize}: {id: string, authorize: boolean}, options?: {
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
   * Construct and simulate a symbol transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Returns the symbol for this token.
   * 
   * # Panics
   * 
   * If the contract has not yet been initialized.
   */
  symbol: (options?: {
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
  }) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a transfer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer `amount` from `from` to `to`.
   * 
   * # Arguments
   * 
   * * `from` - The address holding the balance of tokens which will be
   * withdrawn from.
   * * `to` - The address which will receive the transferred tokens.
   * * `amount` - The amount of tokens to be transferred.
   * 
   * # Events
   * 
   * Emits an event with topics `["transfer", from: Address, to: Address],
   * data = [amount: i128]`
   */
  transfer: ({from, to, amount}: {from: string, to: string, amount: i128}, options?: {
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
   * Construct and simulate a transfer_from transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Transfer `amount` from `from` to `to`, consuming the allowance that
   * `spender` has on `from`'s balance. Authorized by spender
   * (`spender.require_auth()`).
   * 
   * The spender will be allowed to transfer the amount from from's balance
   * if the amount is less than or equal to the allowance that the spender
   * has on the from's balance. The spender's allowance on from's balance
   * will be reduced by the amount.
   * 
   * # Arguments
   * 
   * * `spender` - The address authorizing the transfer, and having its
   * allowance consumed during the transfer.
   * * `from` - The address holding the balance of tokens which will be
   * withdrawn from.
   * * `to` - The address which will receive the transferred tokens.
   * * `amount` - The amount of tokens to be transferred.
   * 
   * # Events
   * 
   * Emits an event with topics `["transfer", from: Address, to: Address],
   * data = [amount: i128]`
   */
  transfer_from: ({spender, from, to, amount}: {spender: string, from: string, to: string, amount: i128}, options?: {
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
      new ContractSpec([ "AAAAAAAAAYlSZXR1cm5zIHRoZSBhbGxvd2FuY2UgZm9yIGBzcGVuZGVyYCB0byB0cmFuc2ZlciBmcm9tIGBmcm9tYC4KClRoZSBhbW91bnQgcmV0dXJuZWQgaXMgdGhlIGFtb3VudCB0aGF0IHNwZW5kZXIgaXMgYWxsb3dlZCB0byB0cmFuc2ZlcgpvdXQgb2YgZnJvbSdzIGJhbGFuY2UuIFdoZW4gdGhlIHNwZW5kZXIgdHJhbnNmZXJzIGFtb3VudHMsIHRoZSBhbGxvd2FuY2UKd2lsbCBiZSByZWR1Y2VkIGJ5IHRoZSBhbW91bnQgdHJhbnNmZXJlZC4KCiMgQXJndW1lbnRzCgoqIGBmcm9tYCAtIFRoZSBhZGRyZXNzIGhvbGRpbmcgdGhlIGJhbGFuY2Ugb2YgdG9rZW5zIHRvIGJlIGRyYXduIGZyb20uCiogYHNwZW5kZXJgIC0gVGhlIGFkZHJlc3Mgc3BlbmRpbmcgdGhlIHRva2VucyBoZWxkIGJ5IGBmcm9tYC4AAAAAAAAJYWxsb3dhbmNlAAAAAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAEAAAAL",
        "AAAAAAAAAIlSZXR1cm5zIHRydWUgaWYgYGlkYCBpcyBhdXRob3JpemVkIHRvIHVzZSBpdHMgYmFsYW5jZS4KCiMgQXJndW1lbnRzCgoqIGBpZGAgLSBUaGUgYWRkcmVzcyBmb3Igd2hpY2ggdG9rZW4gYXV0aG9yaXphdGlvbiBpcyBiZWluZyBjaGVja2VkLgAAAAAAAAphdXRob3JpemVkAAAAAAABAAAAAAAAAAJpZAAAAAAAEwAAAAEAAAAB",
        "AAAAAAAAA55TZXQgdGhlIGFsbG93YW5jZSBieSBgYW1vdW50YCBmb3IgYHNwZW5kZXJgIHRvIHRyYW5zZmVyL2J1cm4gZnJvbQpgZnJvbWAuCgpUaGUgYW1vdW50IHNldCBpcyB0aGUgYW1vdW50IHRoYXQgc3BlbmRlciBpcyBhcHByb3ZlZCB0byB0cmFuc2ZlciBvdXQgb2YKZnJvbSdzIGJhbGFuY2UuIFRoZSBzcGVuZGVyIHdpbGwgYmUgYWxsb3dlZCB0byB0cmFuc2ZlciBhbW91bnRzLCBhbmQKd2hlbiBhbiBhbW91bnQgaXMgdHJhbnNmZXJyZWQgdGhlIGFsbG93YW5jZSB3aWxsIGJlIHJlZHVjZWQgYnkgdGhlCmFtb3VudCB0cmFuc2ZlcmVkLgoKIyBBcmd1bWVudHMKCiogYGZyb21gIC0gVGhlIGFkZHJlc3MgaG9sZGluZyB0aGUgYmFsYW5jZSBvZiB0b2tlbnMgdG8gYmUgZHJhd24gZnJvbS4KKiBgc3BlbmRlcmAgLSBUaGUgYWRkcmVzcyBiZWluZyBhdXRob3JpemVkIHRvIHNwZW5kIHRoZSB0b2tlbnMgaGVsZCBieQpgZnJvbWAuCiogYGFtb3VudGAgLSBUaGUgdG9rZW5zIHRvIGJlIG1hZGUgYXZhaWxhYmxlIHRvIGBzcGVuZGVyYC4KKiBgZXhwaXJhdGlvbl9sZWRnZXJgIC0gVGhlIGxlZGdlciBudW1iZXIgd2hlcmUgdGhpcyBhbGxvd2FuY2UgZXhwaXJlcy4gQ2Fubm90CmJlIGxlc3MgdGhhbiB0aGUgY3VycmVudCBsZWRnZXIgbnVtYmVyIHVubGVzcyB0aGUgYW1vdW50IGlzIGJlaW5nIHNldCB0byAwLgpBbiBleHBpcmVkIGVudHJ5ICh3aGVyZSBleHBpcmF0aW9uX2xlZGdlciA8IHRoZSBjdXJyZW50IGxlZGdlciBudW1iZXIpCnNob3VsZCBiZSB0cmVhdGVkIGFzIGEgMCBhbW91bnQgYWxsb3dhbmNlLgoKIyBFdmVudHMKCkVtaXRzIGFuIGV2ZW50IHdpdGggdG9waWNzIGBbImFwcHJvdmUiLCBmcm9tOiBBZGRyZXNzLApzcGVuZGVyOiBBZGRyZXNzXSwgZGF0YSA9IFthbW91bnQ6IGkxMjgsIGV4cGlyYXRpb25fbGVkZ2VyOiB1MzJdYAAAAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAEZnJvbQAAABMAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAABFleHBpcmF0aW9uX2xlZGdlcgAAAAAAAAQAAAAA",
        "AAAAAAAAAJhSZXR1cm5zIHRoZSBiYWxhbmNlIG9mIGBpZGAuCgojIEFyZ3VtZW50cwoKKiBgaWRgIC0gVGhlIGFkZHJlc3MgZm9yIHdoaWNoIGEgYmFsYW5jZSBpcyBiZWluZyBxdWVyaWVkLiBJZiB0aGUKYWRkcmVzcyBoYXMgbm8gZXhpc3RpbmcgYmFsYW5jZSwgcmV0dXJucyAwLgAAAAdiYWxhbmNlAAAAAAEAAAAAAAAAAmlkAAAAAAATAAAAAQAAAAs=",
        "AAAAAAAAAWRCdXJuIGBhbW91bnRgIGZyb20gYGZyb21gLgoKUmVkdWNlcyBmcm9tJ3MgYmFsYW5jZSBieSB0aGUgYW1vdW50LCB3aXRob3V0IHRyYW5zZmVycmluZyB0aGUgYmFsYW5jZQp0byBhbm90aGVyIGhvbGRlcidzIGJhbGFuY2UuCgojIEFyZ3VtZW50cwoKKiBgZnJvbWAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSBiYWxhbmNlIG9mIHRva2VucyB3aGljaCB3aWxsIGJlCmJ1cm5lZCBmcm9tLgoqIGBhbW91bnRgIC0gVGhlIGFtb3VudCBvZiB0b2tlbnMgdG8gYmUgYnVybmVkLgoKIyBFdmVudHMKCkVtaXRzIGFuIGV2ZW50IHdpdGggdG9waWNzIGBbImJ1cm4iLCBmcm9tOiBBZGRyZXNzXSwgZGF0YSA9IFthbW91bnQ6CmkxMjhdYAAAAARidXJuAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAtxCdXJuIGBhbW91bnRgIGZyb20gYGZyb21gLCBjb25zdW1pbmcgdGhlIGFsbG93YW5jZSBvZiBgc3BlbmRlcmAuCgpSZWR1Y2VzIGZyb20ncyBiYWxhbmNlIGJ5IHRoZSBhbW91bnQsIHdpdGhvdXQgdHJhbnNmZXJyaW5nIHRoZSBiYWxhbmNlCnRvIGFub3RoZXIgaG9sZGVyJ3MgYmFsYW5jZS4KClRoZSBzcGVuZGVyIHdpbGwgYmUgYWxsb3dlZCB0byBidXJuIHRoZSBhbW91bnQgZnJvbSBmcm9tJ3MgYmFsYW5jZSwgaWYKdGhlIGFtb3VudCBpcyBsZXNzIHRoYW4gb3IgZXF1YWwgdG8gdGhlIGFsbG93YW5jZSB0aGF0IHRoZSBzcGVuZGVyIGhhcwpvbiB0aGUgZnJvbSdzIGJhbGFuY2UuIFRoZSBzcGVuZGVyJ3MgYWxsb3dhbmNlIG9uIGZyb20ncyBiYWxhbmNlIHdpbGwgYmUKcmVkdWNlZCBieSB0aGUgYW1vdW50LgoKIyBBcmd1bWVudHMKCiogYHNwZW5kZXJgIC0gVGhlIGFkZHJlc3MgYXV0aG9yaXppbmcgdGhlIGJ1cm4sIGFuZCBoYXZpbmcgaXRzIGFsbG93YW5jZQpjb25zdW1lZCBkdXJpbmcgdGhlIGJ1cm4uCiogYGZyb21gIC0gVGhlIGFkZHJlc3MgaG9sZGluZyB0aGUgYmFsYW5jZSBvZiB0b2tlbnMgd2hpY2ggd2lsbCBiZQpidXJuZWQgZnJvbS4KKiBgYW1vdW50YCAtIFRoZSBhbW91bnQgb2YgdG9rZW5zIHRvIGJlIGJ1cm5lZC4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJidXJuIiwgZnJvbTogQWRkcmVzc10sIGRhdGEgPSBbYW1vdW50OgppMTI4XWAAAAAJYnVybl9mcm9tAAAAAAAAAwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAVNDbGF3YmFjayBgYW1vdW50YCBmcm9tIGBmcm9tYCBhY2NvdW50LiBgYW1vdW50YCBpcyBidXJuZWQgaW4gdGhlCmNsYXdiYWNrIHByb2Nlc3MuCgojIEFyZ3VtZW50cwoKKiBgZnJvbWAgLSBUaGUgYWRkcmVzcyBob2xkaW5nIHRoZSBiYWxhbmNlIGZyb20gd2hpY2ggdGhlIGNsYXdiYWNrIHdpbGwKdGFrZSB0b2tlbnMuCiogYGFtb3VudGAgLSBUaGUgYW1vdW50IG9mIHRva2VucyB0byBiZSBjbGF3ZWQgYmFjay4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJjbGF3YmFjayIsIGFkbWluOiBBZGRyZXNzLCB0bzogQWRkcmVzc10sCmRhdGEgPSBbYW1vdW50OiBpMTI4XWAAAAAACGNsYXdiYWNrAAAAAgAAAAAAAAAEZnJvbQAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAIBSZXR1cm5zIHRoZSBudW1iZXIgb2YgZGVjaW1hbHMgdXNlZCB0byByZXByZXNlbnQgYW1vdW50cyBvZiB0aGlzIHRva2VuLgoKIyBQYW5pY3MKCklmIHRoZSBjb250cmFjdCBoYXMgbm90IHlldCBiZWVuIGluaXRpYWxpemVkLgAAAAhkZWNpbWFscwAAAAAAAAABAAAABA==",
        "AAAAAAAAAPVNaW50cyBgYW1vdW50YCB0byBgdG9gLgoKIyBBcmd1bWVudHMKCiogYHRvYCAtIFRoZSBhZGRyZXNzIHdoaWNoIHdpbGwgcmVjZWl2ZSB0aGUgbWludGVkIHRva2Vucy4KKiBgYW1vdW50YCAtIFRoZSBhbW91bnQgb2YgdG9rZW5zIHRvIGJlIG1pbnRlZC4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJtaW50IiwgYWRtaW46IEFkZHJlc3MsIHRvOiBBZGRyZXNzXSwgZGF0YQo9IFthbW91bnQ6IGkxMjhdYAAAAAAAAARtaW50AAAAAgAAAAAAAAACdG8AAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAA=",
        "AAAAAAAAAFlSZXR1cm5zIHRoZSBuYW1lIGZvciB0aGlzIHRva2VuLgoKIyBQYW5pY3MKCklmIHRoZSBjb250cmFjdCBoYXMgbm90IHlldCBiZWVuIGluaXRpYWxpemVkLgAAAAAAAARuYW1lAAAAAAAAAAEAAAAQ",
        "AAAAAAAAAQxTZXRzIHRoZSBhZG1pbmlzdHJhdG9yIHRvIHRoZSBzcGVjaWZpZWQgYWRkcmVzcyBgbmV3X2FkbWluYC4KCiMgQXJndW1lbnRzCgoqIGBuZXdfYWRtaW5gIC0gVGhlIGFkZHJlc3Mgd2hpY2ggd2lsbCBoZW5jZWZvcnRoIGJlIHRoZSBhZG1pbmlzdHJhdG9yCm9mIHRoaXMgdG9rZW4gY29udHJhY3QuCgojIEV2ZW50cwoKRW1pdHMgYW4gZXZlbnQgd2l0aCB0b3BpY3MgYFsic2V0X2FkbWluIiwgYWRtaW46IEFkZHJlc3NdLCBkYXRhID0KW25ld19hZG1pbjogQWRkcmVzc11gAAAACXNldF9hZG1pbgAAAAAAAAEAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAAA",
        "AAAAAAAAAEZSZXR1cm5zIHRoZSBhZG1pbiBvZiB0aGUgY29udHJhY3QuCgojIFBhbmljcwoKSWYgdGhlIGFkbWluIGlzIG5vdCBzZXQuAAAAAAAFYWRtaW4AAAAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAVBTZXRzIHdoZXRoZXIgdGhlIGFjY291bnQgaXMgYXV0aG9yaXplZCB0byB1c2UgaXRzIGJhbGFuY2UuIElmCmBhdXRob3JpemVkYCBpcyB0cnVlLCBgaWRgIHNob3VsZCBiZSBhYmxlIHRvIHVzZSBpdHMgYmFsYW5jZS4KCiMgQXJndW1lbnRzCgoqIGBpZGAgLSBUaGUgYWRkcmVzcyBiZWluZyAoZGUtKWF1dGhvcml6ZWQuCiogYGF1dGhvcml6ZWAgLSBXaGV0aGVyIG9yIG5vdCBgaWRgIGNhbiB1c2UgaXRzIGJhbGFuY2UuCgojIEV2ZW50cwoKRW1pdHMgYW4gZXZlbnQgd2l0aCB0b3BpY3MgYFsic2V0X2F1dGhvcml6ZWQiLCBpZDogQWRkcmVzc10sIGRhdGEgPQpbYXV0aG9yaXplOiBib29sXWAAAAAOc2V0X2F1dGhvcml6ZWQAAAAAAAIAAAAAAAAAAmlkAAAAAAATAAAAAAAAAAlhdXRob3JpemUAAAAAAAABAAAAAA==",
        "AAAAAAAAAFtSZXR1cm5zIHRoZSBzeW1ib2wgZm9yIHRoaXMgdG9rZW4uCgojIFBhbmljcwoKSWYgdGhlIGNvbnRyYWN0IGhhcyBub3QgeWV0IGJlZW4gaW5pdGlhbGl6ZWQuAAAAAAZzeW1ib2wAAAAAAAAAAAABAAAAEA==",
        "AAAAAAAAAWRUcmFuc2ZlciBgYW1vdW50YCBmcm9tIGBmcm9tYCB0byBgdG9gLgoKIyBBcmd1bWVudHMKCiogYGZyb21gIC0gVGhlIGFkZHJlc3MgaG9sZGluZyB0aGUgYmFsYW5jZSBvZiB0b2tlbnMgd2hpY2ggd2lsbCBiZQp3aXRoZHJhd24gZnJvbS4KKiBgdG9gIC0gVGhlIGFkZHJlc3Mgd2hpY2ggd2lsbCByZWNlaXZlIHRoZSB0cmFuc2ZlcnJlZCB0b2tlbnMuCiogYGFtb3VudGAgLSBUaGUgYW1vdW50IG9mIHRva2VucyB0byBiZSB0cmFuc2ZlcnJlZC4KCiMgRXZlbnRzCgpFbWl0cyBhbiBldmVudCB3aXRoIHRvcGljcyBgWyJ0cmFuc2ZlciIsIGZyb206IEFkZHJlc3MsIHRvOiBBZGRyZXNzXSwKZGF0YSA9IFthbW91bnQ6IGkxMjhdYAAAAAh0cmFuc2ZlcgAAAAMAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==",
        "AAAAAAAAAzNUcmFuc2ZlciBgYW1vdW50YCBmcm9tIGBmcm9tYCB0byBgdG9gLCBjb25zdW1pbmcgdGhlIGFsbG93YW5jZSB0aGF0CmBzcGVuZGVyYCBoYXMgb24gYGZyb21gJ3MgYmFsYW5jZS4gQXV0aG9yaXplZCBieSBzcGVuZGVyCihgc3BlbmRlci5yZXF1aXJlX2F1dGgoKWApLgoKVGhlIHNwZW5kZXIgd2lsbCBiZSBhbGxvd2VkIHRvIHRyYW5zZmVyIHRoZSBhbW91bnQgZnJvbSBmcm9tJ3MgYmFsYW5jZQppZiB0aGUgYW1vdW50IGlzIGxlc3MgdGhhbiBvciBlcXVhbCB0byB0aGUgYWxsb3dhbmNlIHRoYXQgdGhlIHNwZW5kZXIKaGFzIG9uIHRoZSBmcm9tJ3MgYmFsYW5jZS4gVGhlIHNwZW5kZXIncyBhbGxvd2FuY2Ugb24gZnJvbSdzIGJhbGFuY2UKd2lsbCBiZSByZWR1Y2VkIGJ5IHRoZSBhbW91bnQuCgojIEFyZ3VtZW50cwoKKiBgc3BlbmRlcmAgLSBUaGUgYWRkcmVzcyBhdXRob3JpemluZyB0aGUgdHJhbnNmZXIsIGFuZCBoYXZpbmcgaXRzCmFsbG93YW5jZSBjb25zdW1lZCBkdXJpbmcgdGhlIHRyYW5zZmVyLgoqIGBmcm9tYCAtIFRoZSBhZGRyZXNzIGhvbGRpbmcgdGhlIGJhbGFuY2Ugb2YgdG9rZW5zIHdoaWNoIHdpbGwgYmUKd2l0aGRyYXduIGZyb20uCiogYHRvYCAtIFRoZSBhZGRyZXNzIHdoaWNoIHdpbGwgcmVjZWl2ZSB0aGUgdHJhbnNmZXJyZWQgdG9rZW5zLgoqIGBhbW91bnRgIC0gVGhlIGFtb3VudCBvZiB0b2tlbnMgdG8gYmUgdHJhbnNmZXJyZWQuCgojIEV2ZW50cwoKRW1pdHMgYW4gZXZlbnQgd2l0aCB0b3BpY3MgYFsidHJhbnNmZXIiLCBmcm9tOiBBZGRyZXNzLCB0bzogQWRkcmVzc10sCmRhdGEgPSBbYW1vdW50OiBpMTI4XWAAAAAADXRyYW5zZmVyX2Zyb20AAAAAAAAEAAAAAAAAAAdzcGVuZGVyAAAAABMAAAAAAAAABGZyb20AAAATAAAAAAAAAAJ0bwAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAA==" ]),
      options
    )
  }
  public readonly fromJSON = {
    allowance: this.txFromJSON<i128>,
        authorized: this.txFromJSON<boolean>,
        approve: this.txFromJSON<null>,
        balance: this.txFromJSON<i128>,
        burn: this.txFromJSON<null>,
        burn_from: this.txFromJSON<null>,
        clawback: this.txFromJSON<null>,
        decimals: this.txFromJSON<u32>,
        mint: this.txFromJSON<null>,
        name: this.txFromJSON<string>,
        set_admin: this.txFromJSON<null>,
        admin: this.txFromJSON<string>,
        set_authorized: this.txFromJSON<null>,
        symbol: this.txFromJSON<string>,
        transfer: this.txFromJSON<null>,
        transfer_from: this.txFromJSON<null>
  }
}