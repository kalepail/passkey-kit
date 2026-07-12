import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PluginExecutionError,
  PluginTransportError,
} from "@openzeppelin/relayer-plugin-channels";
import worker, { extractMissingAccount, getClientIP } from "./index";
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
const SEEDED_KEY = "sk_seededapikey123456";
const CLIENT_IP = "203.0.113.7";
const KV_KEY = `api-key:${CLIENT_IP}`;

function createKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k);
    }),
  };
}

type FakeKV = ReturnType<typeof createKV>;

function makeEnv(opts: { kv?: FakeKV; network?: "testnet" | "mainnet" } = {}) {
  const network = opts.network ?? "testnet";
  return {
    API_KEYS: opts.kv ?? createKV(),
    NETWORK: network,
    RELAYER_BASE_URL:
      network === "mainnet"
        ? "https://channels.openzeppelin.com"
        : "https://channels.openzeppelin.com/testnet",
  } as any;
}

function seededKV() {
  return createKV({
    [KV_KEY]: JSON.stringify({ apiKey: SEEDED_KEY, createdAt: 1000 }),
  });
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

function stubFetch(handlers: {
  gen?: () => unknown;
  friendbot?: () => unknown;
}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/gen")) return handlers.gen?.() ?? okJson({});
    if (url.includes("friendbot")) return handlers.friendbot?.() ?? okText("ok");
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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
  it("prefers CF-Connecting-IP, then X-Forwarded-For, then X-Real-IP", () => {
    expect(
      getClientIP(
        new Request("http://x", { headers: { "CF-Connecting-IP": "1.1.1.1" } })
      )
    ).toBe("1.1.1.1");
    expect(
      getClientIP(
        new Request("http://x", {
          headers: { "X-Forwarded-For": "2.2.2.2, 3.3.3.3" },
        })
      )
    ).toBe("2.2.2.2");
    expect(
      getClientIP(
        new Request("http://x", { headers: { "X-Real-IP": "4.4.4.4" } })
      )
    ).toBe("4.4.4.4");
  });

  it("falls back to 'unknown' with no IP headers", () => {
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
      makeEnv({ kv: seededKV() }),
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
      makeEnv({ kv: seededKV() }),
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
      makeEnv({ kv: seededKV() }),
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
    stubFetch({});
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
      makeEnv({ kv: seededKV() }),
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
      makeEnv({ kv: seededKV() }),
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
      makeEnv({ kv: seededKV() }),
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
      makeEnv({ kv: seededKV() }),
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
      makeEnv({ kv: seededKV() }),
      ctx()
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "boom",
    });
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
      makeEnv({ kv: seededKV(), network: "testnet" }),
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
      makeEnv({ kv: seededKV(), network: "mainnet" }),
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
// Per-IP API key lifecycle
// ---------------------------------------------------------------------------
describe("API key lifecycle", () => {
  it("mints a key from the Relayer /gen endpoint when none exists", async () => {
    const kv = createKV();
    const fetchMock = stubFetch({
      gen: () => okJson({ apiKey: "sk_generatedkey1234" }),
    });
    submitSorobanTransaction.mockResolvedValueOnce({
      transactionId: "tx",
      hash: "h",
      status: "ok",
    });

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv({ kv }),
      ctx()
    );

    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/gen"))).toBe(
      true
    );
    const stored = JSON.parse(kv.store.get(KV_KEY)!);
    expect(stored.apiKey).toBe("sk_generatedkey1234");
    expect(typeof stored.createdAt).toBe("number");
  });

  it("returns 500 when a key cannot be minted", async () => {
    stubFetch({ gen: () => notOk(500, "denied") });

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv({ kv: createKV() }),
      ctx()
    );

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Could not obtain API key. Service may be misconfigured.",
    });
    expect(submitSorobanTransaction).not.toHaveBeenCalled();
  });

  it("migrates a legacy plain-text KV value to the JSON record", async () => {
    const legacyKey = "sk_plaintextkey12345";
    const kv = createKV({ [KV_KEY]: legacyKey });
    stubFetch({});
    submitSorobanTransaction.mockResolvedValueOnce({
      transactionId: "tx",
      hash: "h",
      status: "ok",
    });

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv({ kv }),
      ctx()
    );

    expect(res.status).toBe(200);
    // Reused the legacy key (no /gen call) and rewrote it as a JSON record.
    const stored = JSON.parse(kv.store.get(KV_KEY)!);
    expect(stored.apiKey).toBe(legacyKey);
    expect(typeof stored.createdAt).toBe("number");
  });

  it("migrates a legacy JSON-string KV value to the JSON record", async () => {
    const legacyKey = "sk_jsonstringkey1234";
    const kv = createKV({ [KV_KEY]: JSON.stringify(legacyKey) });
    stubFetch({});
    submitSorobanTransaction.mockResolvedValueOnce({
      transactionId: "tx",
      hash: "h",
      status: "ok",
    });

    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { func: "F", auth: ["A"] } }),
      makeEnv({ kv }),
      ctx()
    );

    expect(res.status).toBe(200);
    const stored = JSON.parse(kv.store.get(KV_KEY)!);
    expect(stored.apiKey).toBe(legacyKey);
  });
});

// ---------------------------------------------------------------------------
// GET /status
// ---------------------------------------------------------------------------
describe("GET /status", () => {
  it("returns client IP, network, and key presence", async () => {
    const res = await worker.fetch(
      makeRequest("/status"),
      makeEnv({ kv: seededKV() }),
      ctx()
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: {
        clientIP: CLIENT_IP,
        network: "testnet",
        hasKey: true,
        keyCreatedAt: 1000,
      },
    });
  });
});
