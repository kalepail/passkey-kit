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

/// The extend threshold: one week below `max_ttl`. `saturating_sub` so a
/// hypothetical network config with `max_ttl < WEEK_OF_LEDGERS` yields a `0`
/// threshold (bump every time) rather than an overflow panic that would brick
/// all auth and mutation (audit FIX-6). `overflow-checks = true` is on for
/// release, so this must not underflow.
fn extend_threshold(max_ttl: u32) -> u32 {
    max_ttl.saturating_sub(WEEK_OF_LEDGERS)
}

pub fn extend_instance(env: &Env) {
    let max_ttl = env.storage().max_ttl();

    env.storage()
        .instance()
        .extend_ttl(extend_threshold(max_ttl), max_ttl);
}

pub fn extend_signer_key(env: &Env, signer_key: &SignerKey, persistent: bool) {
    let max_ttl = env.storage().max_ttl();

    if persistent {
        env.storage().persistent().extend_ttl::<SignerKey>(
            signer_key,
            extend_threshold(max_ttl),
            max_ttl,
        );
    } else {
        env.storage().temporary().extend_ttl::<SignerKey>(
            signer_key,
            extend_threshold(max_ttl),
            max_ttl,
        );
    }
}
