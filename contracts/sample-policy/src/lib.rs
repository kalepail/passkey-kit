// #![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface}, contract, contracterror, contractimpl, crypto::Hash, panic_with_error, xdr::ScVal, Bytes, Env, FromVal, Vec
};
use webauthn_wallet::types::Signature;

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotPermitted = 1,
}

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = ScVal;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: ScVal,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        // println!("{:?}", signature_payload.to_array()); // Not signing anything so no need to use this
        // println!("{:?}", signature); // ScVal::Void

        for context in auth_contexts.iter() {
            match context {
                Context::Contract(ContractContext { contract: root_contract, fn_name: __check_auth, args: root_args }) => {
                    let arg_signature_payload = Bytes::from_val(&env, &root_args.get_unchecked(0));
                    let arg_signatures: Vec<Signature> = Vec::from_val(&env, &root_args.get_unchecked(1));
                    let arg_auth_contexts: Vec<Context> = Vec::from_val(&env, &root_args.get_unchecked(2));

                    println!("{:?}", arg_signature_payload);

                    for signature in arg_signatures.iter() {
                        println!("{:?}", signature);
                    }

                    for context in arg_auth_contexts.iter() {
                        match context {
                            Context::Contract(ContractContext { contract: sub_contract, fn_name, args: sub_args }) => {
                                if sub_contract == root_contract { // This policy cannot authorize anything on the smart wallet (makes it safe for the policy to be an admin key)
                                    panic_with_error!(&env, Error::NotPermitted)
                                }

                                println!("{:?}", sub_contract); // the example contract
                                println!("{:?}", fn_name); // "call"
                                println!("{:?}", sub_args); // any arguments passed to the example contract function

                                /* For the colorglyph use case we would want to
                                    - limit approval to the colorglyph contract
                                    - limit method to "colors_mine" and "glyph_mint"
                                    - ensure there's at least one Ed25519 signer in the `arg_auth_contexts`
                                */
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
        }

        Ok(())
    }
}
