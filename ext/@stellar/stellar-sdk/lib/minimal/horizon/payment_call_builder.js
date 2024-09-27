"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PaymentCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link PaymentCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#payments}.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/horizon/resources/list-all-payments/|All Payments}
 *
 * @augments CallBuilder
 * @private
 * @class
 *
 * @param {string} serverUrl Horizon server URL.
 */
class PaymentCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl, "payments");
    this.url.segment("payments");
  }

  /**
   * This endpoint responds with a collection of Payment operations where the given account was either the sender or receiver.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/horizon/resources/get-payments-by-account-id|Payments for Account}
   * @param {string} accountId For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {PaymentCallBuilder} this PaymentCallBuilder instance
   */
  forAccount(accountId) {
    return this.forEndpoint("accounts", accountId);
  }

  /**
   * This endpoint represents all payment operations that are part of a valid transactions in a given ledger.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/horizon/resources/retrieve-a-ledgers-payments|Payments for Ledger}
   * @param {number|string} sequence Ledger sequence
   * @returns {PaymentCallBuilder} this PaymentCallBuilder instance
   */
  forLedger(sequence) {
    return this.forEndpoint("ledgers", sequence.toString());
  }

  /**
   * This endpoint represents all payment operations that are part of a given transaction.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/transactions/payments/|Payments for Transaction}
   * @param {string} transactionId Transaction ID
   * @returns {PaymentCallBuilder} this PaymentCallBuilder instance
   */
  forTransaction(transactionId) {
    return this.forEndpoint("transactions", transactionId);
  }
}
exports.PaymentCallBuilder = PaymentCallBuilder;