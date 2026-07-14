#![cfg(test)]
//! `__check_auth` semantics: signer limits branches, expiration boundaries,
//! multi-sig requirements, self-removal, deploy permission, policy
//! granularity, and required-co-signer scope-independence (FIX-5).

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
    contract, contracterror, contractimpl, map, panic_with_error, symbol_short,
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

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum VetoErr {
    Veto = 77,
}

/// Test policy that ALWAYS REJECTS `policy__` (with a recoverable contract
/// error) but installs/uninstalls fine. The shipped suite previously
/// only ever exercised approving policies, so deleting an approval check
/// survived every test.
#[contract]
pub struct VetoPolicy;

#[contractimpl]
impl PolicyInterface for VetoPolicy {
    fn policy__(env: Env, _source: Address, _signer: SignerKey, _contexts: Vec<Context>) {
        panic_with_error!(&env, VetoErr::Veto);
    }

    fn install(env: Env, wallet: Address) {
        wallet.require_auth();
        let _ = env;
    }

    fn uninstall(_env: Env, _wallet: Address) {}
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

    // Bootstrap with a durable admin (the constructor requires a durable
    // first signer), then add the expiring signer under test.
    let (wallet, client) = register_wallet(
        &env,
        &Ed25519Signer::new(9).signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );
    client.mock_all_auths().add_signer(&a.signer(
        &env,
        SignerExpiration(Some(expiration)),
        no_limits(),
        SignerStorage::Persistent,
    ));

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

/// An expired EXTRA signer fails the auth deterministically (pass 2 checks
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

// --- Required co-signer scope-independence (FIX-5) ---------------------------

/// A non-policy required co-signer's OWN limits do not constrain its
/// co-signer role: even `Some(empty)` ("no independent permissions") does not
/// disable it as an approver. A+B authorize the token context although B could
/// not cover anything on its own.
#[test]
fn nonpolicy_co_signer_own_limits_not_enforced() {
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

    // B has an empty limits map — it cannot INDEPENDENTLY cover anything.
    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        empty_limits(&env),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    // B on its own cannot cover the token context.
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (b.signer_key(&env), b.sign(&env, &payload))]),
            &contexts,
        ),
        Err(Ok(Error::MissingContext))
    );

    // But B still serves as A's required co-signer.
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

/// A stored policy required co-signer's OWN limits are likewise not
/// recursively enforced: only its `policy__` decision matters. What was
/// previously a "cycle" (policy_a requires policy_b requires policy_a) simply
/// resolves through each policy's `policy__` approval — no recursion, no depth
/// guard, no blowup.
#[test]
fn policy_co_signer_own_limits_not_enforced() {
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

    // policy_a's own limits reference policy_b (and vice versa). These are NOT
    // re-entered; policy_a is used purely as an approver via policy__.
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

    // policy_a approves (CountingPolicy allows everything); its own limits are
    // ignored, so this resolves to Ok with policy_a invoked exactly once.
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (s.signer_key(&env), s.sign(&env, &payload))]),
            &contexts,
        ),
        Ok(())
    );
    assert_eq!(policy_count(&env, &policy_a), 1);
    // policy_b is never invoked — policy_a's limits are not re-entered.
    assert_eq!(policy_count(&env, &policy_b), 0);
}

// --- Rejecting policies ------------------------------------------------------

