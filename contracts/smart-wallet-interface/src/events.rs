//! Smart wallet event schema (v1).
//!
//! These replace the legacy `("sw_v1", <action>, <key>)` tuple events. Each
//! event is a `#[contractevent]` struct, so its full schema is embedded in the
//! contract spec (SEP-48) and consumed by indexers from the wasm itself. The
//! first topic is the snake_case struct name (`signer_added`, `signer_updated`,
//! `signer_removed`, `upgraded`), which is the version marker for this scheme.
//!
//! Events are a complete mirror of signer-storage transitions: the full new
//! state is always emitted, plus the old storage class on updates so indexers
//! can detect durability moves (an update that flips durability tombstones the
//! entry in one durability while a live twin appears in the other).

use soroban_sdk::{contractevent, BytesN};

use crate::types::{SignerKey, SignerStorage, SignerVal};

/// A signer was added (via `__constructor` or `add_signer`).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerAdded {
    #[topic]
    pub key: SignerKey,
    pub val: SignerVal,
    pub storage: SignerStorage,
}

/// An existing signer was modified via `update_signer`.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerUpdated {
    #[topic]
    pub key: SignerKey,
    pub val: SignerVal,
    pub storage: SignerStorage,
    pub old_storage: SignerStorage,
}

/// A signer was removed via `remove_signer`. `storage` is the durability the
/// entry was removed from.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerRemoved {
    #[topic]
    pub key: SignerKey,
    pub storage: SignerStorage,
}

/// The contract's wasm was replaced via `upgrade`. `old_hash` is `None` on a
/// wallet's first-ever upgrade: the host exposes no way for a contract to
/// read its own executable hash, so the wallet caches the hash in instance
/// storage at each upgrade and the genesis hash is unknowable in-contract.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Upgraded {
    pub old_hash: Option<BytesN<32>>,
    pub new_hash: BytesN<32>,
}
