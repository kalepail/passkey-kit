"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NetworkError = void 0;
// For ES5 compatibility (https://stackoverflow.com/a/55066280).

/**
 * NetworkError is raised when an interaction with a Horizon server has caused
 * some kind of problem.
 * @category Errors
 *
 * @param {string} message Human-readable error message
 * @param {any} response Response details, received from the Horizon server.
 * @param {HorizonApi.ErrorResponseData} [response.data] The data returned by Horizon as part of the error: {@link https://developers.stellar.org/docs/data/horizon/api-reference/errors/response | Error Response}
 * @param {number} [response.status] HTTP status code describing the basic issue with a submitted transaction {@link https://developers.stellar.org/docs/data/horizon/api-reference/errors/http-status-codes/standard | Standard Status Codes}
 * @param {string} [response.statusText] A human-readable description of what the status code means: {@link https://developers.stellar.org/docs/data/horizon/api-reference/errors/http-status-codes/horizon-specific | Horizon-Specific Status Codes}
 * @param {string} [response.url] URL which can provide more information about the problem that occurred.
 */
class NetworkError extends Error {
  constructor(message, response) {
    const trueProto = new.target.prototype;
    super(message);
    this.__proto__ = trueProto;
    this.constructor = NetworkError;
    /**
     * The response sent by the Horizon server.
     * @type {object} Response details, received from the Horizon server
     * @property {HorizonApi.ErrorResponseData} [response.data] The data returned by Horizon as part of the error: {@link https://developers.stellar.org/docs/data/horizon/api-reference/errors/response | Error Response}
     * @property {number} [response.status] HTTP status code describing the basic issue with a submitted transaction {@link https://developers.stellar.org/docs/data/horizon/api-reference/errors/http-status-codes/standard | Standard Status Codes}
     * @property {string} [response.statusText] A human-readable description of what the status code means: {@link https://developers.stellar.org/docs/data/horizon/api-reference/errors/http-status-codes/horizon-specific | Horizon-Specific Status Codes}
     * @property {string} [response.url] URL which can provide more information about the problem that occurred.
     */
    this.response = response;
  }

  /**
   * Returns the error response sent by the Horizon server.
   * @returns {any}
   */
  getResponse() {
    return this.response;
  }
}
exports.NetworkError = NetworkError;