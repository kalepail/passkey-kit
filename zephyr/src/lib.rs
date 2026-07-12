//! passkey-kit Mercury (Zephyr) indexer.
//!
//! Ingests the v1 smart-wallet `#[contractevent]` events (`signer_added`,
//! `signer_updated`, `signer_removed`, `upgraded`) into two tables and exposes
//! two serverless read functions:
//!
//! - `get_signers_by_address(address)` — enumerate a wallet's signers.
//! - `get_addresses_by_signer(key, kind)` — reverse lookup (keyId -> wallets).
//!
//! Design notes (see `zephyr/README.md` for the full story):
//! - Single soroban-sdk (22.x, via zephyr-sdk); NO `smart-wallet-interface`
//!   dependency — the mirror types in `wallet.rs` decode the events instead.
//!   This kills the dual-soroban-sdk build failure (audit F1).
//! - WASM-hash allowlist gate on ingestion: only events from contracts whose
//!   on-chain instance executable is a known passkey-kit wallet are ingested
//!   (audit F3).
//! - Expiration is a UNIX timestamp, inclusive (`now <= exp`); it is stored and
//!   returned with an `expired` flag rather than filtered, and BOTH read
//!   functions apply the identical semantic (audit F4/F5).
//! - `debug_signers` (an unauthenticated full-table dump) is gone.

use base64::{
    engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD},
    Engine as _,
};
use serde::{Deserialize, Serialize};
use soroban_sdk::{
    xdr::{
        ContractExecutable, Hash, LedgerEntryData, Limits, ScAddress, ScSymbol, ScVal, WriteXdr,
    },
    Address, Bytes, BytesN,
};
use stellar_strkey::{ed25519, Strkey};
use zephyr_sdk::{
    bincode,
    utils::{address_from_str, address_to_alloc_string},
    EnvClient,
};

mod types;
mod wallet;

