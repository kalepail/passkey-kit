//! Test fixture used by the smart wallet test suite. Not deployed.
//!
//! `deploy` exercises the wallet authorizing a `CreateContract*` context;
//! `call` exercises a root invocation fanning out into multiple `transfer`
//! sub-invocations under a single wallet authorization.

#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn deploy(env: Env, source: Address, wasm_hash: BytesN<32>) {
        env.deployer()
            .with_address(source, wasm_hash.clone())
            .deploy_v2(wasm_hash, ());
    }

    pub fn call(env: Env, sac: Address, from: Address, to: Address, amount: i128) {
        from.require_auth();
        token::Client::new(&env, &sac).transfer(&from, &to, &amount);
        token::Client::new(&env, &sac).transfer(&from, &to, &1_000_000);
    }
}
