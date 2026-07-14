/**
 * `connectWallet` resolution + verification behavior:
 *
 * - A transport error on the derived-address instance read PROPAGATES —
 *   it must never be misread as not-found and fall through to the
 *   storage/indexer resolution.
 * - A failed opt-in `verifyWasmHash` leaves the kit disconnected, so a
 *   subsequent `sign` cannot operate on the rejected contract.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Networks, xdr } from "@stellar/stellar-sdk";
import type { Spec as ContractSpec } from "@stellar/stellar-sdk/contract";
import { Client as PasskeyClient, type SignerVal } from "passkey-kit-sdk";
import { PasskeyKit } from "./kit.js";
import { WalletOwnershipError } from "./errors.js";
import { SIGNER_VAL_UDT } from "./kit/auth-payload.js";
import base64url from "./base64url.js";

const WASM_HASH = "ab".repeat(32);
const KEY_ID = Buffer.alloc(16, 7);
const KEY_ID_B64 = base64url.encode(KEY_ID);
const INDEXED_WALLET = "CC2R2H3DTXS7OCNV3FTNPAZYIRCY2L2OTBG5FZWJV63HXQ35WB2T2NWJ";

function makeKit(): PasskeyKit {
  return new PasskeyKit({
    rpcUrl: "https://rpc.example",
    networkPassphrase: Networks.TESTNET,
    walletWasmHash: WASM_HASH,
    WebAuthn: {
      startRegistration: vi.fn(),
      startAuthentication: vi.fn(),
    } as never,
  });
}

/** A ledger entry whose contractData().val() decodes to a live SignerVal. */
function signerEntry() {
  const spec = (
    new PasskeyClient({
      contractId: INDEXED_WALLET,
      networkPassphrase: Networks.TESTNET,
      rpcUrl: "https://rpc.example",
    }) as unknown as { spec: ContractSpec }
  ).spec;
  const signerVal: SignerVal = {
    tag: "Secp256r1",
    values: [
      Buffer.concat([Buffer.from([0x04]), Buffer.alloc(64, 0xc1)]),
      [undefined],
      [undefined],
    ],
  };
  const scVal = spec.nativeToScVal(signerVal, SIGNER_VAL_UDT);
  return { val: { contractData: () => ({ val: () => scVal }) } };
}

/** An instance-shaped entry for the bare "does the instance exist" probe. */
function instanceEntry() {
  return { val: { contractData: () => ({ val: () => xdr.ScVal.scvVoid() }) } };
}

/** Fake `getContractData` result carrying a WASM executable hash. */
function instanceWithWasm(hashHex: string) {
  return {
    val: {
      contractData: () => ({
        val: () => ({
          instance: () => ({
            executable: () => ({
              switch: () => ({ name: "contractExecutableWasm" }),
              wasmHash: () => Buffer.from(hashHex, "hex"),
            }),
          }),
        }),
      }),
    },
  };
}

