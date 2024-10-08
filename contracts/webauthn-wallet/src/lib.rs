#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    panic_with_error, symbol_short, vec, BytesN, Env, FromVal, Symbol, Vec,
};
use webauthn_wallet_interface::{
    types::{
        Error, Secp256r1Signature, Signature, Signatures, Signer, SignerKey, SignerLimits,
        SignerStorage, SignerVal,
    },
    PolicyClient, WebAuthnInterface,
};

mod base64_url;
mod types;

mod test;
mod test_extra;

#[contract]
pub struct Contract;

const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;
const EVENT_TAG: Symbol = symbol_short!("sw_v1");
const INITIALIZED: Symbol = symbol_short!("init");

#[contractimpl]
impl WebAuthnInterface for Contract {
    fn add_signer(env: Env, signer: Signer) {
        if env
            .storage()
            .instance()
            .get::<Symbol, bool>(&INITIALIZED)
            .unwrap_or(false)
        {
            env.current_contract_address().require_auth();
        } else {
            env.storage()
                .instance()
                .set::<Symbol, bool>(&INITIALIZED, &true);
        }

        let max_ttl = env.storage().max_ttl();

        let (signer_key, signer_val, signer_storage) = process_signer(signer);

        store_signer(&env, &signer_key, &signer_val, &signer_storage, false);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events().publish(
            (EVENT_TAG, symbol_short!("add"), signer_key),
            (signer_val, signer_storage),
        );
    }
    fn update_signer(env: Env, signer: Signer) {
        let max_ttl = env.storage().max_ttl();

        let (signer_key, signer_val, signer_storage) = process_signer(signer);

        store_signer(&env, &signer_key, &signer_val, &signer_storage, true);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events().publish(
            (EVENT_TAG, symbol_short!("add"), signer_key),
            (signer_val, signer_storage),
        );
    }
    fn remove_signer(env: Env, signer_key: SignerKey) {
        env.current_contract_address().require_auth();

        match get_signer_val_storage(&env, &signer_key, false) {
            Some((_, signer_storage)) => match signer_storage {
                SignerStorage::Persistent => {
                    env.storage().persistent().remove::<SignerKey>(&signer_key);
                }
                SignerStorage::Temporary => {
                    env.storage().temporary().remove::<SignerKey>(&signer_key);
                }
            },
            None => panic_with_error!(env, Error::NotFound),
        }

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("remove"), signer_key), ());
    }
    fn update_contract_code(env: Env, hash: BytesN<32>) {
        env.current_contract_address().require_auth();

        env.deployer().update_current_contract_wasm(hash);

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);
    }
}

fn process_signer(signer: Signer) -> (SignerKey, SignerVal, SignerStorage) {
    match signer {
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
    }
}
fn store_signer(
    env: &Env,
    signer_key: &SignerKey,
    signer_val: &SignerVal,
    signer_storage: &SignerStorage,
    update: bool,
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

    match previous_signer_val_and_storage {
        Some((_, previous_signer_storage)) => {
            // Panic if the signer key already exists and we're not update it
            if !update {
                panic_with_error!(env, Error::AlreadyExists);
            }

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
        }
        None => {
            // Panic if we're update a signer key that doesn't exist
            if update {
                panic_with_error!(env, Error::NotFound);
            }
        }
    }
}

