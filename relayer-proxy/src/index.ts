/**
 * passkey-kit Relayer Proxy — Cloudflare Worker
 *
 * This Worker is deliberately fail-closed. It sponsors only approved
 * passkey-kit smart-wallet calls and wallet deployments, applies global and
 * per-IP limits before doing expensive work, verifies resource fees before
 * minting a per-IP Channels key, and reports success only for terminal-success
 * Channels statuses.
 */

import { Hono } from "hono";
import {
  ChannelsClient,
  PluginExecutionError,
  PluginTransportError,
} from "@openzeppelin/relayer-plugin-channels";
import {
  Account,
  Address,
  Contract,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { Api as RpcApi, Server as RpcServer } from "@stellar/stellar-sdk/rpc";
import {
  SERVICE_NAME,
  FRIENDBOT_URL,
  API_KEY_FIELD_NAMES,
  API_KEY_MIN_LENGTH,
  API_KEY_MAX_LENGTH,
  MISSING_ACCOUNT_PATTERN,
  TESTNET_RETRY_DURATION_MS,
  TESTNET_RETRY_BASE_DELAY_MS,
  TESTNET_RETRY_MAX_DELAY_MS,
  DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
  DEFAULT_RATE_LIMIT_PER_IP,
  DEFAULT_RATE_LIMIT_GLOBAL,
  DEFAULT_MAX_RESOURCE_FEE_STROOPS,
  DEFAULT_WALLET_FUNCTIONS,
  MAX_REQUEST_BODY_BYTES,
  SIMULATION_SOURCE,
  SUCCESS_STATUS,
  FAILURE_STATUS,
  IP_HEADERS,
  UNKNOWN_IP,
} from "./constants";

const DO_KEY = "apiKey";
const RATE_KEY = "rate";
const GLOBAL_RATE_LIMITER = "global";
const MAX_AUTH_ENTRIES = 8;

type SubmissionBody =
  | { mode: "xdr"; xdr: string }
  | { mode: "func"; func: string; auth: string[] };

interface RateState {
  windowStartedAt: number;
  count: number;
}

interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number = 400
  ) {
    super(message);
    this.name = "RequestError";
  }
}

const app = new Hono<{ Bindings: Env }>();

// Restrict browser callers to an explicit origin list. Requests without an
// Origin header (health checks/server-to-server callers) are still permitted.
app.use("*", async (c, next) => {
  const origin = c.req.header("Origin");
  if (origin && !csvSet(c.env.ALLOWED_ORIGINS).has(origin)) {
    return c.json({ success: false, error: "Origin is not allowed" }, 403);
  }

  if (c.req.method === "OPTIONS") {
    const response = new Response(null, { status: 204 });
    if (origin) setCorsHeaders(response.headers, origin);
    return response;
  }

  await next();
  if (origin) setCorsHeaders(c.res.headers, origin);
});

app.onError((error, c) => {
  console.error("Unhandled worker error:", error);
  return c.json({ success: false, error: "Internal server error" }, 500);
});

function setCorsHeaders(headers: Headers, origin: string): void {
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.append("Vary", "Origin");
}

function csvSet(value: string | undefined, lowercase = false): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => (lowercase ? item.toLowerCase() : item))
  );
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RequestError(`${name} must be a positive integer`, 500);
  }
  return parsed;
}

function maxResourceFee(env: Env): bigint {
  const raw = env.MAX_RESOURCE_FEE_STROOPS;
  try {
    const parsed = raw === undefined ? DEFAULT_MAX_RESOURCE_FEE_STROOPS : BigInt(raw);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new RequestError(
      "MAX_RESOURCE_FEE_STROOPS must be a non-negative integer",
      500
    );
  }
}

function networkPassphrase(env: Env): string {
  if (env.NETWORK === "testnet") return Networks.TESTNET;
  if (env.NETWORK === "mainnet") return Networks.PUBLIC;
  throw new RequestError("NETWORK must be testnet or mainnet", 500);
}

