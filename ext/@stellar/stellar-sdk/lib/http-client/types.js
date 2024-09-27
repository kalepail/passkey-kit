"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.CancelToken = void 0;
class CancelToken {
  throwIfRequested() {
    if (this.reason) {
      throw new Error(this.reason);
    }
  }
  constructor(executor) {
    let resolvePromise;
    this.promise = new Promise(resolve => {
      resolvePromise = resolve;
    });
    executor(reason => {
      this.reason = reason;
      resolvePromise();
    });
  }
}
exports.CancelToken = CancelToken;