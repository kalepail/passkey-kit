"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.BadRequestError = void 0;
var _network = require("./network");
/**
 * BadRequestError is raised when a request made to Horizon is invalid in some
 * way (incorrect timebounds for trade call builders, for example.)
 * @augments NetworkError
 * @inheritdoc
 * @category Errors
 *
 * @param {string} message Human-readable error message
 * @param {any} response Response details, received from the Horizon server
 */
class BadRequestError extends _network.NetworkError {
  constructor(message, response) {
    const trueProto = new.target.prototype;
    super(message, response);
    this.__proto__ = trueProto;
    this.constructor = BadRequestError;
    this.name = "BadRequestError";
  }
}
exports.BadRequestError = BadRequestError;