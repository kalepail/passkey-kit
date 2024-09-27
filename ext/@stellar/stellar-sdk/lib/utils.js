"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Utils = void 0;
/**
 * Miscellaneous utilities.
 *
 * @hideconstructor
 */
class Utils {
  /**
   * Verifies if the current date is within the transaction's timebounds
   *
   * @param {Transaction} transaction The transaction whose timebounds will be validated.
   * @param {number} [gracePeriod=0] An additional window of time that should be considered valid on either end of the transaction's time range.
   *
   * @returns {boolean} Returns true if the current time is within the transaction's [minTime, maxTime] range.
   *
   * @static
   */
  static validateTimebounds(transaction, gracePeriod = 0) {
    if (!transaction.timeBounds) {
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    const {
      minTime,
      maxTime
    } = transaction.timeBounds;
    return now >= Number.parseInt(minTime, 10) - gracePeriod && now <= Number.parseInt(maxTime, 10) + gracePeriod;
  }
}
exports.Utils = Utils;