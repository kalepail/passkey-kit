#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short, Address, Bytes, BytesN, Env, Symbol, Vec,
};

/* TODO
    - Should we store user friendly names anywhere here?
        It's a little oof as it increases size and there's nothing stopping a user from changing the name outside the contract thereby causing confusion
        If we track the key ids vs hashes of key ids we could always have a client lookup key info client side
        @No
    - Add the ability to add additional super signers. Currently too much rides on one single key
*/

mod base64_url;

mod test;

#[contract]
pub struct Contract;

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Error {
    NotInitialized = 1,
    NotFound = 2,
    NotPermitted = 3,
    AlreadyInitialized = 4,
    JsonParseError = 5,
    InvalidContext = 6,
    ClientDataJsonChallengeIncorrect = 7,
    Secp256r1PublicKeyParse = 8,
    Secp256r1SignatureParse = 9,
    Secp256r1VerifyFailed = 10,
}

const DAY_OF_LEDGERS: u32 = 60 * 60 * 24 / 5;
const WEEK_OF_LEDGERS: u32 = DAY_OF_LEDGERS * 7;
const FACTORY: Symbol = symbol_short!("factory");
const SUPER: Symbol = symbol_short!("super");

#[contractimpl]
impl Contract {
    pub fn extend_ttl(env: &Env, threshold: u32, extend_to: u32) {
        let contract_address = env.current_contract_address();

        env.storage().instance().extend_ttl(threshold, extend_to);
        env.deployer()
            .extend_ttl(contract_address.clone(), threshold, extend_to);
        env.deployer()
            .extend_ttl_for_code(contract_address.clone(), threshold, extend_to);
        env.deployer().extend_ttl_for_contract_instance(
            contract_address.clone(),
            threshold,
            extend_to,
        );
    }
    pub fn init(env: Env, id: Bytes, pk: BytesN<65>, factory: Address) -> Result<(), Error> {
        if env.storage().instance().has(&SUPER) {
            return Err(Error::AlreadyInitialized);
        }

        let max_ttl = env.storage().max_ttl();

        env.storage().persistent().set(&id, &pk);
        env.storage()
            .persistent()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.storage().instance().set(&SUPER, &id);
        env.storage().instance().set(&FACTORY, &factory);

        Self::extend_ttl(&env, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events().publish(
            (factory, symbol_short!("add_sig"), id, symbol_short!("init")),
            pk,
        );

        Ok(())
    }
    pub fn upgrade(env: Env, hash: BytesN<32>) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        /* TODO
            - Currently we're not updating the FACTORY hash to point to a new factory. Should we?
                It would break all the reverse lookups and I'm not sure what the benefit would be
                @No?
        */

        env.deployer().update_current_contract_wasm(hash);

        let max_ttl = env.storage().max_ttl();
        Self::extend_ttl(&env, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
    pub fn add_sig(env: Env, id: Bytes, pk: BytesN<65>) -> Result<(), Error> {
        if !env.storage().instance().has(&SUPER) {
            return Err(Error::NotInitialized);
        }

        /* TODO
            - With storage simplified via events now may be the right time to revisit using temporary entries
                Given we store the pk in the event we should be able to reuse the same keys via sign in vs always needing to sign up with new keys after an expiration
                Just ensure we're properly toggling temporary vs persistent in the case of the super key, which should never be temporary
        */

        env.current_contract_address().require_auth();

        let max_ttl = env.storage().max_ttl();

        env.storage().persistent().set(&id, &pk);
        env.storage()
            .persistent()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        let factory = env
            .storage()
            .instance()
            .get::<Symbol, Address>(&FACTORY)
            .ok_or(Error::NotInitialized)?;

        env.events()
            .publish((factory, symbol_short!("add_sig"), id), pk);

        Self::extend_ttl(&env, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
    pub fn rm_sig(env: Env, id: Bytes) -> Result<(), Error> {
        // Don't delete the super signer
        if env
            .storage()
            .instance()
            .get::<Symbol, Bytes>(&SUPER)
            .ok_or(Error::NotInitialized)?
            == id
        {
            return Err(Error::NotPermitted);
        }

        env.current_contract_address().require_auth();

        if env.storage().persistent().has(&id) {
            env.storage().persistent().remove(&id);
        } else {
            return Err(Error::NotFound);
        }

        let factory = env
            .storage()
            .instance()
            .get::<Symbol, Address>(&FACTORY)
            .ok_or(Error::NotInitialized)?;

        env.events()
            .publish((factory, symbol_short!("rm_sig"), id), ());

        let max_ttl = env.storage().max_ttl();
        Self::extend_ttl(&env, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
    pub fn re_super(env: Env, id: Bytes) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        // Ensure the new proposed super signer exists
        if env.storage().persistent().has(&id) {
            let max_ttl = env.storage().max_ttl();

            env.storage().instance().set(&SUPER, &id);
            env.storage()
                .persistent()
                .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
        } else {
            return Err(Error::NotFound);
        }

        let max_ttl = env.storage().max_ttl();
        Self::extend_ttl(&env, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}

#[contracttype]
pub struct Signature {
    pub id: Bytes,
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub signature: BytesN<64>,
}

#[derive(serde::Deserialize)]
struct ClientDataJson<'a> {
    challenge: &'a str,
}

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
        // Only the super signer can `add_sig`, `rm_sig`, `re_super` and `upgrade`
        for context in auth_contexts.iter() {
            match context {
                Context::Contract(c) => {
                    if c.contract == env.current_contract_address()
                        && (c.fn_name == symbol_short!("upgrade")
                            || c.fn_name == symbol_short!("add_sig")
                            || c.fn_name == symbol_short!("rm_sig")
                            || c.fn_name == symbol_short!("re_super"))
                    {
                        if env
                            .storage()
                            .instance()
                            .get::<Symbol, Bytes>(&SUPER)
                            .ok_or(Error::NotFound)?
                            != signature.id
                        {
                            return Err(Error::NotPermitted);
                        }
                    }
                }
                _ => {} // Don't block for example the deploying of new contracts from this contract
            };
        }

        // Verify that the public key produced the signature.
        let pk = env
            .storage()
            .persistent()
            .get(&signature.id)
            .ok_or(Error::NotFound)?;

        let mut payload = Bytes::new(&env);

        payload.append(&signature.authenticator_data);
        payload.extend_from_array(&env.crypto().sha256(&signature.client_data_json).to_array());
        let payload = env.crypto().sha256(&payload);

        env.crypto()
            .secp256r1_verify(&pk, &payload, &signature.signature);

        // Parse the client data JSON, extracting the base64 url encoded
        // challenge.
        let client_data_json = signature.client_data_json.to_buffer::<1024>();
        let client_data_json = client_data_json.as_slice();
        let (client_data, _): (ClientDataJson, _) =
            serde_json_core::de::from_slice(client_data_json).map_err(|_| Error::JsonParseError)?;

        // Build what the base64 url challenge is expected.
        let mut expected_challenge = *b"___________________________________________";
        base64_url::encode(&mut expected_challenge, &signature_payload.to_array());

        // Check that the challenge inside the client data JSON that was signed
        // is identical to the expected challenge.
        if client_data.challenge.as_bytes() != expected_challenge {
            return Err(Error::ClientDataJsonChallengeIncorrect);
        }

        let max_ttl = env.storage().max_ttl();
        env.storage()
            .persistent()
            .extend_ttl(&signature.id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Self::extend_ttl(&env, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}