/// A REJECTING policy required as a limit-key co-signer rejects the
/// candidate — the context stays uncovered. Deleting the `try_policy__`
/// rejection check in `verify_signer_limit_keys` fails this test.
#[test]
fn rejecting_policy_as_limit_co_signer_rejects_candidate() {
    let env = test_env();
    let policy = env.register(VetoPolicy, ());
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

/// A REJECTING policy used as `Signature::Policy` fails the whole
/// authorization in pass 2, even when another signer covers every context.
/// Deleting the pass-2 `policy__` invocation fails this test.
#[test]
fn rejecting_policy_as_signature_fails_auth() {
    let env = test_env();
    let policy = env.register(VetoPolicy, ());
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
        empty_limits(&env),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    // a alone: fine.
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

    // a + the rejecting policy as an extra map entry: pass 2 consults the
    // policy, which vetoes the whole authorization.
    let result = check_auth(
        &env,
        &wallet,
        &payload,
        Signatures(map![
            &env,
            (a.signer_key(&env), a.sign(&env, &payload)),
            (SignerKey::Policy(policy.clone()), Signature::Policy),
        ]),
        &contexts,
    );
    assert!(
        result.is_err(),
        "veto policy must fail the auth: {result:?}"
    );
}

// --- Policy self-removal ---------------------------------------------------------

/// A policy signer can ALWAYS self-remove, even when its `policy__` rejects:
/// when the sole context is the policy's own `remove_signer`, pass 2 skips
/// the policy consultation.
#[test]
fn rejecting_policy_can_self_remove() {
    let env = test_env();
    let policy = env.register(VetoPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
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
        empty_limits(&env),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, remove_signer_context(&env, &wallet, &policy_key)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (policy_key.clone(), Signature::Policy)]),
            &contexts,
        ),
        Ok(())
    );
}

/// The pass-2 skip applies ONLY when self-removal is the sole context: any
/// additional context re-enables the policy consultation (which vetoes).
#[test]
fn policy_self_removal_skip_requires_sole_context() {
    let env = test_env();
    let policy = env.register(VetoPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
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
        empty_limits(&env),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![
        &env,
        remove_signer_context(&env, &wallet, &policy_key),
        transfer_context(&env, &token, &wallet, 1),
    ];

    let result = check_auth(
        &env,
        &wallet,
        &payload,
        Signatures(map![
            &env,
            (a.signer_key(&env), a.sign(&env, &payload)),
            (policy_key.clone(), Signature::Policy),
        ]),
        &contexts,
    );
    assert!(
        result.is_err(),
        "extra context must re-enable the policy consultation: {result:?}"
    );
}

/// Self-removal skip × last-signer backstop: a SOLE (non-admin-shaped) rejecting
/// policy can still AUTHORIZE its own removal (the consultation skip), but
/// execution is rejected by the total-count guard — the skip is only ever
/// consequential on wallets with two or more signers.
#[test]
fn sole_rejecting_policy_self_removal_blocked_by_backstop() {
    use crate::{Contract, ContractClient};

    let env = test_env();
    let policy = env.register(VetoPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
    let wallet = Address::generate(&env);

    // Non-admin-shaped (empty limits): the ADMIN counter is 0, so only the
    // total-count backstop stands between this removal and zero signers.
    env.register_at(
        &wallet,
        Contract,
        (Signer::Policy(
            policy.clone(),
            SignerExpiration(None),
            empty_limits(&env),
            SignerStorage::Persistent,
        ),),
    );
    let client = ContractClient::new(&env, &wallet);

    // AUTH passes: pass-1 self-removal rule + pass-2 consultation skip.
    let payload = payload(&env, 7);
    let contexts = vec![&env, remove_signer_context(&env, &wallet, &policy_key)];
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (policy_key.clone(), Signature::Policy)]),
            &contexts,
        ),
        Ok(())
    );

    // EXECUTION rejects, full-stack.
    let root_invocation = remove_signer_invocation(&env, &wallet, &policy_key);
    let nonce = 31i64;
    let signature_expiration_ledger = env.ledger().sequence();
    let root_auth = soroban_sdk::xdr::SorobanAuthorizationEntry {
        credentials: soroban_sdk::xdr::SorobanCredentials::Address(
            soroban_sdk::xdr::SorobanAddressCredentials {
                address: wallet.clone().try_into().unwrap(),
                nonce,
                signature_expiration_ledger,
                signature: Signatures(map![&env, (policy_key.clone(), Signature::Policy)])
                    .try_into()
                    .unwrap(),
            },
        ),
        root_invocation,
    };
    assert_eq!(
        client
            .set_auths(&[root_auth])
            .try_remove_signer(&policy_key),
        Err(Ok(Error::LastSigner))
    );
    assert!(client.get_signer(&policy_key).is_some());
}

