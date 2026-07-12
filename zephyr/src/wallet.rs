//! Local, version-decoupled mirror of the smart wallet's on-chain types plus
//! the v1 `#[contractevent]` payload shapes the indexer decodes.
//!
//! These `#[contracttype]` definitions are byte-for-byte ScVal-compatible with
//! the contract's `smart-wallet-interface` types, but are built on THIS crate's
//! single soroban-sdk (22.x, brought in by zephyr-sdk) rather than the
//! contract's soroban-sdk 27. Depending on `smart-wallet-interface` directly
//! would pull a SECOND soroban-sdk into the tree and fail the build — that dual
//! soroban-sdk is exactly what audit F1 flagged. Mirroring the few types we
//! decode keeps the indexer decoupled from the contract crate's toolchain while
//! staying wire-compatible (the ScVal enum/struct encoding is protocol-stable
//! across soroban-sdk versions).

use soroban_sdk::{contracttype, Address, Bytes, BytesN, Map, Vec};

// --- Signer model (mirror of smart-wallet-interface::types) -----------------

/// UNIX timestamp (seconds) expiration, inclusive; `None` never expires. v1
/// changed this from a ledger sequence number (audit F12).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerExpiration(pub Option<u64>);

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerLimits(pub Option<Map<Address, Option<Vec<SignerKey>>>>);

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SignerStorage {
    Persistent,
    Temporary,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SignerKey {
    Policy(Address),
    Ed25519(BytesN<32>),
    Secp256r1(Bytes),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SignerVal {
    Policy(SignerExpiration, SignerLimits),
    Ed25519(SignerExpiration, SignerLimits),
    Secp256r1(BytesN<65>, SignerExpiration, SignerLimits),
}

impl SignerVal {
    /// Split a stored signer value into its indexable parts: the secp256r1
    /// public key (only present for passkey signers), expiration, and limits.
    pub fn into_parts(self) -> (Option<BytesN<65>>, SignerExpiration, SignerLimits) {
        match self {
            SignerVal::Policy(exp, limits) => (None, exp, limits),
            SignerVal::Ed25519(exp, limits) => (None, exp, limits),
            SignerVal::Secp256r1(public_key, exp, limits) => (Some(public_key), exp, limits),
        }
    }
}

// --- Event data payloads ----------------------------------------------------
//
// The v1 events are `#[contractevent]` structs whose default `data_format` is
// `map`: the non-`#[topic]` fields are emitted as an ScVal::Map keyed by field
// name. The `#[topic]` `key` field is NOT part of the data (it's topic index
// 1). Struct decode is by field name, so the declaration order below is
// irrelevant.

/// Data of `signer_added` — topics: `[sym("signer_added"), <SignerKey>]`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerAddedData {
    pub storage: SignerStorage,
    pub val: SignerVal,
}

/// Data of `signer_updated` — topics: `[sym("signer_updated"), <SignerKey>]`.
/// `old_storage` is the durability the entry lived in before the update (the
/// contract tombstones the old durability if the update flips it; the indexer
/// keeps a single row per (wallet, key) and simply rewrites `storage`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerUpdatedData {
    pub old_storage: SignerStorage,
    pub storage: SignerStorage,
    pub val: SignerVal,
}

/// Data of `signer_removed` — topics: `[sym("signer_removed"), <SignerKey>]`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerRemovedData {
    pub storage: SignerStorage,
}

/// Data of `upgraded` — topics: `[sym("upgraded")]`. `old_hash` is `None` on a
/// wallet's first-ever upgrade.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradedData {
    pub new_hash: BytesN<32>,
    pub old_hash: Option<BytesN<32>>,
}

// --- WASM-hash allowlist (audit F3) -----------------------------------------

/// Known passkey-kit smart-wallet WASM hashes (hex), sourced from
/// `docs/deployments-testnet-2026-07-11.md` — the canonical hash manifest.
/// NEVER rebuild these locally; consume the manifest.
///
/// Only events emitted by a contract whose on-chain instance executable is one
/// of these are ingested. Without this gate any contract emitting well-formed
/// `signer_added`/… events could inject arbitrary signer rows and poison the
/// reverse (keyId -> wallet) lookup (audit F3).
pub const ALLOWLISTED_WASM_HASHES: [&str; 2] = [
    // v1 smart wallet — soroban-sdk 27, #[contractevent] schema.
    "9e7fad441d6560b31eafbf3b627dbc196cf19df4dcdb91e0aededaf6590d6fbe",
    // Legacy pre-1.0 wallet — sw_v1 tuple events (ignored by this indexer), but
    // a known smart wallet: a legacy wallet can upgrade in place to a v1 hash
    // and keep its address, at which point it starts emitting v1 events.
    "e45c42b944a767bd5f37f8c4a469b48917d28e23481dbfd550419c84cdacde92",
];

/// Whether a 32-byte WASM hash is a known passkey-kit smart wallet.
pub fn is_allowlisted(wasm_hash: &[u8; 32]) -> bool {
    let observed = hex::encode(wasm_hash);
    ALLOWLISTED_WASM_HASHES.iter().any(|h| *h == observed)
}
