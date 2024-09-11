#![cfg(test)]

use std::println;
extern crate std;

use crate::{
    types::{
        Ed25519PublicKey, Ed25519Signature, Error, Policy, Secp256r1Id, Secp256r1PublicKey,
        Secp256r1Signature, Signature, Signer, SignerStorage, SignerType,
    },
    Contract, ContractClient,
};
use ed25519_dalek::{Keypair, Signer as _};
use sample_policy::Contract as PolicyContract;
use soroban_sdk::{
    auth::{Context, ContractContext},
    symbol_short,
    testutils::Address as _,
    token, vec,
    xdr::{
        HashIdPreimage, HashIdPreimageSorobanAuthorization, InvokeContractArgs, Limits, ScVal,
        ScVec, SorobanAddressCredentials, SorobanAuthorizationEntry, SorobanAuthorizedFunction,
        SorobanAuthorizedInvocation, SorobanCredentials, ToXdr, VecM, WriteXdr,
    },
    Address, Bytes, BytesN, Env, IntoVal,
};
use stellar_strkey::{ed25519, Strkey};

#[test]
fn test_sample_policy_call_self() {
    let env = Env::default();
    let signature_expiration_ledger = env.ledger().sequence();

    let wallet_address = env.register_contract(None, Contract);
    let wallet_client = ContractClient::new(&env, &wallet_address);

    // Secp256r1
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
    wallet_client.mock_all_auths().add(&Signer::Secp256r1(
        Secp256r1Id(id),
        Secp256r1PublicKey(pk),
        SignerStorage::Persistent,
        SignerType::Admin,
    ));
    ////

    // Ed25519
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

    wallet_client.mock_all_auths().add(&Signer::Ed25519(
        Ed25519PublicKey(address_bytes.clone()),
        SignerStorage::Persistent,
        SignerType::Admin,
    ));
    ////

    // Policy
    let sample_policy_address = env.register_contract(None, PolicyContract);

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: wallet_address.clone().try_into().unwrap(),
            function_name: "add".try_into().unwrap(),
            args: std::vec![Signer::Policy(
                Policy(sample_policy_address.clone()),
                SignerStorage::Temporary,
                SignerType::Policy,
            )
            .try_into()
            .unwrap(),]
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
    let payload = payload.to_xdr(Limits::none()).unwrap();
    let payload = Bytes::from_slice(&env, payload.as_slice());
    let payload = env.crypto().sha256(&payload);

    let signature: ScVal = Signature::Ed25519(Ed25519Signature {
        public_key: Ed25519PublicKey(address_bytes.clone()),
        signature: BytesN::from_array(
            &env,
            &keypair.sign(payload.to_array().as_slice()).to_bytes(),
        ),
    })
    .try_into()
    .unwrap();

    wallet_client
        .set_auths(&[SorobanAuthorizationEntry {
            credentials: SorobanCredentials::Address(SorobanAddressCredentials {
                address: wallet_address.clone().try_into().unwrap(),
                nonce: 0,
                signature_expiration_ledger,
                signature: std::vec![signature,].try_into().unwrap(),
            }),
            root_invocation,
        }])
        .add(&Signer::Policy(
            Policy(sample_policy_address.clone()),
            SignerStorage::Temporary,
            SignerType::Policy,
        ));
    ////
}