/// Removing a DIFFERENT key is not self-removal: the (rejecting) policy is
/// consulted and vetoes.
#[test]
fn policy_signature_removing_other_key_still_consults_policy() {
    let env = test_env();
    let policy = env.register(VetoPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
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

    // Unlimited, so pass 1 coverage is not the obstacle — pass 2 is.
    client.mock_all_auths().add_signer(&Signer::Policy(
        policy.clone(),
        SignerExpiration(None),
        no_limits(),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![
        &env,
        remove_signer_context(&env, &wallet, &a.signer_key(&env)),
    ];

    let result = check_auth(
        &env,
        &wallet,
        &payload,
        Signatures(map![&env, (policy_key.clone(), Signature::Policy)]),
        &contexts,
    );
    assert!(
        result.is_err(),
        "removing another key is not self-removal: {result:?}"
    );
}

/// Full-stack self-removal: it executes end-to-end through
/// address credentials, and the signer is gone afterwards.
#[test]
fn rejecting_policy_self_removal_full_stack() {
    let env = test_env();
    let policy = env.register(VetoPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
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
        empty_limits(&env),
        SignerStorage::Persistent,
    ));

    let root_invocation = remove_signer_invocation(&env, &wallet, &policy_key);
    let nonce = 9i64;
    let signature_expiration_ledger = env.ledger().sequence();

    let root_auth = soroban_sdk::xdr::SorobanAuthorizationEntry {
        credentials: soroban_sdk::xdr::SorobanCredentials::Address(
            soroban_sdk::xdr::SorobanAddressCredentials {
                address: wallet.clone().try_into().unwrap(),
                nonce,
                signature_expiration_ledger,
                signature: Signatures(map![&env, (policy_key.clone(), Signature::Policy)])
                    .try_into()
                    .unwrap(),
            },
        ),
        root_invocation,
    };

    client.set_auths(&[root_auth]).remove_signer(&policy_key);
    assert_eq!(client.get_signer(&policy_key), None);
}

/// Regression: a wallet whose SOLE signer is a
/// REJECTING policy that is Persistent, non-expiring, and admin-capable via a
/// wallet-self limits entry (`{wallet: None}`) must NOT be able to
/// self-remove down to zero signers. The consultation skip still lets the
/// AUTHORIZATION pass (the policy cannot veto its own sole removal), but the
/// broadened durable-admin counter makes EXECUTION reject with
/// `LastAdminSigner`.
#[test]
fn sole_admin_capable_policy_cannot_self_remove() {
    use crate::{Contract, ContractClient};

    let env = test_env();
    let policy = env.register(VetoPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());

    // Pre-generate the wallet address so the constructor signer's limits can
    // reference the wallet itself (the review's deterministic-address
    // deployment shape).
    let wallet = Address::generate(&env);
    env.register_at(
        &wallet,
        Contract,
        (Signer::Policy(
            policy.clone(),
            SignerExpiration(None),
            contract_limits(&env, &wallet, None),
            SignerStorage::Persistent,
        ),),
    );
    let client = ContractClient::new(&env, &wallet);

    // The AUTH layer accepts the self-removal (pass 1 self-removal rule +
    // pass 2 consultation skip): the rejecting policy cannot block it.
    let payload = payload(&env, 7);
    let contexts = vec![&env, remove_signer_context(&env, &wallet, &policy_key)];
    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (policy_key.clone(), Signature::Policy)]),
            &contexts,
        ),
        Ok(())
    );

    // ...but EXECUTION rejects: this signer is the wallet's last durable
    // admin. Full-stack, through real address credentials.
    let root_invocation = remove_signer_invocation(&env, &wallet, &policy_key);
    let nonce = 11i64;
    let signature_expiration_ledger = env.ledger().sequence();
    let root_auth = soroban_sdk::xdr::SorobanAuthorizationEntry {
        credentials: soroban_sdk::xdr::SorobanCredentials::Address(
            soroban_sdk::xdr::SorobanAddressCredentials {
                address: wallet.clone().try_into().unwrap(),
                nonce,
                signature_expiration_ledger,
                signature: Signatures(map![&env, (policy_key.clone(), Signature::Policy)])
                    .try_into()
                    .unwrap(),
            },
        ),
        root_invocation,
    };

    assert_eq!(
        client
            .set_auths(&[root_auth])
            .try_remove_signer(&policy_key),
        Err(Ok(Error::LastAdminSigner))
    );
    assert!(client.get_signer(&policy_key).is_some());
}

