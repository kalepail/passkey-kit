#![cfg(test)]

use std::println;
extern crate std;

use ed25519_dalek::{Keypair, Signer as _};
use example_contract::{Contract as ExampleContract, ContractClient as ExampleContractClient};
use sample_policy::Contract as PolicyContract;
use soroban_sdk::{
    auth::{Context, ContractContext},
    map, symbol_short, token, vec,
    xdr::{
        HashIdPreimage, HashIdPreimageSorobanAuthorization, InvokeContractArgs, Limits, ScVal,
        ScVec, SorobanAddressCredentials, SorobanAuthorizationEntry, SorobanAuthorizedFunction,
        SorobanAuthorizedInvocation, SorobanCredentials, ToXdr, VecM, WriteXdr,
    },
    Address, Bytes, BytesN, Env, IntoVal, String,
};
use stellar_strkey::{ed25519, Strkey};

use crate::{
    types::{Signature, Signer, SignerKey, SignerLimits, SignerStorage},
    Contract, ContractClient,
};

#[test]
fn test() {
    let env: Env = Env::default();
    let signature_expiration_ledger = env.ledger().sequence();
    let amount = 10_000_000i128;
    let evil_amount = 10_000_00i128;

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
    // let super_ed25519_keypair = Keypair::from_bytes(&[
    //     88, 206, 67, 128, 240, 45, 168, 148, 191, 111, 180, 111, 104, 83, 214, 113, 78, 27, 55, 86,
    //     200, 247, 164, 163, 76, 236, 24, 208, 115, 40, 231, 255, 161, 115, 141, 114, 97, 125, 136,
    //     247, 117, 105, 60, 155, 144, 51, 216, 187, 185, 157, 18, 126, 169, 172, 15, 4, 148, 13,
    //     208, 144, 53, 12, 91, 78,
    // ])
    // .unwrap();

    // let super_ed25519_strkey =
    //     Strkey::PublicKeyEd25519(ed25519::PublicKey(super_ed25519_keypair.public.to_bytes()));
    // let super_ed25519 = Bytes::from_slice(&env, super_ed25519_strkey.to_string().as_bytes());
    // let super_ed25519 = Address::from_string_bytes(&super_ed25519);

    // let super_ed25519_bytes = super_ed25519.to_xdr(&env);
    // let super_ed25519_bytes = super_ed25519_bytes.slice(super_ed25519_bytes.len() - 32..);
    // let mut super_ed25519_array = [0u8; 32];
    // super_ed25519_bytes.copy_into_slice(&mut super_ed25519_array);
    // let super_ed25519_bytes = BytesN::from_array(&env, &super_ed25519_array);

    // let super_ed25519_signer_key = SignerKey::Ed25519(super_ed25519_bytes.clone());
    //

    // Secp256r1
    // let secp256r1_id = Bytes::from_array(
    //     &env,
    //     &[
    //         243, 248, 216, 74, 226, 218, 85, 102, 196, 167, 14, 151, 124, 42, 73, 136, 138, 102,
    //         187, 140,
    //     ],
    // );
    // let secp256r1_public_key = BytesN::from_array(
    //     &env,
    //     &[
    //         4, 163, 142, 245, 242, 113, 55, 104, 189, 52, 128, 238, 206, 174, 194, 177, 4, 100,
    //         161, 243, 177, 255, 10, 53, 57, 194, 205, 45, 208, 10, 131, 167, 93, 44, 123, 126, 95,
    //         219, 207, 230, 175, 90, 96, 41, 121, 197, 127, 180, 74, 236, 160, 0, 60, 185, 211, 174,
    //         133, 215, 200, 208, 230, 51, 210, 94, 214,
    //     ],
    // );
    // let secp256r1_signer_key = SignerKey::Secp256r1(secp256r1_id.clone());
    // let secp246r1_signer = Signer::Secp256r1(
    //     secp256r1_id,
    //     secp256r1_public_key,
    //     SignerLimits(map![&env]),
    //     SignerStorage::Temporary,
    // );
    ////

    // Simple Ed25519
    let simple_ed25519_keypair = Keypair::from_bytes(&[
        149, 154, 40, 132, 13, 234, 167, 87, 182, 44, 152, 45, 242, 179, 187, 17, 139, 106, 49, 85,
        249, 235, 17, 248, 24, 170, 19, 164, 23, 117, 145, 252, 172, 35, 170, 26, 69, 15, 75, 127,
        192, 170, 166, 54, 68, 127, 218, 29, 130, 173, 159, 1, 253, 192, 48, 242, 80, 12, 55, 152,
        223, 122, 198, 96,
    ])
    .unwrap();

    let simple_ed25519_strkey =
        Strkey::PublicKeyEd25519(ed25519::PublicKey(simple_ed25519_keypair.public.to_bytes()));
    let simple_ed25519_address =
        Bytes::from_slice(&env, simple_ed25519_strkey.to_string().as_bytes());
    let simple_ed25519_address = Address::from_string_bytes(&simple_ed25519_address);

    let simple_ed25519_bytes = simple_ed25519_address.to_xdr(&env);
    let simple_ed25519_bytes = simple_ed25519_bytes.slice(simple_ed25519_bytes.len() - 32..);
    let mut simple_ed25519_array = [0u8; 32];
    simple_ed25519_bytes.copy_into_slice(&mut simple_ed25519_array);
    let simple_ed25519_bytes = BytesN::from_array(&env, &simple_ed25519_array);
    let simple_ed25519_signer_key = SignerKey::Ed25519(simple_ed25519_bytes.clone());
    //

    // Policy
    let sample_policy_address = env.register_contract(None, PolicyContract);
    let sample_policy_signer_key = SignerKey::Policy(sample_policy_address.clone());
    //

    // Add signers to smart wallet
    // wallet_client.mock_all_auths().add(&Signer::Ed25519(
    //     super_ed25519_bytes,
    //     SignerLimits(map![&env]),
    //     SignerStorage::Persistent,
    // ));

    // wallet_client
    //     .mock_all_auths()
    //     .add(&secp246r1_signer.clone());

    wallet_client.mock_all_auths().add(&Signer::Ed25519(
        simple_ed25519_bytes,
        SignerLimits(map![
            &env,
            (
                sac_address.clone(),
                Some(vec![&env, sample_policy_signer_key.clone()])
            ),
            (example_contract_address.clone(), None,)
        ]),
        SignerStorage::Temporary,
    ));

    wallet_client.mock_all_auths().add(&Signer::Policy(
        sample_policy_address.clone(),
        SignerLimits(map![
            &env,
            (
                sac_address.clone(),
                Some(vec![&env, simple_ed25519_signer_key.clone()])
            ),
        ]),
        SignerStorage::Temporary,
    ));
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

    let evil_transfer_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: sac_address.clone().try_into().unwrap(),
            function_name: "transfer".try_into().unwrap(),
            args: std::vec![
                wallet_address.clone().try_into().unwrap(),
                sac_address.clone().try_into().unwrap(),
                evil_amount.try_into().unwrap(),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    // let remove_invocation = SorobanAuthorizedInvocation {
    //     function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
    //         contract_address: wallet_address.clone().try_into().unwrap(),
    //         function_name: "remove".try_into().unwrap(),
    //         args: std::vec![secp256r1_signer_key.clone().try_into().unwrap(),]
    //             .try_into()
    //             .unwrap(),
    //     }),
    //     sub_invocations: VecM::default(),
    // };

    // let add_invocation = SorobanAuthorizedInvocation {
    //     function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
    //         contract_address: wallet_address.clone().try_into().unwrap(),
    //         function_name: "add".try_into().unwrap(),
    //         args: std::vec![secp246r1_signer.clone().try_into().unwrap(),]
    //             .try_into()
    //             .unwrap(),
    //     }),
    //     sub_invocations: VecM::default(),
    // };

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: example_contract_address.clone().try_into().unwrap(),
            function_name: "call".try_into().unwrap(),
            args: std::vec![
                sac_address.clone().try_into().unwrap(),
                wallet_address.clone().try_into().unwrap(),
                sac_address.clone().try_into().unwrap(),
                amount.try_into().unwrap(),
                // remove_key.clone().try_into().unwrap(),
                // add_signer.clone().try_into().unwrap(),
            ]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: std::vec![
            transfer_invocation.clone(),
            evil_transfer_invocation.clone(),
            // remove_invocation.clone(),
            // add_invocation.clone(),
        ]
        .try_into()
        .unwrap(),
    };

    let payload = HashIdPreimage::SorobanAuthorization(HashIdPreimageSorobanAuthorization {
        network_id: env.ledger().network_id().to_array().into(),
        nonce: 3,
        signature_expiration_ledger,
        invocation: root_invocation.clone(),
    });
    let payload = payload.to_xdr(Limits::none()).unwrap();
    let payload = Bytes::from_slice(&env, payload.as_slice());
    let payload = env.crypto().sha256(&payload);

    // let super_ed25519_signature = Signature::Ed25519(BytesN::from_array(
    //     &env,
    //     &super_ed25519_keypair
    //         .sign(payload.to_array().as_slice())
    //         .to_bytes(),
    // ));

    let simple_ed25519_signature = Signature::Ed25519(BytesN::from_array(
        &env,
        &simple_ed25519_keypair
            .sign(payload.to_array().as_slice())
            .to_bytes(),
    ));

    let root_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce: 3,
            signature_expiration_ledger,
            signature: map![
                &env,
                (
                    simple_ed25519_signer_key.clone(),
                    Some(simple_ed25519_signature)
                ),
                // (
                //     super_ed25519_signer_key.clone(),
                //     Some(super_ed25519_signature)
                // ),
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
            args: std::vec![Context::Contract(ContractContext {
                contract: sac_address.clone(),
                fn_name: symbol_short!("transfer"),
                args: vec![
                    &env,
                    wallet_address.to_val(),
                    sac_address.to_val(),
                    amount.into_val(&env)
                ]
            })
            .try_into()
            .unwrap(),]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let __evil_check_auth_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::ContractFn(InvokeContractArgs {
            contract_address: wallet_address.clone().try_into().unwrap(),
            function_name: "__check_auth".try_into().unwrap(),
            args: std::vec![Context::Contract(ContractContext {
                contract: sac_address.clone(),
                fn_name: symbol_short!("transfer"),
                args: vec![
                    &env,
                    wallet_address.to_val(),
                    sac_address.to_val(),
                    evil_amount.into_val(&env)
                ]
            })
            .try_into()
            .unwrap(),]
            .try_into()
            .unwrap(),
        }),
        sub_invocations: VecM::default(),
    };

    let __check_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: sample_policy_address.clone().try_into().unwrap(),
            nonce: 4,
            signature: ScVal::Vec(Some(ScVec::default())),
            signature_expiration_ledger,
        }),
        root_invocation: __check_auth_invocation.clone(),
    };

    let __evil_check_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: sample_policy_address.clone().try_into().unwrap(),
            nonce: 5,
            signature: ScVal::Vec(Some(ScVec::default())),
            signature_expiration_ledger,
        }),
        root_invocation: __evil_check_auth_invocation.clone(),
    };

    // println!("\n{:?}\n", root_auth.to_xdr_base64(Limits::none()).unwrap());
    // println!(
    //     "\n{:?}\n",
    //     __check_auth.to_xdr_base64(Limits::none()).unwrap()
    // );

    env.budget().reset_default();

    example_contract_client
        .set_auths(&[root_auth, __check_auth, __evil_check_auth])
        .call(
            &sac_address,
            &wallet_address,
            &sac_address,
            &amount,
            // &remove_key,
            // &add_signer,
        );

    // Loose
    // Cpu limit: 100000000; used: 1011983
    // Mem limit: 41943040; used: 106096

    // Careful
    // Cpu limit: 100000000; used: 1151236
    // Mem limit: 41943040; used: 126594

    println!("{:?}", env.budget().print());
}
