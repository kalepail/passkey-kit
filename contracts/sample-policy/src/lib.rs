#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface},
    contract, contracterror, contractimpl,
    crypto::Hash,
    panic_with_error, Bytes, Env, FromVal, Vec,
};
use webauthn_wallet_interface::{Ed25519Signature, Signature, Signer};

pub mod webauthn_wallet_interface;

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    NotPermitted = 2,
}

#[contract]
pub struct Contract;

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Vec<Signature>;

    // TODO test scenario with multiple root_auth_contexts and multiple arg_auth_contexts

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        root_signature_payload: Hash<32>,
        root_signatures: Vec<Signature>,
        root_auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        for context in root_auth_contexts.iter() {
            match context {
                Context::Contract(ContractContext {
                    contract: root_contract,
                    fn_name: __check_auth,
                    args: root_args,
                }) => {
                    let arg_signature_payload = Bytes::from_val(&env, &root_args.get_unchecked(0));
                    let arg_signatures: Vec<Signature> =
                        Vec::from_val(&env, &root_args.get_unchecked(1));
                    let arg_auth_contexts: Vec<Context> =
                        Vec::from_val(&env, &root_args.get_unchecked(2));
                    let arg_signers: Vec<Signer> = Vec::from_val(&env, &root_args.get_unchecked(3));

                    // println!("{:?}", arg_signature_payload);

                    for signature in arg_signatures.iter() {
                        // println!("{:?}", signature);
                    }

                    for context in arg_auth_contexts.iter() {
                        match context {
                            Context::Contract(ContractContext {
                                contract: sub_contract,
                                fn_name,
                                args: sub_args,
                            }) => {
                                if sub_contract == root_contract {
                                    // This policy cannot authorize anything on the smart wallet (makes it safe for the policy to be an admin key)
                                    panic_with_error!(&env, Error::NotPermitted)
                                }

                                // println!("{:?}", sub_contract); // the example contract
                                // println!("{:?}", fn_name); // "call"
                                // println!("{:?}", sub_args); // any arguments passed to the example contract function

                                /* For the colorglyph use case we would want to
                                    - limit approval to the colorglyph contract
                                    - limit method to "colors_mine" and "glyph_mint"
                                    - ensure there's at least one Ed25519 signer in the `arg_auth_contexts`
                                */
                            }
                            _ => {}
                        }
                    }

                    'signer: for signer in arg_signers.iter() {
                        match signer {
                            Signer::Ed25519(signer_public_key) => {
                                for signature in root_signatures.iter() {
                                    match signature {
                                        Signature::Ed25519(signature) => {
                                            let Ed25519Signature {
                                                public_key: signature_public_key,
                                                signature,
                                            } = signature;

                                            if signer_public_key == signature_public_key {
                                                env.crypto().ed25519_verify(
                                                    &signer_public_key.0,
                                                    &root_signature_payload.clone().into(),
                                                    &signature,
                                                );
                                                break 'signer;
                                            }
                                        }
                                        _ => panic_with_error!(&env, Error::NotPermitted),
                                    }
                                }
                            }
                            _ => panic_with_error!(&env, Error::NotPermitted),
                        }

                        panic_with_error!(&env, Error::NotFound)
                    }
                }
                _ => {}
            }
        }

        Ok(())
    }
}
