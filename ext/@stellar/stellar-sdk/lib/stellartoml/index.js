"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.STELLAR_TOML_MAX_SIZE = exports.Resolver = exports.Api = void 0;
var _toml = _interopRequireDefault(require("toml"));
var _httpClient = require("../http-client");
var _config = require("../config");
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
/** @module StellarToml */

/**
 * The maximum size of stellar.toml file, in bytes
 * @constant {number}
 * @default 102400
 */
const STELLAR_TOML_MAX_SIZE = exports.STELLAR_TOML_MAX_SIZE = 100 * 1024;

// axios timeout doesn't catch missing urls, e.g. those with no response
// so we use the axios cancel token to ensure the timeout
const CancelToken = _httpClient.httpClient.CancelToken;

/**
 * Resolver allows resolving `stellar.toml` files.
 * @memberof module:StellarToml
 * @hideconstructor
 */
class Resolver {
  /**
   * Returns a parsed `stellar.toml` file for a given domain.
   * @see {@link https://developers.stellar.org/docs/tokens/publishing-asset-info | Stellar.toml doc}
   *
   * @param {string} domain Domain to get stellar.toml file for
   * @param {object} [opts] Options object
   * @param {boolean} [opts.allowHttp=false] - Allow connecting to http servers. This must be set to false in production deployments!
   * @param {number} [opts.timeout=0] - Allow a timeout. Allows user to avoid nasty lag due to TOML resolve issue.
   * @returns {Promise} A `Promise` that resolves to the parsed stellar.toml object
   *
   * @example
   * StellarSdk.StellarToml.Resolver.resolve('acme.com')
   *   .then(stellarToml => {
   *     // stellarToml in an object representing domain stellar.toml file.
   *   })
   *   .catch(error => {
   *     // stellar.toml does not exist or is invalid
   *   });
   */
  // eslint-disable-next-line require-await
  static async resolve(domain, opts = {}) {
    const allowHttp = typeof opts.allowHttp === "undefined" ? _config.Config.isAllowHttp() : opts.allowHttp;
    const timeout = typeof opts.timeout === "undefined" ? _config.Config.getTimeout() : opts.timeout;
    const protocol = allowHttp ? "http" : "https";
    return _httpClient.httpClient.get(`${protocol}://${domain}/.well-known/stellar.toml`, {
      maxContentLength: STELLAR_TOML_MAX_SIZE,
      cancelToken: timeout ? new CancelToken(cancel => setTimeout(() => cancel(`timeout of ${timeout}ms exceeded`), timeout)) : undefined,
      timeout
    }).then(response => {
      try {
        const tomlObject = _toml.default.parse(response.data);
        return Promise.resolve(tomlObject);
      } catch (e) {
        return Promise.reject(new Error(`stellar.toml is invalid - Parsing error on line ${e.line}, column ${e.column}: ${e.message}`));
      }
    }).catch(err => {
      if (err.message.match(/^maxContentLength size/)) {
        throw new Error(`stellar.toml file exceeds allowed size of ${STELLAR_TOML_MAX_SIZE}`);
      } else {
        throw err;
      }
    });
  }
}

/* tslint:disable-next-line: no-namespace */
exports.Resolver = Resolver;
let Api = exports.Api = void 0;