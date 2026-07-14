#![cfg(test)]
//! Signer management: add/update/remove/upgrade/get_signer, event emission,
//! durability moves, and the policy install/uninstall lifecycle.

extern crate std;

use smart_wallet_interface::{
    events::{SignerAdded, SignerRemoved, SignerUpdated, Upgraded},
    types::{
        Error, Signatures, Signer, SignerExpiration, SignerKey, SignerLimits, SignerStorage,
        SignerVal,
    },
    PolicyInterface, SmartWalletClient,
};
use soroban_sdk::{
    auth::Context,
    contract, contractimpl, contracttype, map,
    testutils::{Address as _, Events as _, Ledger as _},
    vec, Address, Bytes, Env, Event as _, IntoVal, Vec,
};

use crate::tests::test_common::*;
use crate::{Contract, ContractClient};

mod smart_wallet_wasm {
    use soroban_sdk::auth::Context;
    soroban_sdk::contractimport!(file = "fixtures/smart_wallet.wasm");
}

/// Policy that records install/uninstall state per wallet (the pattern
/// stateful policies must follow) and allows everything.
#[contract]
pub struct LifecyclePolicy;

#[contracttype]
pub enum LifecycleKey {
    Installed(Address),
}

#[contractimpl]
impl PolicyInterface for LifecyclePolicy {
    fn policy__(_env: Env, _source: Address, _signer: SignerKey, _contexts: Vec<Context>) {}

    fn install(env: Env, wallet: Address) {
        wallet.require_auth();
        env.storage()
            .persistent()
            .set(&LifecycleKey::Installed(wallet), &true);
    }

    fn uninstall(env: Env, wallet: Address) {
        // Permissionless self-clean (FIX-1): only clear once this policy is
        // genuinely no longer a signer on `wallet`.
        let still_signer = SmartWalletClient::new(&env, &wallet)
            .get_signer(&SignerKey::Policy(env.current_contract_address()))
            .is_some();
        assert!(!still_signer, "policy still installed");

        env.storage()
            .persistent()
            .remove(&LifecycleKey::Installed(wallet));
    }
}

/// Policy whose install always panics: adding it must fail.
#[contract]
pub struct RejectingPolicy;

#[contractimpl]
impl PolicyInterface for RejectingPolicy {
    fn policy__(_env: Env, _source: Address, _signer: SignerKey, _contexts: Vec<Context>) {}

    fn install(_env: Env, _wallet: Address) {
        panic!("install rejected");
    }

    fn uninstall(_env: Env, _wallet: Address) {}
}

/// Policy whose `uninstall` exhausts the transaction budget — a
/// NON-recoverable failure that `try_*` cannot catch. The wallet must never
/// invoke it on the removal path, so removal must still
/// succeed.
#[contract]
pub struct BudgetBurnPolicy;

#[contractimpl]
impl PolicyInterface for BudgetBurnPolicy {
    fn policy__(_env: Env, _source: Address, _signer: SignerKey, _contexts: Vec<Context>) {}

    fn install(env: Env, wallet: Address) {
        wallet.require_auth();
        let _ = env;
    }

    fn uninstall(env: Env, _wallet: Address) {
        // Unbounded metered work → Budget ExceededLimit (non-recoverable),
        // which unwinds the whole atomic transaction if ever reached.
        let mut bytes = Bytes::new(&env);
        loop {
            bytes.push_back(0xff);
            let _ = env.crypto().sha256(&bytes);
        }
    }
}

fn is_installed(env: &Env, policy: &Address, wallet: &Address) -> bool {
    env.as_contract(policy, || {
        env.storage()
            .persistent()
            .has(&LifecycleKey::Installed(wallet.clone()))
    })
}

fn has_entry(env: &Env, wallet: &Address, key: &SignerKey, storage: &SignerStorage) -> bool {
    env.as_contract(wallet, || match storage {
        SignerStorage::Persistent => env.storage().persistent().has::<SignerKey>(key),
        SignerStorage::Temporary => env.storage().temporary().has::<SignerKey>(key),
    })
}

// --- Constructor -----------------------------------------------------------

#[test]
fn constructor_stores_signer_and_emits_event() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let signer = a.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Persistent,
    );

    let (wallet, client) = register_wallet(&env, &signer);

    // events().all() only surfaces the LAST invocation's events — assert the
    // constructor's event before any other call.
    let expected = SignerAdded {
        key: a.signer_key(&env),
        val: SignerVal::Ed25519(SignerExpiration(None), SignerLimits(None)),
        storage: SignerStorage::Persistent,
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (wallet.clone(), expected.topics(&env), expected.data(&env))
        ]
    );

    assert_eq!(
        client.get_signer(&a.signer_key(&env)),
        Some(SignerVal::Ed25519(
            SignerExpiration(None),
            SignerLimits(None)
        ))
    );
}

