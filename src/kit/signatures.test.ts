import { describe, expect, it } from "vitest";
import { Address, xdr } from "@stellar/stellar-sdk";
import type { Spec as ContractSpec } from "@stellar/stellar-sdk/contract";
import { Client as PasskeyClient } from "passkey-kit-sdk";
import type { SignerKey as SDKSignerKey } from "passkey-kit-sdk";
import {
  compareScVal,
  signerKeyToScVal,
  signatureToScVal,
  upsertSignatureEntry,
} from "./auth-payload.js";

const TESTNET = "Test SDF Network ; September 2015";
const CONTRACT = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";

function walletSpec(): ContractSpec {
  const client = new PasskeyClient({
    contractId: CONTRACT,
    networkPassphrase: TESTNET,
    rpcUrl: "https://rpc.example",
  });
  return (client as unknown as { spec: ContractSpec }).spec;
}

describe("compareScVal", () => {
  it("orders by type discriminant first", () => {
    // scvBool (0) sorts before scvU32 (4).
    expect(
      compareScVal(xdr.ScVal.scvBool(true), xdr.ScVal.scvU32(0))
    ).toBeLessThan(0);
  });

  it("orders bytes by content, with a shorter prefix first (host order)", () => {
    const short = xdr.ScVal.scvBytes(Buffer.from([0xff]));
    const long = xdr.ScVal.scvBytes(Buffer.from([0xff, 0x00]));
    // Host compares element-wise then by length: [ff] is a prefix of [ff,00].
    expect(compareScVal(short, long)).toBeLessThan(0);
    expect(compareScVal(long, short)).toBeGreaterThan(0);
    expect(compareScVal(short, short)).toBe(0);
  });

  it("recurses into vectors (SignerKey encoding shape)", () => {
    const a = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol("Secp256r1"),
      xdr.ScVal.scvBytes(Buffer.from([0x01])),
    ]);
    const b = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol("Secp256r1"),
      xdr.ScVal.scvBytes(Buffer.from([0x01, 0x00])),
    ]);
    expect(compareScVal(a, b)).toBeLessThan(0);
  });

  it("orders addresses by their encoding", () => {
    const addr = xdr.ScVal.scvAddress(
      Address.fromString(CONTRACT).toScAddress()
    );
    expect(compareScVal(addr, addr)).toBe(0);
  });
});

describe("signerKeyToScVal", () => {
  it("encodes a Secp256r1 signer key as a tagged vector", () => {
    const spec = walletSpec();
    const key: SDKSignerKey = {
      tag: "Secp256r1",
      values: [Buffer.from([0xaa, 0xbb])],
    };
    const scVal = signerKeyToScVal(spec, key);
    expect(scVal.switch().name).toBe("scvVec");
    const vec = scVal.vec()!;
    expect(vec[0]!.sym().toString()).toBe("Secp256r1");
    expect(Buffer.from(vec[1]!.bytes())).toEqual(Buffer.from([0xaa, 0xbb]));
  });
});

describe("upsertSignatureEntry", () => {
  function credentials(): xdr.SorobanAddressCredentials {
    return new xdr.SorobanAddressCredentials({
      address: Address.fromString(CONTRACT).toScAddress(),
      nonce: xdr.Int64.fromString("1"),
      signatureExpirationLedger: 1,
      signature: xdr.ScVal.scvVoid(),
    });
  }

  function keyBytesOf(entry: xdr.ScMapEntry): Buffer {
    return Buffer.from(entry.key().vec()![1]!.bytes());
  }

  it("creates the Signatures vec+map from a void signature", () => {
    const spec = walletSpec();
    const creds = credentials();
    const scKey = signerKeyToScVal(spec, {
      tag: "Secp256r1",
      values: [Buffer.from([0x01])],
    });
    upsertSignatureEntry(creds, scKey, signatureToScVal(spec, undefined));

    expect(creds.signature().switch().name).toBe("scvVec");
    const map = creds.signature().vec()![0]!.map()!;
    expect(map).toHaveLength(1);
  });

  it("keeps map keys in host order across inserts", () => {
    const spec = walletSpec();
    const creds = credentials();
    // Insert out of order: [ff] then [01]; expect sorted [01] before [ff].
    for (const b of [0xff, 0x01]) {
      const scKey = signerKeyToScVal(spec, {
        tag: "Secp256r1",
        values: [Buffer.from([b])],
      });
      upsertSignatureEntry(creds, scKey, xdr.ScVal.scvVoid());
    }
    const map = creds.signature().vec()![0]!.map()!;
    expect(map.map(keyBytesOf)).toEqual([Buffer.from([0x01]), Buffer.from([0xff])]);
  });

  it("replaces (dedupes) an existing key rather than duplicating it", () => {
    const spec = walletSpec();
    const creds = credentials();
    const scKey = signerKeyToScVal(spec, {
      tag: "Secp256r1",
      values: [Buffer.from([0x07])],
    });
    upsertSignatureEntry(creds, scKey, xdr.ScVal.scvVoid());
    upsertSignatureEntry(creds, scKey, xdr.ScVal.scvVoid());
    expect(creds.signature().vec()![0]!.map()!).toHaveLength(1);
  });
});