describe("connectWallet address resolution", () => {
  let kit: PasskeyKit;

  beforeEach(() => {
    kit = makeKit();
  });

  it("propagates a transport error on the derivation read — no indexer fallthrough", async () => {
    vi.spyOn(kit.rpc, "getLedgerEntries").mockRejectedValue(
      new Error("429 too many requests")
    );
    const getContractId = vi.fn(async () => INDEXED_WALLET);

    await expect(
      kit.connectWallet({ keyId: KEY_ID_B64, getContractId })
    ).rejects.toThrow("429");

    // The canonical derivation was never abandoned for untrusted sources.
    expect(getContractId).not.toHaveBeenCalled();
    expect(kit.wallet).toBeUndefined();
    expect(kit.keyId).toBeUndefined();
  });

  it("falls through to the indexer only on an authoritative not-found", async () => {
    const getLedgerEntries = vi
      .spyOn(kit.rpc, "getLedgerEntries")
      // 1) derived-address instance probe: genuine not-found
      .mockResolvedValueOnce({ entries: [] } as never)
      // 2) ownership check on the indexer-resolved wallet (temporary durability)
      .mockResolvedValueOnce({ entries: [signerEntry()] } as never);
    const getContractId = vi.fn(async () => INDEXED_WALLET);

    const result = await kit.connectWallet({ keyId: KEY_ID_B64, getContractId });

    expect(getContractId).toHaveBeenCalledWith(KEY_ID_B64);
    expect(result.contractId).toBe(INDEXED_WALLET);
    expect(kit.contractId).toBe(INDEXED_WALLET);
    expect(getLedgerEntries).toHaveBeenCalledTimes(2);
  });

  it("connects via the deterministic derivation when the instance exists", async () => {
    vi.spyOn(kit.rpc, "getLedgerEntries")
      // 1) derived-address instance probe: found
      .mockResolvedValueOnce({ entries: [instanceEntry()] } as never)
      // 2) ownership check (temporary durability): found
      .mockResolvedValueOnce({ entries: [signerEntry()] } as never);
    const getContractId = vi.fn(async () => INDEXED_WALLET);

    const result = await kit.connectWallet({ keyId: KEY_ID_B64, getContractId });

    expect(getContractId).not.toHaveBeenCalled();
    // The derived address, not the indexer answer.
    expect(result.contractId).not.toBe(INDEXED_WALLET);
    expect(result.contractId).toMatch(/^C/);
  });

  it("disconnects on an ownership mismatch (keyId not a signer)", async () => {
    vi.spyOn(kit.rpc, "getLedgerEntries")
      .mockResolvedValueOnce({ entries: [instanceEntry()] } as never) // instance
      .mockResolvedValueOnce({ entries: [] } as never) // signer: temporary
      .mockResolvedValueOnce({ entries: [] } as never); // signer: persistent

    await expect(
      kit.connectWallet({ keyId: KEY_ID_B64 })
    ).rejects.toBeInstanceOf(WalletOwnershipError);
    expect(kit.wallet).toBeUndefined();
    expect(kit.keyId).toBeUndefined();
  });
});

describe("connectWallet verifyWasmHash", () => {
  let kit: PasskeyKit;

  beforeEach(() => {
    kit = makeKit();
    vi.spyOn(kit.rpc, "getLedgerEntries")
      .mockResolvedValueOnce({ entries: [instanceEntry()] } as never) // instance
      .mockResolvedValueOnce({ entries: [signerEntry()] } as never); // signer
  });

  it("clears wallet/keyId when the WASM hash does not match", async () => {
    vi.spyOn(kit.rpc, "getContractData").mockResolvedValue(
      instanceWithWasm("cd".repeat(32)) as never
    );

    await expect(
      kit.connectWallet({ keyId: KEY_ID_B64, verifyWasmHash: true })
    ).rejects.toBeInstanceOf(WalletOwnershipError);

    // The rejected contract must NOT stay connected (a later sign() would
    // silently target it).
    expect(kit.wallet).toBeUndefined();
    expect(kit.keyId).toBeUndefined();
    expect(kit.contractId).toBeUndefined();
  });

  it("clears wallet/keyId when the hash read itself fails", async () => {
    vi.spyOn(kit.rpc, "getContractData").mockRejectedValue(
      new Error("503 upstream timeout")
    );

    await expect(
      kit.connectWallet({ keyId: KEY_ID_B64, verifyWasmHash: true })
    ).rejects.toThrow("503");
    expect(kit.wallet).toBeUndefined();
    expect(kit.keyId).toBeUndefined();
  });

  it("stays connected when the WASM hash matches", async () => {
    vi.spyOn(kit.rpc, "getContractData").mockResolvedValue(
      instanceWithWasm(WASM_HASH) as never
    );

    const result = await kit.connectWallet({
      keyId: KEY_ID_B64,
      verifyWasmHash: true,
    });

    expect(kit.contractId).toBe(result.contractId);
    expect(kit.keyId).toBe(KEY_ID_B64);
  });
});
