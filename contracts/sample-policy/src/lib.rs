#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface},
    contract, contracterror, contractimpl,
    crypto::Hash,
    panic_with_error, symbol_short, vec, Address, Bytes, Env, FromVal, String, Vec,
};
use webauthn_wallet_interface::Signature;
pub mod webauthn_wallet_interface;

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotPermitted = 1,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Vec<Signature>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        root_signature_payload: Hash<32>,
        root_signatures: Vec<Signature>,
        root_auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let native_sacs = vec![
            &env,
            Address::from_string(&String::from_str(
                &env,
                "CCABDO7UZXYE4W6GVSEGSNNZTKSLFQGKXXQTH6OX7M7GKZ4Z6CUJNGZN",
            )), // Rust test
            Address::from_string(&String::from_str(
                &env,
                "CB64D3G7SM2RTH6JSGG34DDTFTQ5CFDKVDZJZSODMCX4NJ2HV2KN7OHT",
            )), // Futurenet
            Address::from_string(&String::from_str(
                &env,
                "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
            )), // Testnet
            Address::from_string(&String::from_str(
                &env,
                "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
            )), // Mainnet
        ];

        for context in root_auth_contexts.iter() {
            match context {
                Context::Contract(ContractContext {
                    contract: root_contract, // will be the contract that called the policy the smart wallet
                    fn_name: root_fn_name,   // will always be "__check_auth"
                    args: root_args,
                }) => {
                    let arg_signature_payload = Bytes::from_val(&env, &root_args.get_unchecked(0));
                    // these will be the smart wallet signatures that triggered this __check_auth policy call
                    let arg_signatures: Vec<Signature> =
                        Vec::from_val(&env, &root_args.get_unchecked(1));
                    let arg_auth_contexts: Vec<Context> =
                        Vec::from_val(&env, &root_args.get_unchecked(2));

                    // Ensure there are more signatures than just this policy (so another policy, ed25519 or secp256r1)
                    // CRITICALLY important at least in the case of this sample policy otherwise anyone could drain your smart wallet without any need for cryptographic validation
                    'check: loop {
                        for signature in arg_signatures.iter() {
                            // Going even a step further to ensure there's a non-policy signature (so an Ed25519 or Secp256r1)
                            match signature {
                                Signature::Ed25519(_) => break 'check,
                                Signature::Secp256r1(_) => break 'check,
                                _ => {},
                            }
                        }

                        panic_with_error!(&env, Error::NotPermitted)
                    }

                    for context in arg_auth_contexts.iter() {
                        match context {
                            Context::Contract(ContractContext {
                                contract: sub_contract,
                                fn_name: sub_fn_name,
                                args: sub_args,
                            }) => {
                                if !native_sacs.contains(&sub_contract) {
                                    // This policy can only authorize native XLM contracts
                                    panic_with_error!(&env, Error::NotPermitted)
                                }

                                if sub_fn_name != symbol_short!("transfer") {
                                    // This policy can only authorize the transfer method
                                    panic_with_error!(&env, Error::NotPermitted)
                                }

                                let amount = i128::from_val(&env, &sub_args.get_unchecked(2));

                                if amount > 10_000_000 {
                                    // This policy can only authorize transfers of 1 XLM or less
                                    panic_with_error!(&env, Error::NotPermitted)
                                }
                            }
                            _ => panic_with_error!(&env, Error::NotPermitted),
                        }
                    }
                }
                _ => panic_with_error!(&env, Error::NotPermitted),
            }
        }

        Ok(())
    }
}
