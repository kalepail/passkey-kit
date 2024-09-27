"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AccountCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link AccountCallBuilder} pointed to server defined by `serverUrl`.
 *
 * Do not create this object directly, use {@link Horizon.Server#accounts}.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-accounts|All Accounts}
 *
 * @augments CallBuilder
 * @private
 * @class
 * @param {string} serverUrl Horizon server URL.
 */
class AccountCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl);
    this.url.segment("accounts");
  }

  /**
   * Returns information and links relating to a single account.
   * The balances section in the returned JSON will also list all the trust lines this account has set up.
   *
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/retrieve-an-account|Account Details}
   * @param {string} id For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {CallBuilder} a new CallBuilder instance for the /accounts/:id endpoint
   */
  accountId(id) {
    const builder = new _call_builder.CallBuilder(this.url.clone());
    builder.filter.push([id]);
    return builder;
  }

  /**
   * This endpoint filters accounts by signer account.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-accounts|Accounts}
   * @param {string} id For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {AccountCallBuilder} current AccountCallBuilder instance
   */
  forSigner(id) {
    this.url.setQuery("signer", id);
    return this;
  }

  /**
   * This endpoint filters all accounts who are trustees to an asset.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-accounts|Accounts}
   * @see Asset
   * @param {Asset} asset For example: `new Asset('USD','GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD')`
   * @returns {AccountCallBuilder} current AccountCallBuilder instance
   */
  forAsset(asset) {
    this.url.setQuery("asset", `${asset}`);
    return this;
  }

  /**
   * This endpoint filters accounts where the given account is sponsoring the account or any of its sub-entries..
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-accounts|Accounts}
   * @param {string} id For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {AccountCallBuilder} current AccountCallBuilder instance
   */
  sponsor(id) {
    this.url.setQuery("sponsor", id);
    return this;
  }

  /**
   * This endpoint filters accounts holding a trustline to the given liquidity pool.
   *
   * @param {string} id The ID of the liquidity pool. For example: `dd7b1ab831c273310ddbec6f97870aa83c2fbd78ce22aded37ecbf4f3380fac7`.
   * @returns {AccountCallBuilder} current AccountCallBuilder instance
   */
  forLiquidityPool(id) {
    this.url.setQuery("liquidity_pool", id);
    return this;
  }
}
exports.AccountCallBuilder = AccountCallBuilder;