import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PluginExecutionError,
  PluginTransportError,
} from "@openzeppelin/relayer-plugin-channels";
import {
  Account,
  Address,
  Keypair,
  Networks,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Server as RpcServer } from "@stellar/stellar-sdk/rpc";
import worker, {
  ApiKeyStore,
  RequestRateLimiter,
  extractMissingAccount,
  getClientIP,
} from "./index";
import { SERVICE_NAME } from "./constants";

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
      this.errorDetails = errorDetails;
    }
  }
  class PluginTransportError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  class ChannelsClient {
    submitSorobanTransaction = submitSorobanTransaction;
    submitTransaction = submitTransaction;
  }
  return { ChannelsClient, PluginExecutionError, PluginTransportError };
});

const DO_KEY = "sk_do_relay_key_1234567";
const CLIENT_IP = "203.0.113.7";
const WALLET = Address.contract(Buffer.alloc(32, 1)).toString();
const OTHER_CONTRACT = Address.contract(Buffer.alloc(32, 2)).toString();
const DEPLOYER_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const DEPLOYER = DEPLOYER_KEYPAIR.publicKey();
const WALLET_WASM_HASH = "84".repeat(32);
const G_ADDRESS = `G${"A".repeat(55)}`;

function makeApiKeyDO(opts: { key?: string | null; onGet?: () => void } = {}) {
  const key = opts.key === undefined ? DO_KEY : opts.key;
  const stub = {
    fetch: vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/peek")) return Response.json({ hasKey: key !== null });
      opts.onGet?.();
      return key === null
        ? new Response("mint failed", { status: 502 })
        : new Response(key);
    }),
  };
  return {
    idFromName: vi.fn(() => "api-key-id"),
    get: vi.fn(() => stub),
    _stub: stub,
  };
}

function makeRateLimitDO(decision = { allowed: true, retryAfterSeconds: 0 }) {
  const stub = { fetch: vi.fn(async () => Response.json(decision)) };
  return {
    idFromName: vi.fn((name: string) => name),
    get: vi.fn(() => stub),
    _stub: stub,
  };
}

function makeEnv(
  opts: {
    network?: "testnet" | "mainnet";
    apiKeyDO?: ReturnType<typeof makeApiKeyDO>;
    rateLimitDO?: ReturnType<typeof makeRateLimitDO>;
    allowedContracts?: string;
    allowedWasmHashes?: string;
    origins?: string;
    maxFee?: string;
  } = {}
) {
  const network = opts.network ?? "testnet";
  return {
    API_KEY_DO: opts.apiKeyDO ?? makeApiKeyDO(),
    RATE_LIMIT_DO: opts.rateLimitDO ?? makeRateLimitDO(),
    NETWORK: network,
    RELAYER_BASE_URL:
      network === "mainnet"
        ? "https://channels.openzeppelin.com"
        : "https://channels.openzeppelin.com/testnet",
    STELLAR_RPC_URL: "https://rpc.example",
    ALLOWED_ORIGINS: opts.origins ?? "https://demo.example",
    ALLOWED_WALLET_CONTRACT_IDS: opts.allowedContracts ?? WALLET,
    ALLOWED_WALLET_WASM_HASHES:
      opts.allowedWasmHashes === undefined
        ? WALLET_WASM_HASH
        : opts.allowedWasmHashes,
    ALLOWED_WALLET_FUNCTIONS: "add_signer,update_signer,remove_signer,upgrade",
    ALLOWED_DEPLOYER_ADDRESSES: DEPLOYER,
    MAX_RESOURCE_FEE_STROOPS: opts.maxFee ?? "1000000",
    RATE_LIMIT_WINDOW_SECONDS: "60",
    RATE_LIMIT_PER_IP: "10",
    RATE_LIMIT_GLOBAL: "100",
    TESTNET_RETRY_BASE_DELAY_MS: "1",
    TESTNET_RETRY_MAX_DELAY_MS: "2",
  } as any;
}

const ctx = () =>
  ({ waitUntil: vi.fn(), passThroughOnException: vi.fn() }) as any;

