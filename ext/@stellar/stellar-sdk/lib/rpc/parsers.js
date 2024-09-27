"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.parseRawEvents = parseRawEvents;
exports.parseRawLedgerEntries = parseRawLedgerEntries;
exports.parseRawSendTransaction = parseRawSendTransaction;
exports.parseRawSimulation = parseRawSimulation;
exports.parseRawTransactions = parseRawTransactions;
exports.parseTransactionInfo = parseTransactionInfo;
var _stellarBase = require("@stellar/stellar-base");
var _api = require("./api");
/**
 * Parse the response from invoking the `submitTransaction` method of a Soroban RPC server.
 * @memberof module:rpc
 * @private
 *
 * @param {Api.RawSendTransactionResponse} raw the raw `submitTransaction` response from the Soroban RPC server to parse
 * @returns {Api.SendTransactionResponse} transaction response parsed from the Soroban RPC server's response
 */
function parseRawSendTransaction(raw) {
  const {
    errorResultXdr,
    diagnosticEventsXdr
  } = raw;
  delete raw.errorResultXdr;
  delete raw.diagnosticEventsXdr;
  if (errorResultXdr) {
    return {
      ...raw,
      ...(diagnosticEventsXdr !== undefined && diagnosticEventsXdr.length > 0 && {
        diagnosticEvents: diagnosticEventsXdr.map(evt => _stellarBase.xdr.DiagnosticEvent.fromXDR(evt, 'base64'))
      }),
      errorResult: _stellarBase.xdr.TransactionResult.fromXDR(errorResultXdr, 'base64')
    };
  }
  return {
    ...raw
  };
}
function parseTransactionInfo(raw) {
  const meta = _stellarBase.xdr.TransactionMeta.fromXDR(raw.resultMetaXdr, 'base64');
  const info = {
    ledger: raw.ledger,
    createdAt: raw.createdAt,
    applicationOrder: raw.applicationOrder,
    feeBump: raw.feeBump,
    envelopeXdr: _stellarBase.xdr.TransactionEnvelope.fromXDR(raw.envelopeXdr, 'base64'),
    resultXdr: _stellarBase.xdr.TransactionResult.fromXDR(raw.resultXdr, 'base64'),
    resultMetaXdr: meta
  };
  if (meta.switch() === 3 && meta.v3().sorobanMeta() !== null) {
    info.returnValue = meta.v3().sorobanMeta()?.returnValue();
  }
  if ('diagnosticEventsXdr' in raw && raw.diagnosticEventsXdr) {
    info.diagnosticEventsXdr = raw.diagnosticEventsXdr.map(diagnosticEvent => _stellarBase.xdr.DiagnosticEvent.fromXDR(diagnosticEvent, 'base64'));
  }
  return info;
}
function parseRawTransactions(r) {
  return {
    status: r.status,
    ...parseTransactionInfo(r)
  };
}

/**
 * Parse and return the retrieved events, if any, from a raw response from a Soroban RPC server.
 * @memberof module:rpc
 *
 * @param {Api.RawGetEventsResponse} raw the raw `getEvents` response from the Soroban RPC server to parse
 * @returns {Api.GetEventsResponse} events parsed from the Soroban RPC server's response
 */
function parseRawEvents(raw) {
  return {
    latestLedger: raw.latestLedger,
    events: (raw.events ?? []).map(evt => {
      const clone = {
        ...evt
      };
      delete clone.contractId; // `as any` hack because contractId field isn't optional

      // the contractId may be empty so we omit the field in that case
      return {
        ...clone,
        ...(evt.contractId !== '' && {
          contractId: new _stellarBase.Contract(evt.contractId)
        }),
        topic: evt.topic.map(topic => _stellarBase.xdr.ScVal.fromXDR(topic, 'base64')),
        value: _stellarBase.xdr.ScVal.fromXDR(evt.value, 'base64')
      };
    })
  };
}

/**
 * Parse and return the retrieved ledger entries, if any, from a raw response from a Soroban RPC server.
 * @memberof module:rpc
 * @private
 *
 * @param {Api.RawGetLedgerEntriesResponse} raw he raw `getLedgerEntries` response from the Soroban RPC server to parse
 * @returns {Api.GetLedgerEntriesResponse} ledger entries parsed from the Soroban RPC server's response
 */
