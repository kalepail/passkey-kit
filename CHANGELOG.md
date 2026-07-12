# Changelog

All notable changes to `passkey-kit` are recorded here. The entry below covers the ground-up **v1 overhaul** of the contract, SDK, bindings, and services.

## v1 — Unreleased

> [!NOTE]
> **Version.** The npm package is `0.12.1` at time of writing; the v1 release version (`0.13.0` vs `1.0.0`) is chosen at publish time. The reworked contract already stamps `binver = 1.0.0` in its metadata. Per-component versions below are the source of truth; `npm view` is authoritative for what is published.
>
> | Component | Version |
> |---|---|
> | `passkey-kit` (SDK) | `0.12.1` → **TBD at publish** |
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
- **Indexer abstraction.** A `SignerIndexer` interface (`getSigners` / `findWallets` / `health`) with two interchangeable backends — `MercuryIndexer` and `StellarIndexerBackend` — plus a browser-safe `lookupWithRetry` poll helper. Concrete backends are exported only from `passkey-kit/server`. See [Known limitations](#known-limitations).
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

- **`zephyr/` Mercury indexer — full rewrite** on the current `zephyr-sdk`, consuming the new `#[contractevent]` schema with consistent UNIX-timestamp expiration semantics and a **WASM-hash allowlist** on ingestion (only events from known passkey-kit wallets are indexed). See [`zephyr/README.md`](./zephyr/README.md).
- **`relayer-proxy/` — new** top-level Cloudflare Worker adapted from smart-account-kit. It fronts the OpenZeppelin Relayer Channels service and **mints one API key per client IP** (keyless, cached in a per-IP Durable Object), so the browser submits fee-sponsored transactions with **zero secrets in the bundle** — fixing passkey-kit's prior defect of inlining the relayer key into client JS. See [`relayer-proxy/README.md`](./relayer-proxy/README.md).
- **`RelayerClient`** wraps `@openzeppelin/relayer-plugin-channels ^0.20` with tolerant, never-throwing typed results; `submitSorobanTransaction` (`{ func, auth }`) is preferred for wallet invocations and `submitTransaction` (`{ xdr }`) fee-bumps deploys / source-account auth.

### Demo

- **Svelte 5 + current Vite,** componentized (replacing the single 427-line `App.svelte`), with **zero secrets in the bundle** (the committed secret seed is purged; submission and discovery go through the worker proxies). Exercises the full client API, including `update_signer`, both storage durabilities, admin rotation, non-native SACs, and discovery through both indexer backends.

### Known limitations

- **Indexer live-query paths are pending a decision.** Both indexer backends are code-complete and unit-tested, but neither has a live query path yet: Mercury retired the self-serve Zephyr `POST /zephyr/execute` route the `MercuryIndexer` targets (the backend is gated behind `zephyrExecuteConfirmed` until a path is chosen), and the Stellar Indexer indexes mainnet only. The deterministic `connectWallet` reconnect path needs no indexer and works today. See [`README.md`](./README.md#discovery-indexer) and [`zephyr/README.md`](./zephyr/README.md).
- **The v1 contract is deployed to testnet only;** mainnet upload is a gated release step, recorded in a follow-up deployments manifest.
- **The contract has not been reviewed by a third-party security firm** — only the internal adversarial review noted above.