function makeRequest(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    ip?: string | null;
    origin?: string;
  } = {}
) {
  const headers: Record<string, string> = {};
  if (opts.ip !== null) headers["CF-Connecting-IP"] = opts.ip ?? CLIENT_IP;
  if (opts.origin) headers.Origin = opts.origin;
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body =
      typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  return new Request(`http://localhost${path}`, init);
}

function contractFn(contractId: string, functionName: string) {
  return new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId).toScAddress(),
    functionName,
    args: [xdr.ScVal.scvVoid()],
  });
}

function walletSubmission(
  contractId = WALLET,
  opts: {
    /** Emit legacy V1 address credentials instead of V2. */
    v1Credentials?: boolean;
    /** Credential address, when different from the invoked wallet. */
    credentialAddress?: string;
    /** Invoked wallet function name. */
    functionName?: string;
    /** Auth root invocation target/function, when different from func. */
    rootContract?: string;
    rootFunctionName?: string;
    /** Add a sub-invocation targeting this contract. */
    subInvocationContract?: string;
  } = {}
) {
  const functionName = opts.functionName ?? "add_signer";
  const invoke = contractFn(contractId, functionName);
  const func = xdr.HostFunction.hostFunctionTypeInvokeContract(invoke);
  const addressCredentials = new xdr.SorobanAddressCredentials({
    address: Address.fromString(
      opts.credentialAddress ?? contractId
    ).toScAddress(),
    nonce: xdr.Int64.fromString("1"),
    signatureExpirationLedger: 100,
    signature: xdr.ScVal.scvVoid(),
  });
  const credentials = opts.v1Credentials
    ? xdr.SorobanCredentials.sorobanCredentialsAddress(addressCredentials)
    : xdr.SorobanCredentials.sorobanCredentialsAddressV2(addressCredentials);
  const rootArgs =
    opts.rootContract || opts.rootFunctionName
      ? contractFn(
          opts.rootContract ?? contractId,
          opts.rootFunctionName ?? functionName
        )
      : invoke;
  const subInvocations = opts.subInvocationContract
    ? [
        new xdr.SorobanAuthorizedInvocation({
          function:
            xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
              contractFn(opts.subInvocationContract, "add_signer")
            ),
          subInvocations: [],
        }),
      ]
    : [];
  const rootInvocation = new xdr.SorobanAuthorizedInvocation({
    function:
      xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        rootArgs
      ),
    subInvocations,
  });
  const auth = new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation,
  });
  return {
    func: func.toXDR("base64"),
    auth: [auth.toXDR("base64")],
  };
}

function deployXdr(
  resourceFee = 5_000n,
  wasmHash = WALLET_WASM_HASH,
  opts: {
    /** Keypair to sign with (null = leave unsigned). */
    signer?: Keypair | null;
    /** Operation-level source, when different from the transaction source. */
    opSource?: string;
    /** Contract-id preimage deployer address. */
    preimageAddress?: string;
  } = {}
) {
  const transaction = new TransactionBuilder(new Account(DEPLOYER, "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(opts.preimageAddress ?? DEPLOYER),
        wasmHash: Buffer.from(wasmHash, "hex"),
        salt: Buffer.alloc(32, 4),
        constructorArgs: [xdr.ScVal.scvVoid()],
        ...(opts.opSource ? { source: opts.opSource } : {}),
      })
    )
    .setSorobanData(
      new SorobanDataBuilder().setResourceFee(resourceFee).build()
    )
    .setTimeout(30)
    .build();
  const signer = opts.signer === undefined ? DEPLOYER_KEYPAIR : opts.signer;
  if (signer) transaction.sign(signer);
  return transaction.toXDR();
}

