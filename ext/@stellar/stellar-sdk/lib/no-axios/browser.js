"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  httpClient: true,
  StellarBase: true
};
exports.default = exports.StellarBase = void 0;
Object.defineProperty(exports, "httpClient", {
  enumerable: true,
  get: function () {
    return _httpClient.httpClient;
  }
});
var _httpClient = require("./http-client");
var _index = require("./index");
Object.keys(_index).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _index[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _index[key];
    }
  });
});
var _StellarBase = _interopRequireWildcard(require("@stellar/stellar-base"));
exports.StellarBase = _StellarBase;
function _getRequireWildcardCache(e) { if ("function" != typeof WeakMap) return null; var r = new WeakMap(), t = new WeakMap(); return (_getRequireWildcardCache = function (e) { return e ? t : r; })(e); }
function _interopRequireWildcard(e, r) { if (!r && e && e.__esModule) return e; if (null === e || "object" != typeof e && "function" != typeof e) return { default: e }; var t = _getRequireWildcardCache(r); if (t && t.has(e)) return t.get(e); var n = { __proto__: null }, a = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var u in e) if ("default" !== u && {}.hasOwnProperty.call(e, u)) { var i = a ? Object.getOwnPropertyDescriptor(e, u) : null; i && (i.get || i.set) ? Object.defineProperty(n, u, i) : n[u] = e[u]; } return n.default = e, t && t.set(e, n), n; }
/* tslint:disable:no-var-requires */
/* eslint import/no-import-module-exports: 0 */
var _default = exports.default = module.exports;