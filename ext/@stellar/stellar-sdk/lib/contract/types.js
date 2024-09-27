"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.NULL_ACCOUNT = exports.DEFAULT_TIMEOUT = void 0;
/* disable PascalCase naming convention, to avoid breaking change */
/* eslint-disable @typescript-eslint/naming-convention */

/**
 * An unsigned 32-bit integer.
 * @memberof module:contract
 */

/**
 * A signed 32-bit integer.
 * @memberof module:contract
 */

/**
 * An unsigned 64-bit integer.
 * @memberof module:contract
 */

/**
 * A signed 64-bit integer.
 * @memberof module:contract
 */

/**
 * An unsigned 128-bit integer.
 * @memberof module:contract
 */

/**
 * A signed 128-bit integer.
 * @memberof module:contract
 */

/**
 * An unsigned 256-bit integer.
 * @memberof module:contract
 */

/**
 * A signed 256-bit integer.
 * @memberof module:contract
 */

/**
 * A "regular" transaction, as opposed to a FeeBumpTransaction.
 * @memberof module:contract
 * @type {Transaction<Memo<MemoType>, Operation[]>}
 */

/**
 * Options for a smart contract client.
 * @memberof module:contract
 */

/**
 * Options for a smart contract method invocation.
 * @memberof module:contract
 */

/**
 * The default timebounds, in seconds, during which a transaction will be valid.
 * This is attached to the transaction _before_ transaction simulation (it is
 * needed for simulation to succeed). It is also re-calculated and re-added
 * _before_ transaction signing.
 * @constant {number}
 * @default 300
 * @memberof module:contract
 */
const DEFAULT_TIMEOUT = exports.DEFAULT_TIMEOUT = 5 * 60;

/**
 * An impossible account on the Stellar network
 * @constant {string}
 * @default GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF
 * @memberof module:contract
 */
const NULL_ACCOUNT = exports.NULL_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";