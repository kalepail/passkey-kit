# passkey-kit relayer-proxy

A Cloudflare Worker that fronts the [OpenZeppelin Relayer Channels](https://docs.openzeppelin.com/relayer/stellar)
service so the browser can submit fee-sponsored transactions with **zero
secrets in the bundle**. It mints and caches one Relayer API key per client IP,
so `PasskeyKit`/`PasskeyServer` never ship a relayer key to the client.

This replaces passkey-kit's old defect of inlining `VITE_relayerApiKey` into the
demo's client JS (audit #597/#598).

## How it works

- **Keyless per-IP key minting.** On the first request from an IP the worker
  calls the Relayer's unauthenticated `GET {RELAYER_BASE_URL}/gen` endpoint,
  and caches the returned key in KV under `api-key:<ip>` (indefinitely — the
  Relayer resets usage limits every 24h on its side). Client IP is taken from
  `CF-Connecting-IP`, then `X-Forwarded-For`, then `X-Real-IP`.
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
- KV binding `API_KEYS` (one namespace per network). The committed ids are
  placeholders — provision real ones before deploying:

```sh
wrangler kv namespace create API_KEYS            # testnet id -> [[kv_namespaces]]
wrangler kv namespace create API_KEYS            # mainnet id -> [[env.production.kv_namespaces]]
```

No secrets are needed; the worker mints Relayer keys itself.

## Develop / test

```sh
cd relayer-proxy
pnpm install --ignore-workspace   # or: npm install
pnpm test                          # vitest — worker unit tests
pnpm typecheck                     # tsc --noEmit
pnpm dev                           # wrangler dev (local)
```

The tests mock `@openzeppelin/relayer-plugin-channels` and KV, and cover: IP
extraction, mode validation, both submission paths, the three error mappings,
testnet-vs-mainnet retry behavior, and the per-IP key lifecycle (mint / reuse /
legacy-format migration).

## Deploy

> Deploys are orchestrator-gated (not run from the services todo).

```sh
pnpm deploy               # testnet: wrangler deploy
pnpm deploy:production    # mainnet: wrangler deploy --env production
```

Relayer keys for live verification can be generated at
`{RELAYER_BASE_URL}/gen` (testnet: `https://channels.openzeppelin.com/testnet/gen`).
