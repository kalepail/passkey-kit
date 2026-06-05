import { strict as assert } from "node:assert";
import { Address, Keypair, Networks, hash, xdr } from "@stellar/stellar-sdk/minimal";
import {
    assertSignatureExpirationLedger,
    buildSignaturePayload,
    getAddressCredentials,
    usesAddressBoundPayload,
} from "../src/kit";

function makeAccount(seedByte: number): string {
    return Keypair.fromRawEd25519Seed(Buffer.alloc(32, seedByte)).publicKey();
}

function makeInvocation(): xdr.SorobanAuthorizedInvocation {
    return new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new xdr.InvokeContractArgs({
                contractAddress: xdr.ScAddress.scAddressTypeContract(hash(Buffer.from("contract"))),
                functionName: "do_it",
                args: [],
            })
        ),
        subInvocations: [],
    });
}

function makeAddressCredentials(address: string, expiration = 1): xdr.SorobanAddressCredentials {
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

const networkPassphrase = Networks.TESTNET;

{
    const account = makeAccount(1);
    const entry = makeAuthEntry(account);
    const credentials = getAddressCredentials(entry.credentials());

    assert.equal(entry.credentials().switch().name, "sorobanCredentialsAddress");
    assert.equal(Address.fromScAddress(credentials.address()).toString(), account);
    assert.equal(usesAddressBoundPayload(entry.credentials()), false);
}

{
    const entry = makeAuthEntry(makeAccount(2));
    const payload = buildSignaturePayload(networkPassphrase, entry, 123);
    const credentials = getAddressCredentials(entry.credentials());
    const expectedPreimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
        new xdr.HashIdPreimageSorobanAuthorization({
            networkId: hash(Buffer.from(networkPassphrase)),
            nonce: credentials.nonce(),
            signatureExpirationLedger: 123,
            invocation: entry.rootInvocation(),
        })
    );

    assert.deepEqual(payload, hash(expectedPreimage.toXDR()));
    assert.equal(credentials.signatureExpirationLedger(), 123);
}

{
    const credentials = makeAddressCredentials(makeAccount(3), 1);
    const fakeAddressV2Credentials = {
        switch: () => ({ name: "sorobanCredentialsAddressV2" }),
        addressV2: () => credentials,
    } as unknown as xdr.SorobanCredentials;
    const fakeAddressV2Entry = {
        credentials: () => fakeAddressV2Credentials,
        rootInvocation: () => makeInvocation(),
    } as unknown as xdr.SorobanAuthorizationEntry;

    assert.equal(usesAddressBoundPayload(fakeAddressV2Credentials), true);
    assert.throws(
        () => buildSignaturePayload(networkPassphrase, fakeAddressV2Entry, 123),
        /Address-bound Soroban auth credentials require an SDK with Protocol 27 auth preimage support/
    );
    assert.equal(credentials.signatureExpirationLedger(), 1);
}

{
    const fakeAddressV2Credentials = {
        switch: () => ({ name: "sorobanCredentialsAddressV2" }),
    } as unknown as xdr.SorobanCredentials;

    assert.throws(
        () => getAddressCredentials(fakeAddressV2Credentials),
        /ADDRESS_V2 credentials require an SDK with Protocol 27 credential support/
    );
}

{
    const fakeDelegatedCredentials = {
        switch: () => ({ name: "sorobanCredentialsAddressWithDelegates" }),
    } as unknown as xdr.SorobanCredentials;

    assert.equal(usesAddressBoundPayload(fakeDelegatedCredentials), true);
    assert.throws(
        () => getAddressCredentials(fakeDelegatedCredentials),
        /ADDRESS_WITH_DELEGATES credentials require an SDK with Protocol 27 credential support/
    );
}

{
    assert.doesNotThrow(() => assertSignatureExpirationLedger(0));
    assert.doesNotThrow(() => assertSignatureExpirationLedger(0xffffffff));
    assert.throws(() => assertSignatureExpirationLedger(-1), /uint32 integer/);
    assert.throws(() => assertSignatureExpirationLedger(0x100000000), /uint32 integer/);
    assert.throws(() => assertSignatureExpirationLedger(1.5), /uint32 integer/);
    assert.throws(() => assertSignatureExpirationLedger(Number.NaN), /uint32 integer/);
}

{
    const entry = makeAuthEntry(makeAccount(4));
    const credentials = getAddressCredentials(entry.credentials());

    assert.throws(
        () => buildSignaturePayload(networkPassphrase, entry, 1.5),
        /Soroban signature expiration ledger must be a uint32 integer/
    );
    assert.equal(credentials.signatureExpirationLedger(), 1);
}

console.log("Protocol 27 auth helper tests passed");
