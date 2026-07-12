import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginExecutionError,
  PluginTransportError,
} from "@openzeppelin/relayer-plugin-channels";
import worker, { ApiKeyStore, extractMissingAccount, getClientIP } from "./index";
import { SERVICE_NAME } from "./constants";

// ---------------------------------------------------------------------------
// Mock the Channels plugin: a stub ChannelsClient whose two submit methods are
// controllable vi.fns, plus the two error classes the handler maps by instance.
// ---------------------------------------------------------------------------
const { submitSorobanTransaction, submitTransaction } = vi.hoisted(() => ({
  submitSorobanTransaction: vi.fn(),
  submitTransaction: vi.fn(),
}));

vi.mock("@openzeppelin/relayer-plugin-channels", () => {
  class PluginExecutionError extends Error {
    errorDetails?: { code?: unknown; details?: unknown };
    constructor(
      message: string,
      errorDetails?: { code?: unknown; details?: unknown }
    ) {
      super(message);
      this.name = "PluginExecutionError";
      this.errorDetails = errorDetails;
    }
  }
  class PluginTransportError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.name = "PluginTransportError";
      this.statusCode = statusCode;
    }
  }
  class ChannelsClient {
    constructor(_opts: unknown) {}
    submitSorobanTransaction = submitSorobanTransaction;
    submitTransaction = submitTransaction;
  }
  return { ChannelsClient, PluginExecutionError, PluginTransportError };
});

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------
const DO_KEY = "sk_do_relay_key_1234567";
const CLIENT_IP = "203.0.113.7";

