"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.basicNodeSigner = void 0;
var _stellarBase = require("@stellar/stellar-base");
/**
 * For use with {@link Client} and {@link module:contract.AssembledTransaction}.
 * Implements `signTransaction` and `signAuthEntry` with signatures expected by
 * those classes. This is useful for testing and maybe some simple Node
 * applications. Feel free to use this as a starting point for your own
 * Wallet/TransactionSigner implementation.
 *
 * @memberof module:contract
 *
 * @param {Keypair} keypair {@link Keypair} to use to sign the transaction or auth entry
 * @param {string} networkPassphrase passphrase of network to sign for
 */
const basicNodeSigner = (keypair, networkPassphrase) => ({
  // eslint-disable-next-line require-await
  signTransaction: async tx => {
    const t = _stellarBase.TransactionBuilder.fromXDR(tx, networkPassphrase);
    t.sign(keypair);
    return t.toXDR();
  },
  // eslint-disable-next-line require-await
  signAuthEntry: async entryXdr => keypair.sign((0, _stellarBase.hash)(Buffer.from(entryXdr, "base64"))).toString("base64")
});
exports.basicNodeSigner = basicNodeSigner;