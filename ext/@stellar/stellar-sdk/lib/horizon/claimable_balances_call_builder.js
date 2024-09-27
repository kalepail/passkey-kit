"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ClaimableBalanceCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link ClaimableBalanceCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#claimableBalances}.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/claimablebalances|Claimable Balances}
 *
 * @augments CallBuilder
 * @private
 * @class
 * @param {string} serverUrl Horizon server URL.
 */
class ClaimableBalanceCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl);
    this.url.segment("claimable_balances");
  }

  /**
   * The claimable balance details endpoint provides information on a single claimable balance.
   *
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/retrieve-a-claimable-balance|Claimable Balance Details}
   * @param {string} claimableBalanceId Claimable balance ID
   * @returns {CallBuilder<ServerApi.ClaimableBalanceRecord>} CallBuilder<ServerApi.ClaimableBalanceRecord> OperationCallBuilder instance
   */
  claimableBalance(claimableBalanceId) {
    const builder = new _call_builder.CallBuilder(this.url.clone());
    builder.filter.push([claimableBalanceId]);
    return builder;
  }

  /**
   * Returns all claimable balances which are sponsored by the given account ID.
   *
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-claimable-balances|Claimable Balances}
   * @param {string} sponsor For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {ClaimableBalanceCallBuilder} current ClaimableBalanceCallBuilder instance
   */
  sponsor(sponsor) {
    this.url.setQuery("sponsor", sponsor);
    return this;
  }

  /**
   * Returns all claimable balances which can be claimed by the given account ID.
   *
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-claimable-balances|Claimable Balances}
   * @param {string} claimant For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {ClaimableBalanceCallBuilder} current ClaimableBalanceCallBuilder instance
   */
  claimant(claimant) {
    this.url.setQuery("claimant", claimant);
    return this;
  }

  /**
   * Returns all claimable balances which provide a balance for the given asset.
   *
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-claimable-balances|Claimable Balances}
   * @param {Asset} asset The Asset held by the claimable balance
   * @returns {ClaimableBalanceCallBuilder} current ClaimableBalanceCallBuilder instance
   */
  asset(asset) {
    this.url.setQuery("asset", asset.toString());
    return this;
  }
}
exports.ClaimableBalanceCallBuilder = ClaimableBalanceCallBuilder;