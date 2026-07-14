//! Sample policy: a CUMULATIVE rolling-window spending allowance.
//!
//! It is a reference others copy, so it models the full set of hardening
//! practices for policies and is safe even though `Signature::Policy`
//! carries no secret (anyone can submit it):
//!
//! - **Cumulative allowance.** A per-transfer cap is NOT a spending
//!   limit: because policy signatures are secretless, repeated capped
//!   transfers can move the wallet's full balance.
//!   This policy instead tracks cumulative spend per wallet within a rolling
//!   time window and rejects once the window's total would exceed the cap, so
//!   the most anyone can move through it is `WINDOW_ALLOWANCE` per
//!   `WINDOW_SECONDS` — a genuine, bounded rate limit.
//! - **Caller authentication.** `policy__` is publicly callable with
//!   any caller-chosen `source`. Because this policy keeps per-wallet state,
//!   it calls `source.require_auth()` first. During a real `__check_auth` the
//!   wallet is the direct invoker of `policy__`, so invoker auth satisfies
//!   this; an external caller cannot satisfy it for a wallet it does not
//!   control.
//! - **Deny-by-default.** Every context is rejected unless it is a
//!   `transfer` of a positive amount to a contract other than the wallet.
//!   Any other function, any non-contract context, a missing/mistyped amount,
//!   a non-positive amount, or a context targeting the wallet's own admin
//!   surface all FAIL CLOSED.
//! - **TTL renewal.** `install` and every successful `policy__`
//!   extend this policy's instance/code TTL and the per-wallet state keys, so
//!   a policy participating in a wallet's authorization cannot silently
//!   archive into a wallet lock.
//! - **Permissionless self-clean.** The wallet does NOT call
//!   `uninstall` on removal. Anyone may call it; it clears per-wallet state
//!   only after confirming (via the wallet's own `get_signer`) that this
//!   policy is genuinely no longer a signer on that wallet.
//!
//! Even with a cumulative allowance, a secretless value-moving policy should
//! generally ALSO be paired — via the granting signer's `SignerLimits` — with
//! an authenticated cryptographic co-signer, so that the bounded amount still
//! requires a real signature to move. The allowance bounds worst-case loss;
//! the co-signer removes the "anyone" from "anyone can spend up to the cap".
//!
//! - **Single-charge accounting.** This policy COMMITS spend in
//!   `policy__`. That is safe against multi-charging because the v1 wallet
//!   invokes limit-key policies only after every side-effect-free requirement
//!   of the candidate signer has already passed (co-signer presence, stored
//!   policy expiration), so a losing candidate never charges the allowance.
//!   Two caveats a copied policy inherits: never combine multiple
//!   state-committing policies in one required-keys list (an earlier
//!   policy's commit survives a later one's rejection if the auth succeeds
//!   through another candidate), and do not use one state-committing policy
//!   both as a `Signature::Policy` entry and as a required limit key in the
//!   same authorization (it is invoked — and commits — in both roles).

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
    /// A context is not permitted (deny-by-default), or the cumulative
    /// window allowance would be exceeded.
    NotAllowed = 1,
    /// `policy__` was called for a wallet that never installed this policy.
    NotInstalled = 2,
    /// `uninstall` was called while this policy is still a signer on the
    /// wallet.
    StillInstalled = 3,
}

/// Cumulative amount this policy will authorize for a wallet within one
/// window.
const WINDOW_ALLOWANCE: i128 = 100_000_000;
/// Rolling-window length in seconds (24h). A tumbling window: the first spend
/// after `WINDOW_SECONDS` have elapsed since the window started resets the
/// counter and begins a new window.
const WINDOW_SECONDS: u64 = 60 * 60 * 24;

/// TTL renewal parameters (in ledgers at the historical 5s close time): bump
/// to ~30 days whenever remaining TTL drops below ~1 week. Both are well under
/// any real network's `max_ttl`.
const RENEW_THRESHOLD: u32 = 60 * 60 * 24 / 5 * 7;
const RENEW_TO: u32 = 60 * 60 * 24 / 5 * 30;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageKey {
    Installed(Address),
    Spend(Address),
}

/// Per-wallet cumulative-spend accounting for the current window.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Allowance {
    pub window_start: u64,
    pub spent: i128,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl PolicyInterface for Contract {
    fn install(env: Env, wallet: Address) {
        // The wallet is the direct invoker during add_signer; invoker auth.
        wallet.require_auth();

        let installed_key = StorageKey::Installed(wallet);
        env.storage()
            .persistent()
            .set::<StorageKey, bool>(&installed_key, &true);

        renew_instance(&env);
        renew_persistent(&env, &installed_key);
    }

    fn uninstall(env: Env, wallet: Address) {
        // Permissionless (FIX-1): clear per-wallet state only once this policy
        // is genuinely no longer a signer on `wallet`. The wallet's get_signer
        // is a read-only view; a griefer cannot clear state for a wallet where
        // this policy is still installed.
        let still_signer = SmartWalletClient::new(&env, &wallet)
            .get_signer(&SignerKey::Policy(env.current_contract_address()))
            .is_some();

        if still_signer {
            panic_with_error!(&env, PolicyError::StillInstalled);
        }

        env.storage()
            .persistent()
            .remove::<StorageKey>(&StorageKey::Installed(wallet.clone()));
        env.storage()
            .persistent()
            .remove::<StorageKey>(&StorageKey::Spend(wallet));
    }

    fn policy__(env: Env, source: Address, _signer: SignerKey, contexts: Vec<Context>) {
        // FIX-2: authenticate the caller really is the wallet before touching
        // any per-wallet state. Satisfied by invoker auth during __check_auth.
        source.require_auth();

        let installed_key = StorageKey::Installed(source.clone());
        if !env.storage().persistent().has::<StorageKey>(&installed_key) {
            panic_with_error!(&env, PolicyError::NotInstalled);
        }

        // FIX-3: deny-by-default. Sum the transfer amounts across all contexts
        // in this invocation; anything not explicitly permitted rejects.
        let mut total: i128 = 0;
        for context in contexts.iter() {
            match context {
                Context::Contract(ContractContext {
                    contract,
                    fn_name,
                    args,
                }) => {
                    // Never authorize the wallet's own admin surface
                    // (add/update/remove/upgrade). `source` is the wallet.
                    if contract == source {
                        panic_with_error!(&env, PolicyError::NotAllowed);
                    }

                    // Only `transfer` is permitted.
                    if fn_name != symbol_short!("transfer") {
                        panic_with_error!(&env, PolicyError::NotAllowed);
                    }

                    // Fail closed if the amount argument is missing or not an
                    // i128.
                    let amount = match args.get(2).and_then(|v| i128::try_from_val(&env, &v).ok()) {
                        Some(amount) => amount,
                        None => panic_with_error!(&env, PolicyError::NotAllowed),
                    };

                    if amount <= 0 {
                        panic_with_error!(&env, PolicyError::NotAllowed);
                    }

                    total = match total.checked_add(amount) {
                        Some(total) => total,
                        None => panic_with_error!(&env, PolicyError::NotAllowed),
                    };
                }
                // Non-contract contexts (deploys, etc.) are never permitted.
                _ => panic_with_error!(&env, PolicyError::NotAllowed),
            }
        }

        // FIX-3b: cumulative rolling-window allowance. Load the wallet's spend
        // record, resetting it if the window has elapsed, and reject if this
        // invocation would push cumulative spend over the cap.
        let now = env.ledger().timestamp();
        let spend_key = StorageKey::Spend(source.clone());
        let mut allowance = env
            .storage()
            .persistent()
            .get::<StorageKey, Allowance>(&spend_key)
            .unwrap_or(Allowance {
                window_start: now,
                spent: 0,
            });

        if now.saturating_sub(allowance.window_start) >= WINDOW_SECONDS {
            allowance.window_start = now;
            allowance.spent = 0;
        }

        let new_spent = match allowance.spent.checked_add(total) {
            Some(new_spent) => new_spent,
            None => panic_with_error!(&env, PolicyError::NotAllowed),
        };

        if new_spent > WINDOW_ALLOWANCE {
            panic_with_error!(&env, PolicyError::NotAllowed);
        }

        allowance.spent = new_spent;
        env.storage()
            .persistent()
            .set::<StorageKey, Allowance>(&spend_key, &allowance);

        // FIX-4: keep this policy and its per-wallet state alive for as long
        // as it is actively authorizing.
        renew_instance(&env);
        renew_persistent(&env, &installed_key);
        renew_persistent(&env, &spend_key);
    }
}

fn renew_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(RENEW_THRESHOLD, RENEW_TO);
}

fn renew_persistent(env: &Env, key: &StorageKey) {
    env.storage()
        .persistent()
        .extend_ttl::<StorageKey>(key, RENEW_THRESHOLD, RENEW_TO);
}