#[derive(serde::Deserialize)]
struct ClientDataJson<'a> {
    challenge: &'a str,
}

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Signatures;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Signatures,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        // Check all contexts for an authorizing signature
        for context in auth_contexts.iter() {
            'check: loop {
                for (signer_key, _signature) in signatures.0.iter() {
                    if let Some((signer_val, _)) = get_signer_val_storage(&env, &signer_key, false)
                    {
                        let signer_limits = match signer_val {
                            SignerVal::Policy(signer_limits) => signer_limits,
                            SignerVal::Ed25519(signer_limits) => signer_limits,
                            SignerVal::Secp256r1(_public_key, signer_limits) => signer_limits,
                        };

                        if verify_context(&env, &context, &signer_key, &signer_limits, &signatures)
                        {
                            break 'check;
                        } else {
                            continue;
                        }
                    }
                }

                panic_with_error!(env, Error::MissingContext);
            }
        }

        // Check all signatures for a matching context
        for (signer_key, signature) in signatures.0.iter() {
            match get_signer_val_storage(&env, &signer_key, true) {
                None => panic_with_error!(env, Error::NotFound),
                Some((signer_val, _)) => {
                    match signature {
                        None => {
                            // If there's a policy signer in the signatures map we call it as a full forward of this __check_auth's arguments
                            if let SignerKey::Policy(policy) = &signer_key {
                                PolicyClient::new(&env, policy)
                                    .policy__(&env.current_contract_address(), &auth_contexts);
                                continue;
                            }

                            panic_with_error!(&env, Error::SignatureKeyValueMismatch)
                        }
                        Some(signature) => match signature {
                            Signature::Ed25519(signature) => {
                                if let SignerKey::Ed25519(public_key) = &signer_key {
                                    env.crypto().ed25519_verify(
                                        &public_key,
                                        &signature_payload.clone().into(),
                                        &signature,
                                    );
                                    continue;
                                }

                                panic_with_error!(&env, Error::SignatureKeyValueMismatch)
                            }
                            Signature::Secp256r1(signature) => {
                                if let SignerVal::Secp256r1(public_key, _signer_limits) = signer_val
                                {
                                    verify_secp256r1_signature(
                                        &env,
                                        &signature_payload,
                                        &public_key,
                                        signature,
                                    );
                                    continue;
                                }

                                panic_with_error!(&env, Error::SignatureKeyValueMismatch)
                            }
                        },
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

fn verify_context(
    env: &Env,
    context: &Context,
    signer_key: &SignerKey,
    signer_limits: &SignerLimits,
    signatures: &Signatures,
) -> bool {
    if signer_limits.0.is_empty() {
        return true;
    }

    match context {
        Context::Contract(ContractContext {
            contract,
            fn_name,
            args,
        }) => {
            match signer_limits.0.get(contract.clone()) {
                None => false, // signer limitations not met
                Some(signer_limits_keys) => {
                    // If this signer has a smart wallet context limit, limit that context to only removing itself
                    if *contract == env.current_contract_address()
                        && *fn_name != Symbol::new(&env, "remove_signer")
                        || (*fn_name == Symbol::new(&env, "remove_signer")
                            && SignerKey::from_val(env, &args.get_unchecked(0)) != *signer_key)
                    {
                        return false; // self trying to do something other than remove itself
                    }

                    verify_signer_limit_keys(env, signatures, &signer_limits_keys, &context);

                    true
                }
            }
        }
        Context::CreateContractHostFn(_) => {
            match signer_limits.0.get(env.current_contract_address()) {
                None => false, // signer limitations not met
                Some(signer_limits_keys) => {
                    verify_signer_limit_keys(env, signatures, &signer_limits_keys, &context);

                    true
                }
            }
        }
    }
}

fn verify_signer_limit_keys(
    env: &Env,
    signatures: &Signatures,
    signer_limits_keys: &Option<Vec<SignerKey>>,
    context: &Context,
) {
    if let Some(signer_limits_keys) = signer_limits_keys {
        for signer_limits_key in signer_limits_keys.iter() {
            // Policies SignerLimits don't need to exist in the signatures map, or be stored on the smart wallet for that matter, they can be adjacent as long as they pass their own require_auth_for_args check
            if let SignerKey::Policy(policy) = &signer_limits_key {
                // In the case of a policy signer in the SignerLimits map we need to verify it if that key has been saved to the smart wallet
                // NOTE watch out for infinity loops. If a policy calls itself this will indefinitely recurse
                if let Some((signer_limits_val, _)) =
                    get_signer_val_storage(env, &signer_limits_key, true)
                {
                    if let SignerVal::Policy(signer_limits) = signer_limits_val {
                        if !verify_context(
                            env,
                            context,
                            &signer_limits_key,
                            &signer_limits,
                            signatures,
                        ) {
                            panic_with_error!(env, Error::FailedPolicySignerLimits)
                        }
                    }
                }

                PolicyClient::new(&env, policy)
                    .policy__(&env.current_contract_address(), &vec![env, context.clone()]);
                // For every other SignerLimits key, it must exist in the signatures map and thus exist as a signer on the smart wallet
            } else if !signatures.0.contains_key(signer_limits_key.clone()) {
                // if any required key is missing this contract invocation is invalid
                panic_with_error!(env, Error::MissingSignerLimits)
            }
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
    signature_payload: &Hash<32>,
    public_key: &BytesN<65>,
    signature: Secp256r1Signature,
) {
    let Secp256r1Signature {
        mut authenticator_data,
        client_data_json,
        signature,
    } = signature;

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
