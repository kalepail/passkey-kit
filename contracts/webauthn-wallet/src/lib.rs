#![no_std]

use soroban_sdk::{
    auth::{Context, ContractContext, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    panic_with_error, symbol_short, vec,
    xdr::ToXdr,
    BytesN, Env, FromVal, Symbol, Vec,
};
use types::{Ed25519Signature, Error, Secp256r1Signature, Signature, Signer, SignerKey, SignerVal};

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
    #[allow(unused_mut)] // `admin` actually is mutated so not sure why the IDE is yelling at me
    pub fn add(env: Env, signer: Signer, mut admin: bool) -> Result<(), Error> {
        if env.storage().instance().has(&ADMIN_SIGNER_COUNT) {
            env.current_contract_address().require_auth();
        } else {
            admin = true; // Ensure if this is the first signer they are an admin
        }

        let signer_key: SignerKey;
        let mut signer_val: Option<SignerVal> = None;
        let max_ttl = env.storage().max_ttl();

        match signer {
            Signer::Policy(policy, signers) => {
                signer_key = SignerKey::Policy(policy);

                if signers.len() > 0 {
                    signer_val = Some(SignerVal::Policy(signers));
                }
            }
            Signer::Ed25519(public_key) => {
                signer_key = SignerKey::Ed25519(public_key);
            }
            Signer::Secp256r1(id, public_key) => {
                signer_key = SignerKey::Secp256r1(id);
                signer_val = Some(SignerVal::Secp256r1(public_key));
            }
        }

        if admin {
            if env.storage().temporary().has::<SignerKey>(&signer_key) {
                env.storage().temporary().remove::<SignerKey>(&signer_key);
            }

            update_admin_signer_count(&env, true);

            env.storage()
                .persistent()
                .set::<SignerKey, Option<SignerVal>>(&signer_key, &signer_val);
            env.storage().persistent().extend_ttl::<SignerKey>(
                &signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );
        } else {
            if env.storage().persistent().has::<SignerKey>(&signer_key) {
                update_admin_signer_count(&env, false);

                env.storage().persistent().remove::<SignerKey>(&signer_key);
            }

            env.storage()
                .temporary()
                .set::<SignerKey, Option<SignerVal>>(&signer_key, &signer_val);
            env.storage().temporary().extend_ttl::<SignerKey>(
                &signer_key,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );
        }

        env.storage()
            .instance()
            .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);

        env.events().publish(
            (EVENT_TAG, symbol_short!("add"), signer_key),
            (signer_val, admin),
        );

        Ok(())
    }
    pub fn remove(env: Env, signer_key: SignerKey) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        if env.storage().temporary().has::<SignerKey>(&signer_key) {
            env.storage().temporary().remove::<SignerKey>(&signer_key);
        } else if env.storage().persistent().has::<SignerKey>(&signer_key) {
            update_admin_signer_count(&env, false);

            env.storage().persistent().remove::<SignerKey>(&signer_key);
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

// TODO do we need this? I don't understand it
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
            let mut prev_signature: Option<Signature> = None;

            if i > 0 {
                prev_signature = Some(signatures.get_unchecked(i - 1));
            }

            match signature {
                Signature::Policy(policy) => {
                    let key = SignerKey::Policy(policy.clone());

                    if let Some(prev_signature) = prev_signature {
                        check_signature_order(&env, prev_signature, &key);
                    }

                    let signers = match check_key(&env, &auth_contexts, key, max_ttl) {
                        Some(signer_val) => {
                            if let SignerVal::Policy(signers) = signer_val {
                                signers
                            } else {
                                panic_with_error!(env, Error::NotPermitted)
                            }
                        }
                        None => vec![&env],
                    };

                    // TODO Do we need to include any payload stuff here or is it the responsibility of the policy to check that?

                    policy.0.require_auth_for_args(vec![
                        &env,
                        signature_payload.to_bytes().into(),
                        signatures.clone().into(),
                        auth_contexts.clone().into(),
                        signers.into(),
                    ]);
                }
                Signature::Ed25519(signature) => {
                    let Ed25519Signature {
                        public_key,
                        signature,
                    } = signature;

                    let key = SignerKey::Ed25519(public_key.clone());

                    if let Some(prev_signature) = prev_signature {
                        check_signature_order(&env, prev_signature, &key);
                    }

                    check_key(&env, &auth_contexts, key, max_ttl);

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

                    let key = SignerKey::Secp256r1(id);

                    if let Some(prev_signature) = prev_signature {
                        check_signature_order(&env, prev_signature, &key);
                    }

                    let public_key = if let SignerVal::Secp256r1(public_key) =
                        check_key(&env, &auth_contexts, key, max_ttl).ok_or(Error::NotFound)?
                    {
                        public_key
                    } else {
                        panic_with_error!(env, Error::NotPermitted)
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
                    // TODO is this check actually necessary or is the secp256r1_verify enough?
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

fn check_signature_order(env: &Env, prev_signature: Signature, key: &SignerKey) {
    match prev_signature {
        Signature::Policy(prev_signature) => match key {
            SignerKey::Policy(address) => {
                if prev_signature.0.to_xdr(env) >= address.0.clone().to_xdr(env) {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            SignerKey::Ed25519(public_key) => {
                if prev_signature.0.to_xdr(env) >= public_key.0.clone().into() {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            SignerKey::Secp256r1(id) => {
                if prev_signature.0.to_xdr(env) >= id.0 {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
        },
        Signature::Ed25519(prev_signature) => match key {
            SignerKey::Policy(address) => {
                // Since we're using .into() we need the Bytes value to be first, thus we invert the comparison
                if address.0.clone().to_xdr(&env) <= prev_signature.public_key.0.into() {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            SignerKey::Ed25519(public_key) => {
                if prev_signature.public_key.0 >= public_key.0 {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            SignerKey::Secp256r1(id) => {
                // inverted on purpose so .into() works
                if id.0 <= prev_signature.public_key.0.into() {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
        },
        Signature::Secp256r1(prev_signature) => match key {
            SignerKey::Policy(address) => {
                if prev_signature.id.0 >= address.0.clone().to_xdr(&env) {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            SignerKey::Ed25519(public_key) => {
                if prev_signature.id.0 >= public_key.0.clone().into() {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
            SignerKey::Secp256r1(id) => {
                if prev_signature.id.0 >= id.0 {
                    panic_with_error!(env, Error::BadSignatureOrder)
                }
            }
        },
    }
}

fn check_key(
    env: &Env,
    auth_contexts: &Vec<Context>,
    id: SignerKey,
    max_ttl: u32,
) -> Option<SignerVal> {
    match env
        .storage()
        .temporary()
        .get::<SignerKey, Option<SignerVal>>(&id)
    {
        Some(signer_val) => {
            // Error if a session signer is trying to perform protected actions
            for context in auth_contexts.iter() {
                match context {
                    Context::Contract(ContractContext {
                        contract,
                        fn_name,
                        args,
                    }) => {
                        if contract == env.current_contract_address() // if we're calling self
                            && ( // and
                                fn_name != symbol_short!("remove") // the method isn't the only potentially available self command
                                || ( // or we're not removing ourself
                                    fn_name == symbol_short!("remove") 
                                    && SignerKey::from_val(env, &args.get_unchecked(0)) != id
                                )
                            )
                        {
                            panic_with_error!(env, Error::NotPermitted)
                        }
                    }
                    _ => {} // Don't block for example the deploying of new contracts from this contract
                }
            }

            env.storage().temporary().extend_ttl::<SignerKey>(
                &id,
                max_ttl - WEEK_OF_LEDGERS,
                max_ttl,
            );

            signer_val
        }
        None => {
            match env
                .storage()
                .persistent()
                .get::<SignerKey, Option<SignerVal>>(&id)
            {
                Some(signer_val) => {
                    env.storage().persistent().extend_ttl::<SignerKey>(
                        &id,
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
