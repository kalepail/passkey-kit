#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn deploy(env: Env, source: Address, wasm_hash: BytesN<32>) {
        env.deployer()
            .with_address(source, wasm_hash.clone())
            .deploy(wasm_hash);
    }
    pub fn call(
        env: Env,
        sac: Address,
        from: Address,
        to: Address,
        amount: i128,
        // signer_key: SignerKey,
        // signer: Signer,
    ) {
        from.require_auth();
        token::Client::new(&env, &sac).transfer(&from, &to, &amount);
        token::Client::new(&env, &sac).transfer(&from, &to, &10_000_00);
        // webauthn_wallet::ContractClient::new(&env, &from).remove(&signer_key);
        // webauthn_wallet::ContractClient::new(&env, &from).add(&signer);
    }
}
