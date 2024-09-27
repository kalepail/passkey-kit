"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NotFoundError = void 0;
var _network = require("./network");
/**
 * NotFoundError is raised when the resource requested from Horizon is
 * unavailable.
 * @augments NetworkError
 * @inheritdoc
 * @category Errors
 *
 * @param {string} message Human-readable error message
 * @param {any} response Response details, received from the Horizon server
 */
class NotFoundError extends _network.NetworkError {
  constructor(message, response) {
    const trueProto = new.target.prototype;
    super(message, response);
    this.__proto__ = trueProto;
    this.constructor = NotFoundError;
    this.name = "NotFoundError";
  }
}
exports.NotFoundError = NotFoundError;