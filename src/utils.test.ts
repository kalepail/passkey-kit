import { describe, expect, it } from "vitest";
import base64url from "./base64url.js";
import {
  compactSignature,
  deriveContractAddress,
  extractPublicKeyFromAttestation,
  generateChallenge,
} from "./utils.js";
import { SECP256R1_CURVE_ORDER } from "./constants.js";

const TESTNET = "Test SDF Network ; September 2015";
const MAINNET = "Public Global Stellar Network ; September 2015";

// The canonical passkey-kit deployer: Keypair.fromRawEd25519Seed(sha256("kalepail")).
const DEPLOYER = "GC2C7AWLS2FMFTQAHW3IBUB4ZXVP4E37XNLEF2IK7IVXBB6CMEPCSXFO";

// Golden vectors pinning the deterministic contract-address derivation
// (salt = sha256(keyId), deployer = the canonical kalepail keypair). Any change
// to the derivation breaks these instead of silently shifting deployed wallet
// addresses — and breaking indexer reverse-lookup.
const DERIVE_VECTORS = [
  { name: "zeros-16", credHex: "00".repeat(16), passphrase: TESTNET, expected: "CD7HUBQP46MGSX3J2U5VLMU3UCAKO7KWFGUCZZQXJCOXCWRMSDDK6J2A" },
  { name: "zeros-32", credHex: "00".repeat(32), passphrase: TESTNET, expected: "CBQU3NIOXC3IDGERJWV3YVMSQSIOU2S6NSMH35OS3GPG6XARZFAAT2NL" },
  { name: "ff-16", credHex: "ff".repeat(16), passphrase: TESTNET, expected: "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL" },
  { name: "random-16", credHex: "0123456789abcdef0123456789abcdef", passphrase: TESTNET, expected: "CARFE5CAZUVN7NWEYKQHFD55SXPJ2IZNT3HQDI22PKNTLOHTAP6DENDJ" },
  { name: "random-32", credHex: "deadbeefcafef00dfeedfacebaadf00d0123456789abcdef0123456789abcdef", passphrase: TESTNET, expected: "CAWJ3E3FTZPDQPHWYNRTDAWPW6SEUV4TFPIGW2VOSZHILKQG4N7JHK3P" },
  { name: "mainnet-random-16", credHex: "0123456789abcdef0123456789abcdef", passphrase: MAINNET, expected: "CBTNGSWMKSGVQ5YGEUHG2YJIZEGSTBZKSVUMWXSRODNQ732JRC5AYV6Z" },
] as const;

describe("deriveContractAddress", () => {
  it.each(DERIVE_VECTORS)(
    "derives $name to the pinned contract address",
    ({ credHex, passphrase, expected }) => {
      const keyId = Buffer.from(credHex, "hex");
      expect(deriveContractAddress(keyId, DEPLOYER, passphrase)).toBe(expected);
    }
  );

  it("derives a different address on mainnet than testnet for the same keyId", () => {
    const keyId = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    expect(deriveContractAddress(keyId, DEPLOYER, TESTNET)).not.toBe(
      deriveContractAddress(keyId, DEPLOYER, MAINNET)
    );
  });
});

describe("extractPublicKeyFromAttestation", () => {
  it("normalizes an SPKI public key from a WebAuthn registration response", async () => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"]
    );

    const spki = Buffer.from(
      new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey))
    );
    const raw = Buffer.from(
      new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
    );

    const extracted = await extractPublicKeyFromAttestation({
      clientDataJSON: "",
      attestationObject: "",
      publicKey: base64url.encode(spki),
    });

    expect(Buffer.from(extracted)).toEqual(raw);
    expect(extracted).toHaveLength(65);
    expect(extracted[0]).toBe(0x04);
  });
});

describe("compactSignature", () => {
  function toBuf32(x: bigint): Buffer {
    return Buffer.from(x.toString(16).padStart(64, "0"), "hex");
  }

  /** DER-encode an (r, s) pair, adding the leading 0x00 pad when needed. */
  function der(r: Buffer, s: Buffer): Buffer {
    const pad = (b: Buffer) =>
      b[0]! & 0x80 ? Buffer.concat([Buffer.from([0x00]), b]) : b;
    const rp = pad(r);
    const sp = pad(s);
    const content = Buffer.concat([
      Buffer.from([0x02, rp.length]),
      rp,
      Buffer.from([0x02, sp.length]),
      sp,
    ]);
    return Buffer.concat([Buffer.from([0x30, content.length]), content]);
  }

  it("returns a 64-byte r||s signature", () => {
    const sig = compactSignature(der(Buffer.from([0x01]), Buffer.from([0x02])));
    expect(sig).toHaveLength(64);
    expect(Buffer.from(sig.subarray(0, 32)).toString("hex")).toBe(
      "00".repeat(31) + "01"
    );
    expect(Buffer.from(sig.subarray(32)).toString("hex")).toBe(
      "00".repeat(31) + "02"
    );
  });

  it("normalizes a high-S value to low-S", () => {
    // s = n - 1 is > n/2; low-S form is n - (n - 1) = 1.
    const highS = toBuf32(SECP256R1_CURVE_ORDER - 1n);
    const sig = compactSignature(der(Buffer.from([0x01]), highS));
    expect(Buffer.from(sig.subarray(32)).toString("hex")).toBe(
      "00".repeat(31) + "01"
    );
  });
});

describe("generateChallenge", () => {
  it("returns 32 random bytes, base64url-encoded", () => {
    const a = generateChallenge();
    const b = generateChallenge();
    expect(base64url.toBuffer(a)).toHaveLength(32);
    expect(a).not.toBe(b);
  });
});
