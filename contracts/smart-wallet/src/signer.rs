use smart_wallet_interface::{
    types::{Error, Signatures, Signer, SignerKey, SignerStorage, SignerVal},
    PolicyClient,
};
use soroban_sdk::{auth::Context, panic_with_error, vec, Env, Vec};

use crate::{context::verify_context, storage::extend_signer_key};

pub fn process_signer(signer: Signer) -> (SignerKey, SignerVal, SignerStorage) {
    match signer {
        Signer::Policy(policy, signer_expiration, signer_limits, signer_storage) => (
            SignerKey::Policy(policy),
            SignerVal::Policy(signer_expiration, signer_limits),
            signer_storage,
        ),
        Signer::Ed25519(public_key, signer_expiration, signer_limits, signer_storage) => (
            SignerKey::Ed25519(public_key),
            SignerVal::Ed25519(signer_expiration, signer_limits),
            signer_storage,
        ),
        Signer::Secp256r1(id, public_key, signer_expiration, signer_limits, signer_storage) => (
            SignerKey::Secp256r1(id),
            SignerVal::Secp256r1(public_key, signer_expiration, signer_limits),
            signer_storage,
        ),
    }
}

pub fn store_signer(
    env: &Env,
    signer_key: &SignerKey,
    signer_val: &SignerVal,
    signer_storage: &SignerStorage,
    update: bool,
) {
    // Include this before the `.set` calls so it doesn't read them as previous values
    let previous_signer_val_and_storage: Option<(SignerVal, SignerStorage)> =
        get_signer_val_storage(env, signer_key, false);

    // Add and extend the signer key in the appropriate storage
    let is_persistent = match signer_storage {
        SignerStorage::Persistent => {
            env.storage()
                .persistent()
                .set::<SignerKey, SignerVal>(signer_key, signer_val);

            true
        }
        SignerStorage::Temporary => {
            env.storage()
                .temporary()
                .set::<SignerKey, SignerVal>(signer_key, signer_val);

            false
        }
    };

    extend_signer_key(env, signer_key, is_persistent);

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

pub fn get_signer_val_storage(
    env: &Env,
    signer_key: &SignerKey,
    extend_ttl: bool,
) -> Option<(SignerVal, SignerStorage)> {
    match env
        .storage()
        .temporary()
        .get::<SignerKey, SignerVal>(signer_key)
    {
        Some(signer_val) => {
            if extend_ttl {
                extend_signer_key(env, signer_key, false);
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
                        extend_signer_key(env, signer_key, true);
                    }

                    Some((signer_val, SignerStorage::Persistent))
                }
                None => None,
            }
        }
    }
}

pub fn verify_signer_expiration(env: &Env, signer_expiration: Option<u32>) {
    if let Some(signer_expiration) = signer_expiration {
        if env.ledger().sequence() > signer_expiration {
            // Note we're not removing this expired signer. Probably fine but storage will fill up with expired signers
            // This is fine from the protocol perspective because persistent entries will be archived and temporary entries will be evicted
            // However on the indexer side we'll want to filter out signers which are expired
            panic_with_error!(env, Error::SignerExpired);
        }
    }
}

pub fn verify_signer_limit_keys(
    env: &Env,
    signatures: &Signatures,
    signer_limits_keys: &Option<Vec<SignerKey>>,
    context: &Context,
) {
    if let Some(signer_limits_keys) = signer_limits_keys {
        for signer_limits_key in signer_limits_keys.iter() {
            // Policies SignerLimits don't need to exist in the signatures map, or be stored on the smart wallet for that matter, they can be adjacent as long as they pass their own policy__ check
            if let SignerKey::Policy(policy) = &signer_limits_key {
                // In the case of a policy signer in the SignerLimits map we need to verify it if that key has been saved to the smart wallet
                // NOTE watch out for infinity loops. If a policy calls itself this will indefinitely recurse
                if let Some((signer_limits_val, _)) =
                    get_signer_val_storage(env, &signer_limits_key, true)
                {
                    if let SignerVal::Policy(signer_expiration, signer_limits) = signer_limits_val {
                        verify_signer_expiration(env, signer_expiration);

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
                panic_with_error!(env, Error::FailedSignerLimits)
            }
        }
    }
}
