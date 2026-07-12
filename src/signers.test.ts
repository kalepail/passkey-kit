import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import base64url from "./base64url.js";
import {
  Ed25519Signer,
  PasskeySigner,
  PolicySigner,
  type SignerContext,
} from "./signers.js";

const POLICY = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";

/** Build a minimal DER ECDSA signature for (r, s) = (1, 2). */
function derSig(): Buffer {
  return Buffer.from([0x30, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02]);
}

describe("Ed25519Signer", () => {
  it("produces an Ed25519 (key, value) pair with a verifiable signature", () => {
    const keypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7));
    const signer = new Ed25519Signer(keypair);
    const payload = Buffer.alloc(32, 9);

    const { key, value } = signer.sign(payload);

    expect(key.tag).toBe("Ed25519");
    expect(Buffer.from(key.values[0])).toEqual(
      Buffer.from(keypair.rawPublicKey())
    );
    expect(value?.tag).toBe("Ed25519");
    const signature = (value as { values: readonly [Buffer] }).values[0];
    expect(signature).toHaveLength(64);
    expect(keypair.verify(payload, Buffer.from(signature))).toBe(true);
  });

  it("fromSecret rejects an invalid secret key", () => {
    expect(() => Ed25519Signer.fromSecret("not-a-secret")).toThrow();
  });
});

describe("PolicySigner", () => {
  it("produces a Policy key with a void value", () => {
    const { key, value } = new PolicySigner(POLICY).sign();
    expect(key).toEqual({ tag: "Policy", values: [POLICY] });
    expect(value).toEqual({ tag: "Policy", values: undefined });
  });
});

describe("PasskeySigner", () => {
  function fakeAuthenticator(keyId: string) {
    return {
      startAuthentication: vi.fn(async () => ({
        id: keyId,
        rawId: keyId,
        type: "public-key" as const,
        clientExtensionResults: {},
        response: {
          authenticatorData: base64url.encode(Buffer.alloc(37, 1)),
          clientDataJSON: base64url.encode(Buffer.from("{}")),
          signature: base64url.encode(derSig()),
        },
      })),
    };
  }

  it("runs the authentication ceremony and returns a Secp256r1 pair", async () => {
    const keyId = base64url.encode(Buffer.alloc(16, 0xab));
    const authenticator = fakeAuthenticator(keyId);
    const context: SignerContext = { webAuthn: authenticator, rpId: "example.com" };

    const signer = new PasskeySigner(keyId);
    const { key, value } = await signer.sign(Buffer.alloc(32, 5), context);

    expect(key.tag).toBe("Secp256r1");
    expect(Buffer.from(key.values[0])).toEqual(base64url.toBuffer(keyId));
    expect(value?.tag).toBe("Secp256r1");
    const sig = (value as { values: readonly [{ signature: Buffer }] }).values[0];
    expect(sig.signature).toHaveLength(64);

    // Requested a specific credential -> allowCredentials must be set.
    const optionsJSON = authenticator.startAuthentication.mock.calls[0]![0]
      .optionsJSON;
    expect(optionsJSON.allowCredentials).toEqual([
      { id: keyId, type: "public-key" },
    ]);
    expect(optionsJSON.rpId).toBe("example.com");
  });

  it('omits allowCredentials for a discoverable ("any") credential', async () => {
    const keyId = base64url.encode(Buffer.alloc(16, 0xcd));
    const authenticator = fakeAuthenticator(keyId);
    const context: SignerContext = { webAuthn: authenticator };

    await new PasskeySigner("any").sign(Buffer.alloc(32, 1), context);

    const optionsJSON = authenticator.startAuthentication.mock.calls[0]![0]
      .optionsJSON;
    expect(optionsJSON.allowCredentials).toBeUndefined();
  });

  it("falls back to the context default keyId when none is provided", async () => {
    const defaultKeyId = base64url.encode(Buffer.alloc(16, 0x11));
    const authenticator = fakeAuthenticator(defaultKeyId);
    const context: SignerContext = { webAuthn: authenticator, defaultKeyId };

    await new PasskeySigner().sign(Buffer.alloc(32, 1), context);

    const optionsJSON = authenticator.startAuthentication.mock.calls[0]![0]
      .optionsJSON;
    expect(optionsJSON.allowCredentials).toEqual([
      { id: defaultKeyId, type: "public-key" },
    ]);
  });
});
