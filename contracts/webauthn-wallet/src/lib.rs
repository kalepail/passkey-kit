#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface}, contract, contractimpl, crypto::Hash, panic_with_error, symbol_short, vec, Bytes, BytesN, Env, FromVal, IntoVal, Symbol, Vec
};
use types::{
    Ed25519Signature, Error, Secp256r1PublicKey, Secp256r1Signature, Signature, Signer, SignerKey,
    SignerStorage, SignerType, SignerVal,
};

mod base64_url;
pub mod types;

mod test;

#[contract]
pub struct Contract;

const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;
const EVENT_TAG: Symbol = symbol_short!("sw_v1");
const PERSISTENT_ADMIN_SIGNER_COUNT: Symbol = symbol_short!("p_admin");

#[contractimpl]
impl Contract {
    #[allow(unused_mut)]
    pub fn add(env: Env, signer: Signer) -> Result<(), Error> {
        if env.storage().instance().has(&PERSISTENT_ADMIN_SIGNER_COUNT) {
            env.current_contract_address().require_auth();
        }

        let signer_key: SignerKey;
        let signer_val: SignerVal;
        let max_ttl = env.storage().max_ttl();

        let signer_storage = match signer {
            Signer::Policy(policy, signer_storage, signer_type) => {
                signer_key = SignerKey::Policy(policy);
                signer_val = SignerVal::Policy(signer_type.clone());
                signer_storage
            }
            Signer::Ed25519(public_key, signer_storage, signer_type) => {
                signer_key = SignerKey::Ed25519(public_key);
                signer_val = SignerVal::Ed25519(signer_type.clone());
                signer_storage
            }
            Signer::Secp256r1(id, public_key, signer_storage, signer_type) => {
                signer_key = SignerKey::Secp256r1(id);
                signer_val = SignerVal::Secp256r1(public_key, signer_type.clone());
                signer_storage
            }
        };

        let signer_type = get_signer_type(&signer_val);

        store_signer(&env, &signer_key, &signer_val, &signer_storage, &signer_type);

        ensure_persistent_admin_signer(&env);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events()
            .publish((EVENT_TAG, symbol_short!("add"), signer_key), signer_val);

        Ok(())
    }
    pub fn remove(env: Env, signer_key: SignerKey) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        if let Some((_, signer_storage, signer_type)) =
            get_signer_val_storage_type(&env, &signer_key, false)
        {
            let is_persistent = signer_storage == SignerStorage::Persistent;
            let is_admin = signer_type == SignerType::Admin;
            let is_persistent_admin = is_persistent && is_admin;

            if is_persistent_admin {
                update_persistent_admin_signer_count(&env, false);
            }

            match signer_storage {
                SignerStorage::Persistent => {
                    env.storage().persistent().remove::<SignerKey>(&signer_key);
                }
                SignerStorage::Temporary => {
                    env.storage().temporary().remove::<SignerKey>(&signer_key);
                }
            }
        }

        ensure_persistent_admin_signer(&env);

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
    signer_type: &SignerType
) {
    let max_ttl = env.storage().max_ttl();

    // Include this before the `.set` calls so it doesn't read them as previous values
    let previous_signer_val_and_storage: Option<(SignerVal, SignerStorage, SignerType)> =
        get_signer_val_storage_type(env, signer_key, false);

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
    let is_admin = *signer_type == SignerType::Admin;
    let is_persistent_admin = is_persistent && is_admin;

    if let Some((_, previous_signer_storage, previous_signer_type)) =
        previous_signer_val_and_storage
    {
        // Remove signer key in the opposing storage if it exists
        let previous_is_persistent = match previous_signer_storage {
            SignerStorage::Persistent => {
                if !is_persistent {
                    env.storage().persistent().remove::<SignerKey>(signer_key);
                }

                true
            }
            SignerStorage::Temporary => {
                if is_persistent {
                    env.storage().temporary().remove::<SignerKey>(signer_key);
                }

                false
            }
        };
        let previous_is_admin = previous_signer_type == SignerType::Admin;
        let previous_is_persistent_admin = previous_is_persistent && previous_is_admin;

        // If the previous key was a persistent admin signer but the new key is not, we need to decrement the persistent admin signer count
        if previous_is_persistent_admin && !is_persistent_admin {
            update_persistent_admin_signer_count(&env, false);
        }
        // Otherwise if the new key is a persistent admin, we need to increment the persistent admin signer count 
        else if is_persistent_admin {
            update_persistent_admin_signer_count(&env, true);
        }
    }
    // If there's no previous entry and the new entry is a persistent admin signer, we need to increment the persistent admin signer count
    else if is_persistent_admin {
        update_persistent_admin_signer_count(&env, true);
    }
}

