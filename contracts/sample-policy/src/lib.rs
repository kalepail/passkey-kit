#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface},
    contract, contracterror, contractimpl,
    crypto::Hash,
    panic_with_error, symbol_short, vec, Address, Env, String, Symbol, TryFromVal, Vec,
};
use webauthn_wallet_interface::{Ed25519Signature, Signature, SignerKey};
pub mod webauthn_wallet_interface;

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotAllowed = 1,
}

// In the Colorglyph example would it make more sense to store the service G-address here or inside the smart wallet?
// I think I want to store it in the smart wallet but maybe validate it's signature here? Not sure it makes much material difference as long as we can restrict the service G-address to only be usable in tandem with a specific policy

#[contract]
pub struct Contract;

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Vec<Signature>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Vec<Signature>,
        root_auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        // Currently hard coded to only allow Ed25519 signatures
        for signature in signatures.iter() {
            match signature {
                Signature::Ed25519(Ed25519Signature {
                    public_key,
                    signature,
                }) => {
                    env.crypto().ed25519_verify(
                        &public_key.0,
                        &signature_payload.clone().into(),
                        &signature,
                    );
                }
                _ => panic_with_error!(&env, Error::NotAllowed),
            }
        }

        let native_sacs = vec![
            &env,
            Address::from_string(&String::from_str(
                &env,
                "CBUSYNQKASUYFWYC3M2GUEDMX4AIVWPALDBYJPNK6554BREHTGZ2IUNF",
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
                    contract: root_contract, // In the case of a smart wallet context this would be the smart wallet address
                    fn_name: root_fn_name,
                    args: root_args,
                }) => {
                    // println!(
                    //     "root_contract: {:?}, root_fn_name: {:?}, root_args: {:?}",
                    //     root_contract, root_fn_name, root_args
                    // );

                    // Likely in a smart wallet scenario. At the very least all smart wallet Policy calls WILL be a __check_auth call, so ignoring other contexts is safe
                    if root_fn_name == Symbol::new(&env, "__check_auth") {
                        // Check signer keys, very important check to ensure the required arg_signer_keys were included
                        if let Some(val) = root_args.get(0) {
                            if let Ok(arg_signer_keys) = Vec::<SignerKey>::try_from_val(&env, &val)
                            {
                                for arg_signer_key in arg_signer_keys.iter() {
                                    match arg_signer_key {
                                        SignerKey::Ed25519(arg_signer_public_key) => {
                                            let found = signatures.iter().find_map(|signature| {
                                                match signature {
                                                    Signature::Ed25519(Ed25519Signature {
                                                        public_key,
                                                        ..
                                                    }) => {
                                                        if public_key == arg_signer_public_key {
                                                            Some(())
                                                        } else {
                                                            None
                                                        }
                                                    }
                                                    _ => None,
                                                }
                                            });

                                            // Error if we didn't find a matching signature for this signer key
                                            // Very important check to ensure the included Policy signature signer_keys actually signed
                                            if found.is_none() {
                                                panic_with_error!(&env, Error::NotAllowed)
                                            }
                                        }
                                        _ => panic_with_error!(&env, Error::NotAllowed),
                                    }
                                }
                            }
                        }

                        // Check arg auth contexts
                        if let Some(val) = root_args.get(1) {
                            if let Ok(arg_auth_contexts) = Vec::<Context>::try_from_val(&env, &val)
                            {
                                // If we get here it's very safe to assume we're in a smart wallet scenario and if you are you absolutely would get to this point safely
                                for context in arg_auth_contexts.iter() {
                                    match context {
                                        Context::Contract(ContractContext {
                                            contract: sub_contract,
                                            fn_name: sub_fn_name,
                                            args: sub_args,
                                        }) => {
                                            // println!(
                                            //     "sub_contract: {:?}, sub_fn_name: {:?}, sub_args: {:?}",
                                            //     sub_contract, sub_fn_name, sub_args
                                            // );

                                            // Panic for any context that is a self operation (i.e. a call to the smart wallet itself)
                                            // Disallow any self smart wallet calls (otherwise a Policy Signature alone could call for its own Policy removal)
                                            // Could permit this under more restrictive conditions but for now it's a blanket disallow to ensure Joe Schmo can't nuke this policy from my smart wallet
                                            if sub_contract == root_contract {
                                                panic_with_error!(&env, Error::NotAllowed)
                                            }

                                            if let Some(amount_val) = sub_args.get(2) {
                                                if let Ok(amount) =
                                                    i128::try_from_val(&env, &amount_val)
                                                {
                                                    if native_sacs.contains(sub_contract) // NOTE the // Rust test address seems to change randomly (if you're hitting weird errors while testing, check that)
                                                    && sub_fn_name == symbol_short!("transfer")
                                                    && amount > 10_000_000
                                                    {
                                                        panic_with_error!(&env, Error::NotAllowed)
                                                    }
                                                }
                                            }
                                        }
                                        _ => panic_with_error!(&env, Error::NotAllowed),
                                    }
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(())
    }
}
