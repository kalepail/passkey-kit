// #![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    Env, Vec,
};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum Error {}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Signature(pub u32); // temp, not sure what to put here tbh

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Signature;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signature: Signature,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        for context in auth_contexts.iter() {
            match context {
                Context::Contract(context) => {
                    println!("{:?}", context.contract);
                    println!("{:?}", context.fn_name);
                }
                _ => {}
            }
        }

        Ok(())
    }
}