function configuredWasmHashes(env: Env): Set<string> {
  const hashes = csvSet(env.ALLOWED_WALLET_WASM_HASHES, true);
  for (const hash of hashes) {
    if (!/^[0-9a-f]{64}$/.test(hash)) {
      throw new RequestError(
        "ALLOWED_WALLET_WASM_HASHES contains an invalid hash",
        500
      );
    }
  }
  return hashes;
}

export function getClientIP(request: Request): string {
  return request.headers.get(IP_HEADERS.CF_CONNECTING_IP)?.trim() || UNKNOWN_IP;
}

function isValidApiKey(apiKey: string): boolean {
  const trimmed = apiKey.trim();
  return (
    trimmed.length >= API_KEY_MIN_LENGTH && trimmed.length <= API_KEY_MAX_LENGTH
  );
}

async function generateApiKey(env: Env): Promise<string | null> {
  try {
    const response = await fetch(`${env.RELAYER_BASE_URL}/gen`, { method: "GET" });
    const text = await response.text();

    if (response.ok) {
      try {
        const data = JSON.parse(text) as Record<string, unknown>;
        const apiKey = API_KEY_FIELD_NAMES.map((name) => data[name]).find(Boolean);
        if (typeof apiKey === "string") return apiKey;
        console.error("API key field not found in /gen response");
        return null;
      } catch {
        if (
          text &&
          text.length >= API_KEY_MIN_LENGTH &&
          text.length <= API_KEY_MAX_LENGTH
        ) {
          return text.trim();
        }
        console.error(`Could not parse /gen response (length ${text.length})`);
        return null;
      }
    }

    console.error(
      `Failed to generate API key: status ${response.status} (body length ${text.length})`
    );
    return null;
  } catch (error) {
    console.error("Error generating API key:", error);
    return null;
  }
}

/** Serialized per-IP API-key custody. `/peek` never mints. */
export class ApiKeyStore implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/peek") {
      const existing = await this.state.storage.get<string>(DO_KEY);
      return Response.json({ hasKey: !!existing && isValidApiKey(existing) });
    }

    const apiKey = await this.state.blockConcurrencyWhile(async () => {
      const existing = await this.state.storage.get<string>(DO_KEY);
      if (existing && isValidApiKey(existing)) return existing;
      const minted = await generateApiKey(this.env);
      if (!minted || !isValidApiKey(minted)) return null;
      await this.state.storage.put(DO_KEY, minted);
      return minted;
    });

    return apiKey
      ? new Response(apiKey, { status: 200 })
      : new Response("Could not mint API key", { status: 502 });
  }
}

/** Atomic fixed-window limiter used by one global and one per-IP DO instance. */
export class RequestRateLimiter implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit"));
    const windowMs = Number(url.searchParams.get("windowMs"));
    if (!Number.isSafeInteger(limit) || limit <= 0 || !Number.isSafeInteger(windowMs) || windowMs <= 0) {
      return Response.json({ error: "Invalid rate-limit configuration" }, { status: 500 });
    }

    const decision = await this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const stored = await this.state.storage.get<RateState>(RATE_KEY);
      const current =
        !stored || now - stored.windowStartedAt >= windowMs
          ? { windowStartedAt: now, count: 0 }
          : stored;

      if (current.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((current.windowStartedAt + windowMs - now) / 1000)
          ),
        } satisfies RateDecision;
      }

      current.count += 1;
      await this.state.storage.put(RATE_KEY, current);
      // Self-destruct one full window after this window expires, so per-IP
      // limiter objects don't accumulate storage forever under IP rotation.
      // Active traffic keeps pushing the alarm forward; by fire time the
      // stored window is long expired, so deletion never changes a decision.
      await this.state.storage.setAlarm(current.windowStartedAt + 2 * windowMs);
      return { allowed: true, retryAfterSeconds: 0 } satisfies RateDecision;
    });

    return Response.json(decision);
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

async function getApiKeyForIp(env: Env, ip: string): Promise<string | null> {
  const stub = env.API_KEY_DO.get(env.API_KEY_DO.idFromName(ip));
  const res = await stub.fetch("https://api-key-store/get");
  if (!res.ok) return null;
  const apiKey = (await res.text()).trim();
  return isValidApiKey(apiKey) ? apiKey : null;
}

