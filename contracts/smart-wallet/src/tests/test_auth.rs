#![cfg(test)]
//! `__check_auth` semantics: signer limits branches, expiration boundaries,
//! multi-sig requirements, self-removal, deploy permission, policy
//! granularity, and the recursion depth guard.

extern crate std;

use smart_wallet_interface::{
    types::{
        Error, Signature, Signatures, Signer, SignerExpiration, SignerKey, SignerLimits,
        SignerStorage,
    },
    PolicyInterface,
};
use soroban_sdk::{
    auth::{Context, ContractExecutable, CreateContractHostFnContext},
    contract, contractimpl, map, symbol_short,
    testutils::{Address as _, Ledger as _},
    vec, Address, Env, IntoVal, InvokeError, Val, Vec,
};

use crate::tests::test_common::*;

/// Test policy that allows everything and counts `policy__` invocations in
/// its instance storage, to observe invocation granularity.
#[contract]
pub struct CountingPolicy;

#[contractimpl]
impl PolicyInterface for CountingPolicy {
    fn policy__(env: Env, _source: Address, _signer: SignerKey, _contexts: Vec<Context>) {
        let count: u32 = env
            .storage()
            .instance()
            .get(&symbol_short!("count"))
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&symbol_short!("count"), &(count + 1));
    }

    fn install(env: Env, wallet: Address) {
        wallet.require_auth();
        let _ = env;
    }

    fn uninstall(env: Env, wallet: Address) {
        wallet.require_auth();
        let _ = env;
    }
}

fn policy_count(env: &Env, policy: &Address) -> u32 {
    env.as_contract(policy, || {
        env.storage()
            .instance()
            .get(&symbol_short!("count"))
            .unwrap_or(0)
    })
}

fn check_auth(
    env: &Env,
    wallet: &Address,
    payload: &soroban_sdk::BytesN<32>,
    signatures: Signatures,
    contexts: &Vec<Context>,
) -> Result<(), Result<Error, InvokeError>> {
    env.try_invoke_contract_check_auth::<Error>(wallet, payload, signatures.into_val(env), contexts)
}

fn no_limits() -> SignerLimits {
    SignerLimits(None)
}

fn empty_limits(env: &Env) -> SignerLimits {
    SignerLimits(Some(map![env]))
}

fn contract_limits(env: &Env, contract: &Address, keys: Option<Vec<SignerKey>>) -> SignerLimits {
    SignerLimits(Some(map![env, (contract.clone(), keys)]))
}

// --- Basic coverage ------------------------------------------------------

#[test]
fn unlimited_signer_authorizes_anything() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Ok(())
    );
}

/// F9: `Some(empty map)` is fail-closed — NO permissions.
#[test]
fn empty_limits_map_authorizes_nothing() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            empty_limits(&env),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Err(Ok(Error::MissingContext))
    );
}

#[test]
fn limited_signer_covers_only_granted_contract() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let token = Address::generate(&env);
    let other = Address::generate(&env);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            contract_limits(&env, &token, None),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let signatures = Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]);

    // Granted contract: covered.
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            signatures.clone(),
            &vec![&env, transfer_context(&env, &token, &wallet, 1)],
        ),
        Ok(())
    );

    // Any other contract: not covered.
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            signatures.clone(),
            &vec![&env, transfer_context(&env, &other, &wallet, 1)],
        ),
        Err(Ok(Error::MissingContext))
    );

    // Multiple contexts where only one is covered: whole auth fails.
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            signatures,
            &vec![
                &env,
                transfer_context(&env, &token, &wallet, 1),
                transfer_context(&env, &other, &wallet, 1),
            ],
        ),
        Err(Ok(Error::MissingContext))
    );
}

// --- Signatures map hygiene (pass 2) -------------------------------------

#[test]
fn unknown_signer_alone_is_missing_context() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let stranger = Ed25519Signer::new(2);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    // Only a signature from a signer that is not stored on the wallet:
    // nothing can cover the context.
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![
                &env,
                (stranger.signer_key(&env), stranger.sign(&env, &payload))
            ]),
            &contexts,
        ),
        Err(Ok(Error::MissingContext))
    );
}