// --- Losing candidates must not charge policies -----------------------------------

/// Regression: a candidate that fails on a MISSING co-signer must fail
/// BEFORE its required policy is invoked, so a value-committing policy is
/// charged exactly once per authorization (by the candidate that actually
/// covers), not once per candidate evaluation.
#[test]
fn losing_candidate_does_not_invoke_policy() {
    let env = test_env();
    let policy = env.register(CountingPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
    let token = Address::generate(&env);

    // Order the two candidates deterministically: the signatures map iterates
    // in ScVal order, i.e. ascending public key bytes for Ed25519 keys.
    let s1 = Ed25519Signer::new(1);
    let s2 = Ed25519Signer::new(2);
    let (first, second) = if s1.public_key_bytes < s2.public_key_bytes {
        (s1, s2)
    } else {
        (s2, s1)
    };
    let missing = Ed25519Signer::new(3);

    // first (iterated first): requires the policy AND a key that is NOT in
    // the signatures map — a losing candidate.
    let (wallet, client) = register_wallet(
        &env,
        &first.signer(
            &env,
            SignerExpiration(None),
            contract_limits(
                &env,
                &token,
                Some(vec![&env, policy_key.clone(), missing.signer_key(&env)]),
            ),
            SignerStorage::Persistent,
        ),
    );

    // second: requires only the policy — the covering candidate.
    client.mock_all_auths().add_signer(&second.signer(
        &env,
        SignerExpiration(None),
        contract_limits(&env, &token, Some(vec![&env, policy_key.clone()])),
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
                (first.signer_key(&env), first.sign(&env, &payload)),
                (second.signer_key(&env), second.sign(&env, &payload)),
            ]),
            &contexts,
        ),
        Ok(())
    );

    // Exactly ONE policy invocation: the losing candidate never reached it.
    // (Pre-fix: 2 — the policy was invoked for `first` before its missing
    // co-signer failed the candidate.)
    assert_eq!(policy_count(&env, &policy), 1);
}

/// Against the REAL sample policy: cumulative spend is committed exactly
/// once per authorization. Previously this recorded 2× the amount.
#[test]
fn sample_policy_charged_once_per_authorization() {
    use sample_policy::{Allowance, Contract as SamplePolicy, StorageKey};

    let env = test_env();
    let policy = env.register(SamplePolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
    let token = Address::generate(&env);
    let amount = 5_000_000i128;

    let s1 = Ed25519Signer::new(1);
    let s2 = Ed25519Signer::new(2);
    let (first, second) = if s1.public_key_bytes < s2.public_key_bytes {
        (s1, s2)
    } else {
        (s2, s1)
    };
    let missing = Ed25519Signer::new(3);

    let (wallet, client) = register_wallet(
        &env,
        &first.signer(
            &env,
            SignerExpiration(None),
            contract_limits(
                &env,
                &token,
                Some(vec![&env, policy_key.clone(), missing.signer_key(&env)]),
            ),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&second.signer(
        &env,
        SignerExpiration(None),
        contract_limits(&env, &token, Some(vec![&env, policy_key.clone()])),
        SignerStorage::Persistent,
    ));

    // Install the sample policy on the wallet (it requires installation).
    client.mock_all_auths().add_signer(&Signer::Policy(
        policy.clone(),
        SignerExpiration(None),
        empty_limits(&env),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, amount)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![
                &env,
                (first.signer_key(&env), first.sign(&env, &payload)),
                (second.signer_key(&env), second.sign(&env, &payload)),
            ]),
            &contexts,
        ),
        Ok(())
    );

    // The allowance was charged ONCE (== amount), not once per candidate.
    let allowance = env.as_contract(&policy, || {
        env.storage()
            .persistent()
            .get::<StorageKey, Allowance>(&StorageKey::Spend(wallet.clone()))
            .unwrap()
    });
    assert_eq!(allowance.spent, amount);
}

/// A policy key DUPLICATED within one required-keys list is invoked exactly
/// once — a duplicated entry must not double-commit a value-committing
/// policy (review finding: the Vec was not deduplicated).
#[test]
fn duplicated_policy_entry_invoked_once() {
    let env = test_env();
    let policy = env.register(CountingPolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
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
                Some(vec![&env, policy_key.clone(), policy_key.clone()]),
            ),
            SignerStorage::Persistent,
        ),
    );

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
        Ok(())
    );

    // Exactly ONE invocation despite the duplicated entry (pre-fix: 2).
    assert_eq!(policy_count(&env, &policy), 1);
}

/// Same, against the REAL sample policy: `[SP, SP]` charges the allowance
/// once, not twice.
#[test]
fn duplicated_sample_policy_entry_charged_once() {
    use sample_policy::{Allowance, Contract as SamplePolicy, StorageKey};

    let env = test_env();
    let policy = env.register(SamplePolicy, ());
    let policy_key = SignerKey::Policy(policy.clone());
    let token = Address::generate(&env);
    let amount = 5_000_000i128;
    let a = Ed25519Signer::new(1);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            contract_limits(
                &env,
                &token,
                Some(vec![&env, policy_key.clone(), policy_key.clone()]),
            ),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&Signer::Policy(
        policy.clone(),
        SignerExpiration(None),
        empty_limits(&env),
        SignerStorage::Persistent,
    ));

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, amount)];

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

    let allowance = env.as_contract(&policy, || {
        env.storage()
            .persistent()
            .get::<StorageKey, Allowance>(&StorageKey::Spend(wallet.clone()))
            .unwrap()
    });
    assert_eq!(allowance.spent, amount);
}

// --- Temporary-storage auth path --------------------------------------------------

/// A Temporary-storage signer authorizing through `__check_auth` gets
/// its entry TTL extended to max by pass 2 (the anti-lockout prepay). Without
/// this, an actively-used temporary signer silently evicts.
#[test]
fn temporary_signer_auth_extends_ttl() {
    use soroban_sdk::testutils::storage::Temporary as _;

    let env = test_env();
    let a = Ed25519Signer::new(1);
    let b = Ed25519Signer::new(2);
    let token = Address::generate(&env);

    let (wallet, client) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            no_limits(),
            SignerStorage::Persistent,
        ),
    );

    client.mock_all_auths().add_signer(&b.signer(
        &env,
        SignerExpiration(None),
        no_limits(),
        SignerStorage::Temporary,
    ));

    // `add_signer` prepaid the entry to max TTL; advance the ledger past the
    // one-week extend threshold so the entry is due for renewal again.
    env.ledger().with_mut(|l| l.sequence_number += 200_000);

    let key = b.signer_key(&env);
    let (ttl_before, max_ttl) = env.as_contract(&wallet, || {
        (
            env.storage().temporary().get_ttl(&key),
            env.storage().max_ttl(),
        )
    });
    assert!(
        ttl_before < max_ttl,
        "precondition: entry must start below max TTL ({ttl_before} vs {max_ttl})"
    );

    let payload = payload(&env, 7);
    let contexts = vec![&env, transfer_context(&env, &token, &wallet, 1)];

    assert_eq!(
        check_auth(
            &env,
            &wallet,
            &payload,
            Signatures(map![&env, (key.clone(), b.sign(&env, &payload))]),
            &contexts,
        ),
        Ok(())
    );

    let ttl_after = env.as_contract(&wallet, || env.storage().temporary().get_ttl(&key));
    assert_eq!(
        ttl_after, max_ttl,
        "pass 2 must extend the temporary signer entry to max TTL"
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