function disallowedOperationXdr() {
  const transaction = new TransactionBuilder(new Account(DEPLOYER, "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.bumpSequence({ bumpTo: "2" }))
    .setTimeout(30)
    .build();
  transaction.sign(DEPLOYER_KEYPAIR);
  return transaction.toXDR();
}

function fakeState(initial?: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    storage: {
      get: vi.fn(async (key: string) => store.get(key)),
      put: vi.fn(async (key: string, value: unknown) => store.set(key, value)),
      setAlarm: vi.fn(async () => undefined),
      deleteAll: vi.fn(async () => store.clear()),
    },
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    _store: store,
  } as any;
}

function stubFetch(handlers: { gen?: () => Response; friendbot?: () => Response }) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.includes("/gen")) return handlers.gen?.() ?? Response.json({});
    if (url.includes("friendbot")) {
      return handlers.friendbot?.() ?? new Response("ok");
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.spyOn(RpcServer.prototype, "simulateTransaction").mockResolvedValue({
    transactionData: {},
    minResourceFee: "5000",
  } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("pure helpers", () => {
  it("uses only CF-Connecting-IP", () => {
    expect(
      getClientIP(
        new Request("http://x", { headers: { "CF-Connecting-IP": "1.1.1.1" } })
      )
    ).toBe("1.1.1.1");
    expect(
      getClientIP(
        new Request("http://x", { headers: { "X-Forwarded-For": "2.2.2.2" } })
      )
    ).toBe("unknown");
  });

  it("extracts missing channel accounts", () => {
    expect(extractMissingAccount(`Account not found: ${G_ADDRESS}`)).toBe(
      G_ADDRESS
    );
    expect(extractMissingAccount("other failure")).toBeNull();
  });
});

describe("CORS", () => {
  it("echoes an allowed origin and never emits wildcard CORS", async () => {
    const res = await worker.fetch(
      makeRequest("/", { origin: "https://demo.example" }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://demo.example"
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("rejects disallowed origins, including preflight", async () => {
    const res = await worker.fetch(
      makeRequest("/", {
        method: "OPTIONS",
        origin: "https://evil.example",
      }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("GET /", () => {
  it("reports service and network", async () => {
    const res = await worker.fetch(makeRequest("/"), makeEnv(), ctx());
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      service: SERVICE_NAME,
      network: "testnet",
    });
  });
});

describe("POST / validation and ordering", () => {
  it("rejects malformed JSON before touching the API-key DO", async () => {
    const apiKeyDO = makeApiKeyDO();
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: "{not json" }),
      makeEnv({ apiKeyDO }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect(apiKeyDO.get).not.toHaveBeenCalled();
  });

  it("rejects a non-allowlisted wallet invoke before key minting", async () => {
    const apiKeyDO = makeApiKeyDO();
    const res = await worker.fetch(
      makeRequest("/", {
        method: "POST",
        body: walletSubmission(OTHER_CONTRACT),
      }),
      makeEnv({
        apiKeyDO,
        allowedContracts: WALLET,
        allowedWasmHashes: "",
      }),
      ctx()
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Wallet contract is not allowlisted",
    });
    expect(apiKeyDO.get).not.toHaveBeenCalled();
    expect(submitSorobanTransaction).not.toHaveBeenCalled();
  });

  it("mints only after fee simulation and all validation pass", async () => {
    const order: string[] = [];
    vi.mocked(RpcServer.prototype.simulateTransaction).mockImplementationOnce(
      async () => {
        order.push("validated");
        return { transactionData: {}, minResourceFee: "5000" } as any;
      }
    );
    const apiKeyDO = makeApiKeyDO({ onGet: () => order.push("mint") });
    submitSorobanTransaction.mockResolvedValueOnce({
      transactionId: "tx1",
      hash: "h1",
      status: "confirmed",
    });
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: walletSubmission() }),
      makeEnv({ apiKeyDO }),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(order).toEqual(["validated", "mint"]);
  });

  it("rejects an over-ceiling deploy resource fee before key minting", async () => {
    const apiKeyDO = makeApiKeyDO();
    const res = await worker.fetch(
      makeRequest("/", {
        method: "POST",
        body: { xdr: deployXdr(10_001n) },
      }),
      makeEnv({ apiKeyDO, maxFee: "10000" }),
      ctx()
    );
    expect(res.status).toBe(413);
    expect(apiKeyDO.get).not.toHaveBeenCalled();
  });

  it("rejects non-deploy transaction operations before key minting", async () => {
    const apiKeyDO = makeApiKeyDO();
    const res = await worker.fetch(
      makeRequest("/", {
        method: "POST",
        body: { xdr: disallowedOperationXdr() },
      }),
      makeEnv({ apiKeyDO }),
      ctx()
    );
    expect(res.status).toBe(403);
    expect(apiKeyDO.get).not.toHaveBeenCalled();
  });

  it("rejects a deploy whose WASM hash is not allowlisted", async () => {
    const apiKeyDO = makeApiKeyDO();
    const res = await worker.fetch(
      makeRequest("/", {
        method: "POST",
        body: { xdr: deployXdr(5_000n, "99".repeat(32)) },
      }),
      makeEnv({ apiKeyDO }),
      ctx()
    );
    expect(res.status).toBe(403);
    expect(apiKeyDO.get).not.toHaveBeenCalled();
  });

  it("enforces the request limiter before validation or key minting", async () => {
    const apiKeyDO = makeApiKeyDO();
    const rateLimitDO = makeRateLimitDO({
      allowed: false,
      retryAfterSeconds: 30,
    });
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: walletSubmission() }),
      makeEnv({ apiKeyDO, rateLimitDO }),
      ctx()
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(apiKeyDO.get).not.toHaveBeenCalled();
    expect(RpcServer.prototype.simulateTransaction).not.toHaveBeenCalled();
  });

  it("rejects missing Cloudflare IP without using a shared fallback", async () => {
    const apiKeyDO = makeApiKeyDO();
    const res = await worker.fetch(
      makeRequest("/", {
        method: "POST",
        body: walletSubmission(),
        ip: null,
      }),
      makeEnv({ apiKeyDO }),
      ctx()
    );
    expect(res.status).toBe(400);
    expect(apiKeyDO.idFromName).not.toHaveBeenCalled();
  });
});

describe("POST / func-path negative validation", () => {
  async function submit(
    body: unknown,
    envOpts: Parameters<typeof makeEnv>[0] = {}
  ) {
    const apiKeyDO = makeApiKeyDO();
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body }),
      makeEnv({ apiKeyDO, ...envOpts }),
      ctx()
    );
    return { res, apiKeyDO };
  }

  async function expectRejected(
    res: Response,
    apiKeyDO: ReturnType<typeof makeApiKeyDO>,
    status: number,
    error: string
  ) {
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toEqual({ success: false, error });
    expect(apiKeyDO.get).not.toHaveBeenCalled();
    expect(submitSorobanTransaction).not.toHaveBeenCalled();
  }

  it("rejects legacy V1 (non-address-bound) credentials", async () => {
    const { res, apiKeyDO } = await submit(
      walletSubmission(WALLET, { v1Credentials: true })
    );
    await expectRejected(
      res,
      apiKeyDO,
      403,
      "Only address-bound V2 wallet credentials are allowed"
    );
  });

  it("rejects a credential address that is not the invoked wallet", async () => {
    const { res, apiKeyDO } = await submit(
      walletSubmission(WALLET, { credentialAddress: OTHER_CONTRACT })
    );
    await expectRejected(
      res,
      apiKeyDO,
      403,
      "Auth credential is not for the invoked wallet"
    );
  });

  it("rejects an auth root invocation targeting a different contract", async () => {
    const { res, apiKeyDO } = await submit(
      walletSubmission(WALLET, { rootContract: OTHER_CONTRACT })
    );
    await expectRejected(
      res,
      apiKeyDO,
      403,
      "Auth entry targets a non-allowlisted contract"
    );
  });

  it("rejects a sub-invocation to a non-wallet contract", async () => {
    const { res, apiKeyDO } = await submit(
      walletSubmission(WALLET, { subInvocationContract: OTHER_CONTRACT })
    );
    await expectRejected(
      res,
      apiKeyDO,
      403,
      "Auth entry targets a non-allowlisted contract"
    );
  });

  it("rejects an auth root invocation that does not byte-match func", async () => {
    const { res, apiKeyDO } = await submit(
      walletSubmission(WALLET, { rootFunctionName: "remove_signer" })
    );
    await expectRejected(
      res,
      apiKeyDO,
      403,
      "Auth root invocation does not match func"
    );
  });

  it("rejects a non-allowlisted wallet function", async () => {
    const { res, apiKeyDO } = await submit(
      walletSubmission(WALLET, { functionName: "transfer" })
    );
    await expectRejected(
      res,
      apiKeyDO,
      403,
      "Wallet function is not allowlisted"
    );
  });

  it("rejects a simulated resource fee above the ceiling before minting", async () => {
    const { res, apiKeyDO } = await submit(walletSubmission(), {
      maxFee: "1000",
    });
    await expectRejected(
      res,
      apiKeyDO,
      413,
      "Resource fee exceeds configured maximum"
    );
  });

  it("rejects when the wallet invocation simulation fails", async () => {
    vi.mocked(RpcServer.prototype.simulateTransaction).mockResolvedValueOnce({
      error: "host function failed",
    } as any);
    const { res, apiKeyDO } = await submit(walletSubmission());
    await expectRejected(
      res,
      apiKeyDO,
      400,
      "Wallet invocation simulation failed"
    );
  });

  it("rejects when the simulation requires a state restore", async () => {
    vi.mocked(RpcServer.prototype.simulateTransaction).mockResolvedValueOnce({
      transactionData: {},
      minResourceFee: "5000",
      restorePreamble: { transactionData: {}, minResourceFee: "1" },
    } as any);
    const { res, apiKeyDO } = await submit(walletSubmission());
    await expectRejected(
      res,
      apiKeyDO,
      400,
      "Wallet invocation simulation failed"
    );
  });
});

describe("POST / deploy (xdr) negative validation", () => {
  const WRONG_KEYPAIR = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));

  async function submitXdr(xdrValue: string) {
    const apiKeyDO = makeApiKeyDO();
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { xdr: xdrValue } }),
      makeEnv({ apiKeyDO }),
      ctx()
    );
    return { res, apiKeyDO };
  }

  it.each([
    ["signed by a non-source key", WRONG_KEYPAIR],
    ["unsigned", null],
  ])("rejects a deploy %s", async (_label, signer) => {
    const { res, apiKeyDO } = await submitXdr(
      deployXdr(5_000n, WALLET_WASM_HASH, { signer })
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Deploy transaction lacks a valid source signature",
    });
    expect(apiKeyDO.get).not.toHaveBeenCalled();
    expect(submitTransaction).not.toHaveBeenCalled();
  });

  it("rejects an operation source that differs from the transaction source", async () => {
    const { res, apiKeyDO } = await submitXdr(
      deployXdr(5_000n, WALLET_WASM_HASH, {
        opSource: WRONG_KEYPAIR.publicKey(),
      })
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Operation source must match transaction source",
    });
    expect(apiKeyDO.get).not.toHaveBeenCalled();
  });

  it("rejects a contract-id preimage deployer that is not the source", async () => {
    const { res, apiKeyDO } = await submitXdr(
      deployXdr(5_000n, WALLET_WASM_HASH, {
        preimageAddress: WRONG_KEYPAIR.publicKey(),
      })
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "Deploy preimage address is not the allowlisted source",
    });
    expect(apiKeyDO.get).not.toHaveBeenCalled();
  });
});

