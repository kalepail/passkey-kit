"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ServerApi = void 0;
var _horizon_api = require("./horizon_api");
var ServerApi;
(function (_ServerApi) {
  var TradeType = function (TradeType) {
    TradeType["all"] = "all";
    TradeType["liquidityPools"] = "liquidity_pool";
    TradeType["orderbook"] = "orderbook";
    return TradeType;
  }({});
  _ServerApi.TradeType = TradeType;
  var OperationResponseType = _horizon_api.HorizonApi.OperationResponseType;
  var OperationResponseTypeI = _horizon_api.HorizonApi.OperationResponseTypeI;
})(ServerApi || (exports.ServerApi = ServerApi = {}));