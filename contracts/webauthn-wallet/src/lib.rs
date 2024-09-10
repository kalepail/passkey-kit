#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    panic_with_error, symbol_short,
    xdr::ToXdr,
    BytesN, Env, FromVal, Symbol, Vec,
};
use types::{
    Ed25519Signature, Error, Secp256r1Signature, Signature, Signer, SignerKey, SignerStorage,
    SignerType, SignerVal,
};

mod base64_url;
pub mod types;

mod test;

#[contract]
pub struct Contract;

const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;
const EVENT_TAG: Symbol = symbol_short!("sw_v1");
const ADMIN_SIGNER_COUNT: Symbol = symbol_short!("admins");

#[contractimpl]
impl Contract {
    #[allow(unused_mut)]
    pub fn add(env: Env, signer: Signer) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN_SIGNER_COUNT) {
            env.current_contract_address().require_auth();
        }

        let max_ttl = env.storage().max_ttl();

        let signer_key: SignerKey;
        let signer_val: SignerVal;

        match signer {
            Signer::Policy(policy, signer_storage, signer_type) => {
                signer_key = SignerKey::Policy(policy);
                signer_val = SignerVal::Policy(signer_type.clone());
                store_signer(&env, &signer_storage, &signer_key, &signer_val, max_ttl);
            }
            Signer::Ed25519(public_key, signer_storage, signer_type) => {
                signer_key = SignerKey::Ed25519(public_key);
                signer_val = SignerVal::Ed25519(signer_type.clone());
                store_signer(&env, &signer_storage, &signer_key, &signer_val, max_ttl);
            }
            Signer::Secp256r1(id, public_key, signer_storage, signer_type) => {
                signer_key = SignerKey::Secp256r1(id);
                signer_val = SignerVal::Secp256r1(public_key, signer_type.clone());
                store_signer(&env, &signer_storage, &signer_key, &signer_val, max_ttl);
            }
        };

        ensure_admin_signer(&env);

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events().publish(
            (EVENT_TAG, symbol_short!("add"), signer_key), signer_val,
        );

        Ok(())
    }
    pub fn remove(env: Env, signer_key: SignerKey) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        if env.storage().temporary().has::<SignerKey>(&signer_key) {
            env.storage().temporary().remove::<SignerKey>(&signer_key);
        } else if env.storage().persistent().has::<SignerKey>(&signer_key) {
            env.storage().persistent().remove::<SignerKey>(&signer_key);
            update_admin_signer_count(&env, false);
        }

        ensure_admin_signer(&env);

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
    signer_storage: &SignerStorage,
    signer_key: &SignerKey,
    signer_val: &SignerVal,
    max_ttl: u32,
) {
    match signer_storage {
        SignerStorage::Persistent => {
            if env.storage().temporary().has::<SignerKey>(signer_key) {
                env.storage().temporary().remove::<SignerKey>(signer_key);
            }

            update_admin_signer_count(env, true);

            env.storage()
                .persistent()
                .set::<SignerKey, SignerVal>(signer_key, signer_val);
            env.storage().persistent().extend_ttl::<SignerKey>(
                signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );
        }
        SignerStorage::Temporary => {
            if env.storage().persistent().has::<SignerKey>(signer_key) {
                env.storage().persistent().remove::<SignerKey>(signer_key);
                update_admin_signer_count(env, false);
            }

            env.storage()
                .temporary()
                .set::<SignerKey, SignerVal>(signer_key, signer_val);
            env.storage().temporary().extend_ttl::<SignerKey>(
                signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );
        }
    }
}

fn ensure_admin_signer(env: &Env) {
    // TODO we need to ensure there's always a _persistent_ admin signer

    if env
        .storage()
        .instance()
        .get::<Symbol, i32>(&ADMIN_SIGNER_COUNT)
        .unwrap_or_else(|| panic_with_error!(env, Error::NotPermitted))
        <= 0
    {
        panic_with_error!(env, Error::NotPermitted)
    }
}

fn update_admin_signer_count(env: &Env, add: bool) {
    let admin_count = env
        .storage()
        .instance()
        .get::<Symbol, i32>(&ADMIN_SIGNER_COUNT)
        .unwrap_or(0)
        + if add { 1 } else { -1 };

    env.storage()
        .instance()
        .set::<Symbol, i32>(&ADMIN_SIGNER_COUNT, &admin_count);
}

#[derive(serde::Deserialize)]
struct ClientDataJson<'a> {
    challenge: &'a str,
}

#[contractimpl]
impl CustomAccountInterface for Contract {
    type Error = Error;
    type Signature = Vec<Signature>;

    // TODO test scenario with multiple auth_contexts (get via cross contract call) (also explore how this is related to sub_invocations)

    #[allow(non_snake_case)]
    fn __check_auth(
        env: Env,
        signature_payload: Hash<32>,
        signatures: Vec<Signature>,
        auth_contexts: Vec<Context>,
    ) -> Result<(), Error> {
        let max_ttl = env.storage().max_ttl();

        for i in 0..signatures.len() {
            let signature = signatures.get_unchecked(i);

            if i > 0 {
                let previous_signature = signatures.get_unchecked(i - 1);
                check_signature_order(&env, &signature, previous_signature);
            }

            match signature {
                Signature::Policy(policy) => {
                    let signer_key = SignerKey::Policy(policy.clone());
                    let signer_val = get_signer_val(&env, &signer_key, max_ttl);

                    check_signer_val(&env, &signatures, &auth_contexts, &signer_key, &signer_val);

                    policy.0.require_auth();
                }
                Signature::Ed25519(signature) => {
                    let Ed25519Signature {
                        public_key,
                        signature,
                    } = signature;

                    let signer_key = SignerKey::Ed25519(public_key.clone());
                    let signer_val = get_signer_val(&env, &signer_key, max_ttl);

                    check_signer_val(&env, &signatures, &auth_contexts, &signer_key, &signer_val);

                    env.crypto().ed25519_verify(
                        &public_key.0,
                        &signature_payload.clone().into(),
                        &signature,
                    );
                }
                Signature::Secp256r1(signature) => {
                    let Secp256r1Signature {
                        mut authenticator_data,
                        client_data_json,
                        id,
                        signature,
                    } = signature;

                    let signer_key = SignerKey::Secp256r1(id);
                    let signer_val = get_signer_val(&env, &signer_key, max_ttl);

                    check_signer_val(&env, &signatures, &auth_contexts, &signer_key, &signer_val);

                    let public_key = if let SignerVal::Secp256r1(public_key, ..) = signer_val {
                        public_key
                    } else {
                        panic_with_error!(env, Error::NotFound)
                    };

                    authenticator_data
                        .extend_from_array(&env.crypto().sha256(&client_data_json).to_array());

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
                            .map_err(|_| Error::JsonParseError)?;

                    // Build what the base64 url challenge is expecting.
                    let mut expected_challenge = [0u8; 43];

                    base64_url::encode(&mut expected_challenge, &signature_payload.to_array());

                    // Check that the challenge inside the client data JSON that was signed is identical to the expected challenge.
                    // TODO is this check actually necessary or is the secp256r1_verify sufficient?
                    if client_data_json.challenge.as_bytes() != expected_challenge {
                        return Err(Error::ClientDataJsonChallengeIncorrect);
                    }
                }
            }
        }

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        Ok(())
    }
}

fn get_signer_val(env: &Env, signer_key: &SignerKey, max_ttl: u32) -> SignerVal {
    match env
        .storage()
        .temporary()
        .get::<SignerKey, SignerVal>(signer_key)
    {
        Some(signer_val) => {
            env.storage().temporary().extend_ttl::<SignerKey>(
                signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );

            signer_val
        }
        None => {
            match env
                .storage()
                .persistent()
                .get::<SignerKey, SignerVal>(signer_key)
            {
                Some(signer_val) => {
                    env.storage().persistent().extend_ttl::<SignerKey>(
                        signer_key,
                        max_ttl - WEEK_OF_LEDGERS,
                        max_ttl,
                    );

                    signer_val
                }
                None => {
                    panic_with_error!(env, Error::NotFound)
                }
            }
        }
    }
}

fn check_signer_val(
    env: &Env,
    signatures: &Vec<Signature>,
    auth_contexts: &Vec<Context>,
    signer_key: &SignerKey,
    signer_val: &SignerVal,
) {
    match signer_val {
        SignerVal::Policy(signer_type) => {
            check_signer_type(env, signatures, auth_contexts, signer_key, signer_type);
        }
        SignerVal::Ed25519(signer_type) => {
            check_signer_type(env, signatures, auth_contexts, signer_key, signer_type);
        }
        SignerVal::Secp256r1(_, signer_type) => {
            check_signer_type(env, signatures, auth_contexts, signer_key, signer_type);
        }
    }
}

fn check_signer_type(
    env: &Env,
    signatures: &Vec<Signature>,
    auth_contexts: &Vec<Context>,
    signer_key: &SignerKey,
    signer_type: &SignerType,
) {
    match signer_type {
        SignerType::Admin => {
            // Admins can do anything
        }
        SignerType::Basic => {
            // Error if a Basic signer is trying to perform protected actions
            for context in auth_contexts.iter() {
                match context {
                    Context::Contract(ContractContext {
                        contract,
                        fn_name,
                        args,
                    }) => {
                        if contract == env.current_contract_address() // if we're calling self
                            && ( // and
                                fn_name != symbol_short!("remove") // we're calling any function besides remove
                                || SignerKey::from_val(env, &args.get_unchecked(0)) != *signer_key // or we are calling remove but not on our own signer_key
                            )
                        {
                            panic_with_error!(env, Error::NotPermitted)
                        }
                    }
                    Context::CreateContractHostFn(_) => {
                        // Don't block contract creation from Basic signers
                    }
                }
            }
        }
        SignerType::Policy => {
            /* TODO
                A policy signer should not be allowed to remove itself
                however a policy signer + basic policy should be able to remove the policy signer
                however a basic policy should not be able to remove policy signers
            */

            // Policy signers must be accompanied by a relevant policy key in the auth_contexts
            // We HAVE to ensure policy signatures only ever validate in tandem with a policy signer
            for context in auth_contexts.iter() {
                match context {
                    Context::Contract(ContractContext { contract, .. }) => {
                        // Search the signatures for a policy which matches this policy signer, if not, throw an error
                        for signature in signatures.iter() {
                            if let Signature::Policy(policy) = signature {
                                if contract == policy.0 {
                                    break;
                                }
                            }
                        }

                        panic_with_error!(env, Error::NotPermitted)
                    }
                    Context::CreateContractHostFn(_) => {
                        // Don't block contract creation from Policy signers
                    }
                }
            }
        }
    }
}

fn check_signature_order(env: &Env, signature: &Signature, prev_signature: Signature) {
    match prev_signature {
        Signature::Policy(prev_signature) => match signature {
            Signature::Policy(policy) => {
                if prev_signature.0.to_xdr(env) >= policy.0.clone().to_xdr(env) {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            Signature::Ed25519(Ed25519Signature { public_key, .. }) => {
                if prev_signature.0.to_xdr(env) >= public_key.0.clone().into() {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            Signature::Secp256r1(Secp256r1Signature { id, .. }) => {
                if prev_signature.0.to_xdr(env) >= id.0 {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
        },
        Signature::Ed25519(prev_signature) => match signature {
            Signature::Policy(address) => {
                // Since we're using .into() we need the Bytes value to be first, thus we invert the comparison
                if address.0.clone().to_xdr(&env) <= prev_signature.public_key.0.into() {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            Signature::Ed25519(Ed25519Signature { public_key, .. }) => {
                if prev_signature.public_key.0 >= public_key.0 {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            Signature::Secp256r1(Secp256r1Signature { id, .. }) => {
                // inverted on purpose so .into() works
                if id.0 <= prev_signature.public_key.0.into() {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
        },
        Signature::Secp256r1(prev_signature) => match signature {
            Signature::Policy(address) => {
                if prev_signature.id.0 >= address.0.clone().to_xdr(&env) {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            Signature::Ed25519(Ed25519Signature { public_key, .. }) => {
                if prev_signature.id.0 >= public_key.0.clone().into() {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            Signature::Secp256r1(Secp256r1Signature { id, .. }) => {
                if prev_signature.id.0 >= id.0 {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
        },
    }
}