describe("POST / terminal status gating", () => {
  it("returns success only for a terminal-success status", async () => {
    submitSorobanTransaction.mockResolvedValueOnce({
      transactionId: "tx1",
      hash: "h1",
      status: "confirmed",
    });
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: walletSubmission() }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
  });

  it.each(["pending", "mystery-status", "unsuccessful", "unconfirmed"])(
    "does not report non-terminal status %s as success",
    async (status) => {
      submitSorobanTransaction.mockResolvedValueOnce({
        transactionId: "tx-p",
        hash: null,
        status,
      });
      const res = await worker.fetch(
        makeRequest("/", { method: "POST", body: walletSubmission() }),
        makeEnv(),
        ctx()
      );
      expect(res.status).toBe(202);
      await expect(res.json()).resolves.toMatchObject({
        success: false,
        data: { status },
      });
    }
  );

  it("reports terminal failures as non-success", async () => {
    submitSorobanTransaction.mockResolvedValueOnce({
      transactionId: "tx-f",
      hash: "hf",
      status: "failed",
    });
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: walletSubmission() }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ success: false });
  });
});

describe("POST / submission and errors", () => {
  it("submits a validated wallet invocation", async () => {
    const body = walletSubmission();
    submitSorobanTransaction.mockResolvedValueOnce({
      transactionId: "tx1",
      hash: "h1",
      status: "success",
    });
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(submitSorobanTransaction).toHaveBeenCalledWith(body);
  });

  it("submits a validated wallet deployment envelope", async () => {
    const xdrValue = deployXdr();
    submitTransaction.mockResolvedValueOnce({
      transactionId: "tx2",
      hash: "h2",
      status: "confirmed",
    });
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: { xdr: xdrValue } }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(submitTransaction).toHaveBeenCalledWith({ xdr: xdrValue });
  });

  it("maps plugin execution and transport errors", async () => {
    submitSorobanTransaction.mockRejectedValueOnce(
      new PluginExecutionError("exec failed", { code: "E123", details: "nope" })
    );
    const execution = await worker.fetch(
      makeRequest("/", { method: "POST", body: walletSubmission() }),
      makeEnv(),
      ctx()
    );
    expect(execution.status).toBe(400);

    submitSorobanTransaction.mockRejectedValueOnce(
      new PluginTransportError("upstream unavailable", 502)
    );
    const transport = await worker.fetch(
      makeRequest("/", { method: "POST", body: walletSubmission() }),
      makeEnv(),
      ctx()
    );
    expect(transport.status).toBe(502);
  });

  it("backs off before retrying a funded testnet channel account", async () => {
    const fetchMock = stubFetch({ friendbot: () => new Response("funded") });
    submitSorobanTransaction
      .mockRejectedValueOnce(new Error(`Account not found: ${G_ADDRESS}`))
      .mockResolvedValueOnce({ transactionId: "tx3", hash: "h3", status: "success" });
    const started = Date.now();
    const res = await worker.fetch(
      makeRequest("/", { method: "POST", body: walletSubmission() }),
      makeEnv(),
      ctx()
    );
    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1);
    expect(submitSorobanTransaction).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("friendbot"))).toBe(true);
  });
});

