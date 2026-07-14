use smart_wallet_interface::{
    types::{Signatures, SignerKey, SignerLimits},
    PolicyClient,
};
use soroban_sdk::{
    auth::{Context, ContractContext},
    vec, Env, Symbol, TryFromVal, Vec,
};

use crate::signer::{get_signer_val_storage, is_signer_expired, signer_expiration};

/// True iff `context` is THIS wallet's `remove_signer(signer_key)` — i.e.
/// `signer_key` removing itself. Gated on the wallet's own address; a foreign
/// contract's `remove_signer` (with arbitrary argument types) never matches
/// and never panics.
pub fn is_self_removal_context(env: &Env, context: &Context, signer_key: &SignerKey) -> bool {
    if let Context::Contract(ContractContext {
        contract,
        fn_name,
        args,
    }) = context
    {
        if *contract == env.current_contract_address()
            && *fn_name == Symbol::new(env, "remove_signer")
            && args.len() == 1
        {
            if let Some(arg) = args.get(0) {
                if let Ok(removed_key) = SignerKey::try_from_val(env, &arg) {
                    return removed_key == *signer_key;
                }
            }
        }
    }

    false
}

/// True iff `contexts` is EXACTLY ONE context and it is `signer_key`'s own
/// self-removal on this wallet. Used by pass 2 of `__check_auth` to let a
/// policy signer self-remove without consulting its (possibly rejecting)
/// `policy__` — but ONLY when nothing else is being authorized, so the skip
/// can never leak authority to another context.
pub fn is_sole_self_removal(env: &Env, contexts: &Vec<Context>, signer_key: &SignerKey) -> bool {
    contexts.len() == 1 && is_self_removal_context(env, &contexts.get_unchecked(0), signer_key)
}

/// Decide whether `signer_key` (with `signer_limits`) may authorize
/// `context`.
///
/// BOOLEAN for every recoverable failure by design: a candidate rejected for
/// bad shape, a missing co-signer, or a rejecting/failing policy (via
/// `try_policy__`) never fails the attempt for other candidates. Uncovered
/// contexts surface as `Error::MissingContext` at the `__check_auth` level.
///
/// NOT boolean: NON-recoverable host errors. `try_policy__` recovers only
/// recoverable contract errors — a required policy that exhausts the
/// transaction budget (Budget/Storage `ExceededLimit`) unwinds the whole
/// authorization even when another candidate could have covered the context.
/// That is a DoS-only hazard (it can never make a bad auth succeed), bounded
/// by the fact that policies are invoked LAST, only for candidates whose
/// every other requirement already passed (see `verify_signer_limit_keys`).
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
        Context::Contract(ContractContext { contract, .. }) => {
            // A limited signer may always remove itself, regardless of its
            // limits map and without co-signer requirements. (Note that
            // `remove_signer` itself still rejects removing the wallet's
            // last durable admin signer — see `Error::LastAdminSigner`.)
            if is_self_removal_context(env, context, signer_key) {
                return true;
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
/// symmetric — a required key's own limits govern only its
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
///
/// ## Ordering: side-effect-free checks first, policies last
///
/// `policy__` may commit state (e.g. a cumulative spend allowance), so it
/// must never run for a candidate that was going to fail anyway. The checks
/// therefore run in three phases: (1) presence of every non-policy required
/// key, (2) expiration of every STORED required policy, (3) only then the
/// `policy__` invocations. A candidate that fails phase 1 or 2 rejects
/// without any policy having been consulted, so a value-committing policy is
/// charged only when its candidate's every other requirement holds.
///
/// Phase 3 additionally DEDUPLICATES: a policy key listed more than once in
/// the same required-keys entry is invoked exactly once, so a duplicated
/// entry cannot double-commit a value-committing policy.
///
/// Residual (documented, not fixable at this layer): with TWO OR MORE
/// DISTINCT policies in one required-keys list, an earlier policy's committed
/// state survives a later policy's rejection if the authorization ultimately
/// succeeds through a different candidate. Do not combine multiple
/// state-committing policies in a single required-keys entry.
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

    // Phase 1: every non-policy required key must be present in the
    // signatures map (pass 2 fully verifies each entry). Pure map lookups —
    // no external calls, no side effects.
    for required_key in required_keys.iter() {
        if !matches!(required_key, SignerKey::Policy(_))
            && !signatures.0.contains_key(required_key.clone())
        {
            return false;
        }
    }

    // Phase 2: if a required policy is stored on this wallet it must be
    // unexpired (it need not be in the signatures map, so pass 2 would not
    // otherwise check it). Still no policy code runs.
    for required_key in required_keys.iter() {
        if matches!(required_key, SignerKey::Policy(_)) {
            if let Some((signer_val, _)) = get_signer_val_storage(env, &required_key, true) {
                if is_signer_expired(env, signer_expiration(&signer_val)) {
                    return false;
                }
            }
        }
    }

    // Phase 3: policy approvals, LAST. Each DISTINCT policy must approve
    // THIS context. try_policy__ so a rejecting or (recoverably) failing
    // policy rejects the candidate, never the whole transaction. A policy key
    // duplicated within this list is invoked only on its first occurrence —
    // `policy__` may commit state, so a duplicate entry must not
    // double-commit.
    for (index, required_key) in required_keys.iter().enumerate() {
        if let SignerKey::Policy(policy) = &required_key {
            let mut already_invoked = false;
            for previous_index in 0..index as u32 {
                if required_keys.get_unchecked(previous_index) == required_key {
                    already_invoked = true;
                    break;
                }
            }
            if already_invoked {
                continue;
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
    }

    true
}
