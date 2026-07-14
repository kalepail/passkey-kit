/**
 * Regression coverage: the signing path builds CAP-0071-02 V2
 * address-bound credentials, so the payload a signer signs binds the wallet
 * address — two wallets can never produce interchangeable signatures for a
 * byte-identical, address-free invocation.
 *
 * Also pins the TS side: the payload handed to the signer equals the
 * hash of the SDK's own `buildAuthorizationEntryPreimage` for the (upgraded)
 * V2 entry — the same builder the host-side vectors are checked against.
 */

import { describe, expect, it, vi } from "vitest";
import {
  Address,
  Networks,
  buildAuthorizationEntryPreimage,
  buildWithDelegatesEntry,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import type { Spec as ContractSpec } from "@stellar/stellar-sdk/contract";
import { Client as PasskeyClient } from "passkey-kit-sdk";
import { signAuthEntry, type SignAuthEntryDeps } from "./tx-ops.js";
import { getAddressCredentials } from "./auth-payload.js";
import { SigningError } from "../errors.js";
import type { PreparedSignature, Signer } from "../signers.js";

const networkPassphrase = Networks.TESTNET;
const WALLET_A = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";
const WALLET_B = "CC2R2H3DTXS7OCNV3FTNPAZYIRCY2L2OTBG5FZWJV63HXQ35WB2T2NWJ";

function walletSpec(): ContractSpec {
  const client = new PasskeyClient({
    contractId: WALLET_A,
    networkPassphrase,
    rpcUrl: "https://rpc.example",
  });
  return (client as unknown as { spec: ContractSpec }).spec;
}

/** An address-free invocation: byte-identical regardless of which wallet signs. */
function makeInvocation(): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: xdr.ScAddress.scAddressTypeContract(
            hash(Buffer.from("target-contract"))
          ),
          functionName: "transfer_like",
          args: [xdr.ScVal.scvU32(7)],
        })
      ),
    subInvocations: [],
  });
}

/** A legacy V1 address entry, as simulation returns it. */
function makeV1Entry(wallet: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(wallet).toScAddress(),
        nonce: xdr.Int64.fromString("42"), // identical nonce on both wallets
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      })
    ),
    rootInvocation: makeInvocation(),
  });
}

/** A fake signer that records every payload it is asked to sign. */
function capturingSigner(payloads: Buffer[]): Signer {
  return {
    sign(payload: Buffer): PreparedSignature {
      payloads.push(Buffer.from(payload));
      return {
        key: { tag: "Ed25519", values: [Buffer.alloc(32, 0xee)] },
        value: { tag: "Ed25519", values: [Buffer.alloc(64, 0x5e)] },
      };
    },
  };
}

function makeDeps(): SignAuthEntryDeps {
  return {
    networkPassphrase,
    spec: walletSpec(),
    signerContext: { webAuthn: { startAuthentication: vi.fn() } as never },
    calculateExpiration: vi.fn(async () => 123),
  };
}

