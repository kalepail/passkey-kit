use smart_wallet_interface::{
    types::{Signatures, SignerKey, SignerLimits, SignerVal},
    PolicyClient,
};
use soroban_sdk::{
    auth::{Context, ContractContext},
    vec, Env, Symbol, TryFromVal,
};

use crate::signer::{get_signer_val_storage, is_signer_expired, signer_expiration};

/// Cap on nested policy-limit verification (a stored policy key inside a
/// signer's limits has its own stored limits verified recursively, which can
/// cycle: A requires B, B requires A). Depth past this bound fails closed —
/// the candidate simply doesn't cover the context.
const MAX_LIMIT_KEY_DEPTH: u32 = 4;

/// Decide whether `signer_key` (with `signer_limits`) may authorize
/// `context`.
///
/// PURELY BOOLEAN by design: rejecting a candidate must never panic, so that
/// other signers in the signatures map can still cover the context. Uncovered
/// contexts surface as `Error::MissingContext` at the `__check_auth` level.
///
/// Expiration of the candidate itself is NOT checked here — every signatures
/// map entry gets a single-point expiration check in pass 2 of
/// `__check_auth`. Stored policy keys referenced inside limits ARE
/// expiration-checked here (boolean), because they need not appear in the
/// signatures map and would otherwise never be checked.
pub fn verify_context(
    env: &Env,
    context: &Context,
    signer_key: &SignerKey,
    signer_limits: &SignerLimits,
    signatures: &Signatures,
    depth: u32,
) -> bool {
    let limits = match &signer_limits.0 {
        // No limits: the signer can authorize anything.
        None => return true,
        // Some(map): fail-closed. An empty map covers nothing (except
        // self-removal, below).
        Some(limits) => limits,
    };

    match context {
        Context::Contract(ContractContext {
            contract,
            fn_name,
            args,
        }) => {
            // A limited signer may always remove itself, regardless of its
            // limits map and without co-signer requirements. Gated on the
            // context being THIS wallet's `remove_signer` with the signer's
            // own key as the argument; a non-SignerKey argument is simply
            // not a self-removal (no panic).
            if *contract == env.current_contract_address()
                && *fn_name == Symbol::new(env, "remove_signer")
            {
                if let Some(arg) = args.get(0) {
                    if let Ok(removed_key) = SignerKey::try_from_val(env, &arg) {
                        if removed_key == *signer_key {
                            return true;
                        }
                    }
                }
            }

            match limits.get(contract.clone()) {
                // No entry for this contract: not permitted.
                None => false,
                Some(required_keys) => verify_signer_limit_keys(
                    env,
                    signer_key,
                    signatures,
                    &required_keys,
                    context,
                    depth,
                ),
            }
        }
        // Deploy permission is not grantable through limits: CreateContract*
        // contexts require an unlimited signer (handled by the `None` arm
        // above).
        Context::CreateContractHostFn(_) | Context::CreateContractWithCtorHostFn(_) => false,
    }
}

/// Check a limits entry's co-signer requirements for one context.
///
/// - Non-policy keys must be present in the signatures map. Their crypto,
///   existence and expiration are enforced by pass 2 of `__check_auth`,
///   which verifies every signatures map entry.
/// - Policy keys need not be in the signatures map (they can be "adjacent"
///   requirements). If the policy key is stored on this wallet it must be
///   unexpired and its own stored limits must cover this context
///   (recursive, depth-guarded). The policy contract is then invoked via
///   `try_policy__` for this single context — a rejecting or failing policy
///   rejects the candidate, never the whole transaction.
fn verify_signer_limit_keys(
    env: &Env,
    signer_key: &SignerKey,
    signatures: &Signatures,
    required_keys: &Option<soroban_sdk::Vec<SignerKey>>,
    context: &Context,
    depth: u32,
) -> bool {
    let required_keys = match required_keys {
        // No co-signer requirements for this contract.
        None => return true,
        Some(keys) => keys,
    };

    for required_key in required_keys.iter() {
        match &required_key {
            SignerKey::Policy(policy) => {
                if depth >= MAX_LIMIT_KEY_DEPTH {
                    return false;
                }

                if let Some((signer_val, _)) = get_signer_val_storage(env, &required_key, true) {
                    if is_signer_expired(env, signer_expiration(&signer_val)) {
                        return false;
                    }

                    if let SignerVal::Policy(_, limits) = &signer_val {
                        if !verify_context(
                            env,
                            context,
                            &required_key,
                            limits,
                            signatures,
                            depth + 1,
                        ) {
                            return false;
                        }
                    }
                }

                if PolicyClient::new(env, policy)
                    .try_policy__(
                        &env.current_contract_address(),
                        signer_key,
                        &vec![env, context.clone()],
                    )
                    .is_err()
                {
                    return false;
                }
            }
            _ => {
                if !signatures.0.contains_key(required_key.clone()) {
                    return false;
                }
            }
        }
    }

    true
}
