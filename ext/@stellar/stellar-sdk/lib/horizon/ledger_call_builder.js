"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LedgerCallBuilder = void 0;
var _call_builder = require("./call_builder");
/**
 * Creates a new {@link LedgerCallBuilder} pointed to server defined by serverUrl.
 *
 * Do not create this object directly, use {@link Horizon.Server#ledgers}.
 *
 * @see {@link https://developers.stellar.org/docs/data/horizon/api-reference/resources/list-all-ledgers|All Ledgers}
 *
 * @augments CallBuilder
 * @private
 * @class
 * @param {string} serverUrl Horizon server URL.
 */
class LedgerCallBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl) {
    super(serverUrl);
    this.url.segment("ledgers");
  }

  /**
   * Provides information on a single ledger.
   * @param {number|string} sequence Ledger sequence
   * @returns {LedgerCallBuilder} current LedgerCallBuilder instance
   */
  ledger(sequence) {
    this.filter.push(["ledgers", sequence.toString()]);
    return this;
  }
}
exports.LedgerCallBuilder = LedgerCallBuilder;