// --- add_signer --------------------------------------------------------------

#[test]
fn add_signer_requires_auth() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    // No auth mocked: must fail.
    assert!(client
        .try_add_signer(&b.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ))
        .is_err());
}

#[test]
fn add_signer_duplicate_fails() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    assert_eq!(
        client.mock_all_auths().try_add_signer(&a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Temporary,
        )),
        Err(Ok(Error::SignerAlreadyExists))
    );
}

#[test]
fn add_signer_emits_event() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let passkey = Passkey::new(2);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&passkey.signer(
        &env,
        SignerExpiration(Some(123_456)),
        SignerLimits(None),
        SignerStorage::Temporary,
    ));

    let expected = SignerAdded {
        key: passkey.signer_key(&env),
        val: SignerVal::Secp256r1(
            passkey.public_key(&env),
            SignerExpiration(Some(123_456)),
            SignerLimits(None),
        ),
        storage: SignerStorage::Temporary,
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (wallet.clone(), expected.topics(&env), expected.data(&env))
        ]
    );
}

// --- update_signer ------------------------------------------------------------

#[test]
fn update_signer_nonexistent_fails() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    assert_eq!(
        client.mock_all_auths().try_update_signer(&b.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        )),
        Err(Ok(Error::SignerNotFound))
    );
}

/// A durability flip must remove the entry from the old durability (the "at
/// most one entry per key" invariant) and report the old storage in the event.
#[test]
fn update_signer_durability_flip() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let key = a.signer_key(&env);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    // A second durable admin, so demoting `a` (expiration + Temporary) does
    // not trip the last-admin guard.
    client
        .mock_all_auths()
        .add_signer(&Ed25519Signer::new(9).signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ));

    assert!(has_entry(&env, &wallet, &key, &SignerStorage::Persistent));

    client.mock_all_auths().update_signer(&a.signer(
        &env,
        SignerExpiration(Some(9_999)),
        SignerLimits(None),
        SignerStorage::Temporary,
    ));

    let expected = SignerUpdated {
        key: key.clone(),
        val: SignerVal::Ed25519(SignerExpiration(Some(9_999)), SignerLimits(None)),
        storage: SignerStorage::Temporary,
        old_storage: SignerStorage::Persistent,
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (wallet.clone(), expected.topics(&env), expected.data(&env))
        ]
    );

    assert!(!has_entry(&env, &wallet, &key, &SignerStorage::Persistent));
    assert!(has_entry(&env, &wallet, &key, &SignerStorage::Temporary));

    assert_eq!(
        client.get_signer(&key),
        Some(SignerVal::Ed25519(
            SignerExpiration(Some(9_999)),
            SignerLimits(None)
        ))
    );
}

#[test]
fn update_signer_same_durability() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let key = a.signer_key(&env);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    // A second durable admin, so giving `a` an expiration does not trip the
    // last-admin guard.
    client
        .mock_all_auths()
        .add_signer(&Ed25519Signer::new(9).signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ));

    client.mock_all_auths().update_signer(&a.signer(
        &env,
        SignerExpiration(Some(1_000)),
        SignerLimits(None),
        SignerStorage::Persistent,
    ));

    let expected = SignerUpdated {
        key: key.clone(),
        val: SignerVal::Ed25519(SignerExpiration(Some(1_000)), SignerLimits(None)),
        storage: SignerStorage::Persistent,
        old_storage: SignerStorage::Persistent,
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (wallet.clone(), expected.topics(&env), expected.data(&env))
        ]
    );

    assert!(has_entry(&env, &wallet, &key, &SignerStorage::Persistent));
}

// --- remove_signer ---------------------------------------------------------------

#[test]
fn remove_signer_nonexistent_fails() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&b.signer_key(&env)),
        Err(Ok(Error::SignerNotFound))
    );
}

#[test]
fn remove_signer_removes_and_emits_event() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);
    let key = b.signer_key(&env);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Temporary,
    ));
    assert!(has_entry(&env, &wallet, &key, &SignerStorage::Temporary));

    client.mock_all_auths().remove_signer(&key);

    let expected = SignerRemoved {
        key: key.clone(),
        storage: SignerStorage::Temporary,
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (wallet.clone(), expected.topics(&env), expected.data(&env))
        ]
    );

    assert!(!has_entry(&env, &wallet, &key, &SignerStorage::Temporary));
    assert_eq!(client.get_signer(&key), None);
}

// --- get_signer -------------------------------------------------------------------

