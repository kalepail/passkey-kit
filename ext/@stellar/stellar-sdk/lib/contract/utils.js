"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.contractErrorPattern = void 0;
exports.getAccount = getAccount;
exports.implementsToString = implementsToString;
exports.processSpecEntryStream = processSpecEntryStream;
exports.withExponentialBackoff = withExponentialBackoff;
var _stellarBase = require("@stellar/stellar-base");
var _types = require("./types");
/**
 * Keep calling a `fn` for `timeoutInSeconds` seconds, if `keepWaitingIf` is
 * true. Returns an array of all attempts to call the function.
 * @private
 */
async function withExponentialBackoff(/** Function to call repeatedly */
fn, /** Condition to check when deciding whether or not to call `fn` again */
keepWaitingIf, /** How long to wait between the first and second call */
timeoutInSeconds, /** What to multiply `timeoutInSeconds` by, each subsequent attempt */
exponentialFactor = 1.5, /** Whether to log extra info */
verbose = false) {
  const attempts = [];
  let count = 0;
  attempts.push(await fn());
  if (!keepWaitingIf(attempts[attempts.length - 1])) return attempts;
  const waitUntil = new Date(Date.now() + timeoutInSeconds * 1000).valueOf();
  let waitTime = 1000;
  let totalWaitTime = waitTime;
  while (Date.now() < waitUntil && keepWaitingIf(attempts[attempts.length - 1])) {
    count += 1;
    // Wait a beat
    if (verbose) {
      // eslint-disable-next-line no-console
      console.info(`Waiting ${waitTime}ms before trying again (bringing the total wait time to ${totalWaitTime}ms so far, of total ${timeoutInSeconds * 1000}ms)`);
    }
    // eslint-disable-next-line
    await new Promise(res => setTimeout(res, waitTime));
    // Exponential backoff
    waitTime *= exponentialFactor;
    if (new Date(Date.now() + waitTime).valueOf() > waitUntil) {
      waitTime = waitUntil - Date.now();
      if (verbose) {
        // eslint-disable-next-line no-console
        console.info(`was gonna wait too long; new waitTime: ${waitTime}ms`);
      }
    }
    totalWaitTime = waitTime + totalWaitTime;
    // Try again
    // eslint-disable-next-line no-await-in-loop
    attempts.push(await fn(attempts[attempts.length - 1]));
    if (verbose && keepWaitingIf(attempts[attempts.length - 1])) {
      // eslint-disable-next-line no-console
      console.info(`${count}. Called ${fn}; ${attempts.length} prev attempts. Most recent: ${JSON.stringify(attempts[attempts.length - 1], null, 2)}`);
    }
  }
  return attempts;
}

/**
 * If contracts are implemented using the `#[contracterror]` macro, then the
 * errors get included in the on-chain XDR that also describes your contract's
 * methods. Each error will have a specific number. This Regular Expression
 * matches these "expected error types" that a contract may throw, and helps
 * {@link AssembledTransaction} parse these errors.
 *
 * @constant {RegExp}
 * @default "/Error\(Contract, #(\d+)\)/"
 * @memberof module:contract.Client
 */
const contractErrorPattern = exports.contractErrorPattern = /Error\(Contract, #(\d+)\)/;

/**
 * A TypeScript type guard that checks if an object has a `toString` method.
 * @private
 */
function implementsToString(/** some object that may or may not have a `toString` method */
obj) {
  return typeof obj === "object" && obj !== null && "toString" in obj;
}

/**
 * Reads a binary stream of ScSpecEntries into an array for processing by ContractSpec
 * @private
 */
function processSpecEntryStream(buffer) {
  const reader = new _stellarBase.cereal.XdrReader(buffer);
  const res = [];
  while (!reader.eof) {
    // @ts-ignore
    res.push(_stellarBase.xdr.ScSpecEntry.read(reader));
  }
  return res;
}

//eslint-disable-next-line require-await
async function getAccount(options, server) {
  return options.publicKey ? server.getAccount(options.publicKey) : new _stellarBase.Account(_types.NULL_ACCOUNT, "0");
}