fn ensure_persistent_admin_signer(env: &Env) {
    if env
        .storage()
        .instance()
        .get::<Symbol, i32>(&PERSISTENT_ADMIN_SIGNER_COUNT)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotFound))
        <= 0
    {
        panic_with_error!(env, Error::RequirePersistentAdmin)
    }
}

fn update_persistent_admin_signer_count(env: &Env, add: bool) {
    let count = env
        .storage()
        .instance()
        .get::<Symbol, i32>(&PERSISTENT_ADMIN_SIGNER_COUNT)
        .unwrap_or(0)
        + if add { 1 } else { -1 };

    env.storage()
        .instance()
        .set::<Symbol, i32>(&PERSISTENT_ADMIN_SIGNER_COUNT, &count);
}

#[derive(serde::Deserialize)]
struct ClientDataJson<'a> {
    challenge: &'a str,
}

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Vec<Signature>;

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Vec<Signature>,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        if signatures.len() > 20 {
            return Err(Error::TooManySignatures);
        }

        // iterator to ensure we never sign the same signature twice
        let mut signed: [u8; 20] = [0u8; 20];

        // NOTE Important for multisig scenarios (which this wallet isn't by default so we probably don't need this)
        // If we do decide to de-dupe here we need to include the type and not just the bytes of the key (as there could be conflicts for legit differences between ed25519 and policy signers as they're both 32 bytes)
        // Ensure no duplicate signatures
        // for i in 0..signatures.len() {
        //     let signature = signatures.get_unchecked(i);

        //     if i > 0 {
        //         let previous_signature = signatures.get_unchecked(i - 1);
        //         check_signature_order(&env, &signature, previous_signature);
        //     }
        // }

        // NOTE it might make more sense to map the destructured signatures vs continuously doing it again for every context
        // That would add yet another loop to the signatures though, so maybe not, at least not without some perf testing

        // Look at all the auth_contexts
        for i in 0..auth_contexts.len() {
            // Ensure there's a signature able to sign for it
            check_all_signatures(
                &env,
                &signature_payload,
                &signatures,
                &auth_contexts,
                Some(i),
                &mut signed,
            )?;
        }

        // TODO verify any remaining unused signatures
        // Or should we error if there are any remaining unused signatures?
        // On second thought is it even possible to have remaining unused signatures?
        // Yes, in the case of 2 signers and 3 contexts if the first signer meets the requirements of all 3 auth contexts it would be possible to have an unused signature
        check_all_signatures(&env, &signature_payload, &signatures, &auth_contexts, None, &mut signed)?;

        let max_ttl = env.storage().max_ttl();

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}