/// Every signatures-map entry must be stored: an unknown extra signer fails
/// the whole auth even when another signer covers all contexts.
#[test]
fn unknown_extra_signer_fails_auth() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let stranger = Ed25519Signer::new(2);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![
                &env,
                (a.signer_key(&env), a.sign(&env, &payload)),
                (stranger.signer_key(&env), stranger.sign(&env, &payload)),
            ]),
            &contexts,
        ),
        Err(Ok(Error::SignerNotFound))
    );
}

#[test]
fn empty_signatures_map_is_missing_context() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(&env, &wallet, &payload, Signatures(map![&env]), &contexts),
        Err(Ok(Error::MissingContext))
    );
}

#[test]
fn invalid_ed25519_signature_fails_in_host() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    // b's signature submitted under a's key.
    let result = check_auth(
        &env,
        &wallet,
        &payload,
        Signatures(map![&env, (a.signer_key(&env), b.sign(&env, &payload))]),
        &contexts,
    );

    assert!(result.is_err());
    assert!(
        !matches!(result, Err(Ok(_))),
        "must fail in host crypto, not a wallet-typed error: {result:?}"
    );
}

/// `Signature::Policy` submitted for an Ed25519 signer key.
#[test]
fn policy_signature_for_ed25519_key_is_mismatch() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), Signature::Policy)]),
            &contexts,
        ),
        Err(Ok(Error::SignatureKeyValueMismatch))
    );
}

// --- Expiration (F2/F12) --------------------------------------------------

/// Expiration is inclusive: valid while `now <= exp`, expired once `now > exp`.
#[test]
fn expiration_boundary() {
    let env = test_env();
    let expiration = 10_000u64;
    let a = Ed25519Signer::new(1);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(Some(expiration)),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];
    let signatures = Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]);

    // At exactly the expiration timestamp: still valid.
    env.ledger().set_timestamp(expiration);
    assert_eq!(
        check_auth(&env, &wallet, &payload, signatures.clone(), &contexts),
        Ok(())
    );

    // One second past: expired.
    env.ledger().set_timestamp(expiration + 1);
    assert_eq!(
        check_auth(&env, &wallet, &payload, signatures, &contexts),
        Err(Ok(Error::SignerExpired))
    );
}

/// An expired EXTRA signer poisons the auth deterministically (pass 2 checks
/// every entry), regardless of whether it was needed for coverage.
#[test]
fn expired_extra_signer_fails_auth() {
    let env = test_env();
    env.ledger().set_timestamp(1_000_000);

    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    // b expired long ago.
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(Some(1)),
        no_limits(),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![
                &env,
                (a.signer_key(&env), a.sign(&env, &payload)),
                (b.signer_key(&env), b.sign(&env, &payload)),
            ]),
            &contexts,
        ),
        Err(Ok(Error::SignerExpired))
    );
}

// --- Multi-sig via limits (co-signers) ------------------------------------

fn multisig_setup(env: &Env) -> (Address, Ed25519Signer, Ed25519Signer, Address) {
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);
    let token = Address::generate(env);

    let (wallet, client) = register_wallet(
        env,
        &b.signer(
            env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    // a may only touch `token`, and only together with b.
    client.mock_all_auths().add_signer(&a.signer(
        env,
        SignerExpiration(None),
        contract_limits(env, &token, Some(vec![env, b.signer_key(env)])),
        SignerStorage::Persistent,
    ));

    (wallet, a, b, token)
}

#[test]
fn co_signer_present_authorizes() {
    let env = test_env();
    let (wallet, a, b, token) = multisig_setup(&env);

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![
                &env,
                (a.signer_key(&env), a.sign(&env, &payload)),
                (b.signer_key(&env), b.sign(&env, &payload)),
            ]),
            &contexts,
        ),
        Ok(())
    );
}

#[test]
fn co_signer_missing_fails_coverage() {
    let env = test_env();
    let (wallet, a, _b, token) = multisig_setup(&env);

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    // a alone: its limits require b in the signatures map.
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Err(Ok(Error::MissingContext))
    );
}