#[test]
fn get_signer_returns_raw_value_even_expired() {
    let env = test_env();
    env.ledger().set_timestamp(1_000_000);

    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    // Long expired — get_signer is a raw storage view, not an auth check.
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(Some(1)),
        SignerLimits(None),
        SignerStorage::Persistent,
    ));

    assert_eq!(
        client.get_signer(&b.signer_key(&env)),
        Some(SignerVal::Ed25519(
            SignerExpiration(Some(1)),
            SignerLimits(None)
        ))
    );
    assert_eq!(
        client.get_signer(&Ed25519Signer::new(9).signer_key(&env)),
        None
    );
}

// --- upgrade -----------------------------------------------------------------------

#[test]
fn upgrade_emits_event_and_tracks_hash() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let wasm_hash = env.deployer().upload_contract_wasm(smart_wallet_wasm::WASM);

    // First upgrade: no cached previous hash — old_hash is None.
    client.mock_all_auths().upgrade(&wasm_hash);

    let expected = Upgraded {
        old_hash: None,
        new_hash: wasm_hash.clone(),
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (wallet.clone(), expected.topics(&env), expected.data(&env))
        ]
    );

    // Second upgrade (now executing the wasm build of this same contract):
    // the previous hash is known.
    client.mock_all_auths().upgrade(&wasm_hash);

    let expected = Upgraded {
        old_hash: Some(wasm_hash.clone()),
        new_hash: wasm_hash.clone(),
    };
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (wallet.clone(), expected.topics(&env), expected.data(&env))
        ]
    );

    // The wallet still works after upgrading (same source, wasm-executed).
    assert_eq!(
        client.get_signer(&a.signer_key(&env)),
        Some(SignerVal::Ed25519(
            SignerExpiration(None),
            SignerLimits(None)
        ))
    );
}

#[test]
fn upgrade_requires_auth() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let wasm_hash = env.deployer().upload_contract_wasm(smart_wallet_wasm::WASM);

    assert!(client.try_upgrade(&wasm_hash).is_err());
}

// --- Policy lifecycle (F6) --------------------------------------------------------

#[test]
fn policy_install_uninstall_lifecycle() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let policy = env.register(LifecyclePolicy, ());
    let policy_client = LifecyclePolicyClient::new(&env, &policy);
    let policy_key = SignerKey::Policy(policy.clone());

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    assert!(!is_installed(&env, &policy, &wallet));

    client.mock_all_auths().add_signer(&Signer::Policy(
        policy.clone(),
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Persistent,
    ));
    assert!(is_installed(&env, &policy, &wallet));

    // Permissionless uninstall is REFUSED while the policy is still a signer:
    // a griefer cannot clear install-state for an active policy.
    assert!(policy_client.try_uninstall(&wallet).is_err());
    assert!(is_installed(&env, &policy, &wallet));

    // Removal is pure wallet state — the wallet does NOT call uninstall, so
    // the signer is gone but the policy's install marker lingers.
    client.mock_all_auths().remove_signer(&policy_key);
    assert_eq!(client.get_signer(&policy_key), None);
    assert!(is_installed(&env, &policy, &wallet));

    // Now anyone can clean up: the cross-check to get_signer returns None.
    policy_client.uninstall(&wallet);
    assert!(!is_installed(&env, &policy, &wallet));
}

/// A policy signer can also be the FIRST signer: the constructor runs the
/// install hook too.
#[test]
fn constructor_installs_policy_signer() {
    let env = test_env();
    let policy_contract = env.register(LifecyclePolicy, ());

    let (wallet, _) = register_wallet(
        &env,
        &Signer::Policy(
            policy_contract.clone(),
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    assert!(is_installed(&env, &policy_contract, &wallet));
}

/// A policy that rejects install cannot be added as a signer.
#[test]
fn rejecting_policy_cannot_be_added() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let policy = env.register(RejectingPolicy, ());

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    assert!(client
        .mock_all_auths()
        .try_add_signer(&Signer::Policy(
            policy.clone(),
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ))
        .is_err());

    // The failed add left no state behind.
    assert_eq!(client.get_signer(&SignerKey::Policy(policy.clone())), None);
    assert!(!has_entry(
        &env,
        &wallet,
        &SignerKey::Policy(policy),
        &SignerStorage::Persistent
    ));
}

/// A policy whose `uninstall` exhausts the transaction budget (a
/// NON-recoverable failure that `try_uninstall` could not catch) must NOT
/// be able to block its own removal. Because the wallet never calls
/// uninstall on the removal path, the budget-burn never runs and removal
/// succeeds. Under the old best-effort `try_uninstall` this call would have
/// aborted the whole transaction and rolled the removal back.
#[test]
fn budget_exhausting_uninstall_cannot_block_removal() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let policy = env.register(BudgetBurnPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&Signer::Policy(
        policy.clone(),
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Persistent,
    ));

    client.mock_all_auths().remove_signer(&policy_key);
    assert_eq!(client.get_signer(&policy_key), None);
}