fn check_all_signatures(
    env: &Env,
    signature_payload: &Hash<32>,
    signatures: &Vec<Signature>,
    auth_contexts: &Vec<Context>,
    context_index: Option<u32>,
    signed: &mut [u8; 20],
    
) -> Result<(), Error> {
    let mut authorized = false;
    let context = if let Some(i) = context_index {
        Some(auth_contexts.get_unchecked(i))
    } else {
        None
    };

    // Ensure there's a signature able to sign for it
    for (i, signature) in signatures.iter().enumerate() {
        match signature {
            Signature::Policy(policy) => {
                let signer_key = SignerKey::Policy(policy.clone());

                match get_signer_val_storage_type(env, &signer_key, true) {
                    None => return Err(Error::NotFound),
                    Some((_signer_val, _signer_storage, signer_type)) => {
                        if let Ok(valid_policy_signatures) =
                            verify_signer_type(env, &signer_type, &signer_key, signatures, &context)
                        {
                            authorized = true;

                            // Not skipping if already signed if this isn't a context check to ensure we run this as many times as it's included given we're sending a custom `allowed_policy_signatures` arg
                            // if context_index.is_none() || signed[i] == 0 {
                                policy.0.require_auth_for_args(vec![&env,
                                    signature_payload.to_val(),
                                    valid_policy_signatures.into_val(env),
                                    // None::<Vec<Signature>>.into_val(env),
                                    // Some::<Vec<Signature>>(vec![&env]).into_val(env),
                                    // auth_contexts.to_val(),
                                ]);
                                signed[i] += 1;
                            // }
                        }
                    }
                }
            }
            Signature::Ed25519(signature) => {
                let Ed25519Signature {
                    public_key,
                    signature,
                } = signature;

                let signer_key = SignerKey::Ed25519(public_key.clone());

                match get_signer_val_storage_type(&env, &signer_key, true) {
                    None => return Err(Error::NotFound),
                    Some((_signer_val, _signer_storage, signer_type)) => {
                        if let Ok(_) =
                            verify_signer_type(env, &signer_type, &signer_key, signatures, &context)
                        {
                            authorized = true;

                            // Initially we loop over all contexts to ensure each none of them aren't covered by a signature
                            // It's possible that some signatures will cover multiple contexts, however we don't want to waste compute double signing the same signatures
                            // So we only sign once per signature and track if we've signed it already
                            // This is safe because not every context is "dangerous" and we only want to ensure that any which are are properly authorized by a signature
                            if signed[i] == 0 {
                                env.crypto().ed25519_verify(
                                    &public_key.0,
                                    &Bytes::from_array(env, &signature_payload.to_array()),
                                    &signature,
                                );

                                signed[i] = 1;
                            }
                        }
                    }
                }
            }
            Signature::Secp256r1(signature) => {
                let Secp256r1Signature {
                    mut authenticator_data,
                    client_data_json,
                    id,
                    signature,
                } = signature;

                let signer_key = SignerKey::Secp256r1(id);

                match get_signer_val_storage_type(&env, &signer_key, true) {
                    None => return Err(Error::NotFound),
                    Some((signer_val, _signer_storage, signer_type)) => {
                        if let Ok(_) =
                            verify_signer_type(env, &signer_type, &signer_key, signatures, &context)
                        {
                            authorized = true;

                            if signed[i] == 0 {
                                let public_key =
                                    if let SignerVal::Secp256r1(public_key, ..) = &signer_val {
                                        public_key
                                    } else {
                                        panic_with_error!(env, Error::NotFound)
                                    };

                                verify_secp256r1_signature(
                                    env,
                                    &public_key,
                                    &mut authenticator_data,
                                    &client_data_json,
                                    &signature,
                                    signature_payload,
                                );

                                signed[i] = 1;
                            }
                        }
                    }
                }
            }
        }
    }

    if !authorized {
        panic_with_error!(env, Error::NotAuthorized)
    }

    Ok(())
}

fn verify_signer_type(
    env: &Env,
    signer_type: &SignerType,
    signer_key: &SignerKey,
    signatures: &Vec<Signature>,
    context: &Option<Context>,
) -> Result<Option<Vec<Signature>>, Error> {
    match signer_type {
        SignerType::Admin => Ok(None),
        SignerType::Basic(permitted_signer_policies) => {
            // TODO we only need to do this Vec collection in the case of a Policy signer_key
            // Otherwise we can run a faster boolean loop check
            let mut valid_policy_signatures = vec![&env];

            // Ensure policies in permitted_signer_policies
            // Collect signers for this policy

            if let SignerKey::Policy(policy) = signer_key {
                for signature in signatures.iter() {
                    match signature {
                        Signature::Ed25519()
                    }
                }
            }

            // for allowed_signer_policy in permitted_signer_policies.iter() {
            //     for signature in signatures.iter() {
            //         if let Signature::Policy(signature_policy) = &signature {
            //             if *signature_policy == allowed_signer_policy {
            //                 valid_policy_signatures.push_back(signature);
            //             }
            //         }
            //     }
            // }

            if let Some(context) = context {
                match context {
                    Context::Contract(ContractContext {
                        contract,
                        fn_name,
                        args,
                    }) => {
                        // If we're a Basic signer calling our own smart wallet contract we can only call remove and only for our own key
                        if *contract == env.current_contract_address()
                            && *fn_name != symbol_short!("remove")
                            || (*fn_name == symbol_short!("remove")
                                && SignerKey::from_val(env, &args.get_unchecked(0)) != *signer_key)
                        {
                            return Err(Error::NotAuthorized);
                        }
                    }
                    Context::CreateContractHostFn(_) => {}
                }
            }

            if permitted_signer_policies.len() > 0 && valid_policy_signatures.len() == 0 {
                panic_with_error!(env, Error::NotFound)
            }

            Ok(Some(valid_policy_signatures))
        }
    }
}

// TODO Use Result instead of Option so we can return an error if the signer is not found
fn get_signer_val_storage_type(
    env: &Env,
    signer_key: &SignerKey,
    extend_ttl: bool,
) -> Option<(SignerVal, SignerStorage, SignerType)> {
    let max_ttl = env.storage().max_ttl();

    match env
        .storage()
        .temporary()
        .get::<SignerKey, SignerVal>(signer_key)
    {
        Some(signer_val) => {
            let signer_type = get_signer_type(&signer_val);

            if extend_ttl {
                env.storage().temporary().extend_ttl::<SignerKey>(
                    signer_key,
                    max_ttl - WEEK_OF_LEDGERS,
                    max_ttl,
                );
            }

            Some((signer_val, SignerStorage::Temporary, signer_type))
        }
        None => {
            match env
                .storage()
                .persistent()
                .get::<SignerKey, SignerVal>(signer_key)
            {
                Some(signer_val) => {
                    let signer_type = get_signer_type(&signer_val);

                    if extend_ttl {
                        env.storage().persistent().extend_ttl::<SignerKey>(
                            signer_key,
                            max_ttl - WEEK_OF_LEDGERS,
                            max_ttl,
                        );
                    }

                    Some((signer_val, SignerStorage::Persistent, signer_type))
                }
                None => None,
            }
        }
    }
}

fn get_signer_type(signer_val: &SignerVal) -> SignerType {
    match signer_val {
        SignerVal::Policy(signer_type) => signer_type.clone(),
        SignerVal::Ed25519(signer_type) => signer_type.clone(),
        SignerVal::Secp256r1(_, signer_type) => signer_type.clone(),
    }
}

fn verify_secp256r1_signature(
    env: &Env,
    public_key: &Secp256r1PublicKey,
    authenticator_data: &mut Bytes,
    client_data_json: &Bytes,
    signature: &BytesN<64>,
    signature_payload: &Hash<32>,
) {
    authenticator_data.extend_from_array(&env.crypto().sha256(&client_data_json).to_array());

    env.crypto().secp256r1_verify(
        &public_key.0,
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

// fn check_signature_order(env: &Env, signature: &Signature, prev_signature: Signature) {
//     match prev_signature {
//         Signature::Policy(prev_signature) => match signature {
//             Signature::Policy(policy) => {
//                 if prev_signature.0.to_xdr(env) >= policy.0.clone().to_xdr(env) {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//             Signature::Ed25519(Ed25519Signature { public_key, .. }) => {
//                 if prev_signature.0.to_xdr(env) >= public_key.0.clone().into() {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//             Signature::Secp256r1(Secp256r1Signature { id, .. }) => {
//                 if prev_signature.0.to_xdr(env) >= id.0 {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//         },
//         Signature::Ed25519(prev_signature) => match signature {
//             Signature::Policy(address) => {
//                 // Since we're using .into() we need the Bytes value to be first, thus we invert the comparison
//                 if address.0.clone().to_xdr(&env) <= prev_signature.public_key.0.into() {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//             Signature::Ed25519(Ed25519Signature { public_key, .. }) => {
//                 if prev_signature.public_key.0 >= public_key.0 {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//             Signature::Secp256r1(Secp256r1Signature { id, .. }) => {
//                 // inverted on purpose so .into() works
//                 if id.0 <= prev_signature.public_key.0.into() {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//         },
//         Signature::Secp256r1(prev_signature) => match signature {
//             Signature::Policy(address) => {
//                 if prev_signature.id.0 >= address.0.clone().to_xdr(&env) {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//             Signature::Ed25519(Ed25519Signature { public_key, .. }) => {
//                 if prev_signature.id.0 >= public_key.0.clone().into() {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//             Signature::Secp256r1(Secp256r1Signature { id, .. }) => {
//                 if prev_signature.id.0 >= id.0 {
//                     panic_with_error!(env, Error::BadSignatureOrder)
//                 }
//             }
//         },
//     }
// }
