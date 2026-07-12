//! Database row structs for the two indexer tables (`signers`, `wallets`).
//!
//! `DatabaseDerive` maps each field to a column serialization by its Rust type:
//! `ScVal` -> XDR bytes (BYTEA); integers (`i64`) -> ZephyrVal (BIGINT); every
//! other type (here `bool`) -> bincode (BYTEA). Partial structs select a subset
//! of columns by name for reads/updates.
//!
//! NOTE: the `DatabaseDerive` macro panics on ANY struct-level attribute other
//! than `#[with_name]` (a `///` doc comment becomes a `#[doc]` attribute and
//! trips it), so these structs are documented with plain `//` comments.

use zephyr_sdk::{
    bincode,
    prelude::{Limits, ReadXdr, WriteXdr},
    soroban_sdk::xdr::ScVal,
    Condition, DatabaseDerive, DatabaseInteract, EnvClient, ZephyrVal,
};

/// Sentinel `exp` value meaning "never expires" (`SignerExpiration(None)`).
/// Chosen as `i64::MAX` so the inclusive `now <= exp` check is always true and
/// it fits the BIGINT column.
pub const EXP_NEVER: i64 = i64::MAX;

// --- signers table ----------------------------------------------------------

// One row per (wallet address, signer key). `active` is a soft-delete flag:
// there is no row-delete host op, so `remove_signer` flips `active` to false.
#[derive(DatabaseDerive, Clone)]
#[with_name("signers")]
pub struct Signer {
    /// Wallet contract address, as an `ScVal::Address`.
    pub address: ScVal,
    /// `SignerKey` ScVal (as emitted in event topic 1).
    pub key: ScVal,
    /// secp256r1 public key as `ScVal::Bytes(65)`, or `ScVal::Void` for
    /// Ed25519/Policy signers (which have no separate public key).
    pub val: ScVal,
    /// `SignerLimits` ScVal.
    pub limits: ScVal,
    /// Expiration UNIX timestamp (seconds), or `EXP_NEVER`.
    pub exp: i64,
    /// `SignerStorage` ScVal (Persistent | Temporary).
    pub storage: ScVal,
    /// Live (true) or removed (false).
    pub active: bool,
}

// Columns written when reactivating/updating an existing signer row (the
// (address, key) pair is supplied as the update filter, not rewritten).
#[derive(DatabaseDerive, Clone)]
#[with_name("signers")]
pub struct SignerMutation {
    pub val: ScVal,
    pub limits: ScVal,
    pub exp: i64,
    pub storage: ScVal,
    pub active: bool,
}

// Existence probe for a (address, key) pair.
#[derive(DatabaseDerive, Clone)]
#[with_name("signers")]
pub struct SignerKeyOnly {
    pub key: ScVal,
}

// Column written to soft-delete a signer on `remove_signer` (keeps every other
// column intact; the (address, key) pair is the update filter).
#[derive(DatabaseDerive, Clone)]
#[with_name("signers")]
pub struct SignerActiveMutation {
    pub active: bool,
}

// Projection for `get_signers_by_address`.
#[derive(DatabaseDerive, Clone)]
#[with_name("signers")]
pub struct SignerReadRow {
    pub key: ScVal,
    pub val: ScVal,
    pub limits: ScVal,
    pub exp: i64,
    pub storage: ScVal,
}

// Projection for `get_addresses_by_signer` (reverse lookup).
#[derive(DatabaseDerive, Clone)]
#[with_name("signers")]
pub struct WalletMatchRow {
    pub address: ScVal,
    pub exp: i64,
    pub storage: ScVal,
}

// --- wallets table ----------------------------------------------------------

// One row per trusted wallet: an allowlisted smart-wallet instance observed in
// the ledger. Membership is the ingestion trust gate (audit F3) and records
// the latest known WASM hash (also updated from `upgraded` events).
#[derive(DatabaseDerive, Clone)]
#[with_name("wallets")]
pub struct Wallet {
    pub address: ScVal,
    /// Latest known executable WASM hash, as `ScVal::Bytes(32)`.
    pub wasm_hash: ScVal,
}

// Existence probe / trust check for a wallet address.
#[derive(DatabaseDerive, Clone)]
#[with_name("wallets")]
pub struct WalletAddrOnly {
    pub address: ScVal,
}

// Column written when refreshing a known wallet's WASM hash.
#[derive(DatabaseDerive, Clone)]
#[with_name("wallets")]
pub struct WalletHashMutation {
    pub wasm_hash: ScVal,
}
