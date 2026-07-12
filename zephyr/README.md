# passkey-kit Mercury (Zephyr) indexer

Mercury Zephyr program that indexes passkey-kit **v1** smart-wallet signers for
two query patterns:

- **Enumerate a wallet's signers** — `get_signers_by_address(address)`.
- **Reverse lookup (keyId → wallets)** — `get_addresses_by_signer(key, kind)`.

It is the `MercuryIndexer` backend behind the SDK's `SignerIndexer`
abstraction; the Stellar Indexer backend is the interchangeable second one.

This is a ground-up rewrite (overhaul v1). It consumes the reworked contract's
`#[contractevent]` event schema, indexes on a single soroban-sdk, enforces a
WASM-hash allowlist on ingestion, and uses consistent UNIX-timestamp expiration
semantics. See "Audit fixes" below.

---

## Build

```sh
cd zephyr
cargo build --release --target wasm32-unknown-unknown
# or, equivalently, the Mercury wrapper:
mercury-cli build
```

Artifact: `target/wasm32-unknown-unknown/release/passkey_kit_indexer.wasm`.

### Toolchain & the dual-soroban-sdk trap (audit F1)

The legacy program did not build: it pulled **two** soroban-sdks — one from the
old `zephyr-sdk` (22.x) and one from `smart-wallet-interface` (23.x) — whose
types don't unify, plus a stale rustc pin. This rewrite fixes it structurally:

- **No `smart-wallet-interface` dependency.** The event/signer types are
  mirrored locally in `src/wallet.rs` as `#[contracttype]` definitions on THIS
  crate's soroban-sdk. The ScVal enum/struct wire encoding is protocol-stable
  across soroban-sdk versions, so the mirrors decode the contract's
  soroban-sdk-27-emitted events byte-for-byte while keeping the indexer
  decoupled from the contract crate's toolchain.
