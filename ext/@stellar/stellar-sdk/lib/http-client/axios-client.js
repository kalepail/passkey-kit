"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.create = exports.axiosClient = void 0;
var _axios = _interopRequireDefault(require("axios"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
const axiosClient = exports.axiosClient = _axios.default;
const create = exports.create = _axios.default.create;