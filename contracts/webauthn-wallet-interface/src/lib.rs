#![no_std]

use soroban_sdk::{contractclient, contracterror, Bytes, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
// #[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Error {
    NotFound = 1,
    NotPermitted = 2,
    ClientDataJsonChallengeIncorrect = 3,
    Secp256r1PublicKeyParse = 4,
    Secp256r1SignatureParse = 5,
    Secp256r1VerifyFailed = 6,
    JsonParseError = 7,
}

#[contractclient(name = "WebAuthnWallet")]
pub trait WebAuthnWalletInterface {
    fn add(env: Env, id: Bytes, pk: BytesN<65>, admin: bool) -> Result<(), Error>;
    fn remove(env: Env, id: Bytes) -> Result<(), Error>;
    fn update(env: Env, hash: BytesN<32>) -> Result<(), Error>;
}