"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.InvalidChallengeError = void 0;
/* eslint-disable no-proto */
/**
 * InvalidChallengeError is raised when a challenge transaction does not meet
 * the requirements for a SEP-10 challenge transaction (for example, a non-zero
 * sequence number).
 * @memberof module:WebAuth
 * @category Errors
 *
 * @param {string} message Human-readable error message.
 */
class InvalidChallengeError extends Error {
  constructor(message) {
    const trueProto = new.target.prototype;
    super(message);
    this.__proto__ = trueProto;
    this.constructor = InvalidChallengeError;
    this.name = "InvalidChallengeError";
  }
}
exports.InvalidChallengeError = InvalidChallengeError;