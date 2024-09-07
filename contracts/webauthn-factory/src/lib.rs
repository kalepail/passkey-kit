#![no_std]

mod wallet {
    use soroban_sdk::auth::Context;
    soroban_sdk::contractimport!(file = "../out/webauthn_wallet.wasm");
}

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, BytesN, Env,
    Symbol,
};

#[contract]
pub struct Contract;

#[contracterror]
#[derive(Copy, Clone, Debug)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
}

// NOTE It seems dumb we have to dupe this stuff just to use the `wallet::KeyId` type as a function arg, but it wasn't working without this
// https://discord.com/channels/897514728459468821/1281696488199553025
////
#[contracttype]
#[derive(Clone, PartialEq)]
pub struct Ed25519PublicKey(pub BytesN<32>);

#[contracttype]
#[derive(Clone, PartialEq)]
pub struct Secp256r1Id(pub Bytes);

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum KeyId {
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id),
}
////

const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;
const STORAGE_KEY_WASM_HASH: Symbol = symbol_short!("hash");

/* NOTE
    - We don't have an upgrade function here because if we want to make a new wallet printer we should just deploy an entirely new one
        This ensures some safety so a factory can't sneaky update the wallets it's printing
        One downside is if a factory turns out to be printing bugged wallets there's no way to shut the printer down
*/

/* TODO
    - For the first NOTE reason above we should consider a self destruct method where a contract can break itself such that it cannot deploy any more wallets
        This is important in the case a bug is found in the underlying smart wallet contract code
        Could be a simple instance variable or maybe an upgrade to a wasm that's entirely empty and thus always fails
        @Later
*/

#[contractimpl]
impl Contract {
    pub fn init(env: Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
        if env.storage().instance().has(&STORAGE_KEY_WASM_HASH) {
            return Err(Error::AlreadyInitialized);
        }

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .set(&STORAGE_KEY_WASM_HASH, &wasm_hash);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }

    pub fn deploy(
        env: Env,
        salt: BytesN<32>,
        id: wallet::KeyId,
        pk: Option<BytesN<65>>,
    ) -> Result<Address, Error> {
        let wasm_hash = env
            .storage()
            .instance()
            .get::<Symbol, BytesN<32>>(&STORAGE_KEY_WASM_HASH)
            .ok_or(Error::NotInitialized)?;

        let address = env.deployer().with_current_contract(salt).deploy(wasm_hash);

        wallet::Client::new(&env, &address).add(&id, &pk, &true);

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(address)
    }
}
