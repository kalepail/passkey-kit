#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    panic_with_error, symbol_short, Bytes, BytesN, Env, FromVal, Symbol, Vec,
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
    ClientDataJsonChallengeIncorrect = 3,
    Secp256r1PublicKeyParse = 4,
    Secp256r1SignatureParse = 5,
    Secp256r1VerifyFailed = 6,
    JsonParseError = 7,
}

const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;
const EVENT_TAG: Symbol = symbol_short!("sw_v1");
const ADMIN_SIGNER_COUNT: Symbol = symbol_short!("admins");

#[contractimpl]
impl Contract {
    pub fn add(env: Env, id: Bytes, pk: BytesN<65>, mut admin: bool) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN_SIGNER_COUNT) {
            env.current_contract_address().require_auth();
        } else {
            admin = true; // Ensure if this is the first signer they are an admin
        }

        let max_ttl = env.storage().max_ttl();

        if admin {
            if env.storage().temporary().has(&id) {
                env.storage().temporary().remove(&id);
            }

            Self::update_admin_signer_count(&env, true);

            env.storage().persistent().set(&id, &pk);

            env.storage()
                .persistent()
                .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);
        } else {
            if env.storage().persistent().has(&id) {
                Self::update_admin_signer_count(&env, false);

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

        // TEMP until Zephyr fixes their event processing system to allow for bytesn arrays in the data field
        // env.events()
        //     .publish((EVENT_TAG, symbol_short!("add"), id), (pk, admin));
        env.events()
            .publish((EVENT_TAG, symbol_short!("add"), id, pk), admin);

        Ok(())
    }
    pub fn remove(env: Env, id: Bytes) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        if env.storage().temporary().has(&id) {
            env.storage().temporary().remove(&id);
        } else if env.storage().persistent().has(&id) {
            Self::update_admin_signer_count(&env, false);

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
    pub fn update(env: Env, hash: BytesN<32>) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        env.deployer().update_current_contract_wasm(hash);

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
    fn update_admin_signer_count(env: &Env, add: bool) {
        let count = env
            .storage()
            .instance()
            .get::<Symbol, i32>(&ADMIN_SIGNER_COUNT)
            .unwrap_or(0)
            + if add { 1 } else { -1 };

        if count <= 0 {
            panic_with_error!(env, Error::NotPermitted)
        }

        env.storage()
            .instance()
            .set::<Symbol, i32>(&ADMIN_SIGNER_COUNT, &count);
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

        let max_ttl = env.storage().max_ttl();

        let pk = match env.storage().temporary().get(&id) {
            Some(pk) => {
                // Error if a session signer is trying to perform protected actions
                for context in auth_contexts.iter() {
                    match context {
                        Context::Contract(c) => {
                            if c.contract == env.current_contract_address() // if we're calling self
                                && ( // and
                                    c.fn_name != symbol_short!("remove") // the method isn't the only potentially available self command
                                    || ( // we're not removing ourself
                                        c.fn_name == symbol_short!("remove") 
                                        && Bytes::from_val(&env, &c.args.get(0).unwrap()) != id
                                    )
                                )
                            {
                                return Err(Error::NotPermitted);
                            }
                        }
                        _ => {} // Don't block for example the deploying of new contracts from this contract
                    };
                }

                env.storage()
                    .temporary()
                    .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

                pk
            }
            None => {
                env.storage()
                    .persistent()
                    .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

                env.storage().persistent().get(&id).ok_or(Error::NotFound)?
            }
        };

        authenticator_data.extend_from_array(&env.crypto().sha256(&client_data_json).to_array());

        env.crypto()
            .secp256r1_verify(&pk, &env.crypto().sha256(&authenticator_data), &signature);

        // Parse the client data JSON, extracting the base64 url encoded challenge.
        let client_data_json = client_data_json.to_buffer::<1024>(); // <- TODO why 1024?
        let client_data_json = client_data_json.as_slice();
        let (client_data_json, _): (ClientDataJson, _) =
            serde_json_core::de::from_slice(client_data_json).map_err(|_| Error::JsonParseError)?;

        // Build what the base64 url challenge is expecting.
        let mut expected_challenge = [0u8; 43];

        base64_url::encode(&mut expected_challenge, &signature_payload.to_array());

        // Check that the challenge inside the client data JSON that was signed is identical to the expected challenge.
        // TODO is this check actually necessary or is the secp256r1_verify enough? I think it's necessary
        if client_data_json.challenge.as_bytes() != expected_challenge {
            return Err(Error::ClientDataJsonChallengeIncorrect);
        }

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}
