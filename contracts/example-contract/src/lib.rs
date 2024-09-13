#![no_std]

use soroban_sdk::{contract, contractimpl, token, Address, Env};
use webauthn_wallet::types::{Signer, SignerKey};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn call(
        env: Env,
        sac: Address,
        from: Address,
        to: Address,
        amount: i128,
        signer_key: SignerKey,
        // signer: Signer,
    ) {
        from.require_auth();
        token::Client::new(&env, &sac).transfer(&from, &to, &amount);
        webauthn_wallet::ContractClient::new(&env, &from).remove(&signer_key);
        // webauthn_wallet::ContractClient::new(&env, &from).add(&signer);
    }
}
