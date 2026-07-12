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
    /// Remove a signer. Requires wallet auth. Removal is pure wallet state:
    /// NO policy code runs on this path, so a malicious or broken policy can
    /// never block its own removal. Policy signers self-clean their
    /// install-state afterwards via the permissionless `PolicyInterface::
    /// uninstall` entrypoint.
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
    /// per call when the policy is used inside another signer's limits).
    /// Panic to reject.
    ///
    /// ## Caller authentication (audit FIX-2)
    ///
    /// `policy__` is PUBLICLY CALLABLE — anyone can invoke it with an
    /// arbitrary `source` and `contexts`. Checking an "installed" marker for
    /// `source` proves only that `source` installed the policy at some point,
    /// NOT that `source` is the current caller. Every implementation MUST be
    /// one of:
    ///
    /// - **Read-only / side-effect-free** — safe to call with any arguments
    ///   because a spoofed call cannot change anything (recommended for
    ///   stateless rules). Benign self-maintenance (extending the policy's own
    ///   TTLs) is permitted and does not count as a security-relevant side
    ///   effect.
    /// - **Caller-authenticated** — call `source.require_auth()` before any
    ///   security-relevant state change (spending counters, allowances, …).
    ///   During a legitimate check the wallet is the DIRECT invoker of
    ///   `policy__`, so `source.require_auth()` is satisfied by invoker auth;
    ///   a spoofed external caller cannot satisfy it for a wallet it does not
    ///   control. (Verified to work inside `__check_auth` — see
    ///   `sample-policy`.)
    ///
    /// ## Determinism (audit FIX-7)
    ///
    /// Prefer side-effect-free policies. The wallet's pass-1 coverage search
    /// stops at the first covering signer and iterates the signatures map in
    /// host ScVal order, so a stateful policy used inside limits can observe
    /// order-dependent invocation. A read-only (or idempotent) policy is
    /// immune to this.
    ///
    /// ## Value transfers with a SECRETLESS policy (audit FIX-3b)
    ///
    /// `Signature::Policy` carries NO secret — anyone can submit it, so a
    /// policy that authorizes value transfers is authorizing them for
    /// EVERYONE. A per-transfer cap is therefore NOT a spending limit: it is
    /// trivially bypassed by repeating capped transfers to drain the wallet.
    /// A value-moving policy is only safe when it is one (ideally both) of:
    ///
    /// - a CUMULATIVE / rate-limited allowance that bounds total spend over a
    ///   window (so worst-case loss is bounded — see `sample-policy`), and/or
    /// - paired, via the granting signer's `SignerLimits`, with an
    ///   authenticated cryptographic co-signer, so the bounded amount still
    ///   requires a real signature to move.
    ///
    /// Never ship a policy that authorizes transfers under only an
    /// unbounded per-transfer cap.
    fn policy__(env: Env, source: Address, signer: SignerKey, contexts: Vec<Context>);
    /// Lifecycle hook invoked by a wallet when this policy is added as a
    /// signer (from `add_signer`/`__constructor`). The wallet is the direct
    /// invoker, so `wallet.require_auth()` here is satisfied by invoker auth
    /// and authenticates the wallet. This is a HARD call — a panic aborts the
    /// `add_signer`, so a policy can legitimately refuse to be installed.
    /// Set up any per-wallet state here.
    fn install(env: Env, wallet: Address);
    /// PERMISSIONLESS self-clean entrypoint (audit FIX-1). The wallet does
    /// NOT call this on removal; anyone may call it at any time. An
    /// implementation MUST verify the policy is genuinely no longer a signer
    /// on `wallet` — e.g. `SmartWalletClient::new(env,
    /// wallet).get_signer(SignerKey::Policy(current_contract)).is_none()` —
    /// before clearing any per-wallet install-state, so a griefer cannot
    /// clear state for a wallet where the policy is still installed.
    fn uninstall(env: Env, wallet: Address);
}
