"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AccountResponse = void 0;
var _stellarBase = require("@stellar/stellar-base");
/* tslint:disable:variable-name */

/**
 * Do not create this object directly, use {@link module:Horizon.Server#loadAccount | Horizon.Server#loadAccount}.
 *
 * Returns information and links relating to a single account.
 * The balances section in the returned JSON will also list all the trust lines this account has set up.
 * It also contains {@link BaseAccount} object and exposes it's methods so can be used in {@link TransactionBuilder}.
 *
 * @memberof module:Horizon
 * @private
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/accounts/object|Account Details}
 * @param {string} response Response from horizon account endpoint.
 * @returns {AccountResponse} AccountResponse instance
 */
class AccountResponse {
  constructor(response) {
    this._baseAccount = new _stellarBase.Account(response.account_id, response.sequence);
    // Extract response fields
    // TODO: do it in type-safe manner.
    Object.entries(response).forEach(([key, value]) => {
      this[key] = value;
    });
  }

  /**
   * Get Stellar account public key ex. `GB3KJPLFUYN5VL6R3GU3EGCGVCKFDSD7BEDX42HWG5BWFKB3KQGJJRMA`
   * @returns {string} accountId
   */
  accountId() {
    return this._baseAccount.accountId();
  }

  /**
   * Get the current sequence number
   * @returns {string} sequenceNumber
   */
  sequenceNumber() {
    return this._baseAccount.sequenceNumber();
  }

  /**
   * Increments sequence number in this object by one.
   * @returns {void}
   */
  incrementSequenceNumber() {
    this._baseAccount.incrementSequenceNumber();
    this.sequence = this._baseAccount.sequenceNumber();
  }
}
exports.AccountResponse = AccountResponse;