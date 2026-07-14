import { describe, expect, it } from "vitest";
import base64url from "./base64url.js";
import {
  compactSignature,
  deriveContractAddress,
  extractPublicKeyFromAttestation,
  generateChallenge,
  isOnP256Curve,
} from "./utils.js";
import { SECP256R1_CURVE_ORDER } from "./constants.js";
import { ValidationError, WebAuthnError } from "./errors.js";

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

/** Generate a real P-256 keypair and return its raw uncompressed public key. */
async function generateRawP256(): Promise<Buffer> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  return Buffer.from(
    new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  );
}

const ES256_COSE_PREFIX = Buffer.from([
  0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20,
]);

/** Build a synthetic authenticatorData carrying `raw` as the attested COSE key. */
function makeAuthenticatorData(raw: Buffer, credIdLength = 16): Buffer {
  return Buffer.concat([
    Buffer.alloc(32, 0x11), // rpIdHash
    Buffer.from([0x45]), // flags (AT set)
    Buffer.alloc(4, 0), // signCount
    Buffer.alloc(16, 0x22), // aaguid
    Buffer.from([(credIdLength >> 8) & 0xff, credIdLength & 0xff]),
    Buffer.alloc(credIdLength, 0x33), // credentialId
    ES256_COSE_PREFIX,
    raw.subarray(1, 33), // x
    Buffer.from([0x22, 0x58, 0x20]), // -3: bytes(32)
    raw.subarray(33, 65), // y
  ]);
}

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

  it("extracts the COSE key from authenticatorData with verified structure", async () => {
    const raw = await generateRawP256();

    const extracted = await extractPublicKeyFromAttestation({
      clientDataJSON: "",
      attestationObject: "",
      authenticatorData: base64url.encode(makeAuthenticatorData(raw)),
    });
    expect(Buffer.from(extracted)).toEqual(raw);

    // Different credentialId lengths shift the offsets; extraction follows.
    const extracted64 = await extractPublicKeyFromAttestation({
      clientDataJSON: "",
      attestationObject: "",
      authenticatorData: base64url.encode(makeAuthenticatorData(raw, 64)),
    });
    expect(Buffer.from(extracted64)).toEqual(raw);
  });

  it("rejects authenticatorData whose COSE structure does not match instead of slicing garbage", async () => {
    const raw = await generateRawP256();
    const ad = makeAuthenticatorData(raw);
    // Corrupt the COSE algorithm byte (ES256 `-7` → something else): the old
    // fixed-offset parser would still happily slice x/y from a non-ES256 key.
    const corrupted = Buffer.from(ad);
    corrupted[55 + 16 + 4] = 0x27;

    await expect(
      extractPublicKeyFromAttestation({
        clientDataJSON: "",
        attestationObject: "",
        authenticatorData: base64url.encode(corrupted),
      })
    ).rejects.toBeInstanceOf(WebAuthnError);

    // Truncated: x/y would run past the end of the buffer.
    await expect(
      extractPublicKeyFromAttestation({
        clientDataJSON: "",
        attestationObject: "",
        authenticatorData: base64url.encode(ad.subarray(0, ad.length - 8)),
      })
    ).rejects.toBeInstanceOf(WebAuthnError);
  });

  it("rejects a structurally-valid key that is NOT on the P-256 curve", async () => {
    const raw = await generateRawP256();
    const offCurve = Buffer.from(raw);
    offCurve[64]! ^= 0x01; // tweak y: almost surely off-curve

    await expect(
      extractPublicKeyFromAttestation({
        clientDataJSON: "",
        attestationObject: "",
        publicKey: base64url.encode(offCurve),
        authenticatorData: base64url.encode(makeAuthenticatorData(offCurve)),
      })
    ).rejects.toBeInstanceOf(WebAuthnError);

    expect(isOnP256Curve(raw)).toBe(true);
    expect(isOnP256Curve(offCurve)).toBe(false);
  });

  it("throws when no source yields a key", async () => {
    await expect(
      extractPublicKeyFromAttestation({ clientDataJSON: "" })
    ).rejects.toBeInstanceOf(WebAuthnError);
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

  it("rejects structurally malformed DER instead of slicing blindly", () => {
    const good = der(Buffer.from([0x01]), Buffer.from([0x02]));

    // Too short / wrong tags.
    expect(() => compactSignature(Buffer.alloc(0))).toThrow(ValidationError);
    expect(() => compactSignature(Buffer.alloc(7, 0x02))).toThrow(
      ValidationError
    );
    const badSeq = Buffer.from(good);
    badSeq[0] = 0x31;
    expect(() => compactSignature(badSeq)).toThrow(/SEQUENCE/);

    // SEQUENCE length lies about the buffer span.
    const badLen = Buffer.from(good);
    badLen[1] = badLen[1]! + 4;
    expect(() => compactSignature(badLen)).toThrow(/span/);

    // r length overruns the buffer.
    const badR = Buffer.from(good);
    badR[3] = 0x30;
    expect(() => compactSignature(badR)).toThrow(ValidationError);

    // Trailing bytes after s.
    const trailing = Buffer.concat([good, Buffer.from([0x00])]);
    trailing[1] = trailing.length - 2; // keep the outer length consistent
    expect(() => compactSignature(trailing)).toThrow(ValidationError);

    // Long-form lengths are not valid for a P-256 signature.
    const longForm = Buffer.concat([
      Buffer.from([0x30, 0x81, good.length - 2]),
      good.subarray(2),
    ]);
    expect(() => compactSignature(longForm)).toThrow(/long-form/);
  });

  it("rejects r/s scalars outside [1, n-1]", () => {
    const zero = Buffer.from([0x00]);
    const one = Buffer.from([0x01]);
    expect(() => compactSignature(der(zero, one))).toThrow(/r out of/);
    expect(() => compactSignature(der(one, zero))).toThrow(/s out of/);
    expect(() =>
      compactSignature(der(toBuf32(SECP256R1_CURVE_ORDER), one))
    ).toThrow(/r out of/);
    expect(() =>
      compactSignature(der(one, toBuf32(SECP256R1_CURVE_ORDER + 1n)))
    ).toThrow(/s out of/);
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