async function rateDecision(
  env: Env,
  name: string,
  limit: number,
  windowMs: number
): Promise<RateDecision> {
  const stub = env.RATE_LIMIT_DO.get(env.RATE_LIMIT_DO.idFromName(name));
  const url = new URL("https://rate-limiter/check");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("windowMs", String(windowMs));
  const response = await stub.fetch(url.toString());
  if (!response.ok) throw new RequestError("Rate limiter is unavailable", 503);
  return response.json<RateDecision>();
}

async function enforceRateLimit(env: Env, ip: string): Promise<number | null> {
  const windowMs =
    positiveInteger(
      env.RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
      "RATE_LIMIT_WINDOW_SECONDS"
    ) * 1000;
  const perIp = positiveInteger(
    env.RATE_LIMIT_PER_IP,
    DEFAULT_RATE_LIMIT_PER_IP,
    "RATE_LIMIT_PER_IP"
  );
  const global = positiveInteger(
    env.RATE_LIMIT_GLOBAL,
    DEFAULT_RATE_LIMIT_GLOBAL,
    "RATE_LIMIT_GLOBAL"
  );

  const [globalDecision, ipDecision] = await Promise.all([
    rateDecision(env, GLOBAL_RATE_LIMITER, global, windowMs),
    rateDecision(env, `ip:${ip}`, perIp, windowMs),
  ]);
  if (globalDecision.allowed && ipDecision.allowed) return null;
  return Math.max(
    globalDecision.retryAfterSeconds,
    ipDecision.retryAfterSeconds
  );
}

function parseSubmissionBody(text: string): SubmissionBody {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RequestError("Invalid JSON body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError("Request body must be a JSON object");
  }

  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  const hasXdr = typeof body.xdr === "string" && body.xdr.length > 0;
  const hasFuncAuth =
    typeof body.func === "string" &&
    body.func.length > 0 &&
    Array.isArray(body.auth) &&
    body.auth.length > 0 &&
    body.auth.every((entry) => typeof entry === "string" && entry.length > 0);

  if (!hasXdr && !hasFuncAuth) {
    throw new RequestError("Request must include 'xdr' OR ('func' and 'auth')");
  }
  if (hasXdr && hasFuncAuth) {
    throw new RequestError(
      "Request must include 'xdr' OR ('func' and 'auth'), not both"
    );
  }
  if (hasXdr) {
    if (keys.some((key) => key !== "xdr")) {
      throw new RequestError("The xdr mode accepts only the 'xdr' field");
    }
    return { mode: "xdr", xdr: body.xdr as string };
  }
  if (keys.some((key) => key !== "func" && key !== "auth")) {
    throw new RequestError("The func mode accepts only 'func' and 'auth'");
  }
  if ((body.auth as string[]).length > MAX_AUTH_ENTRIES) {
    throw new RequestError(`At most ${MAX_AUTH_ENTRIES} auth entries are allowed`);
  }
  return { mode: "func", func: body.func as string, auth: body.auth as string[] };
}

async function walletContractIsAllowed(env: Env, contractId: string): Promise<boolean> {
  if (csvSet(env.ALLOWED_WALLET_CONTRACT_IDS).has(contractId)) return true;

  const hashes = configuredWasmHashes(env);
  if (hashes.size === 0) return false;
  if (!env.STELLAR_RPC_URL) {
    throw new RequestError("STELLAR_RPC_URL is required for wallet verification", 500);
  }

  try {
    const server = new RpcServer(env.STELLAR_RPC_URL);
    const response = await server.getLedgerEntries(new Contract(contractId).getFootprint());
    const entry = response.entries[0];
    if (!entry) return false;
    const executable = entry.val.contractData().val().instance().executable();
    if (executable.switch().name !== "contractExecutableWasm") return false;
    return hashes.has(Buffer.from(executable.wasmHash()).toString("hex").toLowerCase());
  } catch (error) {
    console.error("Wallet allowlist RPC verification failed:", error);
    throw new RequestError("Could not verify wallet contract", 503);
  }
}

