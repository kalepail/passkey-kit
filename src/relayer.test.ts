import { describe, expect, it, vi } from "vitest";
import { PluginExecutionError } from "@openzeppelin/relayer-plugin-channels";
import { RelayerClient } from "./relayer.js";
import { ContractError, RelayerError, PasskeyKitErrorCode } from "./errors.js";

/** Build a RelayerClient with its private ChannelsClient replaced by a fake. */
function withChannels(fake: Record<string, unknown>): RelayerClient {
  const relayer = new RelayerClient({ baseUrl: "https://relayer.test", apiKey: "k" });
  (relayer as unknown as { channels: unknown }).channels = fake;
  return relayer;
}

describe("RelayerClient config", () => {
  it("throws when baseUrl or apiKey is missing", () => {
    expect(() => new RelayerClient({ baseUrl: "", apiKey: "k" })).toThrow(
      RelayerError
    );
    expect(() => new RelayerClient({ baseUrl: "u", apiKey: "" })).toThrow(
      RelayerError
    );
  });
});

describe("RelayerClient.send", () => {
  it("returns a success result for a confirmed submission", async () => {
    const submitSorobanTransaction = vi.fn(async () => ({
      transactionId: "tx-1",
      hash: "abc123",
      status: "confirmed",
    }));
    const relayer = withChannels({ submitSorobanTransaction });

    const result = await relayer.send("FUNC", ["AUTH"]);

    expect(result).toEqual({ success: true, hash: "abc123", transactionId: "tx-1" });
    expect(submitSorobanTransaction).toHaveBeenCalledWith({
      func: "FUNC",
      auth: ["AUTH"],
      skipWait: undefined,
      fundRelayerId: undefined,
    });
  });

  it("returns a typed failure when the relayer reports a failed status", async () => {
    const relayer = withChannels({
      submitSorobanTransaction: vi.fn(async () => ({
        transactionId: "tx-2",
        hash: "def",
        status: "failed",
      })),
    });

    const result = await relayer.send("FUNC", []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(RelayerError);
      expect(result.hash).toBe("def");
    }
  });

  it("reports a non-terminal (pending) status as a distinct non-success result", async () => {
    // A `skipWait` submit returns status "pending" with no hash yet. It must NOT
    // map to success:true (which a poll loop would treat as confirmed).
    const relayer = withChannels({
      submitSorobanTransaction: vi.fn(async () => ({
        transactionId: "tx-p",
        hash: "",
        status: "pending",
      })),
    });

    const result = await relayer.send("FUNC", [], { skipWait: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(RelayerError);
      expect(result.error.code).toBe(PasskeyKitErrorCode.RELAYER_PENDING);
      expect(result.error.context).toMatchObject({
        pending: true,
        status: "pending",
        transactionId: "tx-p",
      });
    }
  });

  it('never reports "unsuccessful" as success (substring must not match the allowlist)', async () => {
    const relayer = withChannels({
      submitSorobanTransaction: vi.fn(async () => ({
        transactionId: "tx-u",
        hash: "hu",
        status: "unsuccessful",
      })),
    });

    const result = await relayer.send("FUNC", []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(RelayerError);
      // Not in the failure denylist either, so it surfaces as non-terminal.
      expect(result.error.code).toBe(PasskeyKitErrorCode.RELAYER_PENDING);
    }
  });

  it("never throws on a PluginClientError — maps it to a RelayerError", async () => {
    const relayer = withChannels({
      submitSorobanTransaction: vi.fn(async () => {
        throw new PluginExecutionError("insufficient balance", {
          code: "FEE_LIMIT_EXCEEDED",
        });
      }),
    });

    const result = await relayer.send("FUNC", []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(RelayerError);
      expect(result.error.code).toBe(PasskeyKitErrorCode.RELAYER_REQUEST_FAILED);
      expect(result.error.context).toMatchObject({ category: "execution" });
    }
  });

  it("decodes an on-chain contract error surfaced by the relayer", async () => {
    const relayer = withChannels({
      submitSorobanTransaction: vi.fn(async () => {
        throw new PluginExecutionError("HostError: Error(Contract, #4)");
      }),
    });

    const result = await relayer.send("FUNC", []);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ContractError);
      expect((result.error as ContractError).contractErrorName).toBe(
        "SignerExpired"
      );
    }
  });
});

describe("RelayerClient.sendTransaction", () => {
  it("submits an envelope via submitTransaction", async () => {
    const submitTransaction = vi.fn(async () => ({
      transactionId: "tx-9",
      hash: "hh",
      status: "success",
    }));
    const relayer = withChannels({ submitTransaction });

    const result = await relayer.sendTransaction("ENVELOPE_XDR", { skipWait: true });

    expect(result.success).toBe(true);
    expect(submitTransaction).toHaveBeenCalledWith({
      xdr: "ENVELOPE_XDR",
      skipWait: true,
      fundRelayerId: undefined,
    });
  });
});