// Fake per-IP DurableObjectNamespace. The stub's fetch answers /get (returns a
// key, or 502 when `key` is null) and /peek (presence). This exercises the
// worker's DO integration; the ApiKeyStore's own get-or-create logic is tested
// directly below.
function makeApiKeyDO(opts: { key?: string | null } = {}) {
  const key = opts.key === undefined ? DO_KEY : opts.key;
  const stub = {
    fetch: vi.fn(async (input: unknown) => {
      const url =
        typeof input === "string" ? input : (input as Request).url ?? "";
      if (url.includes("/peek")) {
        return new Response(JSON.stringify({ hasKey: key !== null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (key === null) return new Response("mint failed", { status: 502 });
      return new Response(key, { status: 200 });
    }),
  };
  return {
    idFromName: vi.fn((_ip: string) => "do-id"),
    get: vi.fn((_id: unknown) => stub),
    _stub: stub,
  };
}

function makeEnv(
  opts: { network?: "testnet" | "mainnet"; do?: ReturnType<typeof makeApiKeyDO> } = {}
) {
  const network = opts.network ?? "testnet";
  return {
    API_KEY_DO: opts.do ?? makeApiKeyDO(),
    NETWORK: network,
    RELAYER_BASE_URL:
      network === "mainnet"
        ? "https://channels.openzeppelin.com"
        : "https://channels.openzeppelin.com/testnet",
  } as any;
}

const ctx = () =>
  ({ waitUntil: vi.fn(), passThroughOnException: vi.fn() }) as any;

function makeRequest(
  path: string,
  opts: { method?: string; body?: unknown; ip?: string } = {}
) {
  const headers: Record<string, string> = {
    "CF-Connecting-IP": opts.ip ?? CLIENT_IP,
  };
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body =
      typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(`http://localhost${path}`, init);
}

function okJson(obj: unknown) {
  return { ok: true, status: 200, text: async () => JSON.stringify(obj) };
}
function okText(text: string) {
  return { ok: true, status: 200, text: async () => text };
}
function notOk(status = 500, text = "error") {
  return { ok: false, status, text: async () => text };
}

// Stub the GLOBAL fetch (used by generateApiKey's /gen call and friendbot).
function stubFetch(handlers: { gen?: () => unknown; friendbot?: () => unknown }) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/gen")) return handlers.gen?.() ?? okJson({});
    if (url.includes("friendbot")) return handlers.friendbot?.() ?? okText("ok");
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Fake DurableObjectState for direct ApiKeyStore tests.
function fakeState(initial?: string) {
  const store = new Map<string, unknown>();
  if (initial !== undefined) store.set("apiKey", initial);
  return {
    storage: {
      get: vi.fn(async (k: string) => store.get(k)),
      put: vi.fn(async (k: string, v: unknown) => {
        store.set(k, v);
      }),
    },
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    _store: store,
  } as any;
}

const G_ADDRESS = `G${"A".repeat(55)}`;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe("getClientIP", () => {
  it("uses CF-Connecting-IP", () => {
    expect(
      getClientIP(
        new Request("http://x", { headers: { "CF-Connecting-IP": "1.1.1.1" } })
      )
    ).toBe("1.1.1.1");
  });

  it("ignores spoofable X-Forwarded-For / X-Real-IP, falling back to 'unknown'", () => {
    expect(
      getClientIP(
        new Request("http://x", {
          headers: { "X-Forwarded-For": "2.2.2.2, 3.3.3.3" },
        })
      )
    ).toBe("unknown");
    expect(
      getClientIP(
        new Request("http://x", { headers: { "X-Real-IP": "4.4.4.4" } })
      )
    ).toBe("unknown");
    expect(getClientIP(new Request("http://x"))).toBe("unknown");
  });
});

describe("extractMissingAccount", () => {
  it("pulls the G-address out of a not-found error", () => {
    expect(extractMissingAccount(`Account not found: ${G_ADDRESS}`)).toBe(
      G_ADDRESS
    );
  });

  it("returns null when the message has no account", () => {
    expect(extractMissingAccount("some other failure")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
describe("GET /", () => {
  it("reports service and network", async () => {
    const res = await worker.fetch(makeRequest("/"), makeEnv(), ctx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      service: SERVICE_NAME,
      network: "testnet",
    });
  });
});

// ---------------------------------------------------------------------------
// POST / — mode validation
// ---------------------------------------------------------------------------
describe("POST / validation", () => {
  it("rejects a request with neither xdr nor func+auth (400)", async () => {
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: {} }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Request must include 'xdr' OR ('func' and 'auth')",
    });
    expect(submitSorobanTransaction).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("rejects a request with both xdr and func+auth (400)", async () => {
    const res = await worker.fetch(
      makeRequest("/", {
        method: "POST",
        body: { xdr: "AAA", func: "BBB", auth: ["CCC"] },
      }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Request must include 'xdr' OR ('func' and 'auth'), not both",
    });
  });

  it("rejects malformed JSON (400)", async () => {
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: "{not json" }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Invalid JSON body",
    });
  });
});

// ---------------------------------------------------------------------------
// POST / — submission paths
// ---------------------------------------------------------------------------
describe("POST / submission", () => {
  it("submits a Soroban transaction (func+auth) and returns the result", async () => {
    submitSorobanTransaction.mockResolvedValueOnce({
      transactionId: "tx1",
      hash: "h1",
      status: "pending",
    });

    const res = await worker.fetch(
      makeRequest("/", {
        method: "POST",
        body: { func: "FUNC", auth: ["A1", "A2"] },
      }),
      makeEnv(),
      ctx()
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: { transactionId: "tx1", hash: "h1", status: "pending" },
    });
    expect(submitSorobanTransaction).toHaveBeenCalledWith({
      func: "FUNC",
      auth: ["A1", "A2"],
    });
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("fee-bumps a signed transaction (xdr) and returns the result", async () => {
    submitTransaction.mockResolvedValueOnce({
      transactionId: "tx2",
      hash: "h2",
      status: "submitted",
    });

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { xdr: "XDR" } }),
      makeEnv(),
      ctx()
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: { transactionId: "tx2", hash: "h2", status: "submitted" },
    });
    expect(submitTransaction).toHaveBeenCalledWith({ xdr: "XDR" });
    expect(submitSorobanTransaction).not.toHaveBeenCalled();
  });

  it("maps PluginExecutionError to 400 with code/details", async () => {
    submitSorobanTransaction.mockRejectedValueOnce(
      new PluginExecutionError("exec failed", { code: "E123", details: "nope" })
    );

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv(),
      ctx()
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "exec failed",
      data: { code: "E123", details: "nope" },
    });
  });

  it("maps PluginTransportError to its status code", async () => {
    submitSorobanTransaction.mockRejectedValueOnce(
      new PluginTransportError("upstream unavailable", 502)
    );

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv(),
      ctx()
    );

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "upstream unavailable",
    });
  });

  it("maps an unknown error to 500", async () => {
    submitSorobanTransaction.mockRejectedValueOnce(new Error("boom"));

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv(),
      ctx()
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "boom",
    });
  });

  it("returns 500 when the API key cannot be obtained", async () => {
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv({ do: makeApiKeyDO({ key: null }) }),
      ctx()
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Could not obtain API key. Service may be misconfigured.",
    });
    expect(submitSorobanTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST / — testnet friendbot retry
// ---------------------------------------------------------------------------
describe("POST / testnet retry", () => {
  it("funds a missing channel account via friendbot then retries", async () => {
    const fetchMock = stubFetch({ friendbot: () => okText("funded") });
    submitSorobanTransaction
      .mockRejectedValueOnce(new Error(`Account not found: ${G_ADDRESS}`))
      .mockResolvedValueOnce({ transactionId: "tx3", hash: "h3", status: "ok" });

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv({ network: "testnet" }),
      ctx()
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: { transactionId: "tx3", hash: "h3", status: "ok" },
    });
    expect(submitSorobanTransaction).toHaveBeenCalledTimes(2);
    const friendbotCalls = fetchMock.mock.calls.filter(([u]) =>
      String(u).includes("friendbot")
    );
    expect(friendbotCalls).toHaveLength(1);
    expect(String(friendbotCalls[0][0])).toContain(G_ADDRESS);
  });

  it("does NOT retry a missing account on mainnet (no friendbot)", async () => {
    const fetchMock = stubFetch({});
    submitSorobanTransaction.mockRejectedValueOnce(
      new Error(`Account not found: ${G_ADDRESS}`)
    );

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv({ network: "mainnet" }),
      ctx()
    );

    expect(res.status).toBe(500);
    expect(submitSorobanTransaction).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).includes("friendbot"))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ApiKeyStore Durable Object — serialized get-or-create
