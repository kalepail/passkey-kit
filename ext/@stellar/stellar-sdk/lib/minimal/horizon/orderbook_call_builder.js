"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.OrderbookCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link OrderbookCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#orderbook}.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/aggregations/order-books|Orderbook Details}
 *
 * @augments CallBuilder
 * @private
 * @class
 * @param {string} serverUrl serverUrl Horizon server URL.
 * @param {Asset} selling Asset being sold
 * @param {Asset} buying Asset being bought
 */
class OrderbookCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl, selling, buying) {
    super(serverUrl);
    this.url.segment("order_book");
    if (!selling.isNative()) {
      this.url.setQuery("selling_asset_type", selling.getAssetType());
      this.url.setQuery("selling_asset_code", selling.getCode());
      this.url.setQuery("selling_asset_issuer", selling.getIssuer());
    } else {
      this.url.setQuery("selling_asset_type", "native");
    }
    if (!buying.isNative()) {
      this.url.setQuery("buying_asset_type", buying.getAssetType());
      this.url.setQuery("buying_asset_code", buying.getCode());
      this.url.setQuery("buying_asset_issuer", buying.getIssuer());
    } else {
      this.url.setQuery("buying_asset_type", "native");
    }
  }
}
exports.OrderbookCallBuilder = OrderbookCallBuilder;