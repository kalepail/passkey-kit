"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AssetsCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link AssetsCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#assets}.
 *
 * @class
 * @augments CallBuilder
 * @private
 * @param {string} serverUrl Horizon server URL.
 */
class AssetsCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl);
    this.url.segment("assets");
  }

  /**
   * This endpoint filters all assets by the asset code.
   * @param {string} value For example: `USD`
   * @returns {AssetsCallBuilder} current AssetCallBuilder instance
   */
  forCode(value) {
    this.url.setQuery("asset_code", value);
    return this;
  }

  /**
   * This endpoint filters all assets by the asset issuer.
   * @param {string} value For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {AssetsCallBuilder} current AssetCallBuilder instance
   */
  forIssuer(value) {
    this.url.setQuery("asset_issuer", value);
    return this;
  }
}
exports.AssetsCallBuilder = AssetsCallBuilder;