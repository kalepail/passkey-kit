#![no_std]

use context::verify_context;
use signer::{
    get_signer_val_storage, is_signer_expired, process_signer, signer_expiration, signer_limits,
    store_signer,
};
use smart_wallet_interface::{
    events::{SignerAdded, SignerRemoved, SignerUpdated, Upgraded},
    types::{Error, Signature, Signatures, Signer, SignerKey, SignerStorage, SignerVal},
    PolicyClient, SmartWalletInterface,
};
use soroban_sdk::{
    auth::{Context, CustomAccountInterface},
    contract, contractimpl, contractmeta,
    crypto::Hash,
    panic_with_error, symbol_short, BytesN, Env, Symbol, Vec,
};
use storage::extend_instance;
use verify::verify_secp256r1_signature;

mod base64_url;
mod context;
mod signer;
mod storage;
mod verify;

#[cfg(test)]
mod tests;

contractmeta!(key = "binver", val = env!("CARGO_PKG_VERSION"));

/// Instance storage key caching the wasm hash installed by the most recent
/// `upgrade`. Absent until the first upgrade (a contract cannot read its own
/// executable hash from the host). Sourced for `Upgraded.old_hash`.
const WASM_HASH: Symbol = symbol_short!("wasm_hash");

#[contract]
pub struct Contract;

impl Contract {
    fn add_signer_impl(env: &Env, signer: Signer) -> Result<(), Error> {
        let (signer_key, signer_val, signer_storage) = process_signer(signer);

        store_signer(env, &signer_key, &signer_val, &signer_storage, false)?;

        // Policy signers get their install hook invoked (the policy sees the
        // wallet as its authenticated invoker). A failing install aborts the
        // add — policies must opt in to being attached.
        if let SignerKey::Policy(policy) = &signer_key {
            PolicyClient::new(env, policy).install(&env.current_contract_address());
        }

        extend_instance(env);

        SignerAdded {
            key: signer_key,
            val: signer_val,
            storage: signer_storage,
        }
        .publish(env);

        Ok(())
    }
}

#[contractimpl]
impl SmartWalletInterface for Contract {
    fn __constructor(env: Env, signer: Signer) {
        // Deploy-time-only initialization (CAP-0058 constructor). There is no
        // init flag and no un-authenticated first-add path.
        if let Err(error) = Self::add_signer_impl(&env, signer) {
            panic_with_error!(env, error);
        }
    }

    fn add_signer(env: Env, signer: Signer) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        Self::add_signer_impl(&env, signer)
    }

    fn update_signer(env: Env, signer: Signer) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        let (signer_key, signer_val, signer_storage) = process_signer(signer);

        let old_storage = store_signer(&env, &signer_key, &signer_val, &signer_storage, true)?
            .ok_or(Error::SignerNotFound)?;

        extend_instance(&env);

        SignerUpdated {
            key: signer_key,
            val: signer_val,
            storage: signer_storage,
            old_storage,
        }
        .publish(&env);

        Ok(())
    }

    fn remove_signer(env: Env, signer_key: SignerKey) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        let (_, signer_storage) =
            get_signer_val_storage(&env, &signer_key, false).ok_or(Error::SignerNotFound)?;

        match &signer_storage {
            SignerStorage::Persistent => {
                env.storage().persistent().remove::<SignerKey>(&signer_key);
            }
            SignerStorage::Temporary => {
                env.storage().temporary().remove::<SignerKey>(&signer_key);
            }
        }

        // Removal is pure wallet state — NO untrusted policy code runs on this
        // critical path (audit FIX-1). Calling the policy's `uninstall` here
        // would let a malicious/broken policy block its own removal: `try_*`
        // recovers only *recoverable* contract errors, so a policy that
        // exhausts the transaction budget triggers a non-recoverable
        // Budget/Storage ExceededLimit that unwinds the whole atomic
        // transaction and rolls the removal back. Policies instead self-clean
        // their install-state via the permissionless `uninstall` entrypoint,
        // which verifies the signer is actually gone before acting.
        extend_instance(&env);

        SignerRemoved {
            key: signer_key,
            storage: signer_storage,
        }
        .publish(&env);

        Ok(())
    }

    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error> {
        env.current_contract_address().require_auth();

        let old_hash = env
            .storage()
            .instance()
            .get::<Symbol, BytesN<32>>(&WASM_HASH);

        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());

        env.storage()
            .instance()
            .set::<Symbol, BytesN<32>>(&WASM_HASH, &new_wasm_hash);

        extend_instance(&env);

        Upgraded {
            old_hash,
            new_hash: new_wasm_hash,
        }
        .publish(&env);

        Ok(())
    }

    fn get_signer(env: Env, signer_key: SignerKey) -> Option<SignerVal> {
        get_signer_val_storage(&env, &signer_key, false).map(|(signer_val, _)| signer_val)
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
        // Pass 1 — context coverage. Every context must be authorizable by at
        // least one signer in the signatures map. `verify_context` is purely
        // boolean: a candidate that can't cover a context never poisons the
        // attempt for other candidates. Expiration is deliberately NOT
        // checked here — pass 2 is the single point of truth and fails the
        // whole auth if ANY map entry is expired.
        for context in auth_contexts.iter() {
            let mut covered = false;

            for (signer_key, _) in signatures.0.iter() {
                if let Some((signer_val, _)) = get_signer_val_storage(&env, &signer_key, false) {
                    if verify_context(
                        &env,
                        &context,
                        &signer_key,
                        signer_limits(&signer_val),
                        &signatures,
                    ) {
                        covered = true;
                        break;
                    }
                }
            }

            if !covered {
                return Err(Error::MissingContext);
            }
        }

        // Pass 2 — verify EVERY signatures map entry: it must be stored on
        // this wallet, unexpired, and its signature material must verify.
        // Include only signatures that are needed; an invalid or expired
        // extra entry fails the entire authorization (deterministically,
        // regardless of map order).
        for (signer_key, signature) in signatures.0.iter() {
            let (signer_val, _) =
                get_signer_val_storage(&env, &signer_key, true).ok_or(Error::SignerNotFound)?;

            if is_signer_expired(&env, signer_expiration(&signer_val)) {
                return Err(Error::SignerExpired);
            }

            match signature {
                Signature::Policy => {
                    if let SignerKey::Policy(policy) = &signer_key {
                        // Policy-as-signature sees the FULL context list (a
                        // policy used inside another signer's limits sees one
                        // context at a time). A rejecting policy fails the
                        // whole authorization.
                        PolicyClient::new(&env, policy).policy__(
                            &env.current_contract_address(),
                            &signer_key,
                            &auth_contexts,
                        );
                    } else {
                        return Err(Error::SignatureKeyValueMismatch);
                    }
                }
                Signature::Ed25519(signature) => {
                    if let SignerKey::Ed25519(public_key) = &signer_key {
                        env.crypto().ed25519_verify(
                            public_key,
                            &signature_payload.clone().into(),
                            &signature,
                        );
                    } else {
                        return Err(Error::SignatureKeyValueMismatch);
                    }
                }
                Signature::Secp256r1(signature) => {
                    if let SignerVal::Secp256r1(public_key, _, _) = &signer_val {
                        verify_secp256r1_signature(
                            &env,
                            &signature_payload,
                            public_key,
                            signature,
                        )?;
                    } else {
                        return Err(Error::SignatureKeyValueMismatch);
                    }
                }
            }
        }

        extend_instance(&env);

        Ok(())
    }
}