describe("RequestRateLimiter", () => {
  it("atomically rejects requests over the configured fixed-window limit", async () => {
    const limiter = new RequestRateLimiter(fakeState());
    const url = "https://do/check?limit=1&windowMs=60000";
    await expect((await limiter.fetch(new Request(url))).json()).resolves.toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    await expect((await limiter.fetch(new Request(url))).json()).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("schedules a cleanup alarm one window past expiry on every recorded request", async () => {
    const state = fakeState();
    const limiter = new RequestRateLimiter(state);
    await limiter.fetch(new Request("https://do/check?limit=5&windowMs=60000"));
    const stored = state._store.get("rate") as { windowStartedAt: number };
    expect(state.storage.setAlarm).toHaveBeenCalledWith(
      stored.windowStartedAt + 2 * 60000
    );
  });

  it("alarm() deletes all limiter storage so idle per-IP objects are reclaimed", async () => {
    const state = fakeState({ rate: { windowStartedAt: 0, count: 3 } });
    const limiter = new RequestRateLimiter(state);
    await limiter.alarm();
    expect(state.storage.deleteAll).toHaveBeenCalled();
    expect(state._store.size).toBe(0);
  });
});

describe("ApiKeyStore", () => {
  it("returns a stored key without minting", async () => {
    const state = fakeState({ apiKey: "sk_stored_key_1234567" });
    const fetchMock = stubFetch({});
    const store = new ApiKeyStore(state, makeEnv());
    const res = await store.fetch(new Request("https://do/get"));
    expect((await res.text()).trim()).toBe("sk_stored_key_1234567");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints only on get and /peek never mints", async () => {
    const state = fakeState();
    const fetchMock = stubFetch({
      gen: () => Response.json({ apiKey: "sk_minted_key_1234567" }),
    });
    const store = new ApiKeyStore(state, makeEnv());
    await expect((await store.fetch(new Request("https://do/peek"))).json()).resolves.toEqual({
      hasKey: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const res = await store.fetch(new Request("https://do/get"));
    expect((await res.text()).trim()).toBe("sk_minted_key_1234567");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("GET /status", () => {
  it("returns client IP, network, and key presence", async () => {
    const res = await worker.fetch(makeRequest("/status"), makeEnv(), ctx());
    await expect(res.json()).resolves.toEqual({
      success: true,
      data: { clientIP: CLIENT_IP, network: "testnet", hasKey: true },
    });
  });
});
