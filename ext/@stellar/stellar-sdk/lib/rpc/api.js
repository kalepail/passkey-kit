"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Api = void 0;
/* tslint:disable-next-line:no-namespace */
let Api = exports.Api = void 0;
(function (_Api) {
  /** An XDR-parsed version of {@link this.RawLedgerEntryResult} */
  /** @see https://developers.stellar.org/docs/data/rpc/api-reference/methods/getLedgerEntries */
  /** @see https://developers.stellar.org/docs/data/rpc/api-reference/methods/getNetwork */
  /** @see https://developers.stellar.org/docs/data/rpc/api-reference/methods/getLatestLedger */
  let GetTransactionStatus = /*#__PURE__*/function (GetTransactionStatus) {
    GetTransactionStatus["SUCCESS"] = "SUCCESS";
    GetTransactionStatus["NOT_FOUND"] = "NOT_FOUND";
    GetTransactionStatus["FAILED"] = "FAILED";
    return GetTransactionStatus;
  }({});
  _Api.GetTransactionStatus = GetTransactionStatus;
  /** @see https://developers.stellar.org/docs/data/rpc/api-reference/methods/getTransaction */
  /**
   * Simplifies {@link Api.RawSimulateTransactionResponse} into separate interfaces
   * based on status:
   *   - on success, this includes all fields, though `result` is only present
   *     if an invocation was simulated (since otherwise there's nothing to
   *     "resultify")
   *   - if there was an expiration error, this includes error and restoration
   *     fields
   *   - for all other errors, this only includes error fields
   *
   * @see https://developers.stellar.org/docs/data/rpc/api-reference/methods/simulateTransaction
   */
  /** Includes simplified fields only present on success. */
  /** Includes details about why the simulation failed */
  function isSimulationError(sim) {
    return 'error' in sim;
  }
  _Api.isSimulationError = isSimulationError;
  function isSimulationSuccess(sim) {
    return 'transactionData' in sim;
  }
  _Api.isSimulationSuccess = isSimulationSuccess;
  function isSimulationRestore(sim) {
    return isSimulationSuccess(sim) && 'restorePreamble' in sim && !!sim.restorePreamble.transactionData;
  }
  _Api.isSimulationRestore = isSimulationRestore;
  function isSimulationRaw(sim) {
    return !sim._parsed;
  }
  _Api.isSimulationRaw = isSimulationRaw;
  /** @see https://developers.stellar.org/docs/data/rpc/api-reference/methods/simulateTransaction */
})(Api || (exports.Api = Api = {}));