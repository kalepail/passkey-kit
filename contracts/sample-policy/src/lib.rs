//! Sample policy demonstrating the smart wallet policy lifecycle SAFELY.
//!
//! It is a reference others copy, so it models every hardening the audit
//! asked for:
//!
//! - **Caller authentication (FIX-2).** `policy__` is publicly callable with
//!   an attacker-chosen `source`. Because this policy keeps per-wallet state,
//!   it calls `source.require_auth()` first. During a real `__check_auth` the
//!   wallet is the direct invoker of `policy__`, so invoker auth satisfies
//!   this; an external caller cannot satisfy it for a wallet it does not
//!   control. The `Installed(source)` marker is a secondary gate (it proves
//!   past installation, never current caller identity).
//! - **Deny-by-default (FIX-3).** Every context is rejected unless it is a
//!   `transfer` within the cap. Any other function, any non-contract context,
//!   a missing/mistyped amount argument, or a context targeting the wallet's
//!   own admin surface all FAIL CLOSED.
//! - **TTL renewal (FIX-4).** `install` and every successful `policy__`
//!   extend this policy's instance/code TTL and the `Installed(wallet)` key,
//!   so a policy participating in a wallet's authorization cannot silently
//!   archive into a wallet lock.
//! - **Permissionless self-clean (FIX-1).** The wallet does NOT call
//!   `uninstall` on removal. Anyone may call it; it clears `Installed(wallet)`
//!   only after confirming (via the wallet's own `get_signer`) that this
//!   policy is genuinely no longer a signer on that wallet.

#![no_std]

use smart_wallet_interface::{types::SignerKey, PolicyInterface, SmartWalletClient};
use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, TryFromVal, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PolicyError {
    /// A context is not permitted (deny-by-default).
    NotAllowed = 1,
    /// `policy__` was called for a wallet that never installed this policy.
    NotInstalled = 2,
    /// `uninstall` was called while this policy is still a signer on the
    /// wallet.
    StillInstalled = 3,
}

/// Maximum per-`transfer` amount this policy permits.
const TRANSFER_LIMIT: i128 = 10_000_000;

/// TTL renewal parameters (in ledgers at the historical 5s close time): bump
/// to ~30 days whenever remaining TTL drops below ~1 week. Both are well under
/// any real network's `max_ttl`.
const RENEW_THRESHOLD: u32 = 60 * 60 * 24 / 5 * 7;
const RENEW_TO: u32 = 60 * 60 * 24 / 5 * 30;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageKey {
    Installed(Address),
}

#[contract]
pub struct Contract;

#[contractimpl]
impl PolicyInterface for Contract {
    fn install(env: Env, wallet: Address) {
        // The wallet is the direct invoker during add_signer; invoker auth.
        wallet.require_auth();

        let key = StorageKey::Installed(wallet);
        env.storage()
            .persistent()
            .set::<StorageKey, bool>(&key, &true);

        renew_ttls(&env, &key);
    }

    fn uninstall(env: Env, wallet: Address) {
        // Permissionless (FIX-1): clear install-state only once this policy is
        // genuinely no longer a signer on `wallet`. The wallet's get_signer is
        // a read-only view; a griefer cannot clear state for a wallet where
        // this policy is still installed.
        let still_signer = SmartWalletClient::new(&env, &wallet)
            .get_signer(&SignerKey::Policy(env.current_contract_address()))
            .is_some();

        if still_signer {
            panic_with_error!(&env, PolicyError::StillInstalled);
        }

        env.storage()
            .persistent()
            .remove::<StorageKey>(&StorageKey::Installed(wallet));
    }

    fn policy__(env: Env, source: Address, _signer: SignerKey, contexts: Vec<Context>) {
        // FIX-2: authenticate the caller really is the wallet before touching
        // any per-wallet state. Satisfied by invoker auth during __check_auth.
        source.require_auth();

        let key = StorageKey::Installed(source.clone());
        if !env.storage().persistent().has::<StorageKey>(&key) {
            panic_with_error!(&env, PolicyError::NotInstalled);
        }

        // FIX-4: keep this policy and its install marker alive for as long as
        // it is actively authorizing.
        renew_ttls(&env, &key);

        // FIX-3: deny-by-default. Anything not explicitly permitted rejects.
        for context in contexts.iter() {
            match context {
                Context::Contract(ContractContext {
                    contract,
                    fn_name,
                    args,
                }) => {
                    // Never independently authorize the wallet's own admin
                    // surface (add/update/remove/upgrade). `source` is the
                    // wallet.
                    if contract == source {
                        panic_with_error!(&env, PolicyError::NotAllowed);
                    }

                    // Only `transfer` is permitted.
                    if fn_name != symbol_short!("transfer") {
                        panic_with_error!(&env, PolicyError::NotAllowed);
                    }

                    // Fail closed if the amount argument is missing or not an
                    // i128 (previously this fell open).
                    let amount = match args.get(2).and_then(|v| i128::try_from_val(&env, &v).ok()) {
                        Some(amount) => amount,
                        None => panic_with_error!(&env, PolicyError::NotAllowed),
                    };

                    if amount <= 0 || amount > TRANSFER_LIMIT {
                        panic_with_error!(&env, PolicyError::NotAllowed);
                    }
                }
                // Non-contract contexts (deploys, etc.) are never permitted.
                _ => panic_with_error!(&env, PolicyError::NotAllowed),
            }
        }
    }
}

fn renew_ttls(env: &Env, installed_key: &StorageKey) {
    env.storage()
        .instance()
        .extend_ttl(RENEW_THRESHOLD, RENEW_TO);
    env.storage()
        .persistent()
        .extend_ttl::<StorageKey>(installed_key, RENEW_THRESHOLD, RENEW_TO);
}