- **Exactly one soroban-sdk in the tree**, pinned `=22.0.7` to match what the
  current `zephyr-sdk` resolves. `22.0.7` is required, not incidental:
  - `22.0.7` gates its wasm `#[panic_handler]` behind
    `cfg(all(not(feature = "alloc"), target_family = "wasm"))`. `zephyr-sdk`
    enables the `alloc` feature, so soroban-sdk emits **no** panic handler.
  - `22.0.8+` made the panic handler unconditional on wasm. Because the current
    `zephyr-sdk` graph links `std` (via `rs-zephyr-common`'s `stellar-xdr 27`),
    that duplicates `std`'s `panic_impl` lang item and the build fails with
    `E0152: found duplicate lang item`.
- **`zephyr-sdk` is pinned to the `stellar-main-2` branch** (the current, P27
  default branch), rev `3b832840…`. `Cargo.toml` records the exact rev.
- **rustc** is pinned to `1.93.0` (`rust-toolchain.toml`). The old
  `stable-2024-09-05` (rustc 1.81) predates `stellar-xdr 27`, which
  `rs-zephyr-common` now pulls in.

> Note on "soroban-sdk 27": the overhaul plan targeted soroban-sdk 27 here, but
> upstream `zephyr-sdk` (even on `stellar-main-2`) is still built on soroban-sdk
> 22.x — no soroban-sdk-27 `zephyr-sdk` exists yet. The plan's real intent (F1)
> was "a single soroban-sdk that builds", which this achieves. Ledger-meta XDR
> parsing is handled by `zephyr-sdk` itself; the program only decodes ScVals,
> which are wire-stable.

---

## Events consumed (v1 `#[contractevent]` schema)

The contract emits `#[contractevent]` structs (default `data_format = "map"`):
topic 0 is the snake_case struct name; `#[topic]` fields follow; the remaining
fields are an `ScVal::Map` keyed by field name.

| Event | Topics | Data (`Map`) | Indexer action |
|---|---|---|---|
| `signer_added` | `[sym, SignerKey]` | `{ storage, val }` | upsert signer, `active=true` |
| `signer_updated` | `[sym, SignerKey]` | `{ old_storage, storage, val }` | upsert signer (rewrite in place) |
| `signer_removed` | `[sym, SignerKey]` | `{ storage }` | soft-delete (`active=false`) |
| `upgraded` | `[sym]` | `{ new_hash, old_hash }` | refresh wallet WASM hash |

`SignerVal` carries `SignerExpiration(Option<u64>)` (UNIX seconds) and
`SignerLimits`; the secp256r1 variant also carries the 65-byte SEC-1 public key.
The mirror definitions live in `src/wallet.rs`.

---

## Storage schema

`signers` — one row per `(wallet address, signer key)`:

| Column | Type | Notes |
|---|---|---|
| `address` | BYTEA (indexed) | wallet `ScVal::Address` XDR |
| `key` | BYTEA (indexed) | `SignerKey` ScVal XDR |
| `val` | BYTEA | secp256r1 pubkey `ScVal::Bytes(65)`, else `ScVal::Void` |
| `limits` | BYTEA | `SignerLimits` ScVal XDR |
| `exp` | BIGINT | UNIX seconds, or `i64::MAX` = never |
| `storage` | BYTEA | `SignerStorage` ScVal XDR |
| `active` | BYTEA | native `bool` (bincode) — live/removed |

`wallets` — trusted wallet set (ingestion gate + latest known WASM hash):

| Column | Type | Notes |
|---|---|---|
| `address` | BYTEA (indexed) | wallet `ScVal::Address` XDR |
| `wasm_hash` | BYTEA | `ScVal::Bytes(32)` of the instance executable |

There is no row-delete host op, so removals are a soft-delete flag and expired
rows are never pruned on-chain (they are flagged, not deleted). The `wallets`
table doubles as the WASM-hash allowlist gate.

---

## WASM-hash allowlist (audit F3)

Any contract can emit well-formed `signer_added` events; without a gate an
attacker could inject rows and poison the reverse lookup. On each ledger close
the program scans **successful** contract-instance ledger entries and records a
wallet as trusted only when its instance executable hash is a known passkey-kit
WASM (`src/wallet.rs::ALLOWLISTED_WASM_HASHES`, sourced from
`docs/deployments-testnet-2026-07-11.md` — never rebuilt locally). Signer events
are ingested only from wallets in the trusted set. The SDK still verifies
ownership client-side (audit F7) as defence in depth.

---

## Expiration semantics (audit F4/F5)

`SignerExpiration` is a UNIX timestamp in seconds, **inclusive**: a signer is
valid while `ledger_timestamp <= exp` and expired once `ledger_timestamp > exp`.
Both read functions apply the identical rule and **return** expired signers with
an `expired` flag rather than silently filtering them (the old code filtered
expiration in one function and ignored it in the other, using an off-by-one
ledger-sequence comparison). Removed signers are omitted (soft-deleted); surface
removals via the Stellar Indexer tombstone backend.

The unauthenticated `debug_signers` full-table dump was removed.

---

## Function contracts

Invoke via `POST {mercuryBackend}/zephyr/execute` with the function name and a
JSON body. Responses are JSON.

### `get_signers_by_address`

Request: `{ "address": "C..." }`

Response: `SignerResponse[]`

```jsonc
{
  "kind": "Policy" | "Ed25519" | "Secp256r1",
  "key":  "C… | G… | base64url(keyId)",   // by kind
  "val":  "base64url(65-byte pubkey)" | null, // secp256r1 only
  "expiration": 1752192000 | null,        // UNIX seconds; null = never
  "expired": false,                        // now > expiration
  "storage": "Persistent" | "Temporary",
  "limits": "base64(SignerLimits XDR)"
}
```

### `get_addresses_by_signer`

Request: `{ "key": "…", "kind": "Policy" | "Ed25519" | "Secp256r1" }`
(`key` encoding matches the `key` field above for that kind.)

Response: `WalletMatch[]`

```jsonc
{
  "address": "C…",
  "expiration": 1752192000 | null,
  "expired": false,
  "storage": "Persistent" | "Temporary"
}
```

The SDK's `findWallets` maps this to a plain address list; the expiration flag
is exposed for parity with `get_signers_by_address`.

---

## Deploy (Mercury testnet) — tooling status (audit F2)

**Re-verified against current upstream (2026-07): the published deploy tooling
is deprecated and does not work as documented.**

- The published `mercury-cli` (crates.io `0.2.1`, the latest) hardcodes the base
  `https://api.mercurydata.app` and POSTs to `/zephyr_table_new` and
  `/zephyr_upload`. Both return **404** — upstream removed those endpoints (see
  rs-zephyr-toolkit commit *"flag the legacy Zephyr CLI — its server-side
  commands target removed backend endpoints; deprecate catchup"*, 2026-07-06).
  Note the CLI still prints `Successfully deployed Zephyr program.` after the
  404s — its exit code and message are **not** trustworthy.
- The current testnet backend has moved under `…/rest`
  (`GET https://api.mercurydata.app/rest/health` → `{"service":"up",…}`). The
  newer `mercury-cli` that targets it takes a `--base …/rest` flag but is **not
  published** to crates.io and is not in a public repo at the time of writing.

**Historical command (for reference; currently 404s):**

```sh
export MERCURY_JWT="…"    # from repo-root .env: MERCURY_TESTNET_JWT — NEVER print/commit
mercury-cli --jwt "$MERCURY_JWT" --local false --mainnet false deploy
```

**Current deploy path:** the Mercury web dashboard (`test.mercurydata.app`,
"custom ingestion") or a `--base`-capable `mercury-cli` built from Mercury's
current source. This is an outward, account-touching step; the orchestrator
runs it at the verify/endgame gate. Tables are created from `zephyr.toml`
(program name `passkey-kit-indexer`); the wasm above is uploaded as-is.

Secrets rule: the Mercury JWT comes from the repo-root `.env`
(`MERCURY_TESTNET_JWT` / `MERCURY_MAINNET_JWT`) via shell substitution only —
never printed, logged, or committed.

### Data catchup / backfill

Standard execution (new ledger closes) needs no subscription. Historical
backfill needs a contract-event subscription (via the dashboard) plus a
`mercury-cli catchup` scoped by contracts/topics; the old catchup flow was
deprecated on 2026-07-06. Backfill is optional and orthogonal to live indexing.
