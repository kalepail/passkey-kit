#![cfg(test)]

use std::println;
extern crate std;

use ed25519_dalek::{Keypair, Signer as _};
use example_contract::{Contract as ExampleContract, ContractClient as ExampleContractClient};
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
    Address, Bytes, BytesN, Env, IntoVal, String, TryIntoVal, Val, Vec,
};
use stellar_strkey::{ed25519, Strkey};
// TODO try making a sharable interface and importing it vs this weird sharing/copying thing we're doing now
use webauthn_wallet::{
    types::{
        Ed25519PublicKey, Ed25519Signature, Policy, PolicySignature, Secp256r1Id,
        Secp256r1PublicKey, Signature, Signer, SignerKey, SignerStorage, SignerType,
    },
    Contract, ContractClient,
};

#[test]
fn test() {
    let env: Env = Env::default();
    let signature_expiration_ledger = env.ledger().sequence();
    let amount = 10_000_000i128;

    let wallet_address = env.register_contract(None, Contract);
    let wallet_client = ContractClient::new(&env, &wallet_address);

    let example_contract_address = env.register_contract(None, ExampleContract);
    let example_contract_client = ExampleContractClient::new(&env, &example_contract_address);

    // SAC
    let sac_admin = Address::from_string(&String::from_str(
        &env,
        "GD7777777777777777777777777777777777777777777777777773DB",
    ));
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let sac_address = sac.address();
    let sac_admin_client = token::StellarAssetClient::new(&env, &sac_address);
    // let sac_client = token::Client::new(&env, &sac_address);
    //

    sac_admin_client
        .mock_all_auths()
        .mint(&wallet_address, &100_000_000);

    // Super Ed25519
    let super_keypair = Keypair::from_bytes(&[
        88, 206, 67, 128, 240, 45, 168, 148, 191, 111, 180, 111, 104, 83, 214, 113, 78, 27, 55, 86,
        200, 247, 164, 163, 76, 236, 24, 208, 115, 40, 231, 255, 161, 115, 141, 114, 97, 125, 136,
        247, 117, 105, 60, 155, 144, 51, 216, 187, 185, 157, 18, 126, 169, 172, 15, 4, 148, 13,
        208, 144, 53, 12, 91, 78,
    ])
    .unwrap();

    let super_address =
        Strkey::PublicKeyEd25519(ed25519::PublicKey(super_keypair.public.to_bytes()));
    let super_address = Bytes::from_slice(&env, super_address.to_string().as_bytes());
    let super_address = Address::from_string_bytes(&super_address);

    let super_address_bytes = super_address.to_xdr(&env);
    let super_address_bytes = super_address_bytes.slice(super_address_bytes.len() - 32..);
    let mut super_address_array = [0u8; 32];
    super_address_bytes.copy_into_slice(&mut super_address_array);
    let super_address_bytes = BytesN::from_array(&env, &super_address_array);

    wallet_client.mock_all_auths().add(&Signer::Ed25519(
        Ed25519PublicKey(super_address_bytes.clone()),
        SignerStorage::Persistent,
        SignerType::Admin,
    ));
    //

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
        Secp256r1Id(id.clone()),
        Secp256r1PublicKey(pk),
        SignerStorage::Temporary,
        SignerType::Basic,
    ));
    ////

    // Policy
    let sample_policy_address = env.register_contract(None, PolicyContract);

    // TODO big note that Policy signers can remove themselves with or without adding themselves to their SignerType::Basic(Vec<Policy>) list
    // Likely okay, but is a potential footgun, can guard against it in the policy itself
    // I'm pretty concerned atm of the potential nefarious reach of a policy signer. Will be more controlled once I understand how to control them in a more guaranteed manner
    wallet_client.mock_all_auths().add(&Signer::Policy(
        Policy(sample_policy_address.clone()),
        SignerStorage::Temporary,
        SignerType::Basic,
    ));
    //

    // Simple Ed25519
    let simple_keypair = Keypair::from_bytes(&[
        149, 154, 40, 132, 13, 234, 167, 87, 182, 44, 152, 45, 242, 179, 187, 17, 139, 106, 49, 85,
        249, 235, 17, 248, 24, 170, 19, 164, 23, 117, 145, 252, 172, 35, 170, 26, 69, 15, 75, 127,
        192, 170, 166, 54, 68, 127, 218, 29, 130, 173, 159, 1, 253, 192, 48, 242, 80, 12, 55, 152,
        223, 122, 198, 96,
    ])
    .unwrap();

    let simple_address =
        Strkey::PublicKeyEd25519(ed25519::PublicKey(simple_keypair.public.to_bytes()));
    let simple_address = Bytes::from_slice(&env, simple_address.to_string().as_bytes());
    let simple_address = Address::from_string_bytes(&simple_address);

    let simple_address_bytes = simple_address.to_xdr(&env);
    let simple_address_bytes = simple_address_bytes.slice(simple_address_bytes.len() - 32..);
    let mut simple_address_array = [0u8; 32];
    simple_address_bytes.copy_into_slice(&mut simple_address_array);
    let simple_address_bytes = BytesN::from_array(&env, &simple_address_array);

    let add_signer = Signer::Ed25519(
        Ed25519PublicKey(simple_address_bytes.clone()),
        SignerStorage::Temporary,
        SignerType::Policy,
    );

    wallet_client.mock_all_auths().add(&add_signer);
    //

    let transfer_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: sac_address.clone().try_into().unwrap(),
            function_name: "transfer".try_into().unwrap(),
            args: std::vec![
                wallet_address.clone().try_into().unwrap(),
                sac_address.clone().try_into().unwrap(),
                amount.try_into().unwrap(),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let remove_key = SignerKey::Policy(Policy(sample_policy_address.clone()));
    // let remove_key = SignerKey::Ed25519(Ed25519PublicKey(simple_address_bytes.clone()));
    // let remove_key = SignerKey::Secp256r1(Secp256r1Id(id.clone()));
    let remove_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: wallet_address.clone().try_into().unwrap(),
            function_name: "remove".try_into().unwrap(),
            args: std::vec![remove_key.clone().try_into().unwrap(),]
                .try_into()
                .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let add_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: wallet_address.clone().try_into().unwrap(),
            function_name: "add".try_into().unwrap(),
            args: std::vec![add_signer.clone().try_into().unwrap(),]
                .try_into()
                .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: example_contract_address.clone().try_into().unwrap(),
            function_name: "call".try_into().unwrap(),
            args: std::vec![
                sac_address.clone().try_into().unwrap(),
                wallet_address.clone().try_into().unwrap(),
                sac_address.clone().try_into().unwrap(),
                amount.try_into().unwrap(),
                remove_key.clone().try_into().unwrap(),
                add_signer.clone().try_into().unwrap(),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: std::vec![
            transfer_invocation.clone(),
            // remove_invocation.clone(),
            // add_invocation.clone(),
        ]
        .try_into()
        .unwrap(),
    };

    // let payload = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
    //     network_id: env.ledger().network_id().to_array().into(),
    //     nonce: 3,
    //     signature_expiration_ledger,
    //     invocation: root_invocation.clone(),
    // });
    // let payload = payload.to_xdr(Limits::none()).unwrap();
    // let payload = Bytes::from_slice(&env, payload.as_slice());
    // let payload = env.crypto().sha256(&payload);

    let signer_keys = vec![
        &env,
        SignerKey::Ed25519(Ed25519PublicKey(simple_address_bytes.clone())),
        // SignerKey::Ed25519(Ed25519PublicKey(super_address_bytes.clone())),
    ];
    let signature_policy = Signature::Policy(PolicySignature {
        policy: Policy(sample_policy_address.clone()),
        signer_keys: signer_keys.clone(),
    });
    let signature_policy_scval: ScVal = signature_policy.clone().try_into().unwrap();

    let root_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce: 3,
            signature_expiration_ledger,
            signature: std::vec![
                // super_signature_ed25519_scval.clone(),
                signature_policy_scval.clone(),
            ]
            .try_into()
            .unwrap(),
        }),
        root_invocation: root_invocation.clone(),
    };

    let __check_auth_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: wallet_address.clone().try_into().unwrap(),
            function_name: "__check_auth".try_into().unwrap(),
            args: std::vec![
                signer_keys.clone().try_into().unwrap(),
                vec![
                    &env,
                    Context::Contract(ContractContext {
                        contract: example_contract_address.clone(),
                        fn_name: symbol_short!("call"),
                        args: vec![
                            &env,
                            sac_address.to_val(),
                            wallet_address.to_val(),
                            sac_address.to_val(),
                            amount.into_val(&env),
                            remove_key.into_val(&env),
                            add_signer.into_val(&env),
                        ]
                    }),
                    Context::Contract(ContractContext {
                        contract: sac_address.clone(),
                        fn_name: symbol_short!("transfer"),
                        args: vec![
                            &env,
                            wallet_address.to_val(),
                            sac_address.to_val(),
                            amount.into_val(&env)
                        ]
                    }),
                    // Context::Contract(ContractContext {
                    //     contract: wallet_address.clone(),
                    //     fn_name: symbol_short!("remove"),
                    //     args: vec![&env, remove_key.into_val(&env),]
                    // }),
                    // Context::Contract(ContractContext {
                    //     contract: wallet_address.clone(),
                    //     fn_name: symbol_short!("add"),
                    //     args: vec![&env, add_signer.into_val(&env),]
                    // }),
                ]
                .try_into()
                .unwrap(),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let payload = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id: env.ledger().network_id().to_array().into(),
        nonce: 4,
        signature_expiration_ledger,
        invocation: __check_auth_invocation.clone(),
    });
    let payload = payload.to_xdr(Limits::none()).unwrap();
    let payload = Bytes::from_slice(&env, payload.as_slice());
    let payload = env.crypto().sha256(&payload);

    let super_signature_ed25519 = Signature::Ed25519(Ed25519Signature {
        public_key: Ed25519PublicKey(super_address_bytes.clone()),
        signature: BytesN::from_array(
            &env,
            &super_keypair.sign(payload.to_array().as_slice()).to_bytes(),
        ),
    });
    let super_signature_ed25519_scval: ScVal = super_signature_ed25519.clone().try_into().unwrap();

    let signature_ed25519 = Signature::Ed25519(Ed25519Signature {
        public_key: Ed25519PublicKey(simple_address_bytes.clone()),
        signature: BytesN::from_array(
            &env,
            &simple_keypair
                .sign(payload.to_array().as_slice())
                .to_bytes(),
        ),
    });
    let signature_ed25519_scval: ScVal = signature_ed25519.clone().try_into().unwrap();

    let __check_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: sample_policy_address.clone().try_into().unwrap(),
            nonce: 4,
            // signature: ScVal::Vec(Some(ScVec::default())),
            signature: std::vec![
                super_signature_ed25519_scval.clone(),
                signature_ed25519_scval.clone(),
            ]
            .try_into()
            .unwrap(),
            signature_expiration_ledger,
        }),
        root_invocation: __check_auth_invocation.clone(),
    };

    println!("\n{:?}\n", root_auth.to_xdr_base64(Limits::none()).unwrap());
    println!("\n{:?}\n", __check_auth.to_xdr_base64(Limits::none()).unwrap());

    example_contract_client
        .set_auths(&[root_auth, __check_auth])
        .call(
            &sac_address,
            &wallet_address,
            &sac_address,
            &amount,
            &remove_key,
            &add_signer,
        );
}
