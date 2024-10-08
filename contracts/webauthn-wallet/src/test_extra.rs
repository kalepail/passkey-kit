#![cfg(test)]

use std::println;
extern crate std;

use example_contract::{Contract as ExampleContract, ContractClient as ExampleContractClient};
use soroban_sdk::{
    map,
    xdr::{
        ContractExecutable, ContractIdPreimage, ContractIdPreimageFromAddress, CreateContractArgs,
        Hash, HashIdPreimage, HashIdPreimageSorobanAuthorization, Limits, ScAddress, ScVal,
        SorobanAddressCredentials, SorobanAuthorizationEntry, SorobanAuthorizedFunction,
        SorobanAuthorizedInvocation, SorobanCredentials, ToXdr, Uint256, VecM, WriteXdr,
    },
    Address, Bytes, BytesN, Env,
};
use stellar_strkey::{ed25519, Strkey};
use webauthn_wallet_interface::types::{
    Signature, Signatures, Signer, SignerKey, SignerLimits, SignerStorage,
};

use crate::{Contract, ContractClient};
use ed25519_dalek::{Keypair, Signer as _};

use base64::{engine::general_purpose::URL_SAFE, Engine as _};

mod factory {
    soroban_sdk::contractimport!(
        file = "../target/wasm32-unknown-unknown/release/webauthn_factory.wasm"
    );
}

#[test]
fn test_deploy_contract() {
    let env: Env = Env::default();
    let signature_expiration_ledger = env.ledger().sequence();

    let wallet_address = env.register_contract(None, Contract);
    let wallet_client = ContractClient::new(&env, &wallet_address);

    let example_contract_address = env.register_contract(None, ExampleContract);
    let example_contract_client = ExampleContractClient::new(&env, &example_contract_address);

    let wasm_hash = env.deployer().upload_contract_wasm(factory::WASM);

    let wallet_address_bytes = wallet_address.clone().to_xdr(&env);
    let wallet_address_bytes = wallet_address_bytes.slice(wallet_address_bytes.len() - 32..);
    let mut wallet_address_array = [0u8; 32];
    wallet_address_bytes.copy_into_slice(&mut wallet_address_array);

    // Super Ed25519
    let super_ed25519_keypair = Keypair::from_bytes(&[
        88, 206, 67, 128, 240, 45, 168, 148, 191, 111, 180, 111, 104, 83, 214, 113, 78, 27, 55, 86,
        200, 247, 164, 163, 76, 236, 24, 208, 115, 40, 231, 255, 161, 115, 141, 114, 97, 125, 136,
        247, 117, 105, 60, 155, 144, 51, 216, 187, 185, 157, 18, 126, 169, 172, 15, 4, 148, 13,
        208, 144, 53, 12, 91, 78,
    ])
    .unwrap();

    let super_ed25519_strkey =
        Strkey::PublicKeyEd25519(ed25519::PublicKey(super_ed25519_keypair.public.to_bytes()));
    let super_ed25519 = Bytes::from_slice(&env, super_ed25519_strkey.to_string().as_bytes());
    let super_ed25519 = Address::from_string_bytes(&super_ed25519);

    let super_ed25519_bytes = super_ed25519.to_xdr(&env);
    let super_ed25519_bytes = super_ed25519_bytes.slice(super_ed25519_bytes.len() - 32..);
    let mut super_ed25519_array = [0u8; 32];
    super_ed25519_bytes.copy_into_slice(&mut super_ed25519_array);
    let super_ed25519_bytes = BytesN::from_array(&env, &super_ed25519_array);

    let super_ed25519_signer_key = SignerKey::Ed25519(super_ed25519_bytes.clone());

    wallet_client.mock_all_auths().add_signer(&Signer::Ed25519(
        super_ed25519_bytes,
        SignerLimits(map![&env]),
        SignerStorage::Persistent,
    ));
    //

    let root_invocation = SorobanAuthorizedInvocation {
        function: SorobanAuthorizedFunction::CreateContractHostFn(CreateContractArgs {
            contract_id_preimage: ContractIdPreimage::Address(ContractIdPreimageFromAddress {
                address: ScAddress::Contract(Hash::from(wallet_address_array)),
                salt: Uint256(wasm_hash.to_array()),
            }),
            executable: ContractExecutable::Wasm(Hash::from(wasm_hash.to_array())),
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

    let super_ed25519_signature = Signature::Ed25519(BytesN::from_array(
        &env,
        &super_ed25519_keypair
            .sign(payload.to_array().as_slice())
            .to_bytes(),
    ));

    let root_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce: 0,
            signature_expiration_ledger,
            signature: Signatures(map![
                &env,
                (
                    super_ed25519_signer_key.clone(),
                    Some(super_ed25519_signature)
                ),
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

#[test]
fn who_am_i() {
    let env: Env = Env::default();

    let none = None::<Address>;
    let none = none.to_xdr(&env);
    let mut none_bytes: [u8; 4] = [0; 4];

    none.copy_into_slice(&mut none_bytes);

    println!("{:?}", URL_SAFE.encode(none_bytes));
    println!("{:?}", ScVal::Void.to_xdr_base64(Limits::none()).unwrap());
}
