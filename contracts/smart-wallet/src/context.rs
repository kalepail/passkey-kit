use smart_wallet_interface::types::{Signatures, SignerKey, SignerLimits};
use soroban_sdk::{
    auth::{Context, ContractContext},
    Env, FromVal, Symbol,
};

use crate::signer::verify_signer_limit_keys;

pub fn verify_context(
    env: &Env,
    context: &Context,
    signer_key: &SignerKey,
    signer_limits: &SignerLimits,
    signatures: &Signatures,
) -> bool {
    // Signer has no limits, it can do anything
    if signer_limits.0.is_empty() {
        return true;
    }

    match context {
        Context::Contract(ContractContext {
            contract,
            fn_name,
            args,
        }) => {
            match signer_limits.0.get(contract.clone()) {
                None => false, // signer limitations not met
                Some(signer_limits_keys) => {
                    // If this signer has a smart wallet context limit, limit that context to only removing itself
                    if *contract == env.current_contract_address()
                        && *fn_name != Symbol::new(&env, "remove_signer")
                        || (*fn_name == Symbol::new(&env, "remove_signer")
                            && SignerKey::from_val(env, &args.get_unchecked(0)) != *signer_key)
                    {
                        return false; // self trying to do something other than remove itself
                    }

                    verify_signer_limit_keys(env, signatures, &signer_limits_keys, &context);

                    true
                }
            }
        }
        Context::CreateContractHostFn(_) => {
            // Only signers with the smart wallet context signer limit can deploy contracts
            match signer_limits.0.get(env.current_contract_address()) {
                None => false, // signer limitations not met
                Some(signer_limits_keys) => {
                    verify_signer_limit_keys(env, signatures, &signer_limits_keys, &context);

                    true
                }
            }
        }
    }
}
