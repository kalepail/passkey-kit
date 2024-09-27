"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ServerApi = void 0;
var _horizon_api = require("./horizon_api");
// more types
/* tslint:disable-next-line: no-namespace */
let ServerApi = exports.ServerApi = void 0;
(function (_ServerApi) {
  let TradeType = /*#__PURE__*/function (TradeType) {
    TradeType["all"] = "all";
    TradeType["liquidityPools"] = "liquidity_pool";
    TradeType["orderbook"] = "orderbook";
    return TradeType;
  }({});
  _ServerApi.TradeType = TradeType;
  var OperationResponseType = _horizon_api.HorizonApi.OperationResponseType;
  var OperationResponseTypeI = _horizon_api.HorizonApi.OperationResponseTypeI;
})(ServerApi || (exports.ServerApi = ServerApi = {}));