// ---------------------------------------------------------------------------
describe("ApiKeyStore (Durable Object)", () => {
  it("returns the stored key without minting", async () => {
    const state = fakeState("sk_stored_key_1234567");
    const fetchMock = stubFetch({ gen: () => okJson({ apiKey: "sk_unused" }) });
    const store = new ApiKeyStore(state, makeEnv());

    const res = await store.fetch(new Request("https://do/get"));
    expect(res.status).toBe(200);
    expect((await res.text()).trim()).toBe("sk_stored_key_1234567");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/gen"))).toBe(
      false
    );
  });

  it("mints from /gen and stores when absent", async () => {
    const state = fakeState();
    stubFetch({ gen: () => okJson({ apiKey: "sk_minted_key_1234567" }) });
    const store = new ApiKeyStore(state, makeEnv());

    const res = await store.fetch(new Request("https://do/get"));
    expect(res.status).toBe(200);
    expect((await res.text()).trim()).toBe("sk_minted_key_1234567");
    expect(state._store.get("apiKey")).toBe("sk_minted_key_1234567");
  });

  it("returns 502 when minting fails", async () => {
    const state = fakeState();
    stubFetch({ gen: () => notOk(500, "denied") });
    const store = new ApiKeyStore(state, makeEnv());

    const res = await store.fetch(new Request("https://do/get"));
    expect(res.status).toBe(502);
    expect(state._store.get("apiKey")).toBeUndefined();
  });

  it("/peek reports presence without minting", async () => {
    const present = new ApiKeyStore(
      fakeState("sk_present_key_123456"),
      makeEnv()
    );
    const fetchMock = stubFetch({ gen: () => okJson({ apiKey: "sk_unused" }) });
    const res = await present.fetch(new Request("https://do/peek"));
    await expect(res.json()).resolves.toEqual({ hasKey: true });

    const absent = new ApiKeyStore(fakeState(), makeEnv());
    const res2 = await absent.fetch(new Request("https://do/peek"));
    await expect(res2.json()).resolves.toEqual({ hasKey: false });

    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/gen"))).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------
describe("GET /status", () => {
  it("returns client IP, network, and key presence", async () => {
    const res = await worker.fetch(makeRequest("/status"), makeEnv(), ctx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: {
        clientIP: CLIENT_IP,
        network: "testnet",
        hasKey: true,
      },
    });
  });
});
