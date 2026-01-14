# Passkey Kit

> [!TIP]
> **Looking for the latest smart wallet SDK?**
>
> This package is the **legacy precursor** to [OpenZeppelin Smart Accounts](https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account). For new projects, use **[smart-account-kit](https://github.com/kalepail/smart-account-kit)** — a comprehensive SDK built on top of the audited [OpenZeppelin stellar-contracts](https://github.com/OpenZeppelin/stellar-contracts) library.
>
> Smart Account Kit includes:
> - Context rules with fine-grained authorization scopes
> - Policy support (threshold multisig, spending limits, custom policies)
> - Session management with automatic credential persistence
> - External wallet adapter support
> - Built-in indexer for contract discovery
>
> See the [OpenZeppelin Smart Account package](https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/accounts) and [multisig example](https://github.com/OpenZeppelin/stellar-contracts/tree/main/examples/multisig-smart-account/account) for more details.

> [!WARNING]
> Code in this repo is demo material only. It has not been audited. Do not use to hold, protect, or secure anything.

A TypeScript SDK for creating and managing Stellar smart wallets using passkeys. Works with [OpenZeppelin Relayer](https://docs.openzeppelin.com/relayer/1.3.x/guides/stellar-channels-guide) for submitting passkey-signed transactions onchain.

**Demo:** [passkey-kit-demo.pages.dev](https://passkey-kit-demo.pages.dev/)

## Installation

```bash
pnpm i passkey-kit
```

## Exports

```ts
import {
    PasskeyKit,      // Client-side wallet management
    PasskeyServer,   // Server-side utilities
    SACClient,       // Stellar Asset Contract helper
    PasskeyClient,   // Low-level contract client (from passkey-kit-sdk)
    SignerKey,       // Signer key type constructor
    SignerStore,     // Storage type enum
    type Signer,     // Signer type
    type SignerLimits // Signer limits type
} from 'passkey-kit'
```

---

## PasskeyKit (Client)

Handles wallet creation, connection, and transaction signing.

### Constructor

```ts
const account = new PasskeyKit({
    rpcUrl: string,              // Stellar RPC URL
    networkPassphrase: string,   // Network passphrase
    walletWasmHash: string,      // Smart wallet WASM hash
    timeoutInSeconds?: number,   // Transaction timeout (default: 30)
    WebAuthn?: {                 // Optional WebAuthn override
        startRegistration,
        startAuthentication
    }
})
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `keyId` | `string \| undefined` | Current passkey ID (base64url) |
| `wallet` | `PasskeyClient \| undefined` | Connected wallet client |
| `networkPassphrase` | `string` | Network passphrase |

### Methods

#### `createWallet(app, user, settings?)`
Creates a new passkey and deploys a smart wallet.

```ts
const { rawResponse, keyId, keyIdBase64, contractId, signedTx } = await account.createWallet(
    'My App',           // App name shown in passkey prompt
    'user@example.com', // User identifier
    {
        rpId?: string,  // Relying party ID
        authenticatorSelection?: AuthenticatorSelectionCriteria
    }
)
```

#### `createKey(app, user, settings?)`
Creates a new passkey without deploying a wallet.

```ts
const { rawResponse, keyId, keyIdBase64, publicKey } = await account.createKey(
    'My App',
    'user@example.com',
    { rpId?: string, authenticatorSelection?: AuthenticatorSelectionCriteria }
)
```

#### `connectWallet(opts?)`
Connects to an existing wallet using a passkey.

```ts
const { rawResponse, keyId, keyIdBase64, contractId } = await account.connectWallet({
    rpId?: string,
    keyId?: string | Uint8Array,           // Skip passkey prompt if provided
    getContractId?: (keyId: string) => Promise<string | undefined>,  // Lookup function
    walletPublicKey?: string               // For backwards compatibility
})
```

#### `sign(txn, options?)`
Signs all auth entries for the connected wallet in a transaction.

```ts
const signedTxn = await account.sign(
    txn,  // AssembledTransaction | Tx | string (XDR)
    {
        rpId?: string,
        keyId?: 'any' | string | Uint8Array,  // 'any' allows any passkey
        keypair?: Keypair,                     // Sign with Ed25519 instead
        policy?: string,                       // Sign with policy instead
        expiration?: number                    // Ledger expiration
    }
)
```

#### `signAuthEntry(entry, options?)`
Signs a single authorization entry. Same options as `sign()`.

```ts
const signedEntry = await account.signAuthEntry(entry, options)
```

#### Signer Management

Add, update, or remove signers from the wallet.

```ts
// Add signers
await account.addSecp256r1(keyId, publicKey, limits, store, expiration?)
await account.addEd25519(publicKey, limits, store, expiration?)
await account.addPolicy(policy, limits, store, expiration?)

// Update signers
await account.updateSecp256r1(keyId, publicKey, limits, store, expiration?)
await account.updateEd25519(publicKey, limits, store, expiration?)
await account.updatePolicy(policy, limits, store, expiration?)

// Remove signer
await account.remove(signerKey)
```

**Parameters:**
- `keyId` - Passkey ID (string or Uint8Array)
- `publicKey` - Public key (string or Uint8Array for Secp256r1, Stellar public key for Ed25519)
- `policy` - Policy contract address
- `limits` - `SignerLimits` (see Types below)
- `store` - `SignerStore.Persistent` or `SignerStore.Temporary`
- `expiration` - Optional ledger expiration

---

## PasskeyServer (Server)

Server-side utilities for Mercury indexing and OpenZeppelin Relayer.

### Constructor

```ts
const server = new PasskeyServer({
    rpcUrl?: string,
    relayerUrl?: string,         // OpenZeppelin Relayer URL
    relayerApiKey?: string,      // Relayer API key
    mercuryProjectName?: string, // Mercury project name
    mercuryUrl?: string,         // Mercury URL
    mercuryJwt?: string,         // Mercury JWT (use either JWT or Key)
    mercuryKey?: string          // Mercury API key
})
```

### Methods

#### `getSigners(contractId)`
Get all signers for a wallet from Mercury.

```ts
const signers: Signer[] = await server.getSigners('C...')
```

#### `getContractId(options, index?)`
Reverse lookup a wallet address from a signer.

```ts
const contractId = await server.getContractId({
    keyId?: string,     // Passkey ID (Secp256r1)
    publicKey?: string, // Ed25519 public key
    policy?: string     // Policy address
}, index)  // If multiple wallets, select by index (default: 0)
```

#### `send(txn)`
Submit a transaction via OpenZeppelin Relayer.

```ts
const result = await server.send(txn)  // AssembledTransaction | Tx | string
```

---

## SACClient

Helper for interacting with Stellar Asset Contracts.

```ts
const sac = new SACClient({
    networkPassphrase: string,
    rpcUrl: string
})

const tokenClient = sac.getSACClient('C...')  // SAC contract ID
```

---

## Types

### SignerKey

```ts
SignerKey.Policy(contractAddress)    // Policy signer
SignerKey.Ed25519(publicKey)         // Ed25519 signer
SignerKey.Secp256r1(keyId)           // Passkey signer
```

### SignerLimits

```ts
type SignerLimits = Map<string, SignerKey[] | undefined> | undefined

// Example: Limit signer to specific contract, requires co-signer
const limits = new Map([
    ['C...contractAddress', [SignerKey.Ed25519('G...')]]
])
```

### SignerStore

```ts
enum SignerStore {
    Persistent = 'Persistent',  // Permanent storage
    Temporary = 'Temporary'     // Expires, cheaper
}
```

### Signer

```ts
type Signer = {
    kind: string       // 'Secp256r1' | 'Ed25519' | 'Policy'
    key: string        // Signer identifier
    val: string        // Public key or empty
    expiration: number | null
    storage: 'Persistent' | 'Temporary'
    limits: string     // JSON stringified limits
    evicted?: boolean  // True if temporary signer was evicted
}
```

---

## Deploy the Mercury Indexer

To track signers and reverse lookup wallet addresses, deploy the Zephyr program:

```bash
cd ./zephyr
cargo install mercury-cli
# Get a JWT from https://test.mercurydata.app
export MERCURY_JWT="<YOUR.MERCURY.JWT>"
# Requires Rust 1.79.0+
mercury-cli --jwt $MERCURY_JWT --local false --mainnet false deploy
```

---

## TypeScript Configuration

This library exports TypeScript only to avoid bundling `@stellar/stellar-sdk` twice. Configure your bundler to transpile it.

**Next.js** (`next.config.mjs`):
```mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
    transpilePackages: [
        'passkey-kit',
        'passkey-factory-sdk',
        'passkey-kit-sdk',
        'sac-sdk',
    ]
}

export default nextConfig
```

---

## Contributing

```bash
# Install dependencies
pnpm i

# Build
pnpm run build

# Run demo
cd ./demo && pnpm i && pnpm run start
```

**Directory structure:**
- `./src` - TypeScript SDK source
- `./demo` - Demo application
- `./contracts` - Rust Soroban smart contracts
- `./zephyr` - Mercury Zephyr indexer program

> [!IMPORTANT]
> If modifying contracts in `./contracts`, run the make commands. Update `SMART_WALLET_FACTORY` and `SMART_WALLET_WASM` values from `make deploy` before running `make init`.

> [!IMPORTANT]
> The bindings in `./packages` have been heavily modified. When rebuilding, prefer updating only the `src/index.ts` files in each package.

---

## Resources

- [Super Peach](https://github.com/kalepail/superpeach) - Real-world implementation example
- [Discord #passkeys](https://discord.gg/stellardev) - Questions and showcase
