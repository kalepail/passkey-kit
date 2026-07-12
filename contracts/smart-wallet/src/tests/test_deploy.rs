#![cfg(test)]
//! The wallet as a deployer: a real `CreateContractV2HostFn` authorization
//! through the host, plus the negative (limited signers cannot deploy —
//! that rule's unit coverage lives in test_auth.rs).

extern crate std;

use example_contract::{Contract as ExampleContract, ContractClient as ExampleContractClient};
use smart_wallet_interface::types::{Signatures, SignerExpiration, SignerLimits, SignerStorage};
use soroban_sdk::{
    map,
    xdr::{
        ContractExecutable, ContractId, ContractIdPreimage, ContractIdPreimageFromAddress,
        CreateContractArgsV2, Hash, ScAddress, SorobanAddressCredentials,
        SorobanAuthorizationEntry, SorobanAuthorizedFunction, SorobanAuthorizedInvocation,
        SorobanCredentials, Uint256, VecM,
    },
    Env,
};

use crate::tests::test_common::*;

mod sample_policy_wasm {
    use soroban_sdk::auth::Context;
    soroban_sdk::contractimport!(file = "fixtures/sample_policy.wasm");
}

/// An unlimited signer authorizes the wallet deploying a contract (the
/// deterministic deploy path the SDK uses, wallet as the deployer address).
#[test]
fn wallet_deploys_contract() {
    let env: Env = test_env();

    let signature_expiration_ledger = env.ledger().sequence();
    let signer = Ed25519Signer::new(31);

    let (wallet_address, _) = register_wallet(
        &env,
        &signer.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let example_contract_address = env.register(ExampleContract, ());
    let example_contract_client = ExampleContractClient::new(&env, &example_contract_address);

    let wasm_hash = env
        .deployer()
        .upload_contract_wasm(sample_policy_wasm::WASM);

    let wallet_address_array = address_raw_bytes(&env, &wallet_address);

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::CreateContractV2HostFn(CreateContractArgsV2 {
            contract_id_preimage: ContractIdPreimage::Address(ContractIdPreimageFromAddress {
                address: ScAddress::Contract(ContractId(Hash::from(wallet_address_array))),
                salt: Uint256(wasm_hash.to_array()),
            }),
            executable: ContractExecutable::Wasm(Hash::from(wasm_hash.to_array())),
            constructor_args: VecM::default(),
        }),
        sub_invocations: VecM::default(),
    };

    let nonce = 0i64;
    let payload = auth_payload(&env, nonce, signature_expiration_ledger, &root_invocation);

    let root_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce,
            signature_expiration_ledger,
            signature: Signatures(map![
                &env,
                (signer.signer_key(&env), signer.sign(&env, &payload)),
            ])
            .try_into()
            .unwrap(),
        }),
        root_invocation: root_invocation.clone(),
    };

    example_contract_client
        .set_auths(&[root_auth])
        .deploy(&wallet_address, &wasm_hash);
}
