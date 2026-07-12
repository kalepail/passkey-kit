//! Sample policy demonstrating the smart wallet policy lifecycle.
//!
//! `policy__` is publicly callable — anyone can invoke it with arbitrary
//! arguments — so a policy holding any per-wallet state MUST gate on wallets
//! that actually installed it. The wallet invokes `install`/`uninstall` as
//! the direct cross-contract caller, so `wallet.require_auth()` inside the
//! hooks passes via invoker auth for legitimate calls and requires a real
//! wallet authorization for anyone else.
//!
//! This sample rejects `transfer` invocations over 10_000_000 stroops for
//! installed wallets, and rejects everything for wallets that never
//! installed it.

#![no_std]

use smart_wallet_interface::{types::SignerKey, PolicyInterface};
use soroban_sdk::{
    auth::{Context, ContractContext},
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, TryFromVal, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PolicyError {
    NotAllowed = 1,
    NotInstalled = 2,
}

const TRANSFER_LIMIT: i128 = 10_000_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageKey {
    Installed(Address),
}

#[contract]
pub struct Contract;

#[contractimpl]
impl PolicyInterface for Contract {
    fn install(env: Env, wallet: Address) {
        wallet.require_auth();

        env.storage()
            .persistent()
            .set::<StorageKey, bool>(&StorageKey::Installed(wallet), &true);
    }

    fn uninstall(env: Env, wallet: Address) {
        wallet.require_auth();

        env.storage()
            .persistent()
            .remove::<StorageKey>(&StorageKey::Installed(wallet));
    }

    fn policy__(env: Env, source: Address, _signer: SignerKey, contexts: Vec<Context>) {
        if !env
            .storage()
            .persistent()
            .has::<StorageKey>(&StorageKey::Installed(source))
        {
            panic_with_error!(&env, PolicyError::NotInstalled)
        }

        for context in contexts.iter() {
            match context {
                Context::Contract(ContractContext { fn_name, args, .. }) => {
                    if fn_name == symbol_short!("transfer") {
                        if let Some(amount_val) = args.get(2) {
                            if let Ok(amount) = i128::try_from_val(&env, &amount_val) {
                                if amount > TRANSFER_LIMIT {
                                    panic_with_error!(&env, PolicyError::NotAllowed)
                                }
                            }
                        }
                    }
                }
                _ => panic_with_error!(&env, PolicyError::NotAllowed),
            }
        }
    }
}