describe("signAuthEntry V2 address binding", () => {
  it("upgrades a V1 address entry to V2 credentials before signing", async () => {
    const entry = makeV1Entry(WALLET_A);
    const payloads: Buffer[] = [];

    const signed = await signAuthEntry(makeDeps(), entry, capturingSigner(payloads), {
      expiration: 123,
    });

    expect(signed.credentials().switch().name).toBe(
      "sorobanCredentialsAddressV2"
    );
    // The signature landed in the (upgraded) credentials' Signatures map.
    const credentials = getAddressCredentials(signed.credentials());
    expect(credentials.signature().switch().name).toBe("scvVec");
    expect(credentials.signatureExpirationLedger()).toBe(123);
  });

  it("two wallets produce DIFFERENT payload hashes for a byte-identical address-free invocation", async () => {
    // Same signer key installed on wallets A and B; same nonce, expiration, and
    // invocation bytes. Under the V1 preimage both payloads were identical;
    // the V2 preimage separates them by wallet address.
    const entryA = makeV1Entry(WALLET_A);
    const entryB = makeV1Entry(WALLET_B);

    // Prove the invocations really are byte-identical
    expect(entryA.rootInvocation().toXDR("hex")).toBe(
      entryB.rootInvocation().toXDR("hex")
    );
    // ...and that the legacy V1 preimage would NOT have separated the wallets.
    const v1Preimage = (wallet: xdr.SorobanAuthorizationEntry) =>
      hash(
        xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
          new xdr.HashIdPreimageSorobanAuthorization({
            networkId: hash(Buffer.from(networkPassphrase)),
            nonce: getAddressCredentials(wallet.credentials()).nonce(),
            invocation: wallet.rootInvocation(),
            signatureExpirationLedger: 123,
          })
        ).toXDR()
      );
    expect(v1Preimage(entryA)).toEqual(v1Preimage(entryB));

    const payloads: Buffer[] = [];
    const signer = capturingSigner(payloads);
    await signAuthEntry(makeDeps(), entryA, signer, { expiration: 123 });
    await signAuthEntry(makeDeps(), entryB, signer, { expiration: 123 });

    expect(payloads).toHaveLength(2);
    // The V2 payload binds the wallet address: hashes MUST differ.
    expect(payloads[0]!.equals(payloads[1]!)).toBe(false);
  });

  it("signs the hash of the SDK's own V2 preimage (cross-check)", async () => {
    const entry = makeV1Entry(WALLET_A);
    const payloads: Buffer[] = [];

    const signed = await signAuthEntry(makeDeps(), entry, capturingSigner(payloads), {
      expiration: 456,
    });

    // Rebuild the expected payload from a fresh copy of the signed V2 entry
    // using the stellar-sdk's canonical preimage builder (the reference the
    // host-side golden vectors are pinned against).
    const reference = xdr.SorobanAuthorizationEntry.fromXDR(signed.toXDR());
    expect(reference.credentials().switch().name).toBe(
      "sorobanCredentialsAddressV2"
    );
    const expected = hash(
      buildAuthorizationEntryPreimage(reference, 456, networkPassphrase).toXDR()
    );

    expect(payloads[0]).toEqual(expected);

    // And the V2 preimage really is the address-bound envelope type.
    const preimage = buildAuthorizationEntryPreimage(
      reference,
      456,
      networkPassphrase
    );
    expect(preimage.switch().name).toBe(
      "envelopeTypeSorobanAuthorizationWithAddress"
    );
    expect(
      Address.fromScAddress(
        preimage.sorobanAuthorizationWithAddress().address()
      ).toString()
    ).toBe(WALLET_A);
  });

  it("passes an already-V2 entry through unchanged", async () => {
    const v1 = makeV1Entry(WALLET_A);
    const v2 = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(
        getAddressCredentials(v1.credentials())
      ),
      rootInvocation: v1.rootInvocation(),
    });
    const payloads: Buffer[] = [];

    const signed = await signAuthEntry(makeDeps(), v2, capturingSigner(payloads), {
      expiration: 123,
    });

    expect(signed.credentials().switch().name).toBe(
      "sorobanCredentialsAddressV2"
    );
    expect(payloads).toHaveLength(1);
  });

  it("still rejects with-delegates and source-account credentials", async () => {
    const delegated = buildWithDelegatesEntry({
      entry: makeV1Entry(WALLET_A),
      validUntilLedgerSeq: 123,
      delegates: [{ address: WALLET_B }],
    });
    await expect(
      signAuthEntry(makeDeps(), delegated, capturingSigner([]))
    ).rejects.toBeInstanceOf(SigningError);

    const sourceAccount = new xdr.SorobanAuthorizationEntry({
      credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: makeInvocation(),
    });
    await expect(
      signAuthEntry(makeDeps(), sourceAccount, capturingSigner([]))
    ).rejects.toBeInstanceOf(SigningError);
  });
});
