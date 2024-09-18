#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface}, contract, contractimpl, crypto::Hash, panic_with_error, symbol_short, vec, Bytes, BytesN, Env, FromVal, IntoVal, Map, Symbol, Vec
};
use types::{Error, Secp256r1Signature, Signature, Signer, SignerKey, SignerLimits, SignerStorage, SignerVal};

mod base64_url;
pub mod types;

mod test;

#[contract]
pub struct Contract;

const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;
const EVENT_TAG: Symbol = symbol_short!("sw_v1");
const SIGNER_COUNT: Symbol = symbol_short!("signers");

#[contractimpl]
impl Contract {
    pub fn add(env: Env, signer: Signer) -> Result<(), Error> {
        if env.storage().instance().has(&SIGNER_COUNT) {
            env.current_contract_address().require_auth();
        }

        let max_ttl = env.storage().max_ttl();

        let (signer_key, signer_val, signer_storage) = match signer {
            Signer::Policy(policy, signer_limits, signer_storage) => (
                SignerKey::Policy(policy),
                SignerVal::Policy(signer_limits),
                signer_storage,
            ),
            Signer::Ed25519(public_key, signer_limits, signer_storage) => (
                SignerKey::Ed25519(public_key),
                SignerVal::Ed25519(signer_limits),
                signer_storage,
            ),
            Signer::Secp256r1(id, public_key, signer_limits, signer_storage) => (
                SignerKey::Secp256r1(id),
                SignerVal::Secp256r1(public_key, signer_limits),
                signer_storage,
            ),
        };

        store_signer(&env, &signer_key, &signer_val, &signer_storage);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("add"), signer_key), signer_val);

        Ok(())
    }
    pub fn remove(env: Env, signer_key: SignerKey) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        if let Some((_, signer_storage)) = get_signer_val_storage(&env, &signer_key, false) {
            update_signer_count(&env, false);

            match signer_storage {
                SignerStorage::Persistent => {
                    env.storage().persistent().remove::<SignerKey>(&signer_key);
                }
                SignerStorage::Temporary => {
                    env.storage().temporary().remove::<SignerKey>(&signer_key);
                }
            }
        }

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("remove"), signer_key), ());

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
}

fn store_signer(
    env: &Env,
    signer_key: &SignerKey,
    signer_val: &SignerVal,
    signer_storage: &SignerStorage,
) {
    let max_ttl = env.storage().max_ttl();

    // Include this before the `.set` calls so it doesn't read them as previous values
    let previous_signer_val_and_storage: Option<(SignerVal, SignerStorage)> =
        get_signer_val_storage(env, signer_key, false);

    // Add and extend the signer key in the appropriate storage
    let is_persistent = match signer_storage {
        SignerStorage::Persistent => {
            env.storage()
                .persistent()
                .set::<SignerKey, SignerVal>(signer_key, signer_val);
            env.storage().persistent().extend_ttl::<SignerKey>(
                signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );

            true
        }
        SignerStorage::Temporary => {
            env.storage()
                .temporary()
                .set::<SignerKey, SignerVal>(signer_key, signer_val);
            env.storage().temporary().extend_ttl::<SignerKey>(
                signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );

            false
        }
    };

    if let Some((_, previous_signer_storage)) = previous_signer_val_and_storage {
        // Remove signer key in the opposing storage if it exists
        match previous_signer_storage {
            SignerStorage::Persistent => {
                if !is_persistent {
                    env.storage().persistent().remove::<SignerKey>(signer_key);
                }
            }
            SignerStorage::Temporary => {
                if is_persistent {
                    env.storage().temporary().remove::<SignerKey>(signer_key);
                }
            }
        }
    } else {
        // only need to update the signer count here if we're actually adding vs replacing a signer
        update_signer_count(&env, true);
    }
}

