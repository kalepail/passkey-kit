"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Config = void 0;
/**
 * Global config parameters.
 */

const defaultConfig = {
  allowHttp: false,
  timeout: 0
};
let config = {
  ...defaultConfig
};

/**
 * Global config class.
 *
 * @hideconstructor
 *
 * @example <caption>Usage in node</caption>
 * import { Config } from '@stellar/stellar-sdk';
 * Config.setAllowHttp(true);
 * Config.setTimeout(5000);
 *
 * @example <caption>Usage in the browser</caption>
 * StellarSdk.Config.setAllowHttp(true);
 * StellarSdk.Config.setTimeout(5000);
 */
class Config {
  /**
   * Sets `allowHttp` flag globally. When set to `true`, connections to insecure
   * http protocol servers will be allowed. Must be set to `false` in
   * production.
   * @default false
   * @static
   */
  static setAllowHttp(value) {
    config.allowHttp = value;
  }

  /**
   * Sets `timeout` flag globally. When set to anything besides 0, the request
   * will timeout after specified time (ms).
   * @default 0
   * @static
   */
  static setTimeout(value) {
    config.timeout = value;
  }

  /**
   * Returns the configured `allowHttp` flag.
   * @static
   * @returns {boolean}
   */
  static isAllowHttp() {
    return config.allowHttp;
  }

  /**
   * Returns the configured `timeout` flag.
   * @static
   * @returns {number}
   */
  static getTimeout() {
    return config.timeout;
  }

  /**
   * Sets all global config flags to default values.
   * @static
   */
  static setDefault() {
    config = {
      ...defaultConfig
    };
  }
}
exports.Config = Config;