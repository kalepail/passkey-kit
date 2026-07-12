#![cfg(test)]
//! Full-stack integration: real `SorobanAuthorizationEntry` credentials
//! through `set_auths`, exercising the wallet as a custom account end-to-end
//! for both signer types, plus a budget regression print.

use std::println;
extern crate std;

use example_contract::{Contract as ExampleContract, ContractClient as ExampleContractClient};
use sample_policy::{Contract as PolicyContract, ContractClient as PolicyContractClient};
use smart_wallet_interface::types::{
    Signatures, Signer, SignerExpiration, SignerKey, SignerLimits, SignerStorage,
};
use soroban_sdk::{
    map,
    testutils::Address as _,
    token,
    xdr::{
        InvokeContractArgs, SorobanAddressCredentials, SorobanAuthorizationEntry,
        SorobanAuthorizedFunction, SorobanAuthorizedInvocation, SorobanCredentials,
    },
    Address, Env, String,
};

use crate::tests::test_common::*;

fn register_sac(env: &Env) -> (Address, token::StellarAssetClient<'_>, token::Client<'_>) {
    let sac_admin = Address::from_string(&String::from_str(
        env,
        "GD7777777777777777777777777777777777777777777777777773DB",
    ));
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let sac_address = sac.address();

    (
        sac_address.clone(),
        token::StellarAssetClient::new(env, &sac_address),
        token::Client::new(env, &sac_address),
    )
}

/// The original kitchen-sink flow: an example contract fans out into two
/// transfers under one wallet authorization, authorized by a limited ed25519
/// signer whose limits chain into a policy co-signer.
#[test]
fn ed25519_with_policy_limits_full_stack() {
    let env = test_env();

    let signature_expiration_ledger = env.ledger().sequence();
    let amount = 10_000_000i128;
    let second_amount = 1_000_000i128;

    let super_signer = Ed25519Signer::new(11);
    let simple_signer = Ed25519Signer::new(12);

    let (wallet_address, wallet_client) = register_wallet(
        &env,
        &super_signer.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let example_contract_address = env.register(ExampleContract, ());
    let example_contract_client = ExampleContractClient::new(&env, &example_contract_address);

    let (sac_address, sac_admin_client, sac_client) = register_sac(&env);

    sac_admin_client
        .mock_all_auths()
        .mint(&wallet_address, &100_000_000);

    let sample_policy_address = env.register(PolicyContract, ());
    let sample_policy_signer_key = SignerKey::Policy(sample_policy_address.clone());

    // simple signer: may invoke the SAC only with the policy's approval, and
    // the example contract freely.
    wallet_client
        .mock_all_auths()
        .add_signer(&simple_signer.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(Some(map![
                &env,
                (
                    sac_address.clone(),
                    Some(soroban_sdk::vec![&env, sample_policy_signer_key.clone()])
                ),
                (example_contract_address.clone(), None),
            ])),
            SignerStorage::Temporary,
        ));

    // The policy must be installed on the wallet for its policy__ to accept.
    wallet_client.mock_all_auths().add_signer(&Signer::Policy(
        sample_policy_address.clone(),
        SignerExpiration(None),
        SignerLimits(Some(map![
            &env,
            (
                sac_address.clone(),
                Some(soroban_sdk::vec![&env, simple_signer.signer_key(&env)])
            ),
        ])),
        SignerStorage::Temporary,
    ));

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: example_contract_address.clone().try_into().unwrap(),
            function_name: "call".try_into().unwrap(),
            args: std::vec![
                sac_address.clone().try_into().unwrap(),
                wallet_address.clone().try_into().unwrap(),
                sac_address.clone().try_into().unwrap(),
                amount.try_into().unwrap(),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: std::vec![
            transfer_invocation(&sac_address, &wallet_address, &sac_address, amount),
            transfer_invocation(&sac_address, &wallet_address, &sac_address, second_amount),
        ]
        .try_into()
        .unwrap(),
    };

    let nonce = 3i64;
    let payload = auth_payload(&env, nonce, signature_expiration_ledger, &root_invocation);

    let root_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce,
            signature_expiration_ledger,
            signature: Signatures(map![
                &env,
                (
                    simple_signer.signer_key(&env),
                    simple_signer.sign(&env, &payload)
                ),
            ])
            .try_into()
            .unwrap(),
        }),
        root_invocation: root_invocation.clone(),
    };

    env.cost_estimate().budget().reset_default();

    example_contract_client.set_auths(&[root_auth]).call(
        &sac_address,
        &wallet_address,
        &sac_address,
        &amount,
    );

    // Both sub-transfers (10M + 1M) moved wallet -> SAC contract address.
    assert_eq!(sac_client.balance(&wallet_address), 89_000_000);
    assert_eq!(sac_client.balance(&sac_address), 11_000_000);

    // Budget regression watermark — compare across contract changes.
    println!("{:?}", env.cost_estimate().budget().print());
}

/// The core product path, previously untested (audit F1): a WebAuthn passkey
/// authorizes a real transfer through address credentials.
#[test]
fn secp256r1_passkey_full_stack() {
    let env = test_env();

    let signature_expiration_ledger = env.ledger().sequence();
    let amount = 5_000_000i128;

    let passkey = Passkey::new(21);

    let (wallet_address, _) = register_wallet(
        &env,
        &passkey.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let (sac_address, sac_admin_client, sac_client) = register_sac(&env);

    sac_admin_client
        .mock_all_auths()
        .mint(&wallet_address, &100_000_000);

    // A contract-address recipient: no classic trustline requirements.
    let recipient_address = Address::generate(&env);

    let root_invocation =
        transfer_invocation(&sac_address, &wallet_address, &recipient_address, amount);

    let nonce = 1i64;
    let payload = auth_payload(&env, nonce, signature_expiration_ledger, &root_invocation);

    let root_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce,
            signature_expiration_ledger,
            signature: Signatures(map![
                &env,
                (passkey.signer_key(&env), passkey.sign(&env, &payload)),
            ])
            .try_into()
            .unwrap(),
        }),
        root_invocation,
    };

    sac_client
        .set_auths(&[root_auth])
        .transfer(&wallet_address, &recipient_address, &amount);

    assert_eq!(sac_client.balance(&wallet_address), 100_000_000 - amount);
    assert_eq!(sac_client.balance(&recipient_address), amount);
}

/// FIX-2: `policy__` is publicly callable, but the hardened sample policy
/// authenticates its caller with `source.require_auth()`. An external caller
/// that is not the wallet — even for a wallet that DID install the policy —
/// cannot invoke `policy__` on that wallet's behalf.
///
/// The positive direction (invoker auth satisfies `require_auth` during a real
/// `__check_auth`) is proven by `ed25519_with_policy_limits_full_stack`, which
/// drives the sample policy through `set_auths`.
#[test]
fn sample_policy_rejects_spoofed_caller() {
    let env = test_env();
    let signer = Ed25519Signer::new(41);

    let (wallet_address, wallet_client) = register_wallet(
        &env,
        &signer.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let policy_address = env.register(PolicyContract, ());
    let policy_client = PolicyContractClient::new(&env, &policy_address);

    // Install the policy on the wallet (wallet-authenticated).
    wallet_client.mock_all_auths().add_signer(&Signer::Policy(
        policy_address.clone(),
        SignerExpiration(None),
        SignerLimits(None),
        SignerStorage::Temporary,
    ));

    let token = Address::generate(&env);
    let contexts = soroban_sdk::vec![&env, transfer_context(&env, &token, &wallet_address, 1)];

    // Direct policy__ call with NO auth for the wallet: source.require_auth()
    // is unsatisfied, so it fails. (Note the absence of mock_all_auths.)
    let result = policy_client.try_policy__(
        &wallet_address,
        &SignerKey::Policy(policy_address.clone()),
        &contexts,
    );

    assert!(
        result.is_err(),
        "spoofed policy__ caller must be rejected by source.require_auth()"
    );
}