// --- Last-admin guard -----------------------------------------------------------
//
// A DURABLE ADMIN signer is unlimited + Persistent + non-expiring. The wallet
// rejects any remove/update transition that would take the durable-admin
// count from one to zero, because from zero unlimited signers no
// add_signer/upgrade can ever be authorized again, and the contract code is
// immutable.

fn admin_signer(env: &Env, seed: u8) -> (Ed25519Signer, Signer) {
    let s = Ed25519Signer::new(seed);
    let signer = s.signer(
        env,
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Persistent,
    );
    (s, signer)
}

#[test]
fn cannot_remove_last_admin_signer() {
    let env = test_env();
    let (a, a_signer) = admin_signer(&env, 1);

    let (_, client) = register_wallet(&env, &a_signer);

    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastAdminSigner))
    );

    // The signer is still there.
    assert!(client.get_signer(&a.signer_key(&env)).is_some());
}

#[test]
fn can_remove_admin_while_another_remains() {
    let env = test_env();
    let (a, a_signer) = admin_signer(&env, 1);
    let (b, b_signer) = admin_signer(&env, 2);

    let (_, client) = register_wallet(&env, &a_signer);
    client.mock_all_auths().add_signer(&b_signer);

    // Two durable admins: removing one is fine.
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Ok(Ok(()))
    );

    // Removing the survivor is rejected.
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&b.signer_key(&env)),
        Err(Ok(Error::LastAdminSigner))
    );
}

/// Demoting the last durable admin via `update_signer` is treated the same
/// as removing it — every demotion axis (limits, expiration, durability) is
/// rejected.
#[test]
fn cannot_demote_last_admin_via_update() {
    let env = test_env();
    let (a, a_signer) = admin_signer(&env, 1);

    let (_, client) = register_wallet(&env, &a_signer);

    // Limit it.
    assert_eq!(
        client.mock_all_auths().try_update_signer(&a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(soroban_sdk::map![&env])),
            SignerStorage::Persistent,
        )),
        Err(Ok(Error::LastAdminSigner))
    );

    // Give it an expiration.
    assert_eq!(
        client.mock_all_auths().try_update_signer(&a.signer(
            &env,
            SignerExpiration(Some(u64::MAX)),
            SignerLimits(None),
            SignerStorage::Persistent,
        )),
        Err(Ok(Error::LastAdminSigner))
    );

    // Move it to Temporary (evictable) storage.
    assert_eq!(
        client.mock_all_auths().try_update_signer(&a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Temporary,
        )),
        Err(Ok(Error::LastAdminSigner))
    );
}

/// Promotion via `update_signer` counts: a limited signer promoted to
/// durable admin frees the original admin for removal.
#[test]
fn promotion_updates_admin_accounting() {
    let env = test_env();
    let (a, a_signer) = admin_signer(&env, 1);
    let b = Ed25519Signer::new(2);

    let (_, client) = register_wallet(&env, &a_signer);

    // b starts limited (not an admin) — a is still the last admin.
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(Some(soroban_sdk::map![&env])),
        SignerStorage::Persistent,
    ));
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastAdminSigner))
    );

    // Promote b to durable admin: a becomes removable.
    client.mock_all_auths().update_signer(&b.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Persistent,
    ));
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Ok(Ok(()))
    );

    // And b is now the last admin.
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&b.signer_key(&env)),
        Err(Ok(Error::LastAdminSigner))
    );
}

/// Unlimited signers that are Temporary or expiring are NOT durable admins:
/// they can go dead without any contract call (eviction / expiry), so they
/// neither satisfy the invariant nor are they protected by it.
#[test]
fn temporary_or_expiring_unlimited_signers_are_not_durable_admins() {
    let env = test_env();
    let (a, a_signer) = admin_signer(&env, 1);
    let b = Ed25519Signer::new(2);
    let c = Ed25519Signer::new(3);

    let (_, client) = register_wallet(&env, &a_signer);

    // b: unlimited but Temporary. c: unlimited, Persistent, but expiring.
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Temporary,
    ));
    client.mock_all_auths().add_signer(&c.signer(
        &env,
        SignerExpiration(Some(u64::MAX)),
        SignerLimits(None),
        SignerStorage::Persistent,
    ));

    // Both are freely removable...
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&b.signer_key(&env)),
        Ok(Ok(()))
    );
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&c.signer_key(&env)),
        Ok(Ok(()))
    );

    // ...but they never counted: a is still the last durable admin.
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastAdminSigner))
    );
}

