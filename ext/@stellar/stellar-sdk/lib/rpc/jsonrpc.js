"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.postObject = postObject;
var _axios = _interopRequireDefault(require("./axios"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Check if the given object X has a field Y, and make that available to
// typescript typing.
function hasOwnProperty(obj, prop) {
  // eslint-disable-next-line no-prototype-builtins
  return obj.hasOwnProperty(prop);
}

/**
 * Sends the jsonrpc 'params' as a single 'param' object (no array support).
 *
 * @param {string} url URL to the RPC instance
 * @param {string} method RPC method name that should be called
 * @param {(any | null)} [param=null] params that should be supplied to the method
 * @returns {Promise<T>}
 * @private
 */
async function postObject(url, method, param = null) {
  const response = await _axios.default.post(url, {
    jsonrpc: "2.0",
    // TODO: Generate a unique request id
    id: 1,
    method,
    params: param
  });
  if (hasOwnProperty(response.data, "error")) {
    throw response.data.error;
  } else {
    return response.data?.result;
  }
}