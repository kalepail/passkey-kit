#![cfg(test)]

use std::println;
extern crate std;

use example_contract::{Contract as ExampleContract, ContractClient as ExampleContractClient};
use soroban_sdk::{
    xdr::{
        ContractExecutable, ContractIdPreimage, ContractIdPreimageFromAddress, CreateContractArgs,
        Hash, Limits, ScAddress, ScMap, ScVal, SorobanAddressCredentials,
        SorobanAuthorizationEntry, SorobanAuthorizedFunction, SorobanAuthorizedInvocation,
        SorobanCredentials, ToXdr, Uint256, VecM, WriteXdr,
    },
    Address, Env,
};

use crate::Contract;

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
    // let wallet_client = ContractClient::new(&env, &wallet_address);

    let example_contract_address = env.register_contract(None, ExampleContract);
    let example_contract_client = ExampleContractClient::new(&env, &example_contract_address);

    let wasm_hash = env.deployer().upload_contract_wasm(factory::WASM);

    let wallet_address_bytes = wallet_address.clone().to_xdr(&env);
    let wallet_address_bytes = wallet_address_bytes.slice(wallet_address_bytes.len() - 32..);
    let mut wallet_address_array = [0u8; 32];
    wallet_address_bytes.copy_into_slice(&mut wallet_address_array);

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

    let root_auth = SorobanAuthorizationEntry {
        credentials: SorobanCredentials::Address(SorobanAddressCredentials {
            address: wallet_address.clone().try_into().unwrap(),
            nonce: 0,
            signature_expiration_ledger,
            signature: ScVal::Map(Some(ScMap::default())),
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
