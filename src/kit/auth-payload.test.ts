/**
 * Ported from the old `bun_tests/9.index.ts` Protocol-27 auth-helper vectors.
 *
 * The old test also exercised the "does this SDK support P27?" fallback shims;
 * on stellar-sdk >= 16 those are dead, so this keeps the golden-vector coverage
 * (address / addressV2 / with-delegates preimages match the SDK's own
 * `buildAuthorizationEntryPreimage`) and drops the shim branches.
 */

import { describe, expect, it } from "vitest";
import {
  Address,
  Keypair,
  Networks,
  buildAuthorizationEntryPreimage,
  buildWithDelegatesEntry,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import {
  assertSignatureExpirationLedger,
  buildSignaturePayload,
  getAddressCredentials,
  usesAddressBoundPayload,
} from "./auth-payload.js";

const networkPassphrase = Networks.TESTNET;

function makeAccount(seedByte: number): string {
  return Keypair.fromRawEd25519Seed(Buffer.alloc(32, seedByte)).publicKey();
}

function makeInvocation(): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: xdr.ScAddress.scAddressTypeContract(
            hash(Buffer.from("contract"))
          ),
          functionName: "do_it",
          args: [],
        })
      ),
    subInvocations: [],
  });
}

function makeAddressCredentials(
  address: string,
  expiration = 1
): xdr.SorobanAddressCredentials {
  return new xdr.SorobanAddressCredentials({
    address: Address.fromString(address).toScAddress(),
    nonce: xdr.Int64.fromString("7"),
    signatureExpirationLedger: expiration,
    signature: xdr.ScVal.scvVoid(),
  });
}

function makeAuthEntry(address: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      makeAddressCredentials(address)
    ),
    rootInvocation: makeInvocation(),
  });
}

describe("getAddressCredentials", () => {
  it("returns the address credentials for a plain address entry", () => {
    const account = makeAccount(1);
    const entry = makeAuthEntry(account);
    const credentials = getAddressCredentials(entry.credentials());

    expect(entry.credentials().switch().name).toBe("sorobanCredentialsAddress");
    expect(Address.fromScAddress(credentials.address()).toString()).toBe(account);
    expect(usesAddressBoundPayload(entry.credentials())).toBe(false);
  });

  it("throws for non-address (source-account) credentials", () => {
    const sourceAccount = xdr.SorobanCredentials.sorobanCredentialsSourceAccount();
    expect(() => getAddressCredentials(sourceAccount)).toThrow(
      /do not contain address credentials/
    );
  });
});

describe("buildSignaturePayload", () => {
  it("matches the SDK preimage hash for a plain address entry", () => {
    const entry = makeAuthEntry(makeAccount(2));
    const payload = buildSignaturePayload(networkPassphrase, entry, 123);
    const credentials = getAddressCredentials(entry.credentials());

    const expectedEntry = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
    const expectedPreimage = buildAuthorizationEntryPreimage(
      expectedEntry,
      123,
      networkPassphrase
    );

    expect(payload).toEqual(hash(expectedPreimage.toXDR()));
    expect(credentials.signatureExpirationLedger()).toBe(123);
  });

  it("matches the SDK preimage hash for an addressV2 (address-bound) entry", () => {
    const baseEntry = makeAuthEntry(makeAccount(3));
    const credentials = getAddressCredentials(baseEntry.credentials());
    const addressV2Entry = new xdr.SorobanAuthorizationEntry({
      credentials:
        xdr.SorobanCredentials.sorobanCredentialsAddressV2(credentials),
      rootInvocation: baseEntry.rootInvocation(),
    });

    expect(addressV2Entry.credentials().switch().name).toBe(
      "sorobanCredentialsAddressV2"
    );
    expect(usesAddressBoundPayload(addressV2Entry.credentials())).toBe(true);

    const expectedEntry = xdr.SorobanAuthorizationEntry.fromXDR(
      addressV2Entry.toXDR()
    );
    const expectedPreimage = buildAuthorizationEntryPreimage(
      expectedEntry,
      123,
      networkPassphrase
    );

    expect(buildSignaturePayload(networkPassphrase, addressV2Entry, 123)).toEqual(
      hash(expectedPreimage.toXDR())
    );
  });

  it("matches the SDK preimage hash for a with-delegates entry", () => {
    const delegatedEntry = buildWithDelegatesEntry({
      entry: makeAuthEntry(makeAccount(4)),
      validUntilLedgerSeq: 123,
      delegates: [{ address: makeAccount(5) }],
    });

    expect(delegatedEntry.credentials().switch().name).toBe(
      "sorobanCredentialsAddressWithDelegates"
    );
    expect(usesAddressBoundPayload(delegatedEntry.credentials())).toBe(true);

    const expectedEntry = xdr.SorobanAuthorizationEntry.fromXDR(
      delegatedEntry.toXDR()
    );
    const expectedPreimage = buildAuthorizationEntryPreimage(
      expectedEntry,
      123,
      networkPassphrase
    );

    expect(buildSignaturePayload(networkPassphrase, delegatedEntry, 123)).toEqual(
      hash(expectedPreimage.toXDR())
    );
    expect(
      getAddressCredentials(
        delegatedEntry.credentials()
      ).signatureExpirationLedger()
    ).toBe(123);
  });

  it("rejects a non-u32 expiration without mutating the entry", () => {
    const entry = makeAuthEntry(makeAccount(4));
    const credentials = getAddressCredentials(entry.credentials());
    expect(() => buildSignaturePayload(networkPassphrase, entry, 1.5)).toThrow(
      /uint32 integer/
    );
    expect(credentials.signatureExpirationLedger()).toBe(1);
  });
});

describe("assertSignatureExpirationLedger", () => {
  it("accepts u32 bounds and rejects everything else", () => {
    expect(() => assertSignatureExpirationLedger(0)).not.toThrow();
    expect(() => assertSignatureExpirationLedger(0xffffffff)).not.toThrow();
    expect(() => assertSignatureExpirationLedger(-1)).toThrow(/uint32 integer/);
    expect(() => assertSignatureExpirationLedger(0x100000000)).toThrow(
      /uint32 integer/
    );
    expect(() => assertSignatureExpirationLedger(1.5)).toThrow(/uint32 integer/);
    expect(() => assertSignatureExpirationLedger(Number.NaN)).toThrow(
      /uint32 integer/
    );
  });
});
