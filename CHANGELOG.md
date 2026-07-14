# Changelog

All notable changes to `passkey-kit` are recorded here. The `0.13.0` entry covers the ground-up **v1 overhaul** of the contract, SDK, bindings, and services; `0.13.1` wires live signer discovery onto Mercury's hosted indexer.

## 0.14.0 — 2026-07-14

Robustness, validation, and test-coverage improvements across the contract, SDK, and relayer-proxy. All changes are forward-only. Bindings package `passkey-kit-sdk` is bumped to `0.8.0`. **Breaking:** `updateSecp256r1` drops its `publicKey` parameter (`updateSecp256r1(keyId, limits, store, expiration?)`).

### Contract

- **Rebuilt canonical WASM.** The smart-wallet contract's canonical testnet hash is now `fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0` (sample-policy `801b68fabf9f8746b10bfbc6d3da1b41462db0a38364ab8139d32dec3676ef39`), superseding `84924c53…` from 0.13.0/0.13.1 — see `docs/deployments-testnet-2026-07-11.md` for the re-pinned manifest and upload transactions. Bindings (`passkey-kit-sdk`) are regenerated from the new WASM.
- **New contract error codes**, mirrored in `CONTRACT_ERROR_REGISTRY`: `LastAdminSigner = 103` (removing or demoting the wallet's last durable admin signer is rejected — add or promote a replacement admin first), `LastSigner = 104` (any operation that would leave the wallet without a durable — Persistent, non-expiring — signer is rejected, enforced at construction, removal, and update-demotion, so at least one signer that cannot evict or expire always exists), and `AuthenticatorDataTooLarge = 126` (authenticatorData capped at 1024 bytes). Policy invocations now run only after every other requirement of a signer's limits has passed, so a losing auth candidate never invokes a state-committing policy; a rejecting policy does not block its own removal.

### SDK

- **V2 address-bound signing.** `signAuthEntry` now upgrades V1 address credentials to V2 (`toAddressBoundCredentials`) before hashing and refuses to sign any non-address-bound entry — the CAP-0071-02 V2 preimage binds the wallet address into every signed payload, and there is **no V1 signing path**. A regression test pins that two wallets produce different payload hashes for a byte-identical address-free invocation, and that the signed payload equals the stellar-sdk's own `buildAuthorizationEntryPreimage` V2 hash.
- **`updateSecp256r1` no longer accepts a `publicKey`.** Breaking: `updateSecp256r1(keyId, publicKey, limits, store, expiration?)` → `updateSecp256r1(keyId, limits, store, expiration?)`. `update_signer` replaces the whole on-chain signer value, so the kit now treats the ledger as the single source of truth for key material: it re-reads the authoritative public key on-chain and throws `SignerNotFoundError` if the signer is not found.
- **`connectWallet` no longer treats RPC transport errors as not-found.** The derived-address instance read distinguishes an authoritative not-found (falls through to storage/indexer) from a transport error (429/5xx/timeout — propagates), so a flaky RPC never reroutes wallet resolution. New `contractInstanceExists` helper in `rpc-data`.
- **Reverse lookup fails closed.** `MercuryIndexer.findWallets` now throws `IndexerError(INDEXER_NOT_CONFIGURED)` when candidates exist but no confirmation route does (no `rpc`, and `hardening` derivation only covers Secp256r1 keys) — unconfirmed indexer rows are never returned. Previously they were returned unfiltered when neither `rpc` nor `hardening` was configured.
- **Failed `verifyWasmHash` disconnects.** A `connectWallet({ verifyWasmHash: true })` mismatch now clears `wallet`/`keyId` before throwing, so a subsequent `sign` cannot operate on the rejected contract.
- **Input validation.** `compactSignature` validates the DER structure (tags, short-form lengths that exactly span the buffer, `r`/`s` in `[1, n-1]`) before any offset is read. `extractPublicKeyFromAttestation` verifies the COSE prefix/labels and bounds in place instead of trusting fixed offsets, and rejects any extracted key that is not a point on the P-256 curve — a wallet deployed from a mangled key could never verify a signature; new `isOnP256Curve` export. `validateExpiration` accepts the contract's full `u64` UNIX-seconds range instead of capping at `u32`.

## 0.13.1 — 2026-07-13

### Indexing — live Mercury discovery

Rewires the `MercuryIndexer` onto Mercury's hosted, **keyless** passkey-indexer, now live on both networks. This resolves the *"indexer live-query pending a decision"* limitation noted in 0.13.0. No contract change — the bindings (`passkey-kit-sdk` `0.7.3`, `sac-sdk` `0.4.3`) and the canonical WASM hash `84924c53…` are unchanged.

- **Keyless hosted endpoint.** `MercuryIndexer` now queries Mercury's public passkey-indexer REST API (`https://{testnet,mainnet}.mercurydata.app/rest/passkey-indexer`, `GET /api/wallet/:id` + `/api/lookup/*`) — **no JWT / API key**. It covers **testnet and mainnet** with full history across both signer generations (legacy `("sw_v1", …)` tuples and the v1 `#[contractevent]`s). The endpoint returns fully-decoded signers, so the client maps JSON straight onto `WalletSigner` with no XDR round-trip. New `MercuryIndexer.forNetwork(config, networkPassphrase)` resolves the base URL per network (returns `null` off testnet/mainnet); new `mercuryPasskeyIndexerUrl(passphrase)` helper + `MERCURY_PASSKEY_INDEXER_URLS` constant.
- **`MercuryIndexer` is now browser-safe.** Because the endpoint is keyless, `MercuryIndexer` (+ `MercuryIndexerConfig`, `mercuryPasskeyIndexerUrl`, `MERCURY_PASSKEY_INDEXER_URLS`) is exported from the **main `passkey-kit` entry** instead of `passkey-kit/server` — call it directly from the browser, no proxy. The demo now does exactly this (the `indexer-proxy` indirection is gone).
- **Stellar Indexer backend removed.** `StellarIndexerBackend` (Creit Tech, `POST /v1/contract-data`) is dropped along with `indexerForConfig`: it was mainnet-only and never had a live testnet path, and Mercury now covers both networks keylessly. `SignerIndexer` has one implementation.
- **Hardening preserved.** With an `rpc`, temporary signers are still confirmed on-chain (evicted TTL entries flagged `status: "evicted"` — the indexer can't observe eviction), and reverse-lookup candidates are still confirmed by deterministic derivation or on-chain signer presence before being trusted (#598 F3/F6, audit H2).
- **`PasskeyServer` consolidation.** `getSigners` / `getContractId` now delegate to a single `MercuryIndexer` — the duplicated `POST /zephyr/execute` client is gone. `getSigners` returns `WalletSigner[]`.
- **`zephyr/` removed.** The self-hosted Zephyr indexer program and its docs are dropped; Mercury's hosted indexer replaces it entirely.

> [!IMPORTANT]
> **Breaking (pre-1.0).** `StellarIndexerBackend` / `StellarIndexerConfig` / `indexerForConfig` and the `IndexedSigner` type are **removed** (`PasskeyServer.getSigners` now returns `WalletSigner[]`). `MercuryIndexer` moved from `passkey-kit/server` to the main `passkey-kit` entry. `MercuryConfig` collapses to an optional `{ url? }` (defaults to the network's hosted endpoint); `MercuryConfig`/`MercuryIndexerConfig` no longer take `projectName` / `jwt` / `apiKey`, and the interim `zephyrExecuteConfirmed` gate is gone.

## 0.13.0 — 2026-07-12

> [!NOTE]
> **Version.** The v1 overhaul ships as `passkey-kit@0.13.0` (minor bump from `0.12.1`, forward-only). The reworked contract stamps `binver = 1.0.0` in its metadata. Per-component versions below are the source of truth; `npm view` is authoritative for what is published. This tag is the reference for the canonical v1 contract WASM hash `84924c53a413318df2ce753e30de53ec651404c916d30e861718ad155c94b319` (see [`docs/deployments-testnet-2026-07-11.md`](./docs/deployments-testnet-2026-07-11.md)).
>
> | Component | Version |
> |---|---|
> | `passkey-kit` (SDK) | `0.12.1` → **`0.13.0`** |
> | `passkey-kit-sdk` (bindings) | regenerated from canonical v1 WASM |
> | `sac-sdk` (bindings) | regenerated |
> | `smart-wallet` (contract) | `binver 1.0.0`, `soroban-sdk 27.0.0` |
> | `sample-policy` (contract) | `soroban-sdk 27.0.0` |

> [!IMPORTANT]
> **Compatibility: breaking, forward-only — there is no compatibility layer with 0.12.x.** The on-chain contract, its wire events, its error codes, the signer model, the SDK's public API, and the package's shape all changed. See [`docs/migration-v1.md`](./docs/migration-v1.md) for a complete migration guide with Before/After examples, a removed-exports list, and an A/B gap analysis.
>
> Pre-1.0 wallets remain live on both networks and derive from the same address tuple; they interact only with legacy tooling but can be upgraded in place to a v1 WASM via their own auth. Requires `@stellar/stellar-sdk >= 16.0.0` (peer dependency).

The overhaul rebuilds passkey-kit against `soroban-sdk 27` (Protocol 27, "Zipper") after an internal multi-reviewer adversarial audit of the contract. Every SDK sample, method table, and error code in the documentation is verified against the shipped source.

### Contract (`smart-wallet`, `soroban-sdk 27`)

Reworked against `soroban-sdk 27` on `wasm32v1-none`, with the audit remediations folded in (no compatibility shims).

- **Constructor-only initialization.** `__constructor(signer)` (CAP-0058) is the sole init path; the legacy `init` instance flag and the un-authenticated first-`add_signer` window are gone.
- **Renamed & new entry points.** `update_contract_code` → **`upgrade(new_wasm_hash)`** (emits an `Upgraded` event and caches the hash in instance storage). New **`get_signer(signer_key) -> Option<SignerVal>`** view.
- **Timestamp expirations.** `SignerExpiration` is now a UNIX timestamp in seconds (inclusive), replacing the ledger-sequence number. Timestamps don't drift as ledger close-time changes (e.g. CAP-0070).
- **Fail-closed limits.** `SignerLimits::Some(empty map)` now means **no permissions** (was "unlimited"). There is one unlimited encoding (`None`) and an explicit "none" encoding.
- **Deploy permission decoupled.** `CreateContract*` contexts require a fully unlimited (`None`) signer; a limits entry for the wallet's own address no longer doubles as deploy permission. A limited signer may always self-remove (never an escalation).
- **`__check_auth` correctness.** Pass 1 (context coverage) is purely boolean — a candidate signer being rejected no longer panics and can no longer poison an otherwise valid authorization. Pass 2 verifies **every** signatures-map entry, checking expiration once per entry at a single point of truth (fixes an order-dependent, skippable expiration bug).
- **WebAuthn hardening.** Keeps the load-bearing challenge-equality binding; adds a `type == "webauthn.get"` check, requires the User Present (UP) flag (UV not required, by design), bounds `authenticatorData` length, and returns a typed error for an oversized `clientDataJSON` instead of panicking.
- **Policy lifecycle.** `PolicyInterface` gains `install(wallet)` (a hard call on add — a policy may refuse) and a permissionless `uninstall(wallet)` self-clean entrypoint. `policy__` is documented as publicly callable — stateful policies must authenticate the caller. No policy code runs on the `remove_signer` path, so a broken policy can never block its own removal. `sample-policy` demonstrates the lifecycle as a cumulative rolling-window spending allowance.
- **Typed `#[contractevent]` events.** `SignerAdded` / `SignerUpdated` / `SignerRemoved` / `Upgraded` structs carry a SEP-48 schema in the WASM, replacing the schemaless `("sw_v1", …)` tuple events. Indexers consume them directly.
- **Renumbered errors (100–129),** disjoint from the legacy 1–9 range: `SignerNotFound`, `SignerAlreadyExists`, `SignerExpired`, `MissingContext`, `SignatureKeyValueMismatch`, `ClientDataJsonTooLarge`, `ClientDataJsonParseError`, `ClientDataJsonChallengeIncorrect`, `InvalidWebAuthnType`, `InvalidAuthenticatorData`, `UserPresenceRequired`.
- **Single type source.** `smart-wallet-interface` is the one home for the spec types; the hand-synced duplicate `smart-wallet/src/types.rs` is removed. Flat top-level `SignerKey → SignerVal` storage (temporary-before-persistent lookup) is preserved — it is indexer-critical.

> [!NOTE]
> The deterministic wallet-address derivation tuple (`salt = sha256(keyId)`, the canonical `"kalepail"` deployer, the network passphrase, and `ContractIdPreimageFromAddress`) is **unchanged** — a given passkey derives the same address across contract versions, and the WASM hash is deliberately not part of the preimage. See [`docs/deployments-testnet-2026-07-11.md`](./docs/deployments-testnet-2026-07-11.md).

### SDK (`passkey-kit`)

A ground-up rewrite of the monolithic client into dependency-injected managers, with a typed error model and a unified signing pipeline.

- **Typed errors + discriminated `TransactionResult`.** Every method throws a `PasskeyKitError` subclass with a numeric `code` — except submission methods, which return `{ success: true, … }` / `{ success: false, error }`. On-chain failures decode into `ContractError` (raw code + enum name) via `decodeContractError` / `CONTRACT_ERROR_REGISTRY`; a bindings-sync test keeps the registry aligned with the generated `Errors` map. The legacy 1–9 codes still decode (family `SmartWalletLegacy`).
- **Unified signing pipeline.** `sign(txn, signer?, options?)` / `signAuthEntry(entry, signer?, options?)` take a typed **`Signer`** — `PasskeySigner`, `Ed25519Signer`, or `PolicySigner` — replacing the old `sign(txn, { keyId | keypair | policy })` option trio. The `Signatures` map is sorted with the host-order `compareScVal`, not the previous `localeCompare` approximation. `sign` takes a single explicit `AssembledTransaction` (the lossy `AssembledTransaction | Tx | string` tri-input is gone).
- **Address credentials V2.** The kit builds `SOROBAN_CREDENTIALS_ADDRESS` V2 auth (CAP-0071-02), which binds the wallet address into the payload — closing a cross-wallet replay hole for shared Ed25519 signers. All Protocol-27 probe/feature-detection shims are deleted; the kit targets `@stellar/stellar-sdk >= 16`.
- **Ownership-verifying `connectWallet`.** Resolution is derivation → storage → injected indexer lookup, and then the resolved wallet is **verified**: the keyId must be a live signer (`getSigner`). A transport error surfaces as-is (a flaky RPC never masquerades as an ownership mismatch); only a definitive not-found throws `WalletOwnershipError`. Optional `verifyWasmHash` also checks the on-chain executable hash.
- **Configurable deployer.** `deploySource` replaces the hard-coded deployer keypair; the default still derives from the canonical `"kalepail"` seed to preserve address determinism (documented as load-bearing for discovery).
- **Indexer abstraction.** A `SignerIndexer` interface (`getSigners` / `findWallets` / `health`) with two interchangeable backends — `MercuryIndexer` and `StellarIndexerBackend` — plus a browser-safe `lookupWithRetry` poll helper. Concrete backends are exported only from `passkey-kit/server`. See [Known limitations](#known-limitations). *(0.13.1: `StellarIndexerBackend` removed; the keyless `MercuryIndexer` moved to the main `passkey-kit` entry.)*
- **Storage adapters.** New `passkey-kit/storage` subpath: `MemoryStorage`, `LocalStorageAdapter`, `IndexedDBStorage` over a `StorageAdapter` interface. The kit no longer relies on apps hand-rolling `localStorage`.
- **Client-side validation** (`validateAddress`, `validateAmount`, `validateExpiration`, `validateSecp256r1PublicKey`) and a typed `PasskeyEventEmitter` (`walletCreated` / `walletConnected` / `walletDisconnected`).
- **Crypto helpers.** `generateChallenge` is now a random 32 bytes (was a hard-coded string); `extractPublicKeyFromAttestation` gains a WebCrypto SPKI path; `deriveContractAddress` and `compactSignature` are exported.

### Bindings & packaging

- **Ships compiled `dist/`** (ESM JS + `.d.ts`) with an `exports` map (`.`, `./storage`, `./server`), a `files` whitelist, and `sideEffects: false` — replacing the old raw-TypeScript `main: src/index.ts` shipping that forced consumers to transpile the package.
- **`verify:bindings` drift guard** regenerates the bindings from the canonical WASM hash and diffs the ContractSpec, failing the build/publish on drift. Hand-editing generated bindings is no longer supported.
- **Node-ESM smoke test** (`verify-esm.mjs`) runs as part of `pnpm build`, and `sync-version.js` codegens `version.ts` from `package.json`.
- **Vitest** replaces the ad-hoc `bun_tests/` scripts; tests are co-located `src/*.test.ts`.
- **`sac-sdk` kept** as a full SEP-41 client (the demo needs balances/metadata), with `buildTokenTransferHostFunction` also exposed for the low-level relayer path.

### Services

- **`zephyr/` Mercury indexer — full rewrite** on the current `zephyr-sdk`, consuming the new `#[contractevent]` schema with consistent UNIX-timestamp expiration semantics and a **WASM-hash allowlist** on ingestion (only events from known passkey-kit wallets are indexed). *(Superseded in 0.13.1 — the `zephyr/` program was removed in favor of Mercury's hosted keyless passkey-indexer.)*
- **`relayer-proxy/` — new** top-level Cloudflare Worker adapted from smart-account-kit. It fronts the OpenZeppelin Relayer Channels service and **mints one API key per client IP** (keyless, cached in a per-IP Durable Object), so the browser submits fee-sponsored transactions with **zero secrets in the bundle** — fixing passkey-kit's prior defect of inlining the relayer key into client JS. See [`relayer-proxy/README.md`](./relayer-proxy/README.md).
- **`RelayerClient`** wraps `@openzeppelin/relayer-plugin-channels ^0.20` with tolerant, never-throwing typed results; `submitSorobanTransaction` (`{ func, auth }`) is preferred for wallet invocations and `submitTransaction` (`{ xdr }`) fee-bumps deploys / source-account auth.

### Demo

- **Svelte 5 + current Vite,** componentized (replacing the single 427-line `App.svelte`), with **zero secrets in the bundle** (the committed secret seed is purged; submission and discovery go through the worker proxies). Exercises the full client API, including `update_signer`, both storage durabilities, admin rotation, non-native SACs, and discovery through both indexer backends.

### Known limitations

- **Indexer live-query paths are pending a decision.** Both indexer backends are code-complete and unit-tested, but neither has a live query path yet: Mercury retired the self-serve Zephyr `POST /zephyr/execute` route the `MercuryIndexer` targets (the backend is gated behind `zephyrExecuteConfirmed` until a path is chosen), and the Stellar Indexer indexes mainnet only. The deterministic `connectWallet` reconnect path needs no indexer and works today. See [`README.md`](./README.md#discovery-indexer). *(Mercury resolved in 0.13.1 — a hosted keyless passkey-indexer went live on both networks.)*
- **The v1 contract is deployed to testnet only;** mainnet upload is a gated release step, recorded in a follow-up deployments manifest.
- **The contract has not been reviewed by a third-party security firm** — only the internal adversarial review noted above.