use types::{
    Signer, SignerActiveMutation, SignerKeyOnly, SignerMutation, SignerReadRow, Wallet,
    WalletAddrOnly, WalletHashMutation, WalletMatchRow, EXP_NEVER,
};
use wallet::{
    is_allowlisted, SignerAddedData, SignerKey, SignerRemovedData, SignerStorage, SignerUpdatedData,
    SignerVal, UpgradedData,
};

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn on_close() {
    let env = EnvClient::new();

    // Pass 1 — refresh the trusted-wallet set from this close's contract
    // instances. A wallet is trusted iff an allowlisted smart-wallet WASM was
    // observed as its instance executable (audit F3). `trusted` also serves as
    // an in-memory cache so same-close events (e.g. the constructor's
    // `signer_added`) are accepted before the `wallets` write is committed.
    let mut trusted: Vec<[u8; 32]> = Vec::new();
    let entries = env.reader().v1_success_ledger_entries();
    for entry in entries.created.iter().chain(entries.updated.iter()) {
        if let LedgerEntryData::ContractData(cd) = &entry.data {
            if let ScVal::LedgerKeyContractInstance = cd.key {
                if let ScVal::ContractInstance(instance) = &cd.val {
                    if let ContractExecutable::Wasm(Hash(hash)) = &instance.executable {
                        if is_allowlisted(hash) {
                            if let ScAddress::Contract(Hash(id)) = &cd.contract {
                                let address = ScVal::Address(ScAddress::Contract(Hash(*id)));
                                let wasm_hash =
                                    env.to_scval(BytesN::from_array(env.soroban(), hash));
                                upsert_wallet(&env, address, wasm_hash);
                                if !trusted.contains(id) {
                                    trusted.push(*id);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Pass 2 — ingest signer events from trusted wallets only. Event names are
    // matched as raw `ScVal::Symbol` values (deterministic structural byte
    // comparison) rather than via soroban `Symbol` equality, which for >9-char
    // symbols routes through env object comparison.
    let sym_added = sym_scval("signer_added");
    let sym_updated = sym_scval("signer_updated");
    let sym_removed = sym_scval("signer_removed");
    let sym_upgraded = sym_scval("upgraded");

    for event in env.reader().pretty().soroban_events() {
        let topic0 = match event.topics.get(0) {
            Some(t) => t,
            None => continue,
        };
        if topic0 != &sym_added
            && topic0 != &sym_updated
            && topic0 != &sym_removed
            && topic0 != &sym_upgraded
        {
            continue;
        }

        // Trust gate: this-close instance set, or a previously-recorded wallet.
        let contract_id = event.contract;
        let address = ScVal::Address(ScAddress::Contract(Hash(contract_id)));
        let is_trusted = trusted.contains(&contract_id) || wallet_is_trusted(&env, &address);
        if !is_trusted {
            continue;
        }
        if !trusted.contains(&contract_id) {
            trusted.push(contract_id);
        }

        if topic0 == &sym_added {
            let key = match event.topics.get(1) {
                Some(key) => key.clone(),
                None => continue,
            };
            match env.try_from_scval::<SignerAddedData>(&event.data) {
                Ok(data) => ingest_signer(&env, address, key, data.val, data.storage),
                Err(_) => continue,
            }
        } else if topic0 == &sym_updated {
            let key = match event.topics.get(1) {
                Some(key) => key.clone(),
                None => continue,
            };
            // `old_storage` (the pre-update durability) is available on
            // `SignerUpdatedData` but needs no separate handling: the index
            // keeps one row per (wallet, key) and rewrites `storage` in place,
            // so a durability flip is captured by the new `storage` alone.
            match env.try_from_scval::<SignerUpdatedData>(&event.data) {
                Ok(data) => ingest_signer(&env, address, key, data.val, data.storage),
                Err(_) => continue,
            }
        } else if topic0 == &sym_removed {
            let key = match event.topics.get(1) {
                Some(key) => key.clone(),
                None => continue,
            };
            // Decode to validate the v1 `signer_removed` data shape (Map{storage}).
            if env.try_from_scval::<SignerRemovedData>(&event.data).is_err() {
                continue;
            }
            deactivate_signer(&env, address, key);
        } else {
            // `upgraded`: refresh the (already-trusted) wallet's WASM hash.
            if let Ok(data) = env.try_from_scval::<UpgradedData>(&event.data) {
                refresh_wallet_hash(&env, &address, env.to_scval(data.new_hash));
            }
        }
    }
}

// --- ingestion helpers ------------------------------------------------------

/// Build an `ScVal::Symbol` for an event-name comparison (event topic 0).
fn sym_scval(name: &str) -> ScVal {
    ScVal::Symbol(ScSymbol(name.to_string().try_into().unwrap()))
}

fn wallet_is_trusted(env: &EnvClient, address: &ScVal) -> bool {
    let rows: Vec<WalletAddrOnly> = env
        .read_filter()
        .column_equal_to_xdr("address", address)
        .read()
        .unwrap();
    !rows.is_empty()
}

fn upsert_wallet(env: &EnvClient, address: ScVal, wasm_hash: ScVal) {
    let existing: Vec<WalletAddrOnly> = env
        .read_filter()
        .column_equal_to_xdr("address", &address)
        .read()
        .unwrap();
    if existing.is_empty() {
        env.put(&Wallet { address, wasm_hash });
    } else {
        env.update()
            .column_equal_to_xdr("address", &address)
            .execute(&WalletHashMutation { wasm_hash })
            .unwrap();
    }
}

fn refresh_wallet_hash(env: &EnvClient, address: &ScVal, wasm_hash: ScVal) {
    env.update()
        .column_equal_to_xdr("address", address)
        .execute(&WalletHashMutation { wasm_hash })
        .unwrap();
}

/// Decode a signer value into its indexable columns and upsert the row.
fn ingest_signer(
    env: &EnvClient,
    address: ScVal,
    key: ScVal,
    signer_val: SignerVal,
    storage: SignerStorage,
) {
    let (public_key, expiration, limits) = signer_val.into_parts();
    let val = match public_key {
        Some(public_key) => env.to_scval(public_key),
        None => ScVal::Void,
    };
    let exp = expiration.0.map(|t| t as i64).unwrap_or(EXP_NEVER);
    upsert_signer(
        env,
        address,
        key,
        val,
        env.to_scval(limits),
        exp,
        env.to_scval(storage),
    );
}

fn upsert_signer(
    env: &EnvClient,
    address: ScVal,
    key: ScVal,
    val: ScVal,
    limits: ScVal,
    exp: i64,
    storage: ScVal,
) {
    let existing: Vec<SignerKeyOnly> = env
        .read_filter()
        .column_equal_to_xdr("address", &address)
        .column_equal_to_xdr("key", &key)
        .read()
        .unwrap();
    if existing.is_empty() {
        env.put(&Signer {
            address,
            key,
            val,
            limits,
            exp,
            storage,
            active: true,
        });
    } else {
        env.update()
            .column_equal_to_xdr("address", &address)
            .column_equal_to_xdr("key", &key)
            .execute(&SignerMutation {
                val,
                limits,
                exp,
                storage,
                active: true,
            })
            .unwrap();
    }
}

fn deactivate_signer(env: &EnvClient, address: ScVal, key: ScVal) {
    let existing: Vec<SignerKeyOnly> = env
        .read_filter()
        .column_equal_to_xdr("address", &address)
        .column_equal_to_xdr("key", &key)
        .read()
        .unwrap();
    if !existing.is_empty() {
        env.update()
            .column_equal_to_xdr("address", &address)
            .column_equal_to_xdr("key", &key)
            .execute(&SignerActiveMutation { active: false })
            .unwrap();
    }
}

// ---------------------------------------------------------------------------
// Serverless read functions
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SignersByAddressRequest {
    address: String,
}

#[derive(Serialize)]
pub struct SignerResponse {
    /// "Policy" | "Ed25519" | "Secp256r1".
    kind: String,
    /// Policy: C-address; Ed25519: G-address; Secp256r1: base64url(keyId).
    key: String,
    /// Secp256r1: base64url(65-byte SEC-1 public key); null otherwise.
    val: Option<String>,
    /// Expiration UNIX timestamp (seconds), or null for never.
    expiration: Option<u64>,
    /// Whether the signer is expired at the current ledger timestamp.
    expired: bool,
    /// "Persistent" | "Temporary".
    storage: String,
    /// base64 (standard) of the `SignerLimits` XDR.
    limits: String,
}

/// Enumerate a wallet's live (non-removed) signers, expired ones included and
/// flagged. Removed signers are omitted (soft-deleted); surface removals via
/// the Stellar Indexer tombstone backend.
#[no_mangle]
pub extern "C" fn get_signers_by_address() {
    let env = EnvClient::empty();
    let SignersByAddressRequest { address } = env.read_request_body();
    let now = env.soroban().ledger().timestamp();

    let address = env.to_scval(address_from_str(&env, address.as_str()));
    let active_true = bincode::serialize(&true).unwrap();

    let rows: Vec<SignerReadRow> = env
        .read_filter()
        .column_equal_to_xdr("address", &address)
        .column_equal_to_bytes("active", &active_true)
        .read()
        .unwrap();

    let mut response: Vec<SignerResponse> = Vec::new();
    for row in rows {
        let (kind, key) = match env.from_scval::<SignerKey>(&row.key) {
            SignerKey::Policy(policy) => {
                ("Policy".to_string(), address_to_alloc_string(&env, policy))
            }
            SignerKey::Ed25519(public_key) => (
                "Ed25519".to_string(),
                Strkey::PublicKeyEd25519(ed25519::PublicKey(public_key.to_array())).to_string(),
            ),
            SignerKey::Secp256r1(key_id) => (
                "Secp256r1".to_string(),
                URL_SAFE_NO_PAD.encode(key_id.to_alloc_vec()),
            ),
        };

        let val = env
            .from_scval::<Option<BytesN<65>>>(&row.val)
            .map(|public_key| URL_SAFE_NO_PAD.encode(public_key.to_array()));

        let storage = storage_string(env.from_scval::<SignerStorage>(&row.storage));
        let (expiration, expired) = expiry(row.exp, now);

        response.push(SignerResponse {
            kind,
            key,
            val,
            expiration,
            expired,
            storage,
            limits: URL_SAFE.encode(row.limits.to_xdr(Limits::none()).unwrap()),
        });
    }

    env.conclude(response);
}

#[derive(Deserialize)]
pub struct AddressBySignerRequest {
    key: String,
    kind: String,
}

#[derive(Serialize)]
pub struct WalletMatch {
    /// Wallet contract C-address.
    address: String,
    expiration: Option<u64>,
    expired: bool,
    storage: String,
}

/// Reverse lookup: wallets on which a given signer key is live. Matches include
/// expired signers, flagged via `expired`. The SDK's `findWallets` maps this to
/// a plain address list; the expiration flag is exposed for parity with
/// `get_signers_by_address` (audit F5).
#[no_mangle]
pub extern "C" fn get_addresses_by_signer() {
    let env = EnvClient::empty();
    let AddressBySignerRequest { key, kind } = env.read_request_body();
    let now = env.soroban().ledger().timestamp();

    let key_scval = match kind.as_str() {
        "Policy" => env.to_scval(SignerKey::Policy(address_from_str(&env, key.as_str()))),
        "Ed25519" => {
            let raw = stellar_strkey::ed25519::PublicKey::from_string(&key).unwrap().0;
            env.to_scval(SignerKey::Ed25519(BytesN::from_array(env.soroban(), &raw)))
        }
        "Secp256r1" => {
            let raw = URL_SAFE_NO_PAD.decode(key).unwrap();
            env.to_scval(SignerKey::Secp256r1(Bytes::from_slice(env.soroban(), &raw)))
        }
        _ => {
            env.conclude::<Vec<WalletMatch>>(Vec::new());
            return;
        }
    };

    let active_true = bincode::serialize(&true).unwrap();
    let rows: Vec<WalletMatchRow> = env
        .read_filter()
        .column_equal_to_xdr("key", &key_scval)
        .column_equal_to_bytes("active", &active_true)
        .read()
        .unwrap();

    let mut response: Vec<WalletMatch> = Vec::new();
    for row in rows {
        let address = address_to_alloc_string(&env, env.from_scval::<Address>(&row.address));
        let storage = storage_string(env.from_scval::<SignerStorage>(&row.storage));
        let (expiration, expired) = expiry(row.exp, now);
        response.push(WalletMatch {
            address,
            expiration,
            expired,
            storage,
        });
    }

    env.conclude(response);
}

// --- read helpers -----------------------------------------------------------

fn storage_string(storage: SignerStorage) -> String {
    match storage {
        SignerStorage::Persistent => "Persistent".to_string(),
        SignerStorage::Temporary => "Temporary".to_string(),
    }
}

/// Map a stored `exp` and the current ledger timestamp to (expiration, expired).
/// Semantics: valid while `now <= exp` (inclusive); expired once `now > exp`.
fn expiry(exp: i64, now: u64) -> (Option<u64>, bool) {
    if exp == EXP_NEVER {
        (None, false)
    } else {
        (Some(exp as u64), (now as i64) > exp)
    }
}
