#![no_std]

use soroban_sdk::{auth::Context, contractclient, Address, BytesN, Env, Vec};
use types::{Error, Signer, SignerKey};

pub mod types;

#[contractclient(name = "WebAuthnClient")]
pub trait WebAuthnInterface {
    fn add(env: Env, signer: Signer) -> Result<(), Error>;
    fn remove(env: Env, signer_key: SignerKey) -> Result<(), Error>;
    fn update(env: Env, hash: BytesN<32>) -> Result<(), Error>;
}

#[contractclient(name = "PolicyClient")]
pub trait PolicyInterface {
    fn policy__(env: Env, source: Address, contexts: Vec<Context>);
}