fn update_signer_count(env: &Env, add: bool) {
    let count = env
        .storage()
        .instance()
        .get::<Symbol, i32>(&SIGNER_COUNT)
        .unwrap_or(0)
        + if add { 1 } else { -1 };

    env.storage()
        .instance()
        .set::<Symbol, i32>(&SIGNER_COUNT, &count);
}

#[derive(serde::Deserialize)]
struct ClientDataJson<'a> {
    challenge: &'a str,
}

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Map<SignerKey, Option<Signature>>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Map<SignerKey, Option<Signature>>,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        for (signer_key, signature) in signatures.iter() {
            match get_signer_val_storage(&env, &signer_key, true) {
                None => panic_with_error!(env, Error::NotFound),
                Some((signer_val, _)) => {
                    match signature {
                        None => {
                            if let SignerKey::Policy(policy) = &signer_key {
                                if let SignerVal::Policy(signer_limits) = signer_val {
                                    if signature.is_none() {
                                        // NOTE require_auth not called here because we need the appropriate context in order to call this function
                                        verify_contexts(&env, &auth_contexts, &signatures, &signer_key, &signer_limits);
                                        continue;
                                    }
                                }
                            }

                            panic_with_error!(&env, Error::SignatureKeyValueMismatch)
                        }
                        Some(signature) => {
                            match signature {
                                Signature::Ed25519(signature) => {
                                    if let SignerKey::Ed25519(public_key) = &signer_key {
                                        if let SignerVal::Ed25519(signer_limits) = signer_val { 
                                            env.crypto().ed25519_verify(
                                                &public_key,
                                                &signature_payload.clone().into(),
                                                &signature,
                                            );
                                            verify_contexts(&env, &auth_contexts, &signatures, &signer_key, &signer_limits);
                                            continue;
                                        }
                                    }

                                    panic_with_error!(&env, Error::SignatureKeyValueMismatch)
                                }
                                Signature::Secp256r1(Secp256r1Signature {
                                    mut authenticator_data,
                                    client_data_json,
                                    signature,
                                }) => {
                                    if let SignerKey::Secp256r1(id) = &signer_key {
                                        if let SignerVal::Secp256r1(public_key, signer_limits) = signer_val {
                                            verify_secp256r1_signature(
                                                &env,
                                                &public_key,
                                                &mut authenticator_data,
                                                &client_data_json,
                                                &signature,
                                                &signature_payload,
                                            );
                                            verify_contexts(&env, &auth_contexts, &signatures, &signer_key, &signer_limits);
                                            continue;
                                        }
                                    }

                                    panic_with_error!(&env, Error::SignatureKeyValueMismatch)
                                }
                            }
                        }
                    }
                }
            };
        }

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}

fn verify_contexts(
    env: &Env, 
    auth_contexts: &Vec<Context>, 
    signatures: &Map<SignerKey, Option<Signature>>, 
    signer_key: &SignerKey, 
    signer_limits: &SignerLimits
) {
    let authorized_context = 'check: loop {
        for context in auth_contexts.iter() {

            // If this signature has no limits then yes it's authorized
            if signer_limits.0.is_empty() {
                break 'check Some(context);
            }

            match &context {
                Context::Contract(ContractContext {
                    contract,
                    fn_name,
                    args,
                }) => {
                    match signer_limits.0.get(contract.clone()) {
                        None => continue, // signer limitations not met
                        Some(signer_limits_keys) => {
                            // If this signer has a smart wallet context limit, limit that context to only removing itself
                            if *contract == env.current_contract_address()
                                && *fn_name != symbol_short!("remove")
                                || (*fn_name == symbol_short!("remove")
                                    && SignerKey::from_val(
                                        env,
                                        &args.get_unchecked(0),
                                    ) != *signer_key)
                            {
                                continue; // self trying to do something other than remove itself
                            }

                            if verify_signer_limit_keys(
                                env,
                                signatures,
                                &signer_limits_keys,
                            ) {
                                break 'check Some(context);
                            } else {
                                continue;
                            }
                        }
                    }
                }
                Context::CreateContractHostFn(_) => {
                    match signer_limits.0.get(env.current_contract_address()) {
                        None => continue, // signer limitations not met
                        Some(signer_limits_keys) => {
                            if verify_signer_limit_keys(
                                env,
                                signatures,
                                &signer_limits_keys,
                            ) {
                                break 'check Some(context);
                            } else {
                                continue;
                            }
                        }
                    }
                }
            }
        }

        break 'check None;
    };

    match authorized_context {
        None => panic_with_error!(env, Error::NotAuthorized),
        Some(context) => {
            if let SignerKey::Policy(policy) = signer_key {
                policy.require_auth_for_args(vec![
                    env,
                    // Putting the authorized context in the args to allow the policy to validate
                    context.into_val(env),
                ]);
            }
        } 
    }
}

