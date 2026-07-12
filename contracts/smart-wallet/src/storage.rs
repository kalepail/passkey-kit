//! TTL policy: every successful authentication (and every signer mutation)
//! bumps the instance — and any touched signer entries — to the maximum TTL.
//! This is a deliberate rent PREPAY: an actively-used wallet keeps itself and
//! its signers alive indefinitely, funded by the transactions that use it.
//! The extend threshold is one week of ledgers below max, so at most one
//! bump per entry per week is actually written.

use smart_wallet_interface::types::SignerKey;
use soroban_sdk::Env;

/// One week of ledgers at the historical 5s close time. Close time can drift
/// (CAP-0070 dynamic timing); this constant only shapes how often TTL bumps
/// rewrite state, not any auth semantics, so drift is harmless.
const WEEK_OF_LEDGERS: u32 = 60 * 60 * 24 / 5 * 7;

pub fn extend_instance(env: &Env) {
    let max_ttl = env.storage().max_ttl();

    env.storage()
        .instance()
        .extend_ttl(max_ttl - WEEK_OF_LEDGERS, max_ttl);
}

pub fn extend_signer_key(env: &Env, signer_key: &SignerKey, persistent: bool) {
    let max_ttl = env.storage().max_ttl();

    if persistent {
        env.storage().persistent().extend_ttl::<SignerKey>(
            signer_key,
            max_ttl - WEEK_OF_LEDGERS,
            max_ttl,
        );
    } else {
        env.storage().temporary().extend_ttl::<SignerKey>(
            signer_key,
            max_ttl - WEEK_OF_LEDGERS,
            max_ttl,
        );
    }
}