function validateAuthorizedInvocation(
  invocation: xdr.SorobanAuthorizedInvocation,
  contractId: string
): void {
  const fn = invocation.function();
  if (fn.switch().name !== "sorobanAuthorizedFunctionTypeContractFn") {
    throw new RequestError("Auth entries may authorize only wallet contract calls", 403);
  }
  const args = fn.contractFn();
  const invokedContract = Address.fromScAddress(args.contractAddress()).toString();
  if (invokedContract !== contractId) {
    throw new RequestError("Auth entry targets a non-allowlisted contract", 403);
  }
  for (const child of invocation.subInvocations()) {
    validateAuthorizedInvocation(child, contractId);
  }
}

async function validateFuncSubmission(env: Env, body: Extract<SubmissionBody, { mode: "func" }>): Promise<void> {
  let func: xdr.HostFunction;
  let auth: xdr.SorobanAuthorizationEntry[];
  try {
    func = xdr.HostFunction.fromXDR(body.func, "base64");
    auth = body.auth.map((entry) =>
      xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64")
    );
  } catch {
    throw new RequestError("func/auth contains invalid XDR");
  }

  if (func.switch().name !== "hostFunctionTypeInvokeContract") {
    throw new RequestError("Only invokeContract host functions are allowed", 403);
  }
  const invoke = func.invokeContract();
  const contractId = Address.fromScAddress(invoke.contractAddress()).toString();
  if (!(await walletContractIsAllowed(env, contractId))) {
    throw new RequestError("Wallet contract is not allowlisted", 403);
  }

  const defaultFunctions = DEFAULT_WALLET_FUNCTIONS.join(",");
  const functions = csvSet(env.ALLOWED_WALLET_FUNCTIONS ?? defaultFunctions);
  const functionName = invoke.functionName().toString();
  if (!functions.has(functionName)) {
    throw new RequestError("Wallet function is not allowlisted", 403);
  }

  for (const entry of auth) {
    const credentials = entry.credentials();
    if (credentials.switch().name !== "sorobanCredentialsAddressV2") {
      throw new RequestError("Only address-bound V2 wallet credentials are allowed", 403);
    }
    const signer = Address.fromScAddress(credentials.addressV2().address()).toString();
    if (signer !== contractId) {
      throw new RequestError("Auth credential is not for the invoked wallet", 403);
    }
    validateAuthorizedInvocation(entry.rootInvocation(), contractId);
    const root = entry.rootInvocation().function().contractFn();
    if (!Buffer.from(root.toXDR()).equals(Buffer.from(invoke.toXDR()))) {
      throw new RequestError("Auth root invocation does not match func", 403);
    }
  }

  if (!env.STELLAR_RPC_URL) {
    throw new RequestError("STELLAR_RPC_URL is required for fee validation", 500);
  }
  const simulationTx = new TransactionBuilder(new Account(SIMULATION_SOURCE, "0"), {
    fee: "100",
    networkPassphrase: networkPassphrase(env),
  })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(30)
    .build();
  const simulation = await new RpcServer(env.STELLAR_RPC_URL).simulateTransaction(
    simulationTx
  );
  if (
    !RpcApi.isSimulationSuccess(simulation) ||
    RpcApi.isSimulationRestore(simulation)
  ) {
    throw new RequestError("Wallet invocation simulation failed", 400);
  }
  const resourceFee = BigInt(simulation.minResourceFee);
  if (resourceFee > maxResourceFee(env)) {
    throw new RequestError("Resource fee exceeds configured maximum", 413);
  }
}

function validateSourceSignature(transaction: Transaction): void {
  let source: Keypair;
  try {
    source = Keypair.fromPublicKey(transaction.source);
  } catch {
    throw new RequestError("Deploy transaction source must be a G-address", 403);
  }
  const hash = transaction.hash();
  const valid = transaction.signatures.some((signature) =>
    source.verify(hash, Buffer.from(signature.signature()))
  );
  if (!valid) {
    throw new RequestError("Deploy transaction lacks a valid source signature", 403);
  }
}

function validateXdrSubmission(env: Env, body: Extract<SubmissionBody, { mode: "xdr" }>): void {
  let transaction: Transaction;
  try {
    const decoded = TransactionBuilder.fromXDR(body.xdr, networkPassphrase(env));
    if (!(decoded instanceof Transaction)) {
      throw new Error("fee bump envelope");
    }
    transaction = decoded;
  } catch {
    throw new RequestError("xdr must be a signed transaction envelope");
  }

  if (transaction.operations.length !== 1) {
    throw new RequestError("Deploy transaction must contain exactly one operation", 403);
  }
  const allowedDeployers = csvSet(env.ALLOWED_DEPLOYER_ADDRESSES);
  if (!allowedDeployers.has(transaction.source)) {
    throw new RequestError("Deploy transaction source is not allowlisted", 403);
  }
  validateSourceSignature(transaction);

  const operation = transaction.operations[0];
  if (operation.type !== "invokeHostFunction") {
    throw new RequestError("Only invokeHostFunction deploy operations are allowed", 403);
  }
  if (operation.source && operation.source !== transaction.source) {
    throw new RequestError("Operation source must match transaction source", 403);
  }
  const func = (operation as Operation.InvokeHostFunction).func;
  if (func.switch().name !== "hostFunctionTypeCreateContractV2") {
    throw new RequestError("Only passkey-kit createContractV2 deploys are allowed", 403);
  }

  const deploy = func.createContractV2();
  const executable = deploy.executable();
  if (executable.switch().name !== "contractExecutableWasm") {
    throw new RequestError("Deploy executable must be approved WASM", 403);
  }
  const wasmHash = Buffer.from(executable.wasmHash()).toString("hex").toLowerCase();
  if (!configuredWasmHashes(env).has(wasmHash)) {
    throw new RequestError("Deploy WASM hash is not allowlisted", 403);
  }

  const preimage = deploy.contractIdPreimage();
  if (preimage.switch().name !== "contractIdPreimageFromAddress") {
    throw new RequestError("Deploy must use an address contract-id preimage", 403);
  }
  const deployer = Address.fromScAddress(preimage.fromAddress().address()).toString();
  if (deployer !== transaction.source || !allowedDeployers.has(deployer)) {
    throw new RequestError("Deploy preimage address is not the allowlisted source", 403);
  }

  let resourceFee: bigint;
  try {
    const envelope = transaction.toEnvelope();
    if (envelope.switch().name !== "envelopeTypeTx") throw new Error("not v1");
    const ext = envelope.v1().tx().ext();
    if (ext.switch() !== 1) throw new Error("missing Soroban data");
    resourceFee = ext.sorobanData().resourceFee().toBigInt();
  } catch {
    throw new RequestError("Deploy transaction is missing Soroban resource data");
  }
  if (resourceFee > maxResourceFee(env)) {
    throw new RequestError("Resource fee exceeds configured maximum", 413);
  }
}

async function validateSubmission(env: Env, body: SubmissionBody): Promise<void> {
  if (body.mode === "xdr") validateXdrSubmission(env, body);
  else await validateFuncSubmission(env, body);
}

function createClient(env: Env, apiKey: string): ChannelsClient {
  return new ChannelsClient({ baseUrl: env.RELAYER_BASE_URL, apiKey });
}

export function extractMissingAccount(errorMessage: string): string | null {
  const match = errorMessage.match(MISSING_ACCOUNT_PATTERN);
  return match ? match[1] : null;
}