function parseRawLedgerEntries(raw) {
  return {
    latestLedger: raw.latestLedger,
    entries: (raw.entries ?? []).map(rawEntry => {
      if (!rawEntry.key || !rawEntry.xdr) {
        throw new TypeError(`invalid ledger entry: ${JSON.stringify(rawEntry)}`);
      }
      return {
        lastModifiedLedgerSeq: rawEntry.lastModifiedLedgerSeq,
        key: _stellarBase.xdr.LedgerKey.fromXDR(rawEntry.key, 'base64'),
        val: _stellarBase.xdr.LedgerEntryData.fromXDR(rawEntry.xdr, 'base64'),
        ...(rawEntry.liveUntilLedgerSeq !== undefined && {
          liveUntilLedgerSeq: rawEntry.liveUntilLedgerSeq
        })
      };
    })
  };
}

/**
 * Parse whether or not the transaction simulation was successful, returning the relevant response.
 * @memberof module:rpc
 * @private
 *
 * @param {Api.RawSimulateTransactionResponse} sim a raw response from the `simulateTransaction` method of the Soroban RPC server to parse
 * @param {Api.BaseSimulateTransactionResponse} partial a partially built simulate transaction response that will be used to build the return response
 * @returns {Api.SimulateTransactionRestoreResponse | Api.SimulateTransactionSuccessResponse} Either a simulation response indicating what ledger entries should be restored, or if the simulation was successful.
 */
function parseSuccessful(sim, partial) {
  // success type: might have a result (if invoking) and...
  const success = {
    ...partial,
    transactionData: new _stellarBase.SorobanDataBuilder(sim.transactionData),
    minResourceFee: sim.minResourceFee,
    cost: sim.cost,
    ...(
    // coalesce 0-or-1-element results[] list into a single result struct
    // with decoded fields if present
    // eslint-disable-next-line no-self-compare
    (sim.results?.length ?? 0 > 0) && {
      result: sim.results.map(row => ({
        auth: (row.auth ?? []).map(entry => _stellarBase.xdr.SorobanAuthorizationEntry.fromXDR(entry, 'base64')),
        // if return value is missing ("falsy") we coalesce to void
        retval: row.xdr ? _stellarBase.xdr.ScVal.fromXDR(row.xdr, 'base64') : _stellarBase.xdr.ScVal.scvVoid()
      }))[0]
    }),
    // eslint-disable-next-line no-self-compare
    ...((sim.stateChanges?.length ?? 0 > 0) && {
      stateChanges: sim.stateChanges?.map(entryChange => ({
        type: entryChange.type,
        key: _stellarBase.xdr.LedgerKey.fromXDR(entryChange.key, 'base64'),
        before: entryChange.before ? _stellarBase.xdr.LedgerEntry.fromXDR(entryChange.before, 'base64') : null,
        after: entryChange.after ? _stellarBase.xdr.LedgerEntry.fromXDR(entryChange.after, 'base64') : null
      }))
    })
  };
  if (!sim.restorePreamble || sim.restorePreamble.transactionData === '') {
    return success;
  }

  // ...might have a restoration hint (if some state is expired)
  return {
    ...success,
    restorePreamble: {
      minResourceFee: sim.restorePreamble.minResourceFee,
      transactionData: new _stellarBase.SorobanDataBuilder(sim.restorePreamble.transactionData)
    }
  };
}

/**
 * Converts a raw response schema into one with parsed XDR fields and a simplified interface.
 * @warning This API is only exported for testing purposes and should not be relied on or considered "stable".
 * @memberof module:rpc
 *
 * @param {Api.SimulateTransactionResponse | Api.RawSimulateTransactionResponse} sim the raw response schema (parsed ones are allowed, best-effort
 *    detected, and returned untouched)
 * @returns {Api.SimulateTransactionResponse} the original parameter (if already parsed), parsed otherwise
 */
function parseRawSimulation(sim) {
  const looksRaw = _api.Api.isSimulationRaw(sim);
  if (!looksRaw) {
    // Gordon Ramsey in shambles
    return sim;
  }

  // shared across all responses
  const base = {
    _parsed: true,
    id: sim.id,
    latestLedger: sim.latestLedger,
    events: sim.events?.map(evt => _stellarBase.xdr.DiagnosticEvent.fromXDR(evt, 'base64')) ?? []
  };

  // error type: just has error string
  if (typeof sim.error === 'string') {
    return {
      ...base,
      error: sim.error
    };
  }
  return parseSuccessful(sim, base);
}