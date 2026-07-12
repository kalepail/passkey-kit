#![cfg(test)]
//! Signer management: add/update/remove/upgrade/get_signer, event emission,
//! durability moves, and the policy install/uninstall lifecycle.

extern crate std;

use smart_wallet_interface::{
    events::{SignerAdded, SignerRemoved, SignerUpdated, Upgraded},
    types::{Error, Signer, SignerExpiration, SignerKey, SignerLimits, SignerStorage, SignerVal},
    PolicyInterface,
};
use soroban_sdk::{
    auth::Context,
    contract, contractimpl, contracttype,
    testutils::{Events as _, Ledger as _},
    vec, Address, Bytes, Env, Event as _, Vec,
};

use crate::tests::test_common::*;

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
        wallet.require_auth();
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

/// Policy whose uninstall always panics: removal must still succeed.
#[contract]
pub struct StickyPolicy;

#[contractimpl]
impl PolicyInterface for StickyPolicy {
    fn policy__(_env: Env, _source: Address, _signer: SignerKey, _contexts: Vec<Context>) {}

    fn install(env: Env, wallet: Address) {
        wallet.require_auth();
        let _ = env;
    }

    fn uninstall(_env: Env, _wallet: Address) {
        panic!("uninstall rejected");
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

    client.mock_all_auths().remove_signer(&policy_key);
    assert!(!is_installed(&env, &policy, &wallet));
    assert_eq!(client.get_signer(&policy_key), None);
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

/// A policy whose uninstall panics must NOT be able to block its own removal.
#[test]
fn sticky_policy_can_still_be_removed() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let policy = env.register(StickyPolicy, ());
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

// --- Secp256r1 signer shape ---------------------------------------------------

#[test]
fn secp256r1_signer_roundtrip() {
    let env = test_env();
    let passkey = Passkey::new(5);

    let (_, client) = register_wallet(
        &env,
        &passkey.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Temporary,
        ),
    );

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
