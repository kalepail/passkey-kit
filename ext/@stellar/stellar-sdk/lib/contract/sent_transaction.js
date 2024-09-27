"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SentTransaction = void 0;
var _rpc = require("../rpc");
var _api = require("../rpc/api");
var _utils = require("./utils");
var _types = require("./types");
/* disable max-classes rule, because extending error shouldn't count! */
/* eslint max-classes-per-file: 0 */

/**
 * A transaction that has been sent to the Soroban network. This happens in two steps:
 *
 * 1. `sendTransaction`: initial submission of the transaction to the network.
 *    If this step runs into problems, the attempt to sign and send will be
 *    aborted. You can see the result of this call in the
 *    `sendTransactionResponse` getter.
 * 2. `getTransaction`: once the transaction has been submitted to the network
 *    successfully, you need to wait for it to finalize to get the result of the
 *    transaction. This will be retried with exponential backoff for
 *    {@link MethodOptions.timeoutInSeconds} seconds. See all attempts in
 *    `getTransactionResponseAll` and the most recent attempt in
 *    `getTransactionResponse`.
 *
 * @memberof module:contract
 * @class
 *
 * @param {Function} signTransaction More info in {@link MethodOptions}
 * @param {module:contract.AssembledTransaction<T>} assembled {@link AssembledTransaction} from which this SentTransaction was initialized
 */
class SentTransaction {
  /**
   * The result of calling `sendTransaction` to broadcast the transaction to the
   * network.
   */

  /**
   * If `sendTransaction` completes successfully (which means it has `status: 'PENDING'`),
   * then `getTransaction` will be called in a loop for
   * {@link MethodOptions.timeoutInSeconds} seconds. This array contains all
   * the results of those calls.
   */

  /**
   * The most recent result of calling `getTransaction`, from the
   * `getTransactionResponseAll` array.
   */

  static Errors = {
    SendFailed: class SendFailedError extends Error {},
    SendResultOnly: class SendResultOnlyError extends Error {},
    TransactionStillPending: class TransactionStillPendingError extends Error {}
  };
  constructor(_,
  // deprecated: used to take sentTransaction, need to wait for major release for breaking change
  assembled) {
    this.assembled = assembled;
    this.server = new _rpc.Server(this.assembled.options.rpcUrl, {
      allowHttp: this.assembled.options.allowHttp ?? false
    });
  }

  /**
   * Initialize a `SentTransaction` from `options` and a `signed`
   * AssembledTransaction. This will also send the transaction to the network.
   */
  static init = async (/** @deprecated variable is ignored. Now handled by AssembledTransaction. */
  _,
  // eslint-disable-line @typescript-eslint/no-unused-vars
  /** {@link AssembledTransaction} from which this SentTransaction was initialized */
  assembled) => {
    const tx = new SentTransaction(undefined, assembled);
    const sent = await tx.send();
    return sent;
  };
  send = async () => {
    this.sendTransactionResponse = await this.server.sendTransaction(this.assembled.signed);
    if (this.sendTransactionResponse.status !== "PENDING") {
      throw new SentTransaction.Errors.SendFailed(`Sending the transaction to the network failed!\n${JSON.stringify(this.sendTransactionResponse, null, 2)}`);
    }
    const {
      hash
    } = this.sendTransactionResponse;
    const timeoutInSeconds = this.assembled.options.timeoutInSeconds ?? _types.DEFAULT_TIMEOUT;
    this.getTransactionResponseAll = await (0, _utils.withExponentialBackoff)(() => this.server.getTransaction(hash), resp => resp.status === _api.Api.GetTransactionStatus.NOT_FOUND, timeoutInSeconds);
    this.getTransactionResponse = this.getTransactionResponseAll[this.getTransactionResponseAll.length - 1];
    if (this.getTransactionResponse.status === _api.Api.GetTransactionStatus.NOT_FOUND) {
      throw new SentTransaction.Errors.TransactionStillPending(`Waited ${timeoutInSeconds} seconds for transaction to complete, but it did not. ` + `Returning anyway. Check the transaction status manually. ` + `Sent transaction: ${JSON.stringify(this.sendTransactionResponse, null, 2)}\n` + `All attempts to get the result: ${JSON.stringify(this.getTransactionResponseAll, null, 2)}`);
    }
    return this;
  };
  get result() {
    // 1. check if transaction was submitted and awaited with `getTransaction`
    if ("getTransactionResponse" in this && this.getTransactionResponse) {
      // getTransactionResponse has a `returnValue` field unless it failed
      if ("returnValue" in this.getTransactionResponse) {
        return this.assembled.options.parseResultXdr(this.getTransactionResponse.returnValue);
      }

      // if "returnValue" not present, the transaction failed; return without
      // parsing the result
      throw new Error("Transaction failed! Cannot parse result.");
    }

    // 2. otherwise, maybe it was merely sent with `sendTransaction`
    if (this.sendTransactionResponse) {
      const errorResult = this.sendTransactionResponse.errorResult?.result();
      if (errorResult) {
        throw new SentTransaction.Errors.SendFailed(`Transaction simulation looked correct, but attempting to send the transaction failed. Check \`simulation\` and \`sendTransactionResponseAll\` to troubleshoot. Decoded \`sendTransactionResponse.errorResultXdr\`: ${errorResult}`);
      }
      throw new SentTransaction.Errors.SendResultOnly(`Transaction was sent to the network, but not yet awaited. No result to show. Await transaction completion with \`getTransaction(sendTransactionResponse.hash)\``);
    }

    // 3. finally, if neither of those are present, throw an error
    throw new Error(`Sending transaction failed: ${JSON.stringify(this.assembled.signed)}`);
  }
}
exports.SentTransaction = SentTransaction;