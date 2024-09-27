"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LiquidityPoolCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link LiquidityPoolCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#liquidityPools}.
 *
 * @augments CallBuilder
 * @private
 * @class
 * @param {string} serverUrl Horizon server URL.
 */
class LiquidityPoolCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl);
    this.url.segment("liquidity_pools");
  }

  /**
   * Filters out pools whose reserves don't exactly match these assets.
   *
   * @see Asset
   * @returns {LiquidityPoolCallBuilder} current LiquidityPoolCallBuilder instance
   */
  forAssets(...assets) {
    const assetList = assets.map(asset => asset.toString()).join(",");
    this.url.setQuery("reserves", assetList);
    return this;
  }

  /**
   * Retrieves all pools an account is participating in.
   *
   * @param {string} id   the participant account to filter by
   * @returns {LiquidityPoolCallBuilder} current LiquidityPoolCallBuilder instance
   */
  forAccount(id) {
    this.url.setQuery("account", id);
    return this;
  }

  /**
   * Retrieves a specific liquidity pool by ID.
   *
   * @param {string} id   the hash/ID of the liquidity pool
   * @returns {CallBuilder} a new CallBuilder instance for the /liquidity_pools/:id endpoint
   */
  liquidityPoolId(id) {
    if (!id.match(/[a-fA-F0-9]{64}/)) {
      throw new TypeError(`${id} does not look like a liquidity pool ID`);
    }
    const builder = new _call_builder.CallBuilder(this.url.clone());
    builder.filter.push([id.toLowerCase()]);
    return builder;
  }
}
exports.LiquidityPoolCallBuilder = LiquidityPoolCallBuilder;