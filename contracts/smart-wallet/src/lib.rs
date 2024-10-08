#![no_std]

use context::verify_context;
use signer::{get_signer_val_storage, process_signer, store_signer, verify_signer_expiration};
use smart_wallet_interface::{
    types::{Error, Signature, Signatures, Signer, SignerKey, SignerStorage, SignerVal},
    PolicyClient, SmartWalletInterface,
};
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl,
    crypto::Hash,
    panic_with_error, symbol_short, BytesN, Env, Symbol, Vec,
};
use storage::extend_instance;
use verify::verify_secp256r1_signature;

mod base64_url;
mod context;
mod signer;
mod storage;
mod types;
mod verify;

#[path = "./tests/test.rs"]
mod test;
#[path = "./tests/test_extra.rs"]
mod test_extra;

#[contract]
pub struct Contract;

const EVENT_TAG: Symbol = symbol_short!("sw_v1");
const INITIALIZED: Symbol = symbol_short!("init");

#[contractimpl]
impl SmartWalletInterface for Contract {
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

        let (signer_key, signer_val, signer_storage) = process_signer(signer);

        store_signer(&env, &signer_key, &signer_val, &signer_storage, false);

        extend_instance(&env);

        env.events().publish(
            (EVENT_TAG, symbol_short!("add"), signer_key),
            (signer_val, signer_storage),
        );
    }
    fn update_signer(env: Env, signer: Signer) {
        let (signer_key, signer_val, signer_storage) = process_signer(signer);

        store_signer(&env, &signer_key, &signer_val, &signer_storage, true);

        extend_instance(&env);

        env.events().publish(
            (EVENT_TAG, symbol_short!("update"), signer_key),
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

        extend_instance(&env);

        env.events()
            .publish((EVENT_TAG, symbol_short!("remove"), signer_key), ());
    }
    fn update_contract_code(env: Env, hash: BytesN<32>) {
        env.current_contract_address().require_auth();

        env.deployer().update_current_contract_wasm(hash);

        extend_instance(&env);
    }
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
                for (signer_key, _) in signatures.0.iter() {
                    if let Some((signer_val, _)) = get_signer_val_storage(&env, &signer_key, false)
                    {
                        let (signer_expiration, signer_limits) = match signer_val {
                            SignerVal::Policy(signer_expiration, signer_limits) => {
                                (signer_expiration, signer_limits)
                            }
                            SignerVal::Ed25519(signer_expiration, signer_limits) => {
                                (signer_expiration, signer_limits)
                            }
                            SignerVal::Secp256r1(_, signer_expiration, signer_limits) => {
                                (signer_expiration, signer_limits)
                            }
                        };

                        verify_signer_expiration(&env, signer_expiration);

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
                            // If there's a policy signer in the signatures map we call it as a full forward of this __check_auth's Vec<Context>
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
                                if let SignerVal::Secp256r1(public_key, _, _) = signer_val {
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

        extend_instance(&env);

        Ok(())
    }
}
