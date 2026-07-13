# Passkey Kit

A TypeScript SDK for creating and using **smart-wallet accounts on Stellar with WebAuthn passkeys**. A wallet is a Soroban smart contract whose signers can be secp256r1 passkeys, Ed25519 keys, or policy contracts. The kit handles the WebAuthn ceremonies, deterministic wallet-address derivation, the flat multi-signer signing pipeline, fee-sponsored submission, and signer discovery.

- **Client (`PasskeyKit`)** — runs in the browser: create/connect wallets, sign transactions, build signer-management transactions. Holds no secrets.
- **Server (`PasskeyServer`)** — runs server-side: submits transactions through a relayer (fee sponsorship), plus convenience signer-discovery helpers over the keyless Mercury indexer. Holds the relayer secret.

> [!IMPORTANT]
> **Security.** The v1 smart-wallet contract underwent an internal multi-reviewer adversarial review and remediation (see the [CHANGELOG](./CHANGELOG.md)), but it has **not** been reviewed by a third-party security firm. Review it yourself before holding meaningful value, and read [Caveats & footguns](#caveats--footguns).

> [!NOTE]
> **Looking for context rules, thresholds, and spending-limit policies?** [smart-account-kit](https://github.com/kalepail/smart-account-kit) is a sibling SDK built on the audited [OpenZeppelin stellar-contracts](https://github.com/OpenZeppelin/stellar-contracts) account. It uses a different on-chain authorization model (context rules + an auth digest) than passkey-kit's flat `Signatures` map, so the two are not drop-in compatible — pick the model that fits your app.

## Contents

- [Installation](#installation)
- [Packaging & exports](#packaging--exports)
- [Quick start](#quick-start)
- [`PasskeyKit` (client)](#passkeykit-client)
- [Signers](#signers)
- [Signer management](#signer-management)
- [`PasskeyServer` (server)](#passkeyserver-server)
- [Submission (relayer)](#submission-relayer)
- [Discovery (indexer)](#discovery-indexer)
- [Tokens (`SACClient`)](#tokens-sacclient)
- [Storage adapters](#storage-adapters)
- [Errors](#errors)
- [Types](#types)
- [Caveats & footguns](#caveats--footguns)
- [Contract interface](#contract-interface)
- [Repository layout & development](#repository-layout--development)
- [Resources](#resources)

## Installation

```bash
pnpm add passkey-kit
# peer dependency
pnpm add @stellar/stellar-sdk
```

`@stellar/stellar-sdk` is a **peer dependency** (`>=16.0.0`); the kit targets Protocol 27 smart accounts, which earlier SDKs cannot express.

## Packaging & exports

The package ships **compiled ESM + type declarations** from `dist/` (not raw TypeScript — no bundler transpile step is required). It exposes three entry points, split so server secrets can never be pulled into a browser bundle:

| Import | Contents | Where it runs |
|---|---|---|
| `passkey-kit` | `PasskeyKit`, signers, types, errors, validation, crypto helpers, the keyless `MercuryIndexer` + indexer types | Browser or server |
| `passkey-kit/storage` | `MemoryStorage`, `LocalStorageAdapter`, `IndexedDBStorage` | Browser (persistence) |
| `passkey-kit/server` | `PasskeyServer`, `RelayerClient` — **holds the relayer secret** | Server only |

```ts
// Browser
import { PasskeyKit, PasskeySigner, Ed25519Signer, SACClient, SignerKey, SignerStore } from "passkey-kit";
import { IndexedDBStorage } from "passkey-kit/storage";

// Server ONLY (never import from browser code — it carries the relayer secret)
import { PasskeyServer } from "passkey-kit/server";
```

## Quick start

### 1. Configure the client (browser)

```ts
import { PasskeyKit } from "passkey-kit";

const kit = new PasskeyKit({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  // Canonical v1 smart-wallet WASM hash (testnet); see docs/deployments-*.md
  walletWasmHash: "84924c53a413318df2ce753e30de53ec651404c916d30e861718ad155c94b319",
});
```

### 2. Create a wallet

`createWallet` runs the passkey registration ceremony and builds a **signed** deploy transaction. Submission is a separate, server-side step (below).

```ts
const { keyIdBase64, contractId, signedTx } = await kit.createWallet(
  "My App",           // shown in the passkey prompt
  "user@example.com", // user identifier
);
// `signedTx` is a base64 XDR string ready to submit; `contractId` is the wallet address (C…).
```

### 3. Submit through the server

`PasskeyServer` submits via the relayer, which pays the fees. It never throws for expected failures — branch on `result.success`.

```ts
import { PasskeyServer } from "passkey-kit/server";

const server = new PasskeyServer({
  networkPassphrase: "Test SDF Network ; September 2015",
  rpcUrl: "https://soroban-testnet.stellar.org",
  relayer: {
    baseUrl: process.env.RELAYER_BASE_URL!, // e.g. https://channels.openzeppelin.com/testnet
    apiKey: process.env.RELAYER_API_KEY!,
  },
});

const result = await server.send(signedTx);
if (result.success) {
  console.log("deployed in tx", result.hash);
} else {
  console.error(`[${result.error.code}] ${result.error.message}`);
}
```

### 4. Reconnect later

```ts
const { contractId } = await kit.connectWallet();
// Resolves the wallet from the passkey and VERIFIES the passkey is a live signer on it.
```

### 5. Sign & submit a transfer

Build any Soroban transaction, sign its wallet auth entries with the connected passkey, then submit.

```ts
import { SACClient } from "passkey-kit";

const sac = new SACClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
});
const token = sac.getSACClient("C…nativeSacId");

const tx = await token.transfer({ from: kit.contractId!, to: "C…recipient", amount: 10_000_000n });
await kit.sign(tx);            // default signer = the connected passkey
const res = await server.send(tx);
```

## `PasskeyKit` (client)

Browser-side facade for wallet lifecycle and signing. Holds no secrets.

### Configuration

| Option | Type | Required | Description |
|---|---|---|---|
| `rpcUrl` | `string` | Yes | Stellar RPC URL. |
| `networkPassphrase` | `string` | Yes | Network passphrase. |
| `walletWasmHash` | `string` (hex) | Yes | Smart-wallet WASM hash used to deploy new wallets. |
| `rpId` | `string` | No | WebAuthn Relying Party id (domain). Defaults to the current origin. |
| `deploySource` | `string` (`S…`) | No | Secret key for the fee-paying deployer. Defaults to the canonical deterministic deployer. **Overriding it changes derived wallet addresses** (see [Deterministic derivation](#deterministic-derivation)). |
| `timeoutInSeconds` | `number` | No | Transaction time bound (default `30`; the relayer requires `<= 30`). |
| `storage` | `StorageAdapter` | No | Passkey-record persistence (see [Storage adapters](#storage-adapters)). |
| `WebAuthn` | `WebAuthnClient` | No | Custom `startRegistration`/`startAuthentication` (for testing). |

### Properties

| Property | Type | Description |
|---|---|---|
| `keyId` | `string \| undefined` | Connected passkey's base64url credential id. |
| `wallet` | `PasskeyClient \| undefined` | Connected wallet's generated contract client. |
| `contractId` | `string \| undefined` | Connected wallet address (getter). |
| `deployerPublicKey` | `string` | The fee-paying deployer's `G…` address (getter). |
| `networkPassphrase` / `rpcUrl` / `walletWasmHash` / `rpId` | `string` | The resolved config. |
| `events` | `PasskeyEventEmitter` | Lifecycle events: `walletCreated`, `walletConnected`, `walletDisconnected`. |

### Lifecycle methods

| Method | Returns | Description |
|---|---|---|
| `createKey(appName, userName, options?)` | `CreatedPasskey` | Run a passkey registration ceremony **without** deploying a wallet. |
| `createWallet(appName, userName, options?)` | `CreateWalletResult` | Register a passkey and build a signed deploy transaction (initializes the wallet via `__constructor` with the passkey as the first signer). Submit the returned `signedTx` via `PasskeyServer`. |
| `connectWallet(options?)` | `ConnectWalletResult` | Resolve a wallet from a passkey (derivation → storage → injected indexer lookup) and **verify** the passkey is a live signer on it. |
| `disconnect()` | `void` | Clear the connected wallet/keyId. |
| `requireWallet()` | `PasskeyClient` | Return the connected wallet or throw `WalletNotConnectedError`. |

`options` for `createKey`/`createWallet` is `{ authenticatorSelection?: AuthenticatorSelectionCriteria }`.

`connectWallet` options:

| Option | Type | Description |
|---|---|---|
| `keyId` | `string \| Uint8Array` | Connect a specific credential, skipping the discovery ceremony. |
| `getContractId` | `(keyId: string) => Promise<string \| undefined>` | Indexer-backed keyId → wallet lookup, used only when derivation and storage both miss. |
| `verifyWasmHash` | `boolean` | Also assert the wallet's on-chain WASM hash equals `walletWasmHash`. Off by default (an upgraded wallet legitimately runs a different hash). |

### Signing methods

| Method | Returns | Description |
|---|---|---|
| `sign(txn, signer?, options?)` | `AssembledTransaction<T>` | Sign every wallet auth entry of an assembled transaction. `signer` defaults to a `PasskeySigner()` for the connected passkey. |
| `signAuthEntry(entry, signer?, options?)` | `xdr.SorobanAuthorizationEntry` | Sign a single auth entry. |

`options` is `{ expiration?: number }` — the signature-expiration ledger (defaults to the configured timeout window).

> [!IMPORTANT]
> `sign`/`signAuthEntry` now take a **`Signer` instance** as the second argument, replacing the old `sign(txn, { keyId | keypair | policy })` option trio. See [Signers](#signers).

## Signers

A `Signer` authenticates a signature payload and produces the on-chain `(SignerKey, Signature)` pair the wallet's `__check_auth` expects. Three concrete signers cover the three signer kinds:

| Signer | Constructs | Notes |
|---|---|---|
| `new PasskeySigner(keyId?)` | secp256r1 WebAuthn assertion | `keyId` selects a credential; `"any"` lets the authenticator pick a discoverable one; omit to use the kit's connected passkey. **Default** for `sign`. |
| `new Ed25519Signer(keypair)` / `Ed25519Signer.fromSecret("S…")` | Ed25519 signature | Local Stellar keypair. `.address` returns the `G…` key. |
| `new PolicySigner(policyAddress)` | policy authorization | No signature bytes; the wallet invokes the policy's `policy__` during `__check_auth`. |

```ts
import { PasskeySigner, Ed25519Signer, PolicySigner } from "passkey-kit";

await kit.sign(tx);                                   // connected passkey
await kit.sign(tx, new Ed25519Signer(keypair));       // Ed25519
await kit.sign(tx, new PolicySigner("C…policyAddr")); // policy co-sign
await kit.sign(tx, new PasskeySigner("any"));         // any discoverable passkey
```

Multi-sign by signing the same transaction with several signers in turn — each merges its entry into the flat `Signatures` map (host-ordered):

```ts
await kit.sign(tx, new PasskeySigner());
await kit.sign(tx, new Ed25519Signer(cosignerKeypair));
```

## Signer management

Each method builds an `AssembledTransaction` (`WalletTx`) that wraps one contract admin function — submit it via `PasskeyServer.send`. A wallet must be connected.

| Method | Wrapped contract fn | Description |
|---|---|---|
| `addSecp256r1(keyId, publicKey, limits, store, expiration?)` | `add_signer` | Add a passkey signer. |
| `updateSecp256r1(keyId, publicKey, limits, store, expiration?)` | `update_signer` | Replace a passkey signer's value/storage. |
| `addEd25519(publicKey, limits, store, expiration?)` | `add_signer` | Add an Ed25519 signer (`publicKey` = `G…`). |
| `updateEd25519(publicKey, limits, store, expiration?)` | `update_signer` | Update an Ed25519 signer. |
| `addPolicy(policy, limits, store, expiration?)` | `add_signer` | Add a policy signer (`policy` = `C…`). Invokes the policy's `install` hook. |
| `updatePolicy(policy, limits, store, expiration?)` | `update_signer` | Update a policy signer. |
| `remove(signerKey)` | `remove_signer` | Remove a signer. No policy code runs on this path. |
| `upgrade(newWasmHash)` | `upgrade` | Replace the wallet's WASM (`Buffer`/`Uint8Array`, 32 bytes). |
| `getSigner(signerKey)` | `get_signer` | Read a signer entry from the ledger (temporary before persistent). Returns `SignerVal \| null`. |

Parameters:

- `keyId` — passkey credential id (base64url `string` or raw `Uint8Array`).
- `publicKey` — 65-byte secp256r1 key (`string`/`Uint8Array`) for passkeys, or a `G…` Stellar public key for Ed25519.
- `policy` — policy contract address (`C…`).
- `limits` — [`SignerLimits`](#signerlimits) (`undefined` = fully unlimited).
- `store` — `SignerStore.Persistent` or `SignerStore.Temporary`.
- `expiration` — optional UNIX-timestamp (seconds) after which the signer is invalid.

```ts
import { SignerStore, SignerKey } from "passkey-kit";

// Add an unlimited Ed25519 co-signer, stored persistently.
const tx = await kit.addEd25519("G…", undefined, SignerStore.Persistent);
await kit.sign(tx);                 // authorize with the connected passkey
await server.send(tx);

// Remove it.
const rm = await kit.remove(SignerKey.Ed25519("G…"));
await kit.sign(rm);
await server.send(rm);
```

## `PasskeyServer` (server)

Server-only facade (`passkey-kit/server`). Holds the relayer secret — never import it from browser code.

### Configuration

| Option | Type | Required | Description |
|---|---|---|---|
| `networkPassphrase` | `string` | Yes | Network passphrase. |
| `rpcUrl` | `string` | No | Stellar RPC URL. Enables the temporary-signer eviction probe in `getSigners`. |
| `relayer` | `RelayerClientConfig` | No | Fee-sponsored submission (below). |
| `mercury` | `MercuryConfig` | No | Mercury's keyless hosted passkey-indexer (below). |

`RelayerClientConfig`: `{ baseUrl: string, apiKey: string, adminSecret?: string, timeout?: number }` (default timeout 6 min).
`MercuryConfig`: `{ url?: string }` — the keyless passkey-indexer base URL; **defaults to the network's hosted endpoint** (`https://{testnet,mainnet}.mercurydata.app/rest/passkey-indexer`), so it can be omitted.

### Methods

| Method | Returns | Description |
|---|---|---|
| `send(input, options?)` | `TransactionResult` | Submit an `AssembledTransaction \| Transaction \| string` via the relayer. Picks the `{ func, auth }` Soroban path for wallet invocations and the `{ xdr }` fee-bump path for deploys / source-account auth. **Never throws.** |
| `getTransaction(transactionId)` | `TransactionResult` | Poll a `skipWait` submission by its relayer id. |
| `getSigners(contractId)` | `WalletSigner[]` | Enumerate a wallet's signers via the indexer (flags evicted temporary signers when `rpcUrl` is set). |
| `getContractId(options, index?)` | `string \| undefined` | Reverse lookup: the wallet address for a signer. `options` = exactly one of `{ keyId }`, `{ publicKey }`, `{ policy }`. |

`options` for `send`/`getTransaction` is `{ skipWait?: boolean, fundRelayerId?: string }`. `getSigners`/`getContractId` delegate to a [`MercuryIndexer`](#discovery-indexer) over the keyless hosted endpoint.

## Submission (relayer)

All wallet writes are fee-sponsored by the [OpenZeppelin Relayer Channels](https://docs.openzeppelin.com/relayer/stellar) service: a channel account builds/pays for the transaction so the wallet holds no XLM. `PasskeyServer.send` routes to the relayer and returns a discriminated [`TransactionResult`](#errors).

Two submission modes are chosen automatically:

- **`{ func, auth }`** (`submitSorobanTransaction`) — for wallet invocations (transfers, signer management) whose auth is carried by Address credentials. The relayer builds the envelope.
- **`{ xdr }`** (`submitTransaction`) — for an already-signed envelope that needs a fee bump (deploys / source-account auth).

### Browsers: the relayer-proxy worker

The relayer API key is a secret, so a browser must never hold it. The [`relayer-proxy/`](./relayer-proxy) Cloudflare Worker fronts the relayer and **mints one API key per client IP** (keyless, cached in a per-IP Durable Object). The browser POSTs `{ func, auth }` / `{ xdr }` to the worker with **zero secrets in the bundle**. See [relayer-proxy/README.md](./relayer-proxy/README.md).

## Discovery (indexer)

Because every wallet address is derived deterministically from its passkey credential id (see [Deterministic derivation](#deterministic-derivation)), the primary "reconnect" path needs no indexer — `connectWallet` re-derives the address and confirms ownership on-chain. An indexer is for **richer discovery**: enumerating a wallet's full signer set, and reverse-looking-up which wallets a given signer belongs to.

The SDK abstracts discovery behind a `SignerIndexer` interface (`getSigners` / `findWallets` / `health`), implemented by the **keyless** `MercuryIndexer` — exported from the main `passkey-kit` entry (no secret, so it runs in the browser):

| Backend | Config | Wire | Status |
|---|---|---|---|
| `MercuryIndexer` | `MercuryIndexerConfig` (`url?`, `rpc?`) | Keyless REST (`GET /api/wallet/*`, `/api/lookup/*`) | **Live on testnet + mainnet** — both signer generations, full history. Resolve with `MercuryIndexer.forNetwork(...)`. |

> [!NOTE]
> Mercury's hosted passkey-indexer is public and **keyless**, covering **testnet and mainnet** with full history across both signer generations (legacy `("sw_v1", …)` tuples and the v1 typed `#[contractevent]`s). It returns fully-decoded signers, so the client maps JSON straight onto `WalletSigner`. Resolve the base URL per network with `MercuryIndexer.forNetwork({ rpc? }, networkPassphrase)` (returns `null` off testnet/mainnet); passing an `rpc` lets it flag evicted temporary signers and confirm reverse-lookup candidates on-chain.

```ts
const indexer = MercuryIndexer.forNetwork({ rpc }, networkPassphrase);
const wallets = await lookupWithRetry(() => indexer!.findWallets(SignerKey.Secp256r1(keyId)));
```

`lookupWithRetry(fn, { attempts?, delayMs?, predicate? })` (browser-safe) polls a lookup until it returns a non-empty result — useful right after a write, while the indexer catches up to the ledger.

## Tokens (`SACClient`)

Helper for [Stellar Asset Contracts](https://developers.stellar.org/docs/tokens/stellar-asset-contract) (SEP-41): balances, metadata, and transfers.

```ts
import { SACClient, buildTokenTransferHostFunction } from "passkey-kit";

const sac = new SACClient({ rpcUrl, networkPassphrase });
const token = sac.getSACClient("C…tokenId");

const tx = await token.transfer({ from: kit.contractId!, to, amount: 1_000_000n });
await kit.sign(tx);
await server.send(tx);
```

`buildTokenTransferHostFunction(token, from, to, amountInStroops)` builds a raw `transfer` host function for the low-level relayer `{ func, auth }` path when you don't need a full client.

## Storage adapters

Persist the passkey → wallet association so `connectWallet` can resolve a wallet from a keyId without an indexer. Import from `passkey-kit/storage` and pass to the kit's `storage` config.

| Adapter | Backing store | Use |
|---|---|---|
| `IndexedDBStorage` | IndexedDB | Browser (recommended). |
| `LocalStorageAdapter` | `localStorage` | Browser (simple/synchronous). |
| `MemoryStorage` | in-memory | Tests / SSR. |

```ts
import { IndexedDBStorage } from "passkey-kit/storage";
const kit = new PasskeyKit({ rpcUrl, networkPassphrase, walletWasmHash, storage: new IndexedDBStorage() });
```

All adapters implement `StorageAdapter` (`save` / `get` / `getByContract` / `getAll` / `delete` / `update` / `clear`) over `StoredPasskey` records.

## Errors

Every error the kit throws is a `PasskeyKitError` (or subclass) carrying a numeric `code`, optional `context`, and `cause`. Branch on `error.code` (or `instanceof`) — never on message strings.

**One deliberate exception:** submission methods (`server.send`, `getTransaction`) **do not throw** for expected on-chain/relayer failures. They return a discriminated `TransactionResult`:

```ts
const result = await server.send(tx);
if (result.success) {
  // TransactionSuccess: { success: true, hash, ledger?, transactionId? }
  console.log(result.hash);
} else {
  // TransactionFailure: { success: false, error: PasskeyKitError, hash? }
  if (result.error instanceof ContractError && result.error.contractErrorName === "SignerExpired") {
    // handle an on-chain contract failure by its decoded name
  }
}
```

Error classes: `ConfigurationError`, `WalletNotConnectedError`, `WalletOwnershipError`, `WebAuthnError`, `SigningError`, `SignerNotFoundError`, `SimulationError`, `SubmissionError`, `ValidationError`, `IndexerError`, `RelayerError`, and `ContractError`. Codes are grouped by concern (`1xxx` config, `2xxx` wallet, `3xxx` WebAuthn, `4xxx` signing, `5xxx` transaction, `6xxx` indexer, `7xxx` relayer, `8xxx` validation, `9xxx` storage, `10000` contract).

### Contract error decoding

On-chain failures surface as `Error(Contract, #N)` in diagnostics. `decodeContractError`, `contractErrorFromCode`, and `CONTRACT_ERROR_REGISTRY` map the code to a typed `ContractError` with its enum name. The v1 contract renumbered its error space to **100–129** (disjoint from the legacy 1–9 range, which is still decoded as family `SmartWalletLegacy`):

| Code | Name | Meaning |
|---|---|---|
| 100 | `SignerNotFound` | The requested signer does not exist. |
| 101 | `SignerAlreadyExists` | `add_signer` on an existing key. |
| 102 | `SignerExpired` | Expiration timestamp is in the past. |
| 110 | `MissingContext` | No signer in the map may authorize a requested context. |
| 111 | `SignatureKeyValueMismatch` | A signature's variant doesn't match its stored signer. |
| 120 | `ClientDataJsonTooLarge` | `clientDataJSON` exceeds the 1024-byte parse buffer. |
| 121 | `ClientDataJsonParseError` | `clientDataJSON` is not parseable. |
| 122 | `ClientDataJsonChallengeIncorrect` | WebAuthn challenge ≠ signature payload (binding). |
| 123 | `InvalidWebAuthnType` | `type` is not `"webauthn.get"`. |
| 124 | `InvalidAuthenticatorData` | `authenticatorData` shorter than 37 bytes. |
| 125 | `UserPresenceRequired` | Authenticator did not set the User Present (UP) flag. |

## Types

### `SignerKey`

Identifies a signer. The `value` is the string you work with.

```ts
SignerKey.Secp256r1(keyId)     // base64url passkey credential id
SignerKey.Ed25519(publicKey)   // G… public key
SignerKey.Policy(address)      // C… policy contract
```

### `SignerLimits`

```ts
type SignerLimits = Map<string, SignerKey[] | undefined> | undefined;
```

- `undefined` (whole map) — **fully unlimited**: may authorize anything, including deploys and this wallet's own admin functions.
- `Map` present but a contract → `undefined` — may authorize any call to that contract, no co-signers.
- `Map` present, contract → `[keys]` — may authorize calls to that contract **only if every listed key also approves** (required co-signers).

```ts
// This signer may only call C…token, and only alongside a passkey co-signer.
const limits = new Map([["C…token", [SignerKey.Secp256r1(keyId)]]]);
```

> [!IMPORTANT]
> **v1 breaking change.** `Some(empty map)` now means **no permissions (fail-closed)** — pre-1.0 an empty map meant *unlimited*. Deploy permission is no longer grantable through a limits entry: `CreateContract*` contexts require a fully unlimited (`undefined`-limits) signer.

### `SignerStore`

```ts
enum SignerStore { Persistent = "Persistent", Temporary = "Temporary" }
```

`Temporary` entries are cheaper but **can be evicted** when their ledger TTL lapses — see [Caveats](#caveats--footguns).

### Expiration

Signer and signature expiration are **UNIX timestamps in seconds** (inclusive: valid while `now <= expiration`). Pre-1.0 these were ledger sequence numbers; timestamps don't drift as ledger close-time changes.

## Caveats & footguns

> [!WARNING]
> These are inherent to the wallet model. The SDK does not guard against them — handle them in your app.

- **Don't remove your last usable signer → the wallet bricks.** The contract does not enforce a minimum signer count. If you remove (or let expire) every signer that can authorize admin functions, the wallet becomes permanently uncontrollable. Always keep at least one live, unlimited signer, and add the replacement *before* removing the old one.
- **A sole `Temporary` signer can be evicted → the wallet bricks.** Temporary entries are reclaimed when their TTL lapses. Never let a wallet's only admin signer live in `Temporary` storage; keep at least one `Persistent` signer.
- **The default deployer is a shared, public keypair.** It only pays fees and salts the deploy (it never controls the wallet), but its determinism is load-bearing for discovery. Overriding `deploySource` changes every derived address and breaks keyId → wallet lookup. See [Deterministic derivation](#deterministic-derivation).
- **Deploy front-running.** Because the deployer is public and the WASM is not part of the address preimage, anyone who learns a `keyId` before the wallet is deployed could deploy other code at the derived address. `connectWallet` mitigates this by verifying the keyId is a live signer (and, with `verifyWasmHash: true`, checking the on-chain WASM hash) — never trust a bare derived/looked-up address without that check.
- **WebAuthn requires User Presence (UP), not User Verification (UV).** The contract requires the UP flag but not UV (biometric/PIN), so it stays compatible with non-UV authenticators. Enforce UV at the client/relayer layer if you need it.
- **Value-moving policies need a cumulative cap or a co-signer.** A `Signature::Policy` carries no secret, so a per-transfer cap alone is trivially drained by repeated capped transfers. See the [contract interface](#contract-interface) and `sample-policy`.

## Contract interface

The wallet is a Soroban smart contract (`soroban-sdk 27`, `wasm32v1-none`). Every user wallet is a separate instance deployed with a `Signer` constructor argument.

**Functions:** `__constructor(signer)` · `add_signer(signer)` · `update_signer(signer)` · `remove_signer(signer_key)` · `upgrade(new_wasm_hash)` · `get_signer(signer_key) -> Option<SignerVal>`. Admin functions require wallet auth (`__check_auth`).

**Signer kinds:** `Policy(Address)` · `Ed25519(BytesN<32>)` · `Secp256r1(Bytes keyId)`, each with a `SignerExpiration`, `SignerLimits`, and `SignerStorage`.

**Auth (`__check_auth`):** a flat `Signatures` map (`SignerKey → Signature`) signed over the plain signature payload. Pass 1 checks every requested context is covered by some permitted, unexpired signer; pass 2 verifies **every** entry in the map (existence, expiration, crypto/policy). Include only the signatures you need.

**Policy lifecycle:** policy signers get an `install(wallet)` hook on add (a hard call — a panic aborts the add) and a permissionless `uninstall(wallet)` self-clean entrypoint. `policy__` is publicly callable — stateful policies must authenticate the caller (`source.require_auth()`).

**Events** (`#[contractevent]`, SEP-48 schema in the WASM): `signer_added` · `signer_updated` · `signer_removed` · `upgraded`. These replace the legacy `("sw_v1", …)` tuple events; indexers consume them directly.

See [`contracts/smart-wallet-interface/src/`](./contracts/smart-wallet-interface/src) for the canonical trait and types.

### Deterministic derivation

Every wallet address is derived from its passkey credential id (`keyId`) alone — this is what lets `connectWallet` and the indexers resolve a wallet without a lookup table:

```text
contractId = sha256(XDR(HashIdPreimage::EnvelopeTypeContractId {
    networkId:          sha256(networkPassphrase),
    contractIdPreimage: ContractIdPreimageFromAddress {
        address: G-address of the canonical deployer keypair,
        salt:    sha256(keyId),
    },
}))
```

- The canonical deployer keypair is `Keypair.fromRawEd25519Seed(sha256("kalepail"))`. It only pays fees and salts the deploy — it never controls the wallet — but its determinism is **load-bearing**: overriding `deploySource` changes every derived address and breaks keyId → wallet discovery.
- The WASM hash is deliberately **not** in the preimage, so an `upgrade` never moves a wallet's address.

This tuple is normative and must never change. See [`docs/deployments-testnet-2026-07-11.md`](./docs/deployments-testnet-2026-07-11.md) for the canonical WASM hashes, the deployer `G…` address, and the full derivation spec (including the deploy-front-running consequence in [Caveats](#caveats--footguns)).

## Repository layout & development

| Path | Contents |
|---|---|
| `src/` | The `passkey-kit` SDK (client, server, signers, indexer, storage). |
| `packages/passkey-kit-sdk` | Generated smart-wallet contract bindings (do not hand-edit — see [releasing](./docs/releasing.md)). |
| `packages/sac-sdk` | Generated SEP-41 SAC bindings. |
| `contracts/` | Rust Soroban contracts: `smart-wallet`, `smart-wallet-interface`, `sample-policy`, `example-contract`. |
| `relayer-proxy/` | Cloudflare Worker for keyless, fee-sponsored submission. |
| `demo/` | Svelte 5 demo exercising the full client API. |

```bash
pnpm install
pnpm build            # regenerate bindings, compile to dist/, verify Node-ESM import
pnpm test             # vitest (co-located src/*.test.ts)
pnpm verify:bindings  # assert the committed bindings match the canonical WASM
```

- **[CHANGELOG.md](./CHANGELOG.md)** — the v1 overhaul, by component.
- **[docs/migration-v1.md](./docs/migration-v1.md)** — upgrading from 0.12.x, with Before/After and a gap analysis.
- **[docs/releasing.md](./docs/releasing.md)** — the dependency-ordered publish flow.

## Resources

- [Super Peach](https://github.com/kalepail/superpeach) — a real-world implementation example.
- [Stellar Developers Discord `#passkeys`](https://discord.gg/stellardev) — questions and showcase.
