"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  httpClient: true,
  create: true
};
exports.httpClient = exports.create = void 0;
var _types = require("./types");
Object.keys(_types).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _types[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _types[key];
    }
  });
});
// eslint-disable-next-line import/no-mutable-exports
let httpClient = exports.httpClient = void 0;
// eslint-disable-next-line import/no-mutable-exports
let create = exports.create = void 0;

// Declare a variable that will be set by the entrypoint
// eslint-disable-next-line @typescript-eslint/naming-convention

// Use the variable for the runtime check
// eslint-disable-next-line no-lonely-if
if (true) {
  // eslint-disable-next-line global-require, prefer-import/prefer-import-over-require
  const axiosModule = require('./axios-client');
  exports.httpClient = httpClient = axiosModule.axiosClient;
  exports.create = create = axiosModule.create;
} else {
  // eslint-disable-next-line global-require, prefer-import/prefer-import-over-require
  const fetchModule = require('./fetch-client');
  exports.httpClient = httpClient = fetchModule.fetchClient;
  exports.create = create = fetchModule.create;
}