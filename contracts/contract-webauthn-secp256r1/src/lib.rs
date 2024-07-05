#![no_std]

use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contracterror, contractimpl, contracttype,
    crypto::Hash,
    symbol_short, Bytes, BytesN, Env, Symbol, Vec,
};

/* TODO
    - Add the ability to add additional super signers. Currently too much rides on one single key
        @Maybe
    - Alternatively or perhaps additionally add the ability to add recovery signers as ed25519 signers or even single use hash signers, etc. 
        @Maybe
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
const EVENT_TAG: Symbol = symbol_short!("sw_v1");
const SUPER: Symbol = symbol_short!("super");

#[contractimpl]
impl Contract {
    pub fn init(env: Env, id: Bytes, pk: BytesN<65>) -> Result<(), Error> {
        if env.storage().instance().has(&SUPER) {
            return Err(Error::AlreadyInitialized);
        }

        let max_ttl = env.storage().max_ttl();

        env.storage().persistent().set(&id, &pk);

        env.storage().instance().set(&SUPER, &id);

        env.storage()
            .persistent()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events().publish(
            (
                EVENT_TAG,
                symbol_short!("add_sig"),
                id,
                symbol_short!("init"),
            ),
            pk,
        );

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
    pub fn add_sig(env: Env, id: Bytes, pk: BytesN<65>) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        let max_ttl = env.storage().max_ttl();

        // NOTE we're not doing any existence checks so it's possible to overwrite a key or "dupe" a key (which could cause issues for indexers if they aren't handling dupe events)

        env.storage().temporary().set(&id, &pk);

        env.storage()
            .temporary()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("add_sig"), id), pk);

        Ok(())
    }
    pub fn rm_sig(env: Env, id: Bytes) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        // NOTE we cannot remove super signers so no need to care about that scenario here

        env.storage().temporary().remove(&id);

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("rm_sig"), id), ());

        Ok(())
    }
    pub fn re_super(env: Env, id: Bytes) -> Result<(), Error> {
        let super_id = env
            .storage()
            .instance()
            .get::<Symbol, Bytes>(&SUPER)
            .ok_or(Error::NotInitialized)?;

        let super_pk = env
            .storage()
            .persistent()
            .get::<Bytes, BytesN<65>>(&super_id)
            .ok_or(Error::NotFound)?;

        let pk = env
            .storage()
            .temporary()
            .get::<Bytes, BytesN<65>>(&id)
            .ok_or(Error::NotFound)?;

        env.current_contract_address().require_auth();

        // Move old super signer to temporary storage
        env.storage().temporary().set(&super_id, &super_pk);

        // Move new super signer to persistent storage
        env.storage().persistent().set(&id, &pk);

        // Update the super signer pointer
        env.storage().instance().set(&SUPER, &id);

        // NOTE no need to remove entries as the protocol won't attempt to access keys of the "wrong" storage type

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .temporary()
            .extend_ttl(&super_id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.storage()
            .persistent()
            .extend_ttl(&id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

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
        let super_id = env
            .storage()
            .instance()
            .get::<Symbol, Bytes>(&SUPER)
            .ok_or(Error::NotInitialized)?;

        // Only the super signer can `add_sig`, `rm_sig`, `re_super` and `upgrade`
        for context in auth_contexts.iter() {
            match context {
                Context::Contract(c) => {
                    if c.contract == env.current_contract_address() // calling the smart wallet
                        && (c.fn_name == symbol_short!("upgrade") // calling a protected function
                            || c.fn_name == symbol_short!("add_sig")
                            || c.fn_name == symbol_short!("rm_sig")
                            || c.fn_name == symbol_short!("re_super"))
                        && signature.id != super_id
                    // signature key is not the SUPER key
                    {
                        return Err(Error::NotPermitted);
                    }
                }
                _ => {} // Don't block for example the deploying of new contracts from this contract
            };
        }

        let max_ttl = env.storage().max_ttl();

        // Verify that the public key produced the signature.
        let pk = if signature.id == super_id {
            // if super signer lookup in persistent storage
            env.storage().persistent().extend_ttl(
                &signature.id,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );

            env.storage()
                .persistent()
                .get(&signature.id)
                .ok_or(Error::NotFound)?
        } else {
            // else lookup in temporary storage
            env.storage()
                .temporary()
                .extend_ttl(&signature.id, max_ttl - WEEK_OF_LEDGERS, max_ttl);

            env.storage()
                .temporary()
                .get(&signature.id)
                .ok_or(Error::NotFound)?
        };

        let mut payload = Bytes::new(&env);

        payload.append(&signature.authenticator_data);
        payload.extend_from_array(&env.crypto().sha256(&signature.client_data_json).to_array());

        env.crypto()
            .secp256r1_verify(&pk, &env.crypto().sha256(&payload), &signature.signature);

        // Parse the client data JSON, extracting the base64 url encoded challenge.
        let client_data_json = signature.client_data_json.to_buffer::<1024>(); // <- why 1024?
        let client_data_json = client_data_json.as_slice();
        let (client_data, _): (ClientDataJson, _) =
            serde_json_core::de::from_slice(client_data_json).map_err(|_| Error::JsonParseError)?;

        // Build what the base64 url challenge is expecting.
        let mut expected_challenge = [0u8; 43]; // <- why 43?

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
