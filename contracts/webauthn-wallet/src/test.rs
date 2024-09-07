#![cfg(test)]

use std::println;
extern crate std;

use ed25519_dalek::{Keypair, Signer};
use rand::thread_rng;
use soroban_sdk::{
    auth::{Context, ContractContext}, symbol_short, testutils::{Address as _, Ledger}, token, vec, xdr::{
        HashIdPreimage, HashIdPreimageSorobanAuthorization, InvokeContractArgs, Limits, ScAddress, ScVal, SorobanAddressCredentials, SorobanAuthorizationEntry, SorobanAuthorizedFunction, SorobanAuthorizedInvocation, SorobanCredentials, ToXdr, VecM, WriteXdr
    }, Address, Bytes, BytesN, Env, IntoVal, String
};
use stellar_strkey::{ed25519, Strkey};

use sample_policy::{Contract as PolicyContract, ContractClient as PolicyContractClient};
use example_contract::{Contract as ExampleContract, ContractClient as ExampleContractClient};

use crate::{types::{Ed25519PublicKey, Ed25519Signature, Error, KeyId, Policy, Secp256r1Id, Secp256r1Signature, Signature}, Contract, ContractClient};

#[test]
fn test_sample_policy() {
    let env = Env::default();

    let wallet_address = env.register_contract(None, Contract);
    let wallet_client = ContractClient::new(&env, &wallet_address);

    let keypair = Keypair::from_bytes(&[
        88, 206, 67, 128, 240, 45, 168, 148, 191, 111, 180, 111, 104, 83, 214, 113, 78, 27, 55, 86,
        200, 247, 164, 163, 76, 236, 24, 208, 115, 40, 231, 255, 161, 115, 141, 114, 97, 125, 136,
        247, 117, 105, 60, 155, 144, 51, 216, 187, 185, 157, 18, 126, 169, 172, 15, 4, 148, 13,
        208, 144, 53, 12, 91, 78,
    ])
    .unwrap();

    let address = Strkey::PublicKeyEd25519(ed25519::PublicKey(keypair.public.to_bytes()));
    let address = Bytes::from_slice(&env, address.to_string().as_bytes());
    let address = Address::from_string_bytes(&address);

    let address_bytes = address.to_xdr(&env);
    let address_bytes = address_bytes.slice(address_bytes.len() - 32..);
    let mut address_array = [0u8; 32];
    address_bytes.copy_into_slice(&mut address_array);
    let address_bytes = BytesN::from_array(&env, &address_array);

    wallet_client.add(&KeyId::Ed25519(Ed25519PublicKey(address_bytes.clone())), &None, &true);

    let sample_policy_address = env.register_contract(None, PolicyContract);
    // let sample_policy_client = PolicyContractClient::new(&env, &sample_policy_address);

    let signature_expiration_ledger = env.ledger().sequence();
    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: wallet_address.clone().try_into().unwrap(),
            function_name: "add".try_into().unwrap(),
            args: std::vec![
                KeyId::Policy(Policy(sample_policy_address.clone())).try_into().unwrap(),
                ScVal::Void,
                ScVal::Bool(false)
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let payload = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id: env.ledger().network_id().to_array().into(),
        nonce: 0,
        signature_expiration_ledger,
        invocation: root_invocation.clone(),
    });
    let payload = payload
        .to_xdr(Limits::none())
        .unwrap();
    let payload = Bytes::from_slice(&env, payload.as_slice());
    let payload = env.crypto().sha256(&payload);

    let signature: ScVal = Signature::Ed25519(Ed25519Signature {
        public_key: Ed25519PublicKey(address_bytes.clone()),
        signature: BytesN::from_array(
            &env,
            &keypair.sign(payload.to_array().as_slice()).to_bytes(),
        ),
    }).try_into().unwrap();

    wallet_client
        .set_auths(&[SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: wallet_address.clone().try_into().unwrap(),
                nonce: 0,
                signature_expiration_ledger,
                signature: std::vec![
                    signature,
                ]
                .try_into()
                .unwrap(),
            }),
            root_invocation,
        }])
        .add(&KeyId::Policy(Policy(sample_policy_address.clone())), &None, &false);

    let example_contract_address = env.register_contract(None, ExampleContract);
    let example_contract_client = ExampleContractClient::new(&env, &example_contract_address);

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: example_contract_address.clone().try_into().unwrap(),
            function_name: "call".try_into().unwrap(),
            args: std::vec![
                wallet_address.clone().try_into().unwrap(),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let payload = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id: env.ledger().network_id().to_array().into(),
        nonce: 1,
        signature_expiration_ledger,
        invocation: root_invocation.clone(),
    });
    let payload = payload
        .to_xdr(Limits::none())
        .unwrap();
    let payload = Bytes::from_slice(&env, payload.as_slice());
    let payload = env.crypto().sha256(&payload);

    let signature = Signature::Policy(Policy(sample_policy_address.clone()));
    let signature_scval: ScVal = signature.clone().try_into().unwrap();

    let __check_auth_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: wallet_address.clone().try_into().unwrap(),
            function_name: "__check_auth".try_into().unwrap(),
            args: std::vec![
                payload.to_bytes().try_into().unwrap(),
                vec![&env, signature].try_into().unwrap(),
                vec![&env, Context::Contract(ContractContext {
                    contract: example_contract_address,
                    fn_name: symbol_short!("call"),
                    args: vec![&env, wallet_address.clone()].into_val(&env),
                })].try_into().unwrap(),
            ]
            .try_into()
            .unwrap(),
            // args: VecM::default(),
        }),
        sub_invocations: VecM::default(),
    };

    let res = example_contract_client
        .set_auths(&[
            SorobanAuthorizationEntry {
                credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                    address: wallet_address.clone().try_into().unwrap(),
                    nonce: 1,
                    signature_expiration_ledger,
                    signature: std::vec![
                        signature_scval,
                    ]
                    .try_into()
                    .unwrap(),
                }),
                root_invocation,
            },
            SorobanAuthorizationEntry {
                credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                    address: sample_policy_address.clone().try_into().unwrap(),
                    nonce: 2,
                    signature: std::vec![
                        ScVal::Void,
                    ]
                    .try_into()
                    .unwrap(),
                    signature_expiration_ledger
                }),
                root_invocation: __check_auth_invocation,
            },
        ])
        .call(&wallet_address);

    println!("\n{:?}\n", res);
}

