import { describe, expect, it, vi } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import type { Spec as ContractSpec } from "@stellar/stellar-sdk/contract";
import { Client as PasskeyClient } from "passkey-kit-sdk";
import { SignerManager, type SignerManagerDeps } from "./signer-manager.js";
import { SignerKey, SignerStore } from "../types.js";
import { WalletNotConnectedError } from "../errors.js";
import base64url from "../base64url.js";

const TESTNET = "Test SDF Network ; September 2015";
const CONTRACT = "CAXCIOHU357VIEDAWOU6YZUL3IU3CDFLCHA6O4PT2VDICDX4PNGSVZDL";

function realSpec(): ContractSpec {
  return (
    new PasskeyClient({
      contractId: CONTRACT,
      networkPassphrase: TESTNET,
      rpcUrl: "https://rpc.example",
    }) as unknown as { spec: ContractSpec }
  ).spec;
}

function makeDeps(overrides: Partial<SignerManagerDeps> = {}) {
  const wallet = {
    spec: realSpec(),
    options: { contractId: CONTRACT },
    add_signer: vi.fn(async () => "AT_ADD"),
    update_signer: vi.fn(async () => "AT_UPDATE"),
    remove_signer: vi.fn(async () => "AT_REMOVE"),
  };
  const rpc = {
    getContractData: vi.fn(async () => {
      throw new Error("not found");
    }),
  };
  const deps: SignerManagerDeps = {
    networkPassphrase: TESTNET,
    timeoutInSeconds: 30,
    rpc: rpc as never,
    getWallet: () => wallet as never,
    getContractId: () => CONTRACT,
    getSignerContext: () => ({ webAuthn: { startAuthentication: vi.fn() } as never }),
    calculateExpiration: vi.fn(async () => 100),
    ...overrides,
  };
  return { deps, wallet, rpc };
}

describe("SignerManager signer writes", () => {
  it("addEd25519 calls wallet.add_signer with the encoded Ed25519 signer", async () => {
    const { deps, wallet } = makeDeps();
    const manager = new SignerManager(deps);
    const pk = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();

    const result = await manager.addEd25519(pk, undefined, SignerStore.Persistent);

    expect(result).toBe("AT_ADD");
    expect(wallet.add_signer).toHaveBeenCalledTimes(1);
    const [{ signer }, opts] = wallet.add_signer.mock.calls[0]!;
    expect(signer.tag).toBe("Ed25519");
    expect(signer.values[3]).toEqual({ tag: "Persistent", values: undefined });
    expect(opts).toEqual({ timeoutInSeconds: 30 });
  });

  it("addSecp256r1 encodes keyId/publicKey and expiration/limits", async () => {
    const { deps, wallet } = makeDeps();
    const manager = new SignerManager(deps);
    const keyId = base64url.encode(Buffer.alloc(16, 1));
    const publicKey = base64url.encode(Buffer.alloc(65, 4));

    await manager.addSecp256r1(keyId, publicKey, undefined, SignerStore.Temporary, 777);

    const [{ signer }] = wallet.add_signer.mock.calls[0]!;
    expect(signer.tag).toBe("Secp256r1");
    expect(signer.values[2]).toEqual([777]); // SignerExpiration
    expect(signer.values[3]).toEqual([undefined]); // unlimited SignerLimits
    expect(signer.values[4]).toEqual({ tag: "Temporary", values: undefined });
  });

  it("remove calls wallet.remove_signer with the encoded key", async () => {
    const { deps, wallet } = makeDeps();
    const manager = new SignerManager(deps);

    await manager.remove(SignerKey.Ed25519(
      Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5)).publicKey()
    ));

    expect(wallet.remove_signer).toHaveBeenCalledTimes(1);
    const [{ signer_key }] = wallet.remove_signer.mock.calls[0]!;
    expect(signer_key.tag).toBe("Ed25519");
  });

  it("throws WalletNotConnectedError when no wallet is connected", () => {
    const { deps } = makeDeps({ getWallet: () => undefined });
    const manager = new SignerManager(deps);
    expect(() =>
      manager.addPolicy(CONTRACT, undefined, SignerStore.Persistent)
    ).toThrow(WalletNotConnectedError);
  });
});

describe("SignerManager.sign", () => {
  it("signs the transaction's auth entries against the connected contract", async () => {
    const { deps } = makeDeps();
    const manager = new SignerManager(deps);
    const signAuthEntries = vi.fn(async () => {});
    const txn = { signAuthEntries } as never;

    const returned = await manager.sign(txn, { sign: vi.fn() });

    expect(returned).toBe(txn);
    expect(signAuthEntries).toHaveBeenCalledTimes(1);
    expect(signAuthEntries.mock.calls[0]![0].address).toBe(CONTRACT);
  });
});

describe("SignerManager.getSigner", () => {
  it("returns null when the signer entry is absent in both durabilities", async () => {
    const { deps, rpc } = makeDeps();
    const manager = new SignerManager(deps);

    const result = await manager.getSigner(
      SignerKey.Secp256r1(base64url.encode(Buffer.alloc(16, 9)))
    );

    expect(result).toBeNull();
    expect(rpc.getContractData).toHaveBeenCalledTimes(2); // temporary + persistent
  });
});
