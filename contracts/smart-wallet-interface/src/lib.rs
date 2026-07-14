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
    ///
    /// The first signer MUST be durable — stored `Persistent` with
    /// `SignerExpiration(None)` (any limits) — or the constructor fails with
    /// `Error::LastSigner`: a wallet born with only a Temporary or expiring
    /// signer could reach zero live signers with no contract call to stop it.
    fn __constructor(env: Env, signer: Signer);
    /// Add a new signer. Requires wallet auth. Fails if the signer key
    /// already exists. Policy signers get their `install` hook invoked.
    fn add_signer(env: Env, signer: Signer) -> Result<(), Error>;
    /// Replace an existing signer's value and/or storage durability.
    /// Requires wallet auth. Fails if the signer key does not exist. Fails
    /// with `Error::LastAdminSigner`/`Error::LastSigner` if the update would
    /// demote the wallet's last durable admin / last durable signer (see
    /// `remove_signer` — a demotion to Temporary or to an expiring value is
    /// treated the same as a removal, deferred).
    fn update_signer(env: Env, signer: Signer) -> Result<(), Error>;
    /// Remove a signer. Requires wallet auth. Removal is pure wallet state:
    /// NO policy code runs on this path, so a rejecting or broken policy can
    /// never block its own removal. Policy signers self-clean their
    /// install-state afterwards via the permissionless `PolicyInterface::
    /// uninstall` entrypoint.
    ///
    /// Fails with `Error::LastAdminSigner` if the target is the wallet's
    /// LAST durable admin signer (`Persistent` + non-expiring + independently
    /// admin-capable: unlimited, or a wallet-self limits entry with no
    /// required co-signers): with zero such signers no `add_signer`/`upgrade`
    /// could ever be authorized again, and the contract code is immutable.
    /// `update_signer` rejects demoting the last durable admin for
    /// the same reason.
    ///
    /// Fails with `Error::LastSigner` if the target is the wallet's LAST
    /// DURABLE signer (`Persistent` + non-expiring, any limits) — the
    /// backstop beneath the admin classification. Non-durable signers evict
    /// or expire with no contract call, so only a durable signer guarantees
    /// the wallet keeps at least one live signer; the wallet is born with
    /// one (`__constructor` requires it) and every durable one-to-zero
    /// transition is rejected, making a zero-live-signer wallet unreachable.
    /// Rotation is unaffected: add the durable replacement first, then
    /// remove the old signer.
    fn remove_signer(env: Env, signer_key: SignerKey) -> Result<(), Error>;
    /// Replace the contract's wasm. Requires wallet auth. Emits `Upgraded`.
    ///
    /// The host verifies the wasm EXISTS (an unknown hash rolls the whole
    /// transaction back), but cannot verify it is COMPATIBLE: upgrading to an
    /// uploaded-but-incompatible wasm still takes effect. An in-contract
    /// interface probe is impossible — the new wasm only takes effect after
    /// the current invocation completes — so clients MUST verify the target
    /// hash out-of-band (e.g. against a published manifest) before invoking.
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
    /// ## Caller authentication
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
    /// ## Determinism
    ///
    /// Prefer side-effect-free policies. The wallet's pass-1 coverage search
    /// stops at the first covering signer and iterates the signatures map in
    /// host ScVal order, so a stateful policy used inside limits can observe
    /// order-dependent invocation. A read-only (or idempotent) policy is
    /// immune to this.
    ///
    /// ## Invocation ordering for state-committing policies
    ///
    /// When used inside another signer's limits, `policy__` is invoked only
    /// AFTER every side-effect-free requirement of that candidate has passed
    /// (co-signer presence, stored-policy expiration), so a value-committing
    /// policy is not charged for a candidate that was going to fail anyway.
    /// A policy key duplicated within one required-keys list is invoked only
    /// once (deduplicated). Residual: with two or more DISTINCT policies in
    /// ONE required-keys list, an earlier policy's committed state survives a
    /// later policy's rejection if the authorization ultimately succeeds
    /// through another candidate — do NOT combine multiple state-committing
    /// policies in a single required-keys entry. A policy used simultaneously as a
    /// `Signature::Policy` map entry AND as a required limit key in the same
    /// authorization is invoked in both roles (and will commit in both).
    ///
    /// ## Self-removal
    ///
    /// `policy__` is NOT consulted when the only context being authorized is
    /// this policy signer's own `remove_signer` on the wallet: a signer can
    /// always self-remove, so a rejecting or broken policy cannot block its
    /// own removal. Do not rely on `policy__` to keep the policy installed.
    /// (Removal of a wallet's LAST signer — or last durable admin — is still
    /// rejected at execution: `Error::LastSigner`/`Error::LastAdminSigner`.)
    ///
    /// ## Do not make a policy your only admin
    ///
    /// The wallet counts an admin-shaped policy signer as a durable admin —
    /// it cannot statically know whether the policy will APPROVE admin
    /// requests. A rejecting policy left as the sole remaining admin makes
    /// the wallet's admin surface unrecoverable even though the signer still
    /// exists (the last-signer/last-admin guards keep it stored, but it
    /// approves nothing). Always keep a non-policy admin, or a second admin,
    /// on the wallet.
    ///
    /// ## Value transfers with a SECRETLESS policy
    ///
    /// `Signature::Policy` carries NO secret — anyone can submit it, so a
    /// policy that authorizes value transfers is authorizing them for
    /// EVERYONE. A per-transfer cap is therefore NOT a spending limit:
    /// repeated capped transfers can move the wallet's full balance.
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
    /// PERMISSIONLESS self-clean entrypoint. The wallet does
    /// NOT call this on removal; anyone may call it at any time. An
    /// implementation MUST verify the policy is genuinely no longer a signer
    /// on `wallet` — e.g. `SmartWalletClient::new(env,
    /// wallet).get_signer(SignerKey::Policy(current_contract)).is_none()` —
    /// before clearing any per-wallet install-state, so a griefer cannot
    /// clear state for a wallet where the policy is still installed.
    fn uninstall(env: Env, wallet: Address);
}