fn verify_signer_limit_keys(
    env: &Env,
    signatures: &Map<SignerKey, Option<Signature>>,
    signer_limits_keys: &Option<Vec<SignerKey>>,
) -> bool {
    match signer_limits_keys {
        None => return true, // no key limits
        Some(signer_limits_keys) => {
            for signer_limits_key in signer_limits_keys.iter() {
                if !signatures.contains_key(signer_limits_key) {
                    // if any required key is missing this signature is not authorized for this context
                    panic_with_error!(env, Error::NotAuthorized);
                }
            }

            return true; // all required keys are present
        }
    }
}

fn get_signer_val_storage(
    env: &Env,
    signer_key: &SignerKey,
    extend_ttl: bool,
) -> Option<(SignerVal, SignerStorage)> {
    let max_ttl = env.storage().max_ttl();

    match env
        .storage()
        .temporary()
        .get::<SignerKey, SignerVal>(signer_key)
    {
        Some(signer_val) => {
            if extend_ttl {
                env.storage().temporary().extend_ttl::<SignerKey>(
                    signer_key,
                    max_ttl - WEEK_OF_LEDGERS,
                    max_ttl,
                );
            }

            Some((signer_val, SignerStorage::Temporary))
        }
        None => {
            match env
                .storage()
                .persistent()
                .get::<SignerKey, SignerVal>(signer_key)
            {
                Some(signer_val) => {
                    if extend_ttl {
                        env.storage().persistent().extend_ttl::<SignerKey>(
                            signer_key,
                            max_ttl - WEEK_OF_LEDGERS,
                            max_ttl,
                        );
                    }

                    Some((signer_val, SignerStorage::Persistent))
                }
                None => None,
            }
        }
    }
}

fn verify_secp256r1_signature(
    env: &Env,
    public_key: &BytesN<65>,
    authenticator_data: &mut Bytes,
    client_data_json: &Bytes,
    signature: &BytesN<64>,
    signature_payload: &Hash<32>,
) {
    authenticator_data.extend_from_array(&env.crypto().sha256(&client_data_json).to_array());

    env.crypto().secp256r1_verify(
        &public_key,
        &env.crypto().sha256(&authenticator_data),
        &signature,
    );

    // Parse the client data JSON, extracting the base64 url encoded challenge.
    let client_data_json = client_data_json.to_buffer::<1024>(); // <- TODO why 1024?
    let client_data_json = client_data_json.as_slice();
    let (client_data_json, _): (ClientDataJson, _) =
        serde_json_core::de::from_slice(client_data_json)
            .unwrap_or_else(|_| panic_with_error!(env, Error::JsonParseError));

    // Build what the base64 url challenge is expecting.
    let mut expected_challenge = [0u8; 43];

    base64_url::encode(&mut expected_challenge, &signature_payload.to_array());

    // Check that the challenge inside the client data JSON that was signed is identical to the expected challenge.
    // TODO is this check actually necessary or is the secp256r1_verify sufficient?
    if client_data_json.challenge.as_bytes() != expected_challenge {
        panic_with_error!(env, Error::ClientDataJsonChallengeIncorrect)
    }
}