/// A sole limited, NON-admin-capable signer (empty limits map, durable-admin
/// count zero) is not protected by the admin guard — but the TOTAL-count
/// backstop still refuses to remove the wallet's literal last signer, so the
/// self-removal right stops one signer short of zero. The
/// distinct error code (`LastSigner`, not `LastAdminSigner`) also proves the
/// admin counter did NOT over-count this shape.
#[test]
fn sole_limited_signer_cannot_zero_out() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(soroban_sdk::map![&env])),
            SignerStorage::Persistent,
        ),
    );

    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastSigner))
    );
    assert!(client.get_signer(&a.signer_key(&env)).is_some());
}

/// Full-stack regression: a sole admin can AUTHORIZE its own removal
/// (the pass-1 self-removal rule and pass-2 both succeed), but execution of
/// `remove_signer` still rejects — the guard holds at execution time, not
/// only in the auth layer.
#[test]
fn last_admin_self_removal_fails_at_execution() {
    let env = test_env();
    let (a, a_signer) = admin_signer(&env, 1);

    let (wallet, client) = register_wallet(&env, &a_signer);

    let key = a.signer_key(&env);
    let root_invocation = remove_signer_invocation(&env, &wallet, &key);
    let nonce = 5i64;
    let signature_expiration_ledger = env.ledger().sequence();
    let payload = auth_payload(&env, nonce, signature_expiration_ledger, &root_invocation);

    let root_auth = soroban_sdk::xdr::SorobanAuthorizationEntry {
        credentials: soroban_sdk::xdr::SorobanCredentials::Address(
            soroban_sdk::xdr::SorobanAddressCredentials {
                address: wallet.clone().try_into().unwrap(),
                nonce,
                signature_expiration_ledger,
                signature: Signatures(soroban_sdk::map![
                    &env,
                    (key.clone(), a.sign(&env, &payload))
                ])
                .try_into()
                .unwrap(),
            },
        ),
        root_invocation,
    };

    assert_eq!(
        client.set_auths(&[root_auth]).try_remove_signer(&key),
        Err(Ok(Error::LastAdminSigner))
    );
    assert!(client.get_signer(&key).is_some());
}

// --- Last-admin guard: ADMIN-CAPABLE LIMITED signers ---------------------------
//
// A limits entry keyed by the wallet's OWN address with no required
// co-signers grants the full admin surface single-handedly (proven by
// `wallet_self_entry_grants_admin_functions`), so such signers must be
// counted as durable admins — otherwise a sole one could self-remove down
// to zero signers while ADMIN_COUNT sat at 0.

/// Register a wallet at a PRE-GENERATED address so the constructor signer's
/// limits can reference the wallet itself.
fn register_wallet_at<'a>(env: &Env, wallet: &Address, signer: &Signer) -> ContractClient<'a> {
    env.register_at(wallet, Contract, (signer.clone(),));
    ContractClient::new(env, wallet)
}

/// (b) A sole Ed25519 signer whose limits are `{wallet_self: None}` is a
/// durable admin: removal and demotion are both rejected.
#[test]
fn sole_wallet_self_limited_signer_cannot_remove_or_demote() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let wallet = Address::generate(&env);

    let client = register_wallet_at(
        &env,
        &wallet,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env, (wallet.clone(), None)])),
            SignerStorage::Persistent,
        ),
    );

    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastAdminSigner))
    );

    // Demotion by dropping the wallet-self entry is rejected the same way.
    let foreign = Address::generate(&env);
    assert_eq!(
        client.mock_all_auths().try_update_signer(&a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env, (foreign, None)])),
            SignerStorage::Persistent,
        )),
        Err(Ok(Error::LastAdminSigner))
    );

    assert!(client.get_signer(&a.signer_key(&env)).is_some());
}

/// An EMPTY required-co-signer list on the wallet-self entry imposes no
/// requirement (`verify_signer_limit_keys` treats it as `None`), so it also
/// counts as admin-capable and is protected.
#[test]
fn wallet_self_empty_cosigner_list_counts_as_admin() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let wallet = Address::generate(&env);

    let client = register_wallet_at(
        &env,
        &wallet,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env, (wallet.clone(), Some(vec![&env]))])),
            SignerStorage::Persistent,
        ),
    );

    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastAdminSigner))
    );
}

