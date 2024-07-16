#![cfg(test)]

use std::println;
extern crate std;

use soroban_sdk::{
    // testutils::{Address as _, BytesN as _},
    // token, Address,
    vec,
    Bytes,
    BytesN,
    Env,
    IntoVal,
};

use crate::{Contract, ContractClient, Error, Signature};

mod factory {
    soroban_sdk::contractimport!(file = "../out/webauthn_factory.optimized.wasm");
}

// mod passkey {
//     use soroban_sdk::auth::Context;
//     soroban_sdk::contractimport!(file = "../out/webauthn_wallet.optimized.wasm");
// }

#[test]
fn test() {
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
    deployee_client.add(&id, &pk, &true);

    let signature_payload = BytesN::from_array(
        &env,
        &[
            150, 22, 248, 96, 91, 4, 111, 72, 170, 101, 57, 225, 210, 199, 91, 29, 159, 227, 209,
            6, 231, 63, 222, 209, 232, 57, 112, 98, 140, 118, 206, 245,
        ],
    );

    let signature = Signature {
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
        id: Bytes::from_array(
            &env,
            &[
                243, 248, 216, 74, 226, 218, 85, 102, 196, 167, 14, 151, 124, 42, 73, 136, 138,
                102, 187, 140,
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
    };

    let result: Result<(), Result<Error, _>> = env.try_invoke_contract_check_auth(
        &deployee_address,
        &signature_payload,
        signature.into_val(&env),
        &vec![&env],
    );

    println!("{:?}", result);
}
