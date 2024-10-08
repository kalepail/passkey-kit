#![no_std]

use soroban_sdk::{auth::Context, contractclient, Address, BytesN, Env, Vec};
use types::{Signer, SignerKey};

pub mod types;

#[contractclient(name = "WebAuthnClient")]
pub trait WebAuthnInterface {
    fn add_signer(env: Env, signer: Signer);
    fn update_signer(env: Env, signer: Signer);
    fn remove_signer(env: Env, signer_key: SignerKey);
    fn update_contract_code(env: Env, hash: BytesN<32>);
}

#[contractclient(name = "PolicyClient")]
pub trait PolicyInterface {
    fn policy__(env: Env, source: Address, contexts: Vec<Context>);
}