/// (c) NOT over-counted: a wallet-self entry WITH required co-signers cannot
/// authorize `add_signer` alone, and a limits map without any wallet-self
/// entry has no admin surface at all — neither is counted, both stay
/// removable (self-removal exit right preserved).
#[test]
fn cosigner_gated_and_foreign_limited_signers_not_counted() {
    // {wallet_self: Some([b])} — admin surface only WITH b's approval. As the
    // sole signer, removal is blocked by the TOTAL-count backstop; the error
    // being `LastSigner` (not `LastAdminSigner`) proves the admin counter did
    // not over-count the shape.
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);
    let wallet = Address::generate(&env);

    let client = register_wallet_at(
        &env,
        &wallet,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![
                &env,
                (wallet.clone(), Some(vec![&env, b.signer_key(&env)]))
            ])),
            SignerStorage::Persistent,
        ),
    );
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastSigner))
    );

    // With a second signer present it is freely removable (no admin guard).
    let (_, b_signer) = admin_signer(&env, 2);
    client.mock_all_auths().add_signer(&b_signer);
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Ok(Ok(()))
    );

    // {foreign: None} — no wallet-self entry, no admin surface: same shape of
    // proof.
    let env = test_env();
    let foreign = Address::generate(&env);
    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env, (foreign, None)])),
            SignerStorage::Persistent,
        ),
    );
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastSigner))
    );

    let (_, b_signer) = admin_signer(&env, 2);
    client.mock_all_auths().add_signer(&b_signer);
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Ok(Ok(()))
    );
}

/// (d) Two admin-capable-limited signers: one removable, the survivor
/// protected — the counter treats them exactly like unlimited admins.
#[test]
fn two_admin_capable_limited_signers_accounting() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);
    let wallet = Address::generate(&env);

    let self_admin_limits = SignerLimits(Some(map![&env, (wallet.clone(), None)]));

    let client = register_wallet_at(
        &env,
        &wallet,
        &a.signer(
            &env,
            SignerExpiration(None),
            self_admin_limits.clone(),
            SignerStorage::Persistent,
        ),
    );
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        self_admin_limits.clone(),
        SignerStorage::Persistent,
    ));

    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Ok(Ok(()))
    );
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&b.signer_key(&env)),
        Err(Ok(Error::LastAdminSigner))
    );
}

// --- Last-SIGNER backstop (terminal, classification-independent) ---------------
//
// Case (a): admin-capability classification is a whack-a-mole
// (e.g. a signer whose wallet-self entry names its OWN key as the required
// co-signer authorizes alone yet was uncounted). The TOTAL-signer counter
// closes the whole class: removing the literal last signer is rejected
// unconditionally, whatever the classification says.

/// Case (a) repro, full-stack: sole signer with
/// `{wallet_self: Some([own_key])}` — it satisfies its own co-signer
/// requirement, so it IS independently admin-capable, but the admin counter
/// does not know that shape. Its self-removal must be rejected by the
/// total-count backstop.
#[test]
fn sole_self_cosigner_signer_cannot_self_remove() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let key = a.signer_key(&env);
    let wallet = Address::generate(&env);

    let client = register_wallet_at(
        &env,
        &wallet,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![
                &env,
                (wallet.clone(), Some(vec![&env, key.clone()]))
            ])),
            SignerStorage::Persistent,
        ),
    );

    // Premise check: this signer really does authorize the admin surface
    // ALONE (it is its own required co-signer) — the exact under-count shape.
    let b = Ed25519Signer::new(2);
    let payload_val = payload(&env, 7);
    let new_signer: soroban_sdk::Val = b
        .signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        )
        .into_val(&env);
    assert_eq!(
        env.try_invoke_contract_check_auth::<Error>(
            &wallet,
            &payload_val,
            Signatures(map![&env, (key.clone(), a.sign(&env, &payload_val))]).into_val(&env),
            &vec![
                &env,
                contract_context(&env, &wallet, "add_signer", vec![&env, new_signer]),
            ],
        ),
        Ok(())
    );

    // Self-removal AUTH also passes (pass-1 self-removal rule) — but
    // EXECUTION rejects via the total-count backstop, full-stack.
    let root_invocation = remove_signer_invocation(&env, &wallet, &key);
    let nonce = 21i64;
    let signature_expiration_ledger = env.ledger().sequence();
    let payload = auth_payload(&env, nonce, signature_expiration_ledger, &root_invocation);

    let root_auth = soroban_sdk::xdr::SorobanAuthorizationEntry {
        credentials: soroban_sdk::xdr::SorobanCredentials::Address(
            soroban_sdk::xdr::SorobanAddressCredentials {
                address: wallet.clone().try_into().unwrap(),
                nonce,
                signature_expiration_ledger,
                signature: Signatures(map![&env, (key.clone(), a.sign(&env, &payload))])
                    .try_into()
                    .unwrap(),
            },
        ),
        root_invocation,
    };

    assert_eq!(
        client.set_auths(&[root_auth]).try_remove_signer(&key),
        Err(Ok(Error::LastSigner))
    );
    assert!(client.get_signer(&key).is_some());

    // The legitimate escape: rotate — add a replacement, THEN self-remove.
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Persistent,
    ));
    assert_eq!(client.mock_all_auths().try_remove_signer(&key), Ok(Ok(())));
}

/// EVERY sole-signer shape's last removal is rejected. The error code shows
/// which guard fired: `LastAdminSigner` for shapes the admin counter tracks,
/// `LastSigner` (the backstop) for everything else — either way, zero
/// signers is unreachable.
#[test]
fn every_sole_signer_shape_last_removal_rejected() {
    let a = Ed25519Signer::new(1);

    // (limits-builder, expected error) per shape. Built per-env below.
    let cases: std::vec::Vec<(
        &str,
        fn(&Env, &Address, &Ed25519Signer) -> SignerLimits,
        Error,
    )> = std::vec![
        (
            "unlimited",
            |_, _, _| SignerLimits(None),
            Error::LastAdminSigner
        ),
        (
            "wallet-self: None",
            |env, wallet, _| SignerLimits(Some(map![env, (wallet.clone(), None)])),
            Error::LastAdminSigner,
        ),
        (
            "wallet-self: Some([])",
            |env, wallet, _| SignerLimits(Some(map![env, (wallet.clone(), Some(vec![env]))])),
            Error::LastAdminSigner,
        ),
        (
            "wallet-self: Some([own key])",
            |env, wallet, a| {
                SignerLimits(Some(map![
                    env,
                    (wallet.clone(), Some(vec![env, a.signer_key(env)]))
                ]))
            },
            Error::LastSigner,
        ),
        (
            "wallet-self: Some([other key])",
            |env, wallet, _| {
                SignerLimits(Some(map![
                    env,
                    (
                        wallet.clone(),
                        Some(vec![env, Ed25519Signer::new(9).signer_key(env)])
                    )
                ]))
            },
            Error::LastSigner,
        ),
        (
            "foreign contract only",
            |env, _, _| SignerLimits(Some(map![env, (Address::generate(env), None)])),
            Error::LastSigner,
        ),
        (
            "empty map",
            |env, _, _| SignerLimits(Some(map![env])),
            Error::LastSigner,
        ),
    ];

    for (name, limits, expected) in cases {
        let env = test_env();
        let wallet = Address::generate(&env);
        let client = register_wallet_at(
            &env,
            &wallet,
            &a.signer(
                &env,
                SignerExpiration(None),
                limits(&env, &wallet, &a),
                SignerStorage::Persistent,
            ),
        );

        assert_eq!(
            client
                .mock_all_auths()
                .try_remove_signer(&a.signer_key(&env)),
            Err(Ok(expected)),
            "sole-signer shape not protected: {name}"
        );
        assert!(client.get_signer(&a.signer_key(&env)).is_some());
    }

    // Policy shapes: non-admin-shaped (empty map) → backstop; admin-shaped
    // (wallet-self grant) → admin guard.
    let env = test_env();
    let policy = env.register(LifecyclePolicy, ());
    let (_, client) = register_wallet(
        &env,
        &Signer::Policy(
            policy.clone(),
            SignerExpiration(None),
            SignerLimits(Some(map![&env])),
            SignerStorage::Persistent,
        ),
    );
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&SignerKey::Policy(policy.clone())),
        Err(Ok(Error::LastSigner))
    );

    let env = test_env();
    let policy = env.register(LifecyclePolicy, ());
    let wallet = Address::generate(&env);
    let client = register_wallet_at(
        &env,
        &wallet,
        &Signer::Policy(
            policy.clone(),
            SignerExpiration(None),
            SignerLimits(Some(map![&env, (wallet.clone(), None)])),
            SignerStorage::Persistent,
        ),
    );
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&SignerKey::Policy(policy.clone())),
        Err(Ok(Error::LastAdminSigner))
    );
}

/// Rotation is unaffected by the backstop: add the replacement FIRST, then
/// remove the old signer — for non-admin signers too.
#[test]
fn non_admin_rotation_still_works() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env])),
            SignerStorage::Persistent,
        ),
    );

    // total = 2: the old signer becomes removable.
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(Some(map![&env])),
        SignerStorage::Persistent,
    ));
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Ok(Ok(()))
    );

    // ...and the survivor is the new last signer.
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&b.signer_key(&env)),
        Err(Ok(Error::LastSigner))
    );
}

// --- Durable-count drift-freedom (final re-review counterexample) --------------
//
// The backstop counter includes ONLY durable (Persistent + non-expiring)
// signers, because those are the only entries that cannot leave storage
// without a counter-tracked contract call. These tests prove the reviewer's
// eviction/expiry counterexamples no longer unlock the last removal.

