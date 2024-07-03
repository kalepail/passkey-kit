#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, vec, Address, Bytes, BytesN, Env, Symbol,
};

#[contract]
pub struct Contract;

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Error {
    NotInitialized = 1,
    AlreadyInitialized = 2,
}

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
    pub fn extend_ttl(env: &Env) {
        let max_ttl = env.storage().max_ttl();
        let contract_address = env.current_contract_address();

        env.storage().instance().extend_ttl(max_ttl, max_ttl);
        env.deployer()
            .extend_ttl(contract_address.clone(), max_ttl, max_ttl);
        env.deployer()
            .extend_ttl_for_code(contract_address.clone(), max_ttl, max_ttl);
        env.deployer()
            .extend_ttl_for_contract_instance(contract_address.clone(), max_ttl, max_ttl);
    }

    pub fn init(env: Env, wasm_hash: BytesN<32>) -> Result<(), Error> {
        if env.storage().instance().has(&STORAGE_KEY_WASM_HASH) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage()
            .instance()
            .set(&STORAGE_KEY_WASM_HASH, &wasm_hash);

        Self::extend_ttl(&env);

        Ok(())
    }

    pub fn deploy(env: Env, id: Bytes, pk: BytesN<65>) -> Result<Address, Error> {
        let wasm_hash = env
            .storage()
            .instance()
            .get::<Symbol, BytesN<32>>(&STORAGE_KEY_WASM_HASH)
            .ok_or(Error::NotInitialized)?;

        let address = env
            .deployer()
            .with_current_contract(env.crypto().sha256(&id))
            .deploy(wasm_hash);
        let () = env.invoke_contract(
            &address,
            &symbol_short!("init"),
            vec![
                &env,
                id.to_val(),
                pk.to_val(),
                env.current_contract_address().to_val(),
            ],
        );

        Self::extend_ttl(&env);

        Ok(address)
    }
}
