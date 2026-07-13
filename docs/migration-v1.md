# Migrating to `passkey-kit` v1

v1 is a ground-up overhaul of the contract, SDK, and services. It has **no backwards-compatibility layer** — every change below is a clean cut from the `0.12.x` line. If you only ever call `connectWallet()` and submit through `PasskeyServer`, the two changes that will touch your code are the **signing API** (a `Signer` instance instead of an options object) and the **`TransactionResult`** discriminated union.

> [!IMPORTANT]
> **Contract compatibility.** v1 is a new on-chain contract (new WASM hash, renumbered errors, new event schema, timestamp expirations). Wallets deployed from the pre-1.0 contract remain live and keep their addresses (the [derivation tuple](./deployments-testnet-2026-07-11.md#deterministic-wallet-address-derivation-normative) is unchanged), but they run the legacy code until upgraded in place. A v1 SDK talks to v1 wallets; it still *decodes* legacy error codes (family `SmartWalletLegacy`) so failures from a legacy wallet are legible.

## Contents

- [Signing pipeline](#signing-pipeline)
- [Results & error handling](#results--error-handling)
- [Errors](#errors)
- [Configuration](#configuration)
- [Signer model & expiration](#signer-model--expiration)
- [Storage adapters](#storage-adapters)
- [Indexer & discovery](#indexer--discovery)
- [Packaging & imports](#packaging--imports)
- [Removed exports](#removed-exports)
- [Gap analysis](#gap-analysis)
- [Contract-side changes](#contract-side-changes)
- [Behavior changes](#behavior-changes)

---

## Signing pipeline

**`sign` / `signAuthEntry` now take a typed `Signer` instance** instead of a mutually-exclusive `{ keyId | keypair | policy }` options object.

```ts
// Before (0.12.x)
await kit.sign(txn, { keyId });                    // passkey
await kit.sign(txn, { keypair });                  // Ed25519
await kit.sign(txn, { policy });                   // policy
await kit.sign(txn, { keyId: "any", expiration }); // any passkey + explicit expiration

// After (v1)
import { PasskeySigner, Ed25519Signer, PolicySigner } from "passkey-kit";

await kit.sign(txn);                               // connected passkey (default)
await kit.sign(txn, new PasskeySigner(keyId));     // specific passkey
await kit.sign(txn, new Ed25519Signer(keypair));   // Ed25519
await kit.sign(txn, new PolicySigner(policy));     // policy
await kit.sign(txn, new PasskeySigner("any"), { expiration }); // any passkey + expiration
```

Notes:

- The per-call options object is now just `{ expiration?: number }`. Per-call `rpId` is gone — `rpId` moved to the `PasskeyKit` constructor (a single source of truth).
- `Ed25519Signer.fromSecret("S…")` builds a signer from a secret key (throws `ValidationError` on an invalid key).
- Multi-sign by calling `sign` once per signer; each merges into the flat `Signatures` map, now sorted in Soroban **host order** (was a `localeCompare` approximation that could produce a map the host rejected).

**`sign` takes a single `AssembledTransaction`.** The old `AssembledTransaction | Tx | string` tri-input silently dropped memo/fee/operations on its fallback path. If you hold XDR, rebuild first:

```ts
// Before: await kit.sign(xdrString)
// After:
import { AssembledTransaction } from "@stellar/stellar-sdk/contract";
const txn = AssembledTransaction.fromXDR(options, xdrString, spec);
await kit.sign(txn);
```

## Results & error handling

**`TransactionResult` is now a discriminated union on `success`.** Narrow on `result.success` before reading `.error` or `.hash`.

```ts
// Before (0.12.x): an untyped { success, hash, error? } object; error was a string.
const result = await server.send(txn);
if (result.success) {
  console.log(result.hash);
} else {
  console.error(result.error); // string
}

// After (v1)
const result = await server.send(txn);
if (result.success) {
  // TransactionSuccess: { success: true; hash: string; ledger?; transactionId? }
  console.log(result.hash);
} else {
  // TransactionFailure: { success: false; error: PasskeyKitError; hash? }
  console.error(`[${result.error.code}] ${result.error.message}`);
}
```

- `error` is now a **typed `PasskeyKitError`** (a `ContractError` when an on-chain code was decoded), not a string. Branch on `result.error.code`.
- Success results have **no** `error` field; failure results have an **optional** `hash`.
- New type exports: `TransactionSuccess`, `TransactionFailure`, `SubmissionMethod`.

**Which methods return this vs. throw.** Only submission methods (`server.send`, `server.getTransaction`) return a `TransactionResult`. **Everything else throws** a typed `PasskeyKitError` subclass. A pending (non-terminal) relayer status is surfaced as a failure carrying `RELAYER_PENDING` — keep polling `getTransaction`; do not treat it as success.

## Errors

- All thrown errors are now `PasskeyKitError` subclasses with a numeric `code`: `ConfigurationError`, `WalletNotConnectedError`, `WalletOwnershipError`, `WebAuthnError`, `SigningError`, `SignerNotFoundError`, `SimulationError`, `SubmissionError`, `ValidationError`, `IndexerError`, `RelayerError`, `ContractError`. Codes are grouped by concern (`1xxx`–`9xxx`, `10000` for contract-level).
- **New decoding API:** `decodeContractError(diagnostic)`, `contractErrorFromCode(code)`, `CONTRACT_ERROR_REGISTRY`, and types `ContractErrorFamily` / `ContractErrorInfo`.
- **Contract error codes were renumbered to 100–129** (see [README → Contract error decoding](../README.md#contract-error-decoding)). The legacy 1–9 codes still decode (family `SmartWalletLegacy`), so a failure from a legacy wallet is still legible.

```ts
if (!result.success && result.error instanceof ContractError) {
  switch (result.error.contractErrorName) {
    case "SignerExpired": /* 102 */ break;
    case "MissingContext": /* 110 */ break;
  }
}
```

## Configuration

**`PasskeyKit` config** gains `rpId`, `deploySource`, and `storage`:

```ts
// Before
new PasskeyKit({ rpcUrl, networkPassphrase, walletWasmHash, timeoutInSeconds, WebAuthn });

// After
new PasskeyKit({
  rpcUrl, networkPassphrase, walletWasmHash,
  rpId,            // NEW: WebAuthn RP id (was read per sign()/connect() call)
  deploySource,    // NEW: S… secret for the fee payer (default = canonical deployer)
  storage,         // NEW: StorageAdapter for passkey records
  timeoutInSeconds, WebAuthn,
});
```

**`PasskeyServer` config is now nested** (was a flat bag of `relayer*`/`mercury*` keys):

```ts
// Before
new PasskeyServer({
  rpcUrl, relayerUrl, relayerApiKey,
  mercuryProjectName, mercuryUrl, mercuryJwt, mercuryKey,
});

// After
new PasskeyServer({
  networkPassphrase,                                  // NEW: now required
  rpcUrl,
  relayer: { baseUrl, apiKey, adminSecret?, timeout? },
  mercury: { url? },                                  // keyless; url defaults to the network's hosted endpoint
});
```

`networkPassphrase` is required. `relayer.baseUrl`/`apiKey` replace `relayerUrl`/`relayerApiKey`. The old `mercury*` keys (`mercuryProjectName`/`mercuryJwt`/`mercuryKey`) are **gone** — Mercury's hosted passkey-indexer is keyless, so `mercury` is now just an optional `{ url? }` that defaults to the network's hosted endpoint (omit it entirely to use the default).

## Signer model & expiration

- **Expiration is a UNIX timestamp in seconds** (inclusive), not a ledger sequence number. Update any code that computed `latestLedger + N`; use `nowSeconds + N`.
- **`SignerLimits::Some(empty map)` now means fail-closed (no permissions).** Pre-1.0 an empty map meant *unlimited*. If you passed an empty map to mean "unlimited", pass `undefined` instead.
- **Deploy permission is decoupled from limits.** A limits entry for the wallet's own address no longer grants deploy permission; `CreateContract*` contexts require an unlimited (`undefined`-limits) signer. Granting a signer a limits entry for the wallet's own address grants it the full admin surface (it can add an unlimited signer) — treat that as full control.
- **New `upgrade(newWasmHash)` wrapper** (contract `upgrade`, renamed from `update_contract_code`) and **new `getSigner(signerKey)`** read (contract `get_signer`).

## Storage adapters

The kit no longer expects apps to hand-roll `localStorage`. Import an adapter from the new `passkey-kit/storage` subpath and pass it as `storage`:

```ts
import { IndexedDBStorage } from "passkey-kit/storage";
const kit = new PasskeyKit({ /* … */, storage: new IndexedDBStorage() });
```

`createWallet` then remembers the passkey → wallet record automatically, and `connectWallet` can resolve a wallet from local storage before falling back to an indexer.

## Indexer & discovery

- `PasskeyServer.getSigners` now returns the richer **`WalletSigner[]`** (from the `SignerIndexer` abstraction); the old flat `IndexedSigner` row type is **removed**. `getContractId` keeps its `{ keyId | publicKey | policy }` signature.
- A `SignerIndexer` abstraction resolved by the keyless `MercuryIndexer` — exported from the main `passkey-kit` entry (browser-safe; no token), alongside the browser-safe types + `lookupWithRetry`.
- **Live Mercury discovery is on by default** via Mercury's hosted, **keyless** passkey-indexer (both networks, full history, both signer generations). `MercuryConfig` collapsed to an optional `{ url? }`; the old `projectName`/`jwt`/`apiKey` and the interim `zephyrExecuteConfirmed` gate are gone. Resolve per network with `MercuryIndexer.forNetwork(...)`.

## Packaging & imports

- The package now ships **compiled `dist/`** (ESM + `.d.ts`) with an `exports` map. Remove any `transpilePackages: ["passkey-kit", "passkey-factory-sdk", …]` / bundler workaround you added for the old raw-TypeScript shipping.
- `@stellar/stellar-sdk` is a **peer dependency** (`>=16.0.0`) — install it in your app.
- Server-only code moved behind the `passkey-kit/server` subpath. Import `PasskeyServer` from `passkey-kit/server`, not `passkey-kit`, and never from browser code.

```ts
// Before
import { PasskeyKit, PasskeyServer } from "passkey-kit";

// After
import { PasskeyKit } from "passkey-kit";
import { PasskeyServer } from "passkey-kit/server"; // server-only
```

## Removed exports

- **`passkey-factory-sdk`** — never a real package; the factory design it referenced was abandoned before v1. Remove it from imports and bundler config.
- **`PasskeyServer` from the package root** — moved to `passkey-kit/server`.
- **The old indexer row type** (`Signer` / `IndexedSigner`) — **removed**. `PasskeyServer.getSigners` and the `MercuryIndexer` return the richer `WalletSigner` shape (`SignerIndexer` abstraction). The name `Signer` now refers only to the signing-pipeline interface.
- **`StellarIndexerBackend` / `StellarIndexerConfig` / `indexerForConfig`** — removed; `MercuryIndexer` (keyless, both networks) is the one backend. `MercuryIndexer` moved from `passkey-kit/server` to the main `passkey-kit` entry.

## Gap analysis

An explicit accounting of capabilities the pre-1.0 version had that v1 changes or drops — and what to use instead.

| Old capability | v1 status | What to do instead |
|---|---|---|
| `connectWallet({ walletPublicKey })` — resolve/connect a wallet by an Ed25519 `G…` key | **Removed.** `connectWallet` is passkey-ownership-based by design: it verifies the connecting `keyId` is a live secp256r1 signer. | For reverse lookup by an Ed25519 or policy signer, use `server.getContractId({ publicKey })` / `{ policy }`, then operate on that address. There is no "connect as an Ed25519 identity" — sign with an `Ed25519Signer` against a passkey-connected wallet. |
| `sign(xdrString \| Tx)` — sign a raw XDR string or `Tx` | **Removed** (lossy fallback). | `AssembledTransaction.fromXDR(...)` first, then `sign(txn)`. |
| Per-call `rpId` on `sign` / `connectWallet` | **Moved to the constructor.** | Set `rpId` once on `new PasskeyKit({ rpId })`. |
| **Live signer discovery via Mercury** (`getSigners` / `getContractId`) | **Live.** Rewired onto Mercury's hosted, **keyless** [passkey-indexer](https://docs.mercurydata.app/smart-wallet-indexers/introduction-1) — both networks (incl. testnet), full history, both signer generations. | Enumerate with `server.getSigners(contractId)` (returns `WalletSigner[]`) and reverse-lookup with `server.getContractId({ keyId \| publicKey \| policy })`, or use `MercuryIndexer.forNetwork(...)` directly. The deterministic `connectWallet()` path still covers the common reconnect case with **no** indexer. |
| Legacy `("sw_v1", …)` tuple events | **Replaced** by typed `#[contractevent]` events. | Consume the new `signer_added`/`signer_updated`/`signer_removed`/`upgraded` schema; Mercury's hosted passkey-indexer already does (and still indexes the legacy tuples for older wallets). |
| Raw-TypeScript package (import internal source files) | **Removed** — ships compiled `dist/`. | Use the public entry points (`.`, `./storage`, `./server`). |

**Net:** v1 is a superset of the old *contract* surface (adds `upgrade` wrapping + `get_signer`), and a superset of the old *SDK* surface except for the three intentional API-shape changes above — and server-side discovery is now backed by Mercury's keyless hosted passkey-indexer on both networks (`getSigners` returns the richer `WalletSigner` shape instead of the old `IndexedSigner` row).

## Contract-side changes

If you build against the contract directly (not just the SDK):

- `__constructor(signer)` is the only init path (the `init` flag and un-authed first-`add_signer` are gone).
- `update_contract_code` → `upgrade(new_wasm_hash)`; new `get_signer(signer_key) -> Option<SignerVal>` view.
- `SignerExpiration(Option<u64>)` is a UNIX timestamp; `SignerLimits::Some(empty)` is fail-closed; errors renumbered 100–129; events are `#[contractevent]` structs; policies gain `install`/`uninstall`.

See the [CHANGELOG](../CHANGELOG.md#contract-smart-wallet-soroban-sdk-27) for the full list and [`contracts/smart-wallet-interface/src/`](../contracts/smart-wallet-interface/src) for the canonical interface.

## Behavior changes

| Situation | Before | After |
|---|---|---|
| Submission failure | `{ success: false, error: string }` | `{ success: false, error: PasskeyKitError }` |
| Any non-submission failure | plain `Error` / failure object | typed `PasskeyKitError` subclass (thrown) |
| `connectWallet` with a keyId not on the wallet | trusted the derived/looked-up address | throws `WalletOwnershipError` (verifies the keyId is a live signer) |
| Empty `SignerLimits` map | unlimited | no permissions (fail-closed) |
| Signer/signature expiration unit | ledger sequence | UNIX timestamp (seconds) |
| WebAuthn challenge | fixed string | random 32 bytes |
| `Signatures` map order | `localeCompare` | Soroban host ScVal order |
| Address auth credentials | V1 | V2 (binds the wallet address; closes cross-wallet replay) |
