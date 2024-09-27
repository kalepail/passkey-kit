"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.TradesCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link TradesCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#trades}.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/trades|Trades}
 *
 * @augments CallBuilder
 * @private
 * @class
 *
 * @param {string} serverUrl serverUrl Horizon server URL.
 */
class TradesCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl, "trades");
    this.url.segment("trades");
  }

  /**
   * Filter trades for a specific asset pair (orderbook)
   * @param {Asset} base asset
   * @param {Asset} counter asset
   * @returns {TradesCallBuilder} current TradesCallBuilder instance
   */
  forAssetPair(base, counter) {
    if (!base.isNative()) {
      this.url.setQuery("base_asset_type", base.getAssetType());
      this.url.setQuery("base_asset_code", base.getCode());
      this.url.setQuery("base_asset_issuer", base.getIssuer());
    } else {
      this.url.setQuery("base_asset_type", "native");
    }
    if (!counter.isNative()) {
      this.url.setQuery("counter_asset_type", counter.getAssetType());
      this.url.setQuery("counter_asset_code", counter.getCode());
      this.url.setQuery("counter_asset_issuer", counter.getIssuer());
    } else {
      this.url.setQuery("counter_asset_type", "native");
    }
    return this;
  }

  /**
   * Filter trades for a specific offer
   * @param {string} offerId ID of the offer
   * @returns {TradesCallBuilder} current TradesCallBuilder instance
   */
  forOffer(offerId) {
    this.url.setQuery("offer_id", offerId);
    return this;
  }

  /**
   * Filter trades by a specific type.
   * @param {ServerApi.TradeType} tradeType the trade type to filter by.
   * @returns {TradesCallBuilder} current TradesCallBuilder instance.
   */
  forType(tradeType) {
    this.url.setQuery("trade_type", tradeType);
    return this;
  }

  /**
   * Filter trades for a specific account
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/get-trades-by-account-id|Trades for Account}
   * @param {string} accountId For example: `GBYTR4MC5JAX4ALGUBJD7EIKZVM7CUGWKXIUJMRSMK573XH2O7VAK3SR`
   * @returns {TradesCallBuilder} current TradesCallBuilder instance
   */
  forAccount(accountId) {
    return this.forEndpoint("accounts", accountId);
  }

  /**
   * Filter trades for a specific liquidity pool
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/retrieve-related-trades|Trades for Liquidity Pool}
   * @param {string} liquidityPoolId For example: `3b476aff8a406a6ec3b61d5c038009cef85f2ddfaf616822dc4fec92845149b4`
   * @returns {TradesCallBuilder} current TradesCallBuilder instance
   */
  forLiquidityPool(liquidityPoolId) {
    return this.forEndpoint("liquidity_pools", liquidityPoolId);
  }
}
exports.TradesCallBuilder = TradesCallBuilder;