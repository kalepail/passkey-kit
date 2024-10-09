use smart_wallet_interface::types::SignerKey;
use soroban_sdk::Env;

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
