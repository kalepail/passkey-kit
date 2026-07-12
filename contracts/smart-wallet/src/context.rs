use smart_wallet_interface::{
    types::{Signatures, SignerKey, SignerLimits},
    PolicyClient,
};
use soroban_sdk::{
    auth::{Context, ContractContext},
    vec, Env, Symbol, TryFromVal,
};

use crate::signer::{get_signer_val_storage, is_signer_expired, signer_expiration};

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
                Some(required_keys) => {
                    verify_signer_limit_keys(env, signer_key, signatures, &required_keys, context)
                }
            }
        }
        // Deploy permission is not grantable through limits: CreateContract*
        // contexts require an unlimited signer (handled by the `None` arm
        // above).
        Context::CreateContractHostFn(_) | Context::CreateContractWithCtorHostFn(_) => false,
    }
}

/// Check a limits entry's required co-signers for one context.
///
/// Required keys are scope-independent APPROVERS: their role as a co-signer
/// is decoupled from their own `SignerLimits`. This makes both key kinds
/// symmetric (FIX-5, audit) — a required key's own limits govern only its
/// INDEPENDENT (as-a-covering-signer) authority, never its co-signer role:
///
/// - Non-policy keys must be present in the signatures map. Their existence,
///   expiration and crypto are enforced by pass 2 of `__check_auth`. Their
///   own `SignerLimits` are NOT consulted here.
/// - Policy keys need not be in the signatures map (they can be "adjacent"
///   requirements). The policy must APPROVE this context via `policy__`. If
///   the policy key is also stored on this wallet it must be unexpired, but
///   its own `SignerLimits` are NOT recursively enforced. Because no stored
///   policy's limits are re-entered, there is no policy-limit recursion and
///   thus no cycle to guard against.
fn verify_signer_limit_keys(
    env: &Env,
    signer_key: &SignerKey,
    signatures: &Signatures,
    required_keys: &Option<soroban_sdk::Vec<SignerKey>>,
    context: &Context,
) -> bool {
    let required_keys = match required_keys {
        // No co-signer requirements for this contract.
        None => return true,
        Some(keys) => keys,
    };

    for required_key in required_keys.iter() {
        match &required_key {
            SignerKey::Policy(policy) => {
                // If the policy is stored on this wallet it must be unexpired
                // (it need not be in the signatures map, so pass 2 would not
                // otherwise check it). We do NOT re-enter its own limits.
                if let Some((signer_val, _)) = get_signer_val_storage(env, &required_key, true) {
                    if is_signer_expired(env, signer_expiration(&signer_val)) {
                        return false;
                    }
                }

                // The policy must approve THIS context. try_policy__ so a
                // rejecting or failing policy rejects the candidate, never the
                // whole transaction.
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
