# passkey-kit relayer-proxy

A fail-closed Cloudflare Worker in front of OpenZeppelin Relayer Channels. The
browser sends transaction material without receiving a Channels API key; the
Worker validates the request before lazily minting and storing a per-IP key.

## Security boundary

`POST /` accepts exactly one of:

- `{ func, auth }`: a direct call to an approved passkey-kit smart-wallet
  method. The target must be an explicitly allowed contract ID or resolve on
  chain to an approved wallet WASM hash. Every authorization entry must use
  address-bound V2 credentials for that same wallet, and the Worker simulates
  the call to enforce the resource-fee ceiling before submission.
- `{ xdr }`: one signed `createContractV2` operation. The transaction source,
  contract-id preimage address, and source signature must match an approved
  deployer, and the executable must be an approved wallet WASM hash. The
  envelope's Soroban resource fee is checked before submission.

All other operations, contracts, functions, auth trees, sources, WASM hashes,
and over-ceiling fees are rejected before an API key can be minted. Invalid
JSON and missing `CF-Connecting-IP` also fail before key custody is touched.

A fixed-window Durable Object limiter is applied globally and per IP. The
global bucket bounds IP rotation. Browser CORS is an exact configured origin
list; the Worker never emits `Access-Control-Allow-Origin: *`. Requests without
an `Origin` header remain possible for server-to-server use and are still
subject to every other check.

Channels responses count as success only when their status matches
`/confirm|success/i`, mirroring `src/relayer.ts`. Failure statuses return a
non-success response, and pending or unknown statuses return HTTP 202 with
`success: false`.

Testnet missing-account retries use exponential backoff after Friendbot funding;
mainnet never uses Friendbot.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Health and network |
| POST | `/` | Validated wallet invocation or wallet deployment |
| GET | `/status` | Client IP, network, and cached-key presence |

## Configuration

All lists are comma-separated. Empty security allowlists fail closed.

| Variable | Meaning |
|---|---|
| `NETWORK` | `testnet` or `mainnet` |
| `RELAYER_BASE_URL` | Channels service base URL |
| `STELLAR_RPC_URL` | RPC used for wallet-WASM verification and func/auth simulation |
| `ALLOWED_ORIGINS` | Exact browser origins allowed by CORS |
| `ALLOWED_WALLET_CONTRACT_IDS` | Optional explicit wallet contract IDs |
| `ALLOWED_WALLET_WASM_HASHES` | Wallet WASM hashes approved for invokes and deploys |
| `ALLOWED_WALLET_FUNCTIONS` | Direct wallet methods the proxy may sponsor |
| `ALLOWED_DEPLOYER_ADDRESSES` | Deploy transaction/preimage G-addresses |
| `MAX_RESOURCE_FEE_STROOPS` | Maximum resource fee per request; default `1000000` |
| `RATE_LIMIT_WINDOW_SECONDS` | Fixed-window duration; default `60` |
| `RATE_LIMIT_PER_IP` | Per-IP requests per window; default `10` |
| `RATE_LIMIT_GLOBAL` | All-IP requests per window; default `100` |
| `TESTNET_RETRY_BASE_DELAY_MS` | Initial retry delay; default `500` |
| `TESTNET_RETRY_MAX_DELAY_MS` | Backoff cap; default `5000` |

`API_KEY_DO` binds `ApiKeyStore`; `RATE_LIMIT_DO` binds
`RequestRateLimiter`. `wrangler.toml` includes both SQLite Durable Object
migrations. The production environment intentionally leaves origins, wallet
hashes, deployers, and RPC empty so a mainnet deploy cannot sponsor anything
until operators explicitly populate those values.

For local development, copy `.dev.vars.example` to `.dev.vars` and adjust the
public allowlists. Never add a Channels key; the Worker mints keys through
`{RELAYER_BASE_URL}/gen` only after validation.

## Develop and verify

```sh
cd relayer-proxy
pnpm install --ignore-workspace
pnpm test
pnpm typecheck
pnpm deploy              # testnet
pnpm deploy:production   # mainnet; keep fail-closed until explicitly configured
```

The tests cover operation/contract rejection, V2 wallet auth, deploy source and
WASM checks, resource-fee ceilings, rate limiting, mint-after-validation
ordering, missing-IP rejection, terminal-status gating, exact-origin CORS,
error mapping, retry backoff, and both Durable Objects.