/// An expired co-signer satisfies pass-1 presence but fails pass 2: the F2
/// hole (expired co-signer silently satisfying limits) is closed.
#[test]
fn expired_co_signer_fails_auth() {
    let env = test_env();
    env.ledger().set_timestamp(1_000_000);

    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);
    let token = Address::generate(&env);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            contract_limits(&env, &token, Some(vec![&env, b.signer_key(&env)])),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(Some(1)),
        no_limits(),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![
                &env,
                (a.signer_key(&env), a.sign(&env, &payload)),
                (b.signer_key(&env), b.sign(&env, &payload)),
            ]),
            &contexts,
        ),
        Err(Ok(Error::SignerExpired))
    );
}

/// Mutual co-signer requirements (2-of-2) work: non-policy required keys are
/// presence-checked, so there is no recursion.
#[test]
fn mutual_co_signers_authorize() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);
    let token = Address::generate(&env);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            contract_limits(&env, &token, Some(vec![&env, b.signer_key(&env)])),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        contract_limits(&env, &token, Some(vec![&env, a.signer_key(&env)])),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![
                &env,
                (a.signer_key(&env), a.sign(&env, &payload)),
                (b.signer_key(&env), b.sign(&env, &payload)),
            ]),
            &contexts,
        ),
        Ok(())
    );
}

// --- Self-removal rule -----------------------------------------------------

/// A limited signer (even with an empty limits map) may always remove itself.
#[test]
fn limited_signer_can_always_self_remove() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            empty_limits(&env),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let contexts = vec![
        &env,
        remove_signer_context(&env, &wallet, &a.signer_key(&env)),
    ];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Ok(())
    );
}

/// Removing a DIFFERENT key is not self-removal.
#[test]
fn limited_signer_cannot_remove_others() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            empty_limits(&env),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let contexts = vec![
        &env,
        remove_signer_context(&env, &wallet, &b.signer_key(&env)),
    ];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Err(Ok(Error::MissingContext))
    );
}

/// F5 regression: a foreign contract's `remove_signer` function (with
/// arbitrary argument types) must not trip the self-removal rule — the rule
/// is gated on the wallet's own address, and foreign args must never panic.
#[test]
fn foreign_remove_signer_fn_does_not_interfere() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let foreign = Address::generate(&env);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            contract_limits(&env, &foreign, None),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    // foreign.remove_signer(u32, u32) — not a SignerKey in sight.
    let contexts = vec![
        &env,
        contract_context(
            &env,
            &foreign,
            "remove_signer",
            vec![&env, 42u32.into_val(&env), 43u32.into_val(&env)],
        ),
    ];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Ok(())
    );
}

/// The wallet's own address in a limits map grants the admin surface — an
/// explicit, documented escalation grant.
#[test]
fn wallet_self_entry_grants_admin_functions() {
    let env = test_env();
    let bootstrap = Ed25519Signer::new(9);
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);

    // The wallet address is only known after registration, so bootstrap with
    // an unlimited signer and then add the wallet-self-limited one.
    let (wallet, client) = register_wallet(
        &env,
        &bootstrap.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&a.signer(
        &env,
        SignerExpiration(None),
        contract_limits(&env, &wallet, None),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let new_signer: Val = b
        .signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        )
        .into_val(&env);
    let contexts = vec![
        &env,
        contract_context(&env, &wallet, "add_signer", vec![&env, new_signer]),
    ];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Ok(())
    );
}

// --- Deploy permission (F9 decoupling) -------------------------------------

fn create_contract_context(env: &Env) -> Context {
    Context::CreateContractHostFn(CreateContractHostFnContext {
        executable: ContractExecutable::Wasm(soroban_sdk::BytesN::from_array(env, &[9; 32])),
        salt: soroban_sdk::BytesN::from_array(env, &[8; 32]),
    })
}

#[test]
fn unlimited_signer_can_deploy() {
    let env = test_env();
    let a = Ed25519Signer::new(1);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let contexts = vec![&env, create_contract_context(&env)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Ok(())
    );
}