#[test]
fn test_sample_policy() {
    let env = Env::default();
    let signature_expiration_ledger = env.ledger().sequence();

    let wallet_address = env.register_contract(None, Contract);
    let wallet_client = ContractClient::new(&env, &wallet_address);

    // Secp256r1
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
    wallet_client.mock_all_auths().add(&Signer::Secp256r1(
        Secp256r1Id(id),
        Secp256r1PublicKey(pk),
        SignerStorage::Persistent,
        SignerType::Admin,
    ));
    ////

    // Ed25519
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

    wallet_client.mock_all_auths().add(&Signer::Ed25519(
        Ed25519PublicKey(address_bytes.clone()),
        SignerStorage::Persistent,
        SignerType::Basic,
    ));
    ////

    // Policy
    let sample_policy_address = env.register_contract(None, PolicyContract);

    wallet_client.mock_all_auths().add(&Signer::Policy(
        Policy(sample_policy_address.clone()),
        SignerStorage::Temporary,
        SignerType::Policy,
    ));
    ////

    // Transfer
    let sac_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let sac_address = sac.address();
    let sac_admin_client = token::StellarAssetClient::new(&env, &sac_address);
    let sac_client = token::Client::new(&env, &sac_address);

    sac_admin_client
        .mock_all_auths()
        .mint(&wallet_address, &10_000_000);

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: sac_address.clone().try_into().unwrap(),
            function_name: "transfer".try_into().unwrap(),
            args: std::vec![
                wallet_address.clone().try_into().unwrap(),
                sac_address.clone().try_into().unwrap(),
                10_000_000i128.try_into().unwrap(),
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
    let payload = payload.to_xdr(Limits::none()).unwrap();
    let payload = Bytes::from_slice(&env, payload.as_slice());
    let payload = env.crypto().sha256(&payload);

    let signature_policy = Signature::Policy(Policy(sample_policy_address.clone()));
    let signature_policy_scval: ScVal = signature_policy.clone().try_into().unwrap();

    let signature_ed25519 = Signature::Ed25519(Ed25519Signature {
        public_key: Ed25519PublicKey(address_bytes.clone()),
        signature: BytesN::from_array(
            &env,
            &keypair.sign(payload.to_array().as_slice()).to_bytes(),
        ),
    });
    let signature_ed25519_scval: ScVal = signature_ed25519.clone().try_into().unwrap();

    let __check_auth_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: wallet_address.clone().try_into().unwrap(),
            function_name: "__check_auth".try_into().unwrap(),
            args: std::vec![
                payload.to_bytes().try_into().unwrap(),
                vec![&env, 
                    signature_policy, 
                    signature_ed25519
                ]
                .try_into()
                .unwrap(),
                vec![
                    &env,
                    Context::Contract(ContractContext {
                        contract: sac_address.clone(),
                        fn_name: symbol_short!("transfer"),
                        args: vec![
                            &env,
                            wallet_address.to_val(),
                            sac_address.to_val(),
                            10_000_000i128.into_val(&env)
                        ]
                        .into_val(&env),
                    })
                ]
                .try_into()
                .unwrap(),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let auth1 = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce: 1,
            signature_expiration_ledger,
            signature: std::vec![
                signature_policy_scval, 
                signature_ed25519_scval,
            ]
            .try_into()
            .unwrap(),
        }),
        root_invocation,
    };

    let auth2 = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: sample_policy_address.clone().try_into().unwrap(),
            nonce: 2,
            signature: ScVal::Vec(Some(ScVec::default())),
            signature_expiration_ledger,
        }),
        root_invocation: __check_auth_invocation,
    };

    // println!(
    //     "\nauth1: {:?}\n",
    //     auth1.to_xdr_base64(Limits::none()).unwrap()
    // );
    // println!(
    //     "\nauth2: {:?}\n",
    //     auth2.to_xdr_base64(Limits::none()).unwrap()
    // );

    sac_client
        .set_auths(&[
            // TODO where is the protection for this call?
            // Where does this actually get signed for?
            // How is this technically/cryptographically safe?
            // Probably from the fact that all the args of auth 1 are baked into auth 2
            auth1, auth2,
        ])
        .transfer(&wallet_address, &sac_address, &10_000_000);
    ////
}

#[test]
fn test_ed25519() {
    let env = Env::default();
    let signature_expiration_ledger = env.ledger().sequence();

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

    wallet_client.add(&Signer::Ed25519(
        Ed25519PublicKey(address_bytes.clone()),
        SignerStorage::Persistent,
        SignerType::Admin,
    ));

    let sac_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let sac_address = sac.address();
    let sac_admin_client = token::StellarAssetClient::new(&env, &sac_address);
    let sac_client = token::Client::new(&env, &sac_address);

    sac_admin_client
        .mock_all_auths()
        .mint(&wallet_address, &10_000_000);

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: sac_address.clone().try_into().unwrap(),
            function_name: "transfer".try_into().unwrap(),
            args: std::vec![
                wallet_address.clone().try_into().unwrap(),
                sac_address.clone().try_into().unwrap(),
                10_000_000i128.try_into().unwrap(),
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
    let payload = payload.to_xdr(Limits::none()).unwrap();
    let payload = Bytes::from_slice(&env, payload.as_slice());
    let payload = env.crypto().sha256(&payload);

    let signature_ed25519 = Signature::Ed25519(Ed25519Signature {
        public_key: Ed25519PublicKey(address_bytes.clone()),
        signature: BytesN::from_array(
            &env,
            &keypair.sign(payload.to_array().as_slice()).to_bytes(),
        ),
    });
    let signature_ed25519_scval: ScVal = signature_ed25519.clone().try_into().unwrap();

    let auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce: 1,
            signature_expiration_ledger,
            signature: std::vec![signature_ed25519_scval,].try_into().unwrap(),
        }),
        root_invocation,
    };

    sac_client
        .set_auths(&[auth])
        .transfer(&wallet_address, &sac_address, &10_000_000);
}

#[test]
fn test_secp256r1() {
    let env = Env::default();

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

    deployee_client.add(&Signer::Secp256r1(
        Secp256r1Id(id),
        Secp256r1PublicKey(pk),
        SignerStorage::Persistent,
        SignerType::Admin,
    ));

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

    assert_eq!(res, Ok(()));
}
