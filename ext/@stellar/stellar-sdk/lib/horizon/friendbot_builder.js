"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FriendbotBuilder = void 0;
var _call_builder = require("./call_builder");
class FriendbotBuilder extends _call_builder.CallBuilder {
  constructor(serverUrl, address) {
    super(serverUrl);
    this.url.segment("friendbot");
    this.url.setQuery("addr", address);
  }
}
exports.FriendbotBuilder = FriendbotBuilder;