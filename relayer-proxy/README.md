# passkey-kit relayer-proxy

A Cloudflare Worker that fronts the [OpenZeppelin Relayer Channels](https://docs.openzeppelin.com/relayer/stellar)
service so the browser can submit fee-sponsored transactions with **zero
secrets in the bundle**. It mints and caches one Relayer API key per client IP,
so `PasskeyKit`/`PasskeyServer` never ship a relayer key to the client.

This replaces passkey-kit's old defect of inlining `VITE_relayerApiKey` into the
demo's client JS.

## How it works

- **Keyless per-IP key minting.** On the first request from an IP the worker
  calls the Relayer's unauthenticated `GET {RELAYER_BASE_URL}/gen` endpoint and
  stores the returned key. Custody lives in a **per-IP Durable Object**
  (`ApiKeyStore`, one instance per `CF-Connecting-IP`): its `blockConcurrencyWhile`
  serializes get-or-create, so N concurrent first-requests from one IP mint at
  most ONE key — the atomic get-or-create that KV cannot provide (no CAS). The
  key persists indefinitely; the Relayer resets usage limits every 24h.
- **Client IP** is taken ONLY from `CF-Connecting-IP` (always set at the CF
  edge, unspoofable). `X-Forwarded-For` / `X-Real-IP` are client-controlled and
  deliberately not trusted for key custody.
- **Two submission modes** (`POST /`):
  - `{ func, auth }` → `submitSorobanTransaction` — Relayer builds the tx with
    channel accounts (Address credentials: transfers, wallet ops).
  - `{ xdr }` → `submitTransaction` — Relayer fee-bumps an already-signed tx
    (source-account auth: deploys).
  Exactly one of the two must be present (400 otherwise).
- **Error mapping**: `PluginExecutionError` → 400 `{error, data:{code,details}}`;
  `PluginTransportError` → its `statusCode`; malformed JSON → 400; anything else
  → 500. Success → `{ success: true, data: { transactionId, hash, status } }`.
- **Testnet Friendbot retry**: if the Relayer reports a missing channel account
  (after a testnet reset), the worker funds it via Friendbot and retries for up
  to 5 minutes. Mainnet never retries (no Friendbot).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | health: `{ status, service, network }` |
| POST | `/` | submit: `{ func, auth } \| { xdr }` |
| GET | `/status` | client IP, network, whether a key is cached |

## Config

`wrangler.toml`:

- Testnet (default): `NETWORK=testnet`, `RELAYER_BASE_URL=https://channels.openzeppelin.com/testnet`.
- Mainnet (`[env.production]`): `NETWORK=mainnet`, `RELAYER_BASE_URL=https://channels.openzeppelin.com`.
- Durable Object binding `API_KEY_DO` → class `ApiKeyStore` (+ a `[[migrations]]`
  entry), one per environment. No namespace id to provision — the class is bound
  directly, and the DO is created on first use.

No secrets are needed; the worker mints Relayer keys itself.

## Develop / test

```sh
cd relayer-proxy
pnpm install --ignore-workspace   # or: npm install
pnpm test                          # vitest — worker unit tests
pnpm typecheck                     # tsc --noEmit
pnpm dev                           # wrangler dev (local)
```

The tests mock `@openzeppelin/relayer-plugin-channels` and the DO namespace, and
cover: IP extraction (CF-Connecting-IP only), mode validation, both submission
paths, the three error mappings, testnet-vs-mainnet retry behavior, and the
`ApiKeyStore` DO get-or-create logic (returns stored / mints from `/gen` /
502-on-mint-failure / `/peek`).

## Deploy

> Deploys are orchestrator-gated (not run from the services todo).

```sh
pnpm deploy               # testnet: wrangler deploy
pnpm deploy:production    # mainnet: wrangler deploy --env production
```

Relayer keys for live verification can be generated at
`{RELAYER_BASE_URL}/gen` (testnet: `https://channels.openzeppelin.com/testnet/gen`).
