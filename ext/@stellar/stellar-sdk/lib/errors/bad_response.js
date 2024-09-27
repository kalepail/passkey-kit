"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BadResponseError = void 0;
var _network = require("./network");
/**
 * BadResponseError is raised when a response from a
 * {@link module:Horizon | Horizon} or {@link module:Federation | Federation}
 * server is invalid in some way. For example, a federation response may exceed
 * the maximum allowed size, or a transaction submission may have failed with
 * Horizon.
 * @augments NetworkError
 * @inheritdoc
 * @category Errors
 *
 * @param {string} message Human-readable error message.
 * @param {any} response Response details, received from the server.
 */
class BadResponseError extends _network.NetworkError {
  constructor(message, response) {
    const trueProto = new.target.prototype;
    super(message, response);
    this.__proto__ = trueProto;
    this.constructor = BadResponseError;
    this.name = "BadResponseError";
  }
}
exports.BadResponseError = BadResponseError;