"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TransactionCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link TransactionCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#transactions}.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-transactions|All Transactions}
 *
 * @augments CallBuilder
 * @private
 * @class
 *
 * @param {string} serverUrl Horizon server URL.
 */
class TransactionCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl, "transactions");
    this.url.segment("transactions");
  }

  /**
   * The transaction details endpoint provides information on a single transaction. The transaction hash provided in the hash argument specifies which transaction to load.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/retrieve-a-transaction|Transaction Details}
   * @param {string} transactionId Transaction ID
   * @returns {CallBuilder} a CallBuilder instance
   */
  transaction(transactionId) {
    const builder = new _call_builder.CallBuilder(this.url.clone());
    builder.filter.push([transactionId]);
    return builder;
  }

  /**
   * This endpoint represents all transactions that affected a given account.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/get-transactions-by-account-id|Transactions for Account}
   * @param {string} accountId For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {TransactionCallBuilder} current TransactionCallBuilder instance
   */
  forAccount(accountId) {
    return this.forEndpoint("accounts", accountId);
  }

  /**
   * This endpoint represents all transactions that reference a given claimable_balance.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/cb-retrieve-related-transactions|Transactions for Claimable Balance}
   * @param {string} claimableBalanceId Claimable Balance ID
   * @returns {TransactionCallBuilder} this TransactionCallBuilder instance
   */
  forClaimableBalance(claimableBalanceId) {
    return this.forEndpoint("claimable_balances", claimableBalanceId);
  }

  /**
   * This endpoint represents all transactions in a given ledger.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/retrieve-a-ledgers-transactions|Transactions for Ledger}
   * @param {number|string} sequence Ledger sequence
   * @returns {TransactionCallBuilder} current TransactionCallBuilder instance
   */
  forLedger(sequence) {
    return this.forEndpoint("ledgers", sequence.toString());
  }

  /**
   * This endpoint represents all transactions involving a particular liquidity pool.
   *
   * @param {string} poolId   liquidity pool ID
   * @returns {TransactionCallBuilder} this TransactionCallBuilder instance
   */
  forLiquidityPool(poolId) {
    return this.forEndpoint("liquidity_pools", poolId);
  }

  /**
   * Adds a parameter defining whether to include failed transactions. By default only successful transactions are
   * returned.
   * @param {boolean} value Set to `true` to include failed transactions.
   * @returns {TransactionCallBuilder} current TransactionCallBuilder instance
   */
  includeFailed(value) {
    this.url.setQuery("include_failed", value.toString());
    return this;
  }
}
exports.TransactionCallBuilder = TransactionCallBuilder;