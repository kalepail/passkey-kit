#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short, Bytes, BytesN, Env, Symbol, Vec,
};

mod base64_url;

mod test;

#[contract]
pub struct Contract;

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Error {
    NotFound = 1,
    NotPermitted = 2,
    AlreadyInitialized = 3,
    ClientDataJsonChallengeIncorrect = 4,
    Secp256r1PublicKeyParse = 5,
    Secp256r1SignatureParse = 6,
    Secp256r1VerifyFailed = 7,
    JsonParseError = 8,
}

const DAY_OF_LEDGERS: u32 = 60 * 60 * 24 / 5;
const WEEK_OF_LEDGERS: u32 = DAY_OF_LEDGERS * 7;
const EVENT_TAG: Symbol = symbol_short!("sw_v1");

#[contractimpl]
impl Contract {
    pub fn init(env: Env, id: Bytes, pk: BytesN<65>) -> Result<(), Error> {
        /* NOTE
            - You can't call `add` without some admin key so there has to be a method to add the first admin key
                however once that has been called it must not be able to be called again
                currently just storing the EVENT_TAG on the instance to mark that the wallet has been initialized
                if some day we get something better we can use that
        */

        if env.storage().instance().has(&EVENT_TAG) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&EVENT_TAG, &());

        env.storage().persistent().set(&id, &pk);

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .persistent()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events().publish(
            (EVENT_TAG, symbol_short!("add"), id, symbol_short!("init")),
            (pk, true),
        );

        Ok(())
    }
    pub fn add(env: Env, id: Bytes, pk: BytesN<65>, admin: bool) -> Result<(), Error> {
        /* NOTE
            - We're not doing any existence checks so it's possible to overwrite a key or "dupe" a key (which could cause issues for indexers if they aren't handling dupe events)
        */

        env.current_contract_address().require_auth();

        let max_ttl = env.storage().max_ttl();

        if admin {
            if env.storage().temporary().has(&id) {
                env.storage().temporary().remove(&id);
            }

            env.storage().persistent().set(&id, &pk);

            env.storage()
                .persistent()
                .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
        } else {
            if env.storage().persistent().has(&id) {
                env.storage().persistent().remove(&id);
            }

            env.storage().temporary().set(&id, &pk);

            env.storage()
                .temporary()
                .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
        }

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("add"), id), (pk, admin));

        Ok(())
    }
    pub fn remove(env: Env, id: Bytes) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        if env.storage().temporary().has(&id) {
            env.storage().temporary().remove(&id);
        }

        if env.storage().persistent().has(&id) {
            env.storage().persistent().remove(&id);
        }

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("remove"), id), ());

        Ok(())
    }
    pub fn upgrade(env: Env, hash: BytesN<32>) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        env.deployer().update_current_contract_wasm(hash);

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

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

// TODO do we need this? I don't understand it
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
        let Signature {
            id,
            mut authenticator_data,
            client_data_json,
            signature,
        } = signature;

        let admin;
        let max_ttl = env.storage().max_ttl();

        let pk = match env.storage().temporary().get(&id) {
            Some(pk) => {
                admin = false;

                env.storage()
                    .temporary()
                    .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

                pk
            }
            None => {
                admin = true;

                env.storage()
                    .persistent()
                    .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

                env.storage().persistent().get(&id).ok_or(Error::NotFound)?
            }
        };

        // Only admin signers can `upgrade`, `add` and `remove`
        for context in auth_contexts.iter() {
            match context {
                Context::Contract(c) => {
                    if c.contract == env.current_contract_address() // calling the smart wallet
                        && (c.fn_name == symbol_short!("upgrade") // calling a protected function
                            || c.fn_name == symbol_short!("add")
                            || c.fn_name == symbol_short!("remove"))
                        && !admin
                    // signature key is not an admin key
                    {
                        return Err(Error::NotPermitted);
                    }
                }
                _ => {} // Don't block for example the deploying of new contracts from this contract
            };
        }

        let client_data_json_hash = env.crypto().sha256(&client_data_json).to_array();

        authenticator_data.extend_from_array(&client_data_json_hash);

        let digest = env.crypto().sha256(&authenticator_data);

        env.crypto().secp256r1_verify(&pk, &digest, &signature);

        // Parse the client data JSON, extracting the base64 url encoded challenge.
        let client_data_json = client_data_json.to_buffer::<1024>(); // <- TODO why 1024?
        let client_data_json = client_data_json.as_slice();
        let (client_data, _): (ClientDataJson, _) =
            serde_json_core::de::from_slice(client_data_json).map_err(|_| Error::JsonParseError)?;

        // Build what the base64 url challenge is expecting.
        let mut expected_challenge = [0u8; 43];

        base64_url::encode(&mut expected_challenge, &signature_payload.to_array());

        // Check that the challenge inside the client data JSON that was signed is identical to the expected challenge.
        if client_data.challenge.as_bytes() != expected_challenge {
            return Err(Error::ClientDataJsonChallengeIncorrect);
        }

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}