/// The reviewer's EXACT counterexample: A durable (non-admin) + B Temporary;
/// B EVICTS via TTL lapse (no contract call); removing A must still be
/// rejected — under the old total-count design B's ghost inflated the count
/// and this removal reached zero live signers.
#[test]
fn evicted_temporary_signer_does_not_unlock_last_removal() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);
    let a_key = a.signer_key(&env);
    let b_key = b.signer_key(&env);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env])), // non-admin: only the backstop protects
            SignerStorage::Persistent,
        ),
    );
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Temporary,
    ));

    // Evict B: advance halfway, keep A's entry and the instance alive, then
    // advance past B's (un-renewed) TTL.
    let max_ttl = env.as_contract(&wallet, || env.storage().max_ttl());
    env.ledger().with_mut(|l| l.sequence_number += max_ttl / 2);
    env.as_contract(&wallet, || {
        env.storage()
            .persistent()
            .extend_ttl::<SignerKey>(&a_key, max_ttl, max_ttl);
        env.storage().instance().extend_ttl(max_ttl, max_ttl);
    });
    env.ledger()
        .with_mut(|l| l.sequence_number += max_ttl / 2 + 10);

    // B is gone — evicted with no contract call; it cannot even be removed
    // (which is why no counter over non-durable entries can stay exact).
    assert_eq!(client.get_signer(&b_key), None);
    assert_eq!(
        client.mock_all_auths().try_remove_signer(&b_key),
        Err(Ok(Error::SignerNotFound))
    );

    // A is genuinely the last live signer, and the durable counter knows it.
    assert_eq!(
        client.mock_all_auths().try_remove_signer(&a_key),
        Err(Ok(Error::LastSigner))
    );
    assert!(client.get_signer(&a_key).is_some());
}

/// Expiry variant: B is Persistent but EXPIRING (never counted); after its
/// expiration lapses, removing A is still rejected.
#[test]
fn expired_signer_does_not_unlock_last_removal() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env])),
            SignerStorage::Persistent,
        ),
    );
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(Some(1_000)),
        SignerLimits(None),
        SignerStorage::Persistent,
    ));

    // B lapses — dead for auth purposes, no contract call involved.
    env.ledger().set_timestamp(2_000);

    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&a.signer_key(&env)),
        Err(Ok(Error::LastSigner))
    );

    // The dead-but-stored B itself is non-durable: freely removable.
    assert_eq!(
        client
            .mock_all_auths()
            .try_remove_signer(&b.signer_key(&env)),
        Ok(Ok(()))
    );
}

/// Demoting the last durable signer via `update_signer` — to Temporary
/// storage or to an expiring value — is a deferred removal (the entry can
/// then evict/lapse to zero with no call to guard): rejected. Non-admin
/// shape, so the error proves the DURABLE guard (104), not the admin one.
#[test]
fn cannot_demote_last_durable_signer_via_update() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    let (_, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env])),
            SignerStorage::Persistent,
        ),
    );

    assert_eq!(
        client.mock_all_auths().try_update_signer(&a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env])),
            SignerStorage::Temporary,
        )),
        Err(Ok(Error::LastSigner))
    );

    assert_eq!(
        client.mock_all_auths().try_update_signer(&a.signer(
            &env,
            SignerExpiration(Some(u64::MAX)),
            SignerLimits(Some(map![&env])),
            SignerStorage::Persistent,
        )),
        Err(Ok(Error::LastSigner))
    );

    // With a second durable signer present the demotion is fine.
    let (_, b_signer) = admin_signer(&env, 2);
    client.mock_all_auths().add_signer(&b_signer);
    assert_eq!(
        client.mock_all_auths().try_update_signer(&a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![&env])),
            SignerStorage::Temporary,
        )),
        Ok(Ok(()))
    );
}

/// A wallet whose FIRST signer is Temporary could evict to zero signers
/// with no guard able to see it: the constructor rejects it.
#[test]
#[should_panic(expected = "Error(Contract, #104)")]
fn constructor_rejects_temporary_first_signer() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Temporary,
        ),
    );
}

/// Same for an EXPIRING first signer.
#[test]
#[should_panic(expected = "Error(Contract, #104)")]
fn constructor_rejects_expiring_first_signer() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(Some(u64::MAX)),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );
}

// --- Secp256r1 signer shape ---------------------------------------------------

#[test]
fn secp256r1_signer_roundtrip() {
    let env = test_env();
    let passkey = Passkey::new(5);

    // Bootstrap with a durable admin (the constructor requires a durable
    // first signer), then exercise the Temporary Secp256r1 roundtrip.
    let (_, client) = register_wallet(
        &env,
        &Ed25519Signer::new(9).signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );
    client.mock_all_auths().add_signer(&passkey.signer(
        &env,
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Temporary,
    ));

    assert_eq!(
        client.get_signer(&SignerKey::Secp256r1(Bytes::from_slice(
            &env,
            &passkey.key_id
        ))),
        Some(SignerVal::Secp256r1(
            passkey.public_key(&env),
            SignerExpiration(None),
            SignerLimits(None)
        ))
    );
}