#[test]
fn test_secp256r1() {
    let env = Env::default();
    // let contract_id = env.register_contract(None, Contract);
    // let client = ContractClient::new(&env, &contract_id);

    // let factory_address = env.register_contract_wasm(None, factory::WASM);
    // let factory_client = factory::Client::new(&env, &factory_address);

    // let passkkey_hash = env.deployer().upload_contract_wasm(passkey::WASM);

    // let deployee_address = factory_client.deploy(&id, &pk);
    let deployee_address = env.register_contract(None, Contract);
    let deployee_client = ContractClient::new(&env, &deployee_address);

    let id = Bytes::from_array(
        &env,
        &[
            243, 248, 216, 74, 226, 218, 85, 102, 196, 167, 14, 151, 124, 42, 73, 136, 138, 102,
            187, 140,
        ],
    );
    let pk = BytesN::from_array(
        &env,
        &[
            4, 163, 142, 245, 242, 113, 55, 104, 189, 52, 128, 238, 206, 174, 194, 177, 4, 100,
            161, 243, 177, 255, 10, 53, 57, 194, 205, 45, 208, 10, 131, 167, 93, 44, 123, 126, 95,
            219, 207, 230, 175, 90, 96, 41, 121, 197, 127, 180, 74, 236, 160, 0, 60, 185, 211, 174,
            133, 215, 200, 208, 230, 51, 210, 94, 214,
        ],
    );
    // let salt = env.crypto().sha256(&id);

    // factory_client.init(&passkkey_hash);
    deployee_client.add(&KeyId::Secp256r1(Secp256r1Id(id)), &Some(pk), &true);

    let signature_payload = BytesN::from_array(
        &env,
        &[
            150, 22, 248, 96, 91, 4, 111, 72, 170, 101, 57, 225, 210, 199, 91, 29, 159, 227, 209,
            6, 231, 63, 222, 209, 232, 57, 112, 98, 140, 118, 206, 245,
        ],
    );

    let signature = Signature::Secp256r1(Secp256r1Signature {
        id: Secp256r1Id(Bytes::from_array(
            &env,
            &[
                243, 248, 216, 74, 226, 218, 85, 102, 196, 167, 14, 151, 124, 42, 73, 136, 138,
                102, 187, 140,
            ],
        )),
        authenticator_data: Bytes::from_array(
            &env,
            &[
                75, 74, 206, 229, 181, 139, 119, 89, 254, 159, 95, 149, 227, 164, 109, 143, 188,
                228, 143, 219, 181, 216, 77, 123, 142, 172, 60, 20, 162, 154, 181, 187, 29, 0, 0,
                0, 0,
            ],
        ),
        client_data_json: Bytes::from_array(
            &env,
            &[
                123, 34, 116, 121, 112, 101, 34, 58, 34, 119, 101, 98, 97, 117, 116, 104, 110, 46,
                103, 101, 116, 34, 44, 34, 99, 104, 97, 108, 108, 101, 110, 103, 101, 34, 58, 34,
                108, 104, 98, 52, 89, 70, 115, 69, 98, 48, 105, 113, 90, 84, 110, 104, 48, 115,
                100, 98, 72, 90, 95, 106, 48, 81, 98, 110, 80, 57, 55, 82, 54, 68, 108, 119, 89,
                111, 120, 50, 122, 118, 85, 34, 44, 34, 111, 114, 105, 103, 105, 110, 34, 58, 34,
                104, 116, 116, 112, 115, 58, 47, 47, 112, 97, 115, 115, 107, 101, 121, 45, 107,
                105, 116, 45, 100, 101, 109, 111, 46, 112, 97, 103, 101, 115, 46, 100, 101, 118,
                34, 125,
            ],
        ),
        signature: BytesN::from_array(
            &env,
            &[
                74, 48, 29, 120, 181, 135, 255, 178, 105, 76, 82, 118, 29, 135, 193, 72, 123, 144,
                138, 214, 125, 27, 33, 159, 169, 200, 151, 55, 7, 250, 111, 172, 86, 89, 162, 167,
                148, 105, 144, 68, 21, 249, 61, 253, 80, 61, 54, 29, 14, 162, 12, 173, 206, 194,
                144, 227, 11, 225, 74, 254, 191, 221, 103, 86,
            ],
        ),
    });

    let res: Result<(), Result<Error, _>> = env.try_invoke_contract_check_auth(
        &deployee_address,
        &signature_payload,
        vec![&env, signature].into_val(&env),
        &vec![&env],
    );

    println!("\n{:?}\n", res);
}
