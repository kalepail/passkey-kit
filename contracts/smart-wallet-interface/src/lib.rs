#![no_std]

use soroban_sdk::{auth::Context, contractclient, Address, BytesN, Env, Vec};
use types::{Error, Signer, SignerKey, SignerVal};

pub mod events;
pub mod types;

#[contractclient(name = "SmartWalletClient")]
pub trait SmartWalletInterface {
    /// Initialize the wallet with its first signer. Deploy-time only
    /// (CAP-0058); there is no other initialization path and no
    /// un-authenticated `add_signer` window.
    fn __constructor(env: Env, signer: Signer);
    /// Add a new signer. Requires wallet auth. Fails if the signer key
    /// already exists. Policy signers get their `install` hook invoked.
    fn add_signer(env: Env, signer: Signer) -> Result<(), Error>;
    /// Replace an existing signer's value and/or storage durability.
    /// Requires wallet auth. Fails if the signer key does not exist.
    fn update_signer(env: Env, signer: Signer) -> Result<(), Error>;
    /// Remove a signer. Requires wallet auth. Policy signers get their
    /// `uninstall` hook invoked (best-effort: a failing or malicious policy
    /// cannot block its own removal).
    fn remove_signer(env: Env, signer_key: SignerKey) -> Result<(), Error>;
    /// Replace the contract's wasm. Requires wallet auth. Emits `Upgraded`.
    fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), Error>;
    /// Return the stored signer value for a key, or `None` if not stored.
    /// Returns the raw stored value — expiration is NOT filtered; check
    /// `SignerExpiration` client-side.
    fn get_signer(env: Env, signer_key: SignerKey) -> Option<SignerVal>;
}

#[contractclient(name = "PolicyClient")]
pub trait PolicyInterface {
    /// Authorization check invoked by a smart wallet during `__check_auth`.
    /// `source` is the wallet, `signer` is the signer key the check is being
    /// performed for, `contexts` is what is being authorized (the full
    /// context list when the policy is used as a signature; a single context
    /// when the policy is used inside another signer's limits). Panic to
    /// reject.
    ///
    /// PUBLICLY CALLABLE: anyone can invoke `policy__` with arbitrary
    /// arguments. Stateful policies MUST gate on wallets that actually
    /// installed them (see `install`) and MUST NOT trust `source` otherwise.
    fn policy__(env: Env, source: Address, signer: SignerKey, contexts: Vec<Context>);
    /// Lifecycle hook invoked by a wallet when this policy is added as a
    /// signer. Implementations should `wallet.require_auth()` — the wallet is
    /// the direct invoker, so invoker auth makes this trustworthy — and set
    /// up any per-wallet state.
    fn install(env: Env, wallet: Address);
    /// Lifecycle hook invoked by a wallet when this policy is removed. The
    /// wallet invokes this best-effort: a panic here does not block removal.
    fn uninstall(env: Env, wallet: Address);
}
