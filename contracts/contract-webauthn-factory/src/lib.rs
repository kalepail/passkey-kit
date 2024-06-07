#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short, vec, Address, Bytes, BytesN, Env, Symbol,
};

#[contract]
pub struct Contract;

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Error {
    NotInited = 1,
    NotFound = 2,
    NotPermitted = 3,
    AlreadyInited = 4,
    AlreadyMapped = 5,
}

const STORAGE_KEY_WASM_HASH: Symbol = symbol_short!("hash");

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
            return Err(Error::AlreadyInited);
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
            .ok_or(Error::NotInited)?;

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

        Self::__add_sig(&env, &id, &address)?;

        Self::extend_ttl(&env);

        Ok(address)
    }

    pub fn add_sig(env: Env, id: Bytes, contract: Address) -> Result<(), Error> {
        contract.require_auth();

        let _ = Self::__add_sig(&env, &id, &contract);

        Self::extend_ttl(&env);

        Ok(())
    }

    pub fn rm_sig(env: Env, id: Bytes, contract: Address) -> Result<(), Error> {
        contract.require_auth();

        // Ensure the contract is permitted to remove the id mapping
        if env
            .storage()
            .persistent()
            .get::<Bytes, Address>(&id)
            .ok_or(Error::NotFound)?
            != contract
        {
            return Err(Error::NotPermitted);
        }

        env.storage().persistent().remove(&id);

        Self::extend_ttl(&env);

        Ok(())
    }

    // This function allows reverse lookups. So given any passkey id you can find it's related contract address
    // Especially useful after a resudo function call where you cannot rely on the initial passkey's id to derive the initial smart wallet's contract address
    fn __add_sig(env: &Env, id: &Bytes, contract: &Address) -> Result<(), Error> {
        /* NOTE
            This requires that each passkey can only be added to one smart wallet
            Could switch to a Vec to allow multiple contract mappings from the same passkey
            Some sort of protection here is important though otherwise nefarious folks could add contracts to passkeys that aren't actually connected
                Maybe this isn't dangerous, just dumb
        */
        /* TODO
            - Ideally this method could only be called by the `deploy` method and contracts deployed by this deployer, not any random external Address
                Likely too much work for little to no real benefit, just ensure the require_auth is actually appropriately protecting the additions and removals
                @No
        */

        if env.storage().persistent().has(id) {
            return Err(Error::AlreadyMapped);
        }

        let max_ttl = env.storage().max_ttl();

        env.storage().persistent().set(id, contract);
        env.storage().persistent().extend_ttl(id, max_ttl, max_ttl);

        Ok(())
    }
}