/// Deploy permission is NOT grantable through limits — not even a wallet-self
/// entry (the pre-1.0 coupling) grants it.
#[test]
fn limited_signer_cannot_deploy() {
    let env = test_env();
    let bootstrap = Ed25519Signer::new(9);
    let a = Ed25519Signer::new(1);

    let (wallet, client) = register_wallet(
        &env,
        &bootstrap.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    // Even a wallet-self limits entry (the pre-1.0 deploy grant) does not
    // grant deploy.
    client.mock_all_auths().add_signer(&a.signer(
        &env,
        SignerExpiration(None),
        contract_limits(&env, &wallet, None),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, create_contract_context(&env)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Err(Ok(Error::MissingContext))
    );
}

// --- Policy invocation granularity ------------------------------------------

/// A policy used as a signature sees the full context list in ONE call.
#[test]
fn policy_as_signature_called_once_with_all_contexts() {
    let env = test_env();
    let policy = env.register(CountingPolicy, ());
    let token = Address::generate(&env);
    let a = Ed25519Signer::new(1);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&Signer::Policy(
        policy.clone(),
        SignerExpiration(None),
        no_limits(),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![
        &env,
        transfer_context(&env, &token, &wallet, 1),
        transfer_context(&env, &token, &wallet, 2),
    ];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![
                &env,
                (SignerKey::Policy(policy.clone()), Signature::Policy)
            ]),
            &contexts,
        ),
        Ok(())
    );

    assert_eq!(policy_count(&env, &policy), 1);
}

/// A policy used inside another signer's limits is invoked once PER covered
/// context.
#[test]
fn policy_as_limit_called_per_context() {
    let env = test_env();
    let policy = env.register(CountingPolicy, ());
    let token = Address::generate(&env);
    let a = Ed25519Signer::new(1);

    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            contract_limits(
                &env,
                &token,
                Some(vec![&env, SignerKey::Policy(policy.clone())]),
            ),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let contexts = vec![
        &env,
        transfer_context(&env, &token, &wallet, 1),
        transfer_context(&env, &token, &wallet, 2),
    ];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Ok(())
    );

    assert_eq!(policy_count(&env, &policy), 2);
}

// --- Recursion depth guard (F10) ---------------------------------------------

/// Two stored policies whose limits require each other would recurse
/// unboundedly without the depth guard; with it, coverage fails closed.
#[test]
fn cyclic_policy_limits_fail_closed() {
    let env = test_env();
    let policy_a = env.register(CountingPolicy, ());
    let policy_b = env.register(CountingPolicy, ());
    let token = Address::generate(&env);
    let s = Ed25519Signer::new(1);

    let (wallet, client) = register_wallet(
        &env,
        &s.signer(
            &env,
            SignerExpiration(None),
            contract_limits(
                &env,
                &token,
                Some(vec![&env, SignerKey::Policy(policy_a.clone())]),
            ),
            SignerStorage::Persistent,
        ),
    );

    // policy_a requires policy_b for token, policy_b requires policy_a: cycle.
    client.mock_all_auths().add_signer(&Signer::Policy(
        policy_a.clone(),
        SignerExpiration(None),
        contract_limits(
            &env,
            &token,
            Some(vec![&env, SignerKey::Policy(policy_b.clone())]),
        ),
        SignerStorage::Persistent,
    ));
    client.mock_all_auths().add_signer(&Signer::Policy(
        policy_b.clone(),
        SignerExpiration(None),
        contract_limits(
            &env,
            &token,
            Some(vec![&env, SignerKey::Policy(policy_a.clone())]),
        ),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    // Fails closed via the depth guard — no stack/budget blowup.
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (s.signer_key(&env), s.sign(&env, &payload))]),
            &contexts,
        ),
        Err(Ok(Error::MissingContext))
    );
}

/// An expired stored policy referenced in limits rejects the candidate
/// (boolean, in pass 1 — such keys never reach pass 2).
#[test]
fn expired_stored_policy_limit_key_rejects() {
    let env = test_env();
    env.ledger().set_timestamp(1_000_000);

    let policy = env.register(CountingPolicy, ());
    let token = Address::generate(&env);
    let a = Ed25519Signer::new(1);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            contract_limits(
                &env,
                &token,
                Some(vec![&env, SignerKey::Policy(policy.clone())]),
            ),
            SignerStorage::Persistent,
        ),
    );

    // The policy itself is stored — and expired.
    client.mock_all_auths().add_signer(&Signer::Policy(
        policy.clone(),
        SignerExpiration(Some(1)),
        no_limits(),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (a.signer_key(&env), a.sign(&env, &payload))]),
            &contexts,
        ),
        Err(Ok(Error::MissingContext))
    );
}
