"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.OfferCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link OfferCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#offers}.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/offers/|Offers}
 *
 * @augments CallBuilder
 * @private
 * @class
 * @param {string} serverUrl Horizon server URL.
 */
class OfferCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl, "offers");
    this.url.segment("offers");
  }

  /**
   * The offer details endpoint provides information on a single offer. The offer ID provided in the id
   * argument specifies which offer to load.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/offers/single/|Offer Details}
   * @param {string} offerId Offer ID
   * @returns {CallBuilder<ServerApi.OfferRecord>} CallBuilder<ServerApi.OfferRecord> OperationCallBuilder instance
   */
  offer(offerId) {
    const builder = new _call_builder.CallBuilder(this.url.clone());
    builder.filter.push([offerId]);
    return builder;
  }

  /**
   * Returns all offers where the given account is involved.
   *
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/accounts/offers/|Offers}
   * @param {string} id For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {OfferCallBuilder} current OfferCallBuilder instance
   */
  forAccount(id) {
    return this.forEndpoint("accounts", id);
  }

  /**
   * Returns all offers buying an asset.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/offers/list/|Offers}
   * @see Asset
   * @param {Asset} asset For example: `new Asset('USD','GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD')`
   * @returns {OfferCallBuilder} current OfferCallBuilder instance
   */
  buying(asset) {
    if (!asset.isNative()) {
      this.url.setQuery("buying_asset_type", asset.getAssetType());
      this.url.setQuery("buying_asset_code", asset.getCode());
      this.url.setQuery("buying_asset_issuer", asset.getIssuer());
    } else {
      this.url.setQuery("buying_asset_type", "native");
    }
    return this;
  }

  /**
   * Returns all offers selling an asset.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/offers/list/|Offers}
   * @see Asset
   * @param {Asset} asset For example: `new Asset('EUR','GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD')`
   * @returns {OfferCallBuilder} current OfferCallBuilder instance
   */
  selling(asset) {
    if (!asset.isNative()) {
      this.url.setQuery("selling_asset_type", asset.getAssetType());
      this.url.setQuery("selling_asset_code", asset.getCode());
      this.url.setQuery("selling_asset_issuer", asset.getIssuer());
    } else {
      this.url.setQuery("selling_asset_type", "native");
    }
    return this;
  }

  /**
   * This endpoint filters offers where the given account is sponsoring the offer entry.
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/get-all-offers|Offers}
   * @param {string} id For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {OfferCallBuilder} current OfferCallBuilder instance
   */
  sponsor(id) {
    this.url.setQuery("sponsor", id);
    return this;
  }

  /**
   * This endpoint filters offers where the given account is the seller.
   *
   * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/get-all-offers|Offers}
   * @param {string} seller For example: `GDGQVOKHW4VEJRU2TETD6DBRKEO5ERCNF353LW5WBFW3JJWQ2BRQ6KDD`
   * @returns {OfferCallBuilder} current OfferCallBuilder instance
   */
  seller(seller) {
    this.url.setQuery("seller", seller);
    return this;
  }
}
exports.OfferCallBuilder = OfferCallBuilder;