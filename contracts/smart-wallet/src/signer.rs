use smart_wallet_interface::types::{
    Error, Signer, SignerExpiration, SignerKey, SignerStorage, SignerVal,
};
use soroban_sdk::Env;

use crate::storage::extend_signer_key;

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

/// Store a signer entry. `update: false` requires the key to be new,
/// `update: true` requires it to exist. Returns the previous storage
/// durability when updating (for the `SignerUpdated` event's `old_storage`).
pub fn store_signer(
    env: &Env,
    signer_key: &SignerKey,
    signer_val: &SignerVal,
    signer_storage: &SignerStorage,
    update: bool,
) -> Result<Option<SignerStorage>, Error> {
    let previous = get_signer_val_storage(env, signer_key, false);

    match (&previous, update) {
        (Some(_), false) => return Err(Error::SignerAlreadyExists),
        (None, true) => return Err(Error::SignerNotFound),
        _ => {}
    }

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

    // An update that flips durability leaves the old entry behind — remove it
    // so the "at most one entry per signer key" invariant holds.
    if let Some((_, previous_storage)) = &previous {
        match previous_storage {
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

    Ok(previous.map(|(_, storage)| storage))
}

/// Look up a signer entry, checking Temporary before Persistent (invariant:
/// at most one entry exists per key, but the lookup order is load-bearing for
/// determinism and indexers mirror it).
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
        None => match env
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
        },
    }
}

pub fn signer_expiration(signer_val: &SignerVal) -> &SignerExpiration {
    match signer_val {
        SignerVal::Policy(signer_expiration, _) => signer_expiration,
        SignerVal::Ed25519(signer_expiration, _) => signer_expiration,
        SignerVal::Secp256r1(_, signer_expiration, _) => signer_expiration,
    }
}

pub fn signer_limits(signer_val: &SignerVal) -> &smart_wallet_interface::types::SignerLimits {
    match signer_val {
        SignerVal::Policy(_, signer_limits) => signer_limits,
        SignerVal::Ed25519(_, signer_limits) => signer_limits,
        SignerVal::Secp256r1(_, _, signer_limits) => signer_limits,
    }
}

/// Expiration is a UNIX timestamp in seconds, inclusive: expired once
/// `ledger timestamp > expiration`. Expired signers are not pruned from
/// storage (persistent entries archive, temporary entries evict); indexers
/// filter expiration themselves.
pub fn is_signer_expired(env: &Env, signer_expiration: &SignerExpiration) -> bool {
    match signer_expiration.0 {
        Some(expiration) => env.ledger().timestamp() > expiration,
        None => false,
    }
}