async function fundWithFriendbot(account: string): Promise<boolean> {
  try {
    return (
      await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(account)}`)
    ).ok;
  } catch (error) {
    console.error("Friendbot funding failed:", error);
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.get("/", (c) =>
  c.json({ status: "ok", service: SERVICE_NAME, network: c.env.NETWORK })
);

app.post("/", async (c) => {
  try {
    const ip = getClientIP(c.req.raw);
    if (ip === UNKNOWN_IP) {
      return c.json(
        { success: false, error: "Cloudflare client IP is required" },
        400
      );
    }

    const retryAfter = await enforceRateLimit(c.env, ip);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      return c.json({ success: false, error: "Rate limit exceeded" }, 429);
    }

    const contentLength = Number(c.req.header("Content-Length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
      return c.json({ success: false, error: "Request body is too large" }, 413);
    }
    const text = await c.req.text();
    if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BODY_BYTES) {
      return c.json({ success: false, error: "Request body is too large" }, 413);
    }

    const body = parseSubmissionBody(text);
    await validateSubmission(c.env, body);

    // Invariant: mint only after parsing, allowlist checks, signature
    // checks, fee validation, simulation, and rate limiting all passed.
    const apiKey = await getApiKeyForIp(c.env, ip);
    if (!apiKey) {
      return c.json(
        { success: false, error: "Could not obtain API key. Service may be misconfigured." },
        500
      );
    }

    const client = createClient(c.env, apiKey);
    const isTestnet = c.env.NETWORK === "testnet";
    const deadline = isTestnet ? Date.now() + TESTNET_RETRY_DURATION_MS : 0;
    const fundedAccounts = new Set<string>();
    let retryDelay = positiveInteger(
      c.env.TESTNET_RETRY_BASE_DELAY_MS,
      TESTNET_RETRY_BASE_DELAY_MS,
      "TESTNET_RETRY_BASE_DELAY_MS"
    );
    const maxRetryDelay = positiveInteger(
      c.env.TESTNET_RETRY_MAX_DELAY_MS,
      TESTNET_RETRY_MAX_DELAY_MS,
      "TESTNET_RETRY_MAX_DELAY_MS"
    );

    while (true) {
      try {
        const result =
          body.mode === "xdr"
            ? await client.submitTransaction({ xdr: body.xdr })
            : await client.submitSorobanTransaction({
                func: body.func,
                auth: body.auth,
              });
        const data = {
          transactionId: result.transactionId,
          hash: result.hash,
          status: result.status,
        };
        const status = result.status ?? "";
        if (SUCCESS_STATUS.test(status)) {
          return c.json({ success: true, data });
        }
        if (FAILURE_STATUS.test(status)) {
          return c.json(
            { success: false, error: `Relayer reported status "${result.status}"`, data },
            502
          );
        }
        return c.json(
          {
            success: false,
            error: `Relayer status "${result.status ?? "unknown"}" is not terminal (pending)`,
            data,
          },
          202
        );
      } catch (submitError) {
        const message =
          submitError instanceof Error ? submitError.message : String(submitError);
        const missingAccount = extractMissingAccount(message);
        const timeRemaining = deadline - Date.now();
        if (!missingAccount || !isTestnet || timeRemaining <= 0) throw submitError;

        if (!fundedAccounts.has(missingAccount)) {
          const funded = await fundWithFriendbot(missingAccount);
          if (funded) fundedAccounts.add(missingAccount);
        }
        await sleep(Math.min(retryDelay, timeRemaining));
        retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
      }
    }
  } catch (error) {
    if (error instanceof RequestError) {
      return c.json(
        { success: false, error: error.message },
        error.status as 400 | 403 | 413 | 500 | 503
      );
    }
    console.error("Relayer submission error:", error);
    if (error instanceof PluginExecutionError) {
      return c.json(
        {
          success: false,
          error: error.message,
          data: {
            code: error.errorDetails?.code,
            details: error.errorDetails?.details,
          },
        },
        400
      );
    }
    if (error instanceof PluginTransportError) {
      const status = error.statusCode || 500;
      return c.json(
        { success: false, error: error.message },
        status as 400 | 401 | 403 | 404 | 500 | 502 | 503
      );
    }
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Relayer request failed",
      },
      500
    );
  }
});

app.get("/status", async (c) => {
  try {
    const ip = getClientIP(c.req.raw);
    if (ip === UNKNOWN_IP) {
      return c.json(
        { success: false, error: "Cloudflare client IP is required" },
        400
      );
    }
    const stub = c.env.API_KEY_DO.get(c.env.API_KEY_DO.idFromName(ip));
    const res = await stub.fetch("https://api-key-store/peek");
    const peek = (res.ok ? await res.json() : { hasKey: false }) as {
      hasKey: boolean;
    };
    return c.json({
      success: true,
      data: { clientIP: ip, network: c.env.NETWORK, hasKey: peek.hasKey },
    });
  } catch (error) {
    console.error("Status endpoint failed:", error);
    return c.json({ success: false, error: "Could not read status" }, 500);
  }
});

export default { fetch: app.fetch };
