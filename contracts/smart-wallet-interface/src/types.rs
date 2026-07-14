use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Map, Vec};

/// Contract errors.
///
/// Deliberately renumbered for the v1 interface so the error space is disjoint
/// from the legacy (pre-1.0) contract's 1-9 range. A client decoding an error
/// code < 100 is talking to a legacy wallet.
///
/// Ranges:
/// - 100-109: signer storage / management
/// - 110-119: auth (`__check_auth`)
/// - 120-129: WebAuthn (secp256r1) verification
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    /// The requested signer does not exist on this smart wallet.
    SignerNotFound = 100,
    /// `add_signer` was called with a signer key that already exists.
    SignerAlreadyExists = 101,
    /// The signer's expiration timestamp is in the past.
    SignerExpired = 102,
    /// The operation would remove — or demote via `update_signer` — the
    /// wallet's LAST durable admin signer: a signer stored `Persistent`,
    /// non-expiring (`SignerExpiration(None)`), and independently
    /// admin-capable — either unlimited (`SignerLimits(None)`) or holding a
    /// limits entry for the wallet's own address with no required co-signers
    /// (`None` or an empty list). With zero such signers no `add_signer` or
    /// `upgrade` could ever be authorized again, permanently locking the
    /// wallet on an immutable network, so the transition is rejected.
    /// To retire the last admin signer, add (or promote) a replacement
    /// durable admin signer first.
    ///
    /// Case this guard CANNOT catch (statically undecidable): a POLICY
    /// signer with an admin-shaped grant counts as an admin even if its
    /// `policy__` rejects every request. If such a policy is your only
    /// remaining admin, the wallet's admin surface is unrecoverable even
    /// though the signer still exists. Keep a non-policy admin (or a second
    /// admin) at all times.
    LastAdminSigner = 103,
    /// The operation would leave the wallet without any DURABLE signer — one
    /// stored `Persistent` with `SignerExpiration(None)`, any limits. Fired
    /// by `remove_signer` (removing the last durable signer), `update_signer`
    /// (demoting it to `Temporary` storage or to an expiring value), and
    /// `__constructor` (the wallet's first signer must be durable).
    /// Non-durable signers can evict or expire with NO contract
    /// call, so only a durable signer guarantees the wallet always keeps at
    /// least one live signer; with zero live signers nothing — not even
    /// `add_signer` — can ever be authorized again. This is the
    /// classification-independent backstop beneath `LastAdminSigner`. To
    /// retire the last durable signer, add a durable replacement first.
    LastSigner = 104,

    /// No signer in the signatures map is permitted to authorize one of the
    /// requested auth contexts.
    MissingContext = 110,
    /// A signature's variant does not match the stored signer it claims to be
    /// for (e.g. an Ed25519 signature submitted for a Policy signer key).
    SignatureKeyValueMismatch = 111,

    /// clientDataJSON exceeds the 1024 byte parse buffer.
    ClientDataJsonTooLarge = 120,
    /// clientDataJSON is not parseable JSON (or is missing required fields).
    ClientDataJsonParseError = 121,
    /// The challenge in clientDataJSON does not match the base64url-encoded
    /// signature payload. This binds the WebAuthn assertion to the Soroban
    /// authorization entry and MUST NOT be weakened.
    ClientDataJsonChallengeIncorrect = 122,
    /// clientDataJSON `type` is not "webauthn.get".
    InvalidWebAuthnType = 123,
    /// authenticatorData is shorter than the WebAuthn minimum of 37 bytes
    /// (rpIdHash 32 + flags 1 + signCount 4).
    InvalidAuthenticatorData = 124,
    /// The authenticator did not set the User Present (UP) flag.
    ///
    /// UP-only is the deliberate default. Requiring UP keeps
    /// silent, non-interactive assertions out while staying compatible with
    /// authenticators that cannot do User Verification (UV — biometric/PIN).
    /// UV is therefore NOT required by this contract. A deployment that wants
    /// UV-required assertions should enforce it at the client/relayer layer,
    /// or via a future per-signer flag (which would be a signer-model change,
    /// not a change to this check); the contract cannot upgrade UP-only
    /// signers to UV-required retroactively without such a flag.
    UserPresenceRequired = 125,
    /// authenticatorData exceeds the 1024 byte cap (symmetric with
    /// `ClientDataJsonTooLarge`). Real assertions are ~37 bytes; the cap
    /// rejects oversized input BEFORE it is hashed, since this path is
    /// reachable without a valid signature.
    AuthenticatorDataTooLarge = 126,
}

/// Optional expiration for a signer as a UNIX timestamp in seconds, INCLUSIVE:
/// the signer is valid while `ledger timestamp <= expiration` and expired once
/// `ledger timestamp > expiration`. `None` never expires.
///
/// v1 breaking change: this was a ledger sequence number pre-1.0. Timestamps
/// don't drift with changes to ledger close time (e.g. CAP-0070 dynamic
/// timing), which ledger-sequence expirations did.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerExpiration(pub Option<u64>);

/// Restrictions on which auth contexts a signer may authorize.
///
/// - `None`: unlimited. The signer can authorize anything, including
///   `CreateContract*` (deploy) contexts and this wallet's own admin
///   functions.
/// - `Some(empty map)`: NO permissions (fail-closed). The signer can authorize
///   nothing except removing itself (see below). v1 breaking change: pre-1.0
///   an empty map meant unlimited, leaving two unlimited encodings and no
///   "none" encoding.
/// - `Some({address -> None})`: the signer may authorize any invocation of
///   contract `address`, with no co-signers required.
/// - `Some({address -> Some([keys])})`: the signer may authorize invocations
///   of contract `address` only if every listed key also APPROVES. The listed
///   keys are required CO-SIGNERS.
///
/// ## Required co-signers are scope-independent approvers
///
/// A required co-signer's OWN `SignerLimits` do NOT constrain its co-signer
/// role — a key's limits govern only its INDEPENDENT authority (whether it can
/// cover a context on its own). This is symmetric across key kinds:
///
/// - A non-policy required key must be present in the transaction's signatures
///   map (and is therefore fully verified — stored, unexpired, crypto-valid —
///   in pass 2 of `__check_auth`). Its own limits are not consulted.
/// - A policy required key must APPROVE the specific context via `policy__`
///   (it need not appear in the signatures map). If the policy key is also
///   stored on this wallet it must be unexpired, but its own stored limits are
///   NOT recursively enforced.
///
/// Consequence: `Some(empty map)` on a key disables that key's INDEPENDENT
/// coverage only. A key with empty limits can still serve as a required
/// co-signer for another signer. Because no stored policy's limits are
/// re-entered, there is no policy-limit recursion (and thus no cycle to
/// guard against).
///
/// Notes:
/// - Deploy permission is NOT grantable through limits: `CreateContract*`
///   contexts require an unlimited (`None`) signer. (Pre-1.0 a limits entry
///   for the wallet's own address doubled as deploy permission.)
/// - A limited signer may ALWAYS authorize `remove_signer(its own key)` on
///   this wallet, regardless of its limits map, and without co-signer
///   requirements. Self-removal is never escalation. (Execution still
///   rejects removing the wallet's last durable admin signer — see
///   `Error::LastAdminSigner`.)
/// - Granting a limits entry for the wallet's own address grants the wallet's
///   admin surface (`add_signer`, `update_signer`, `remove_signer`,
///   `upgrade`). A signer that can add signers can add an unlimited signer,
///   so treat such a grant as equivalent to full control of the wallet.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerLimits(pub Option<Map<Address, Option<Vec<SignerKey>>>>);

/// Which durability a signer entry is stored under. At most one entry exists
/// per signer key; lookups check Temporary before Persistent.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SignerStorage {
    Persistent,
    Temporary,
}

/// Full signer description used by `__constructor`, `add_signer` and
/// `update_signer`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Signer {
    Policy(Address, SignerExpiration, SignerLimits, SignerStorage),
    Ed25519(BytesN<32>, SignerExpiration, SignerLimits, SignerStorage),
    Secp256r1(
        Bytes,
        BytesN<65>,
        SignerExpiration,
        SignerLimits,
        SignerStorage,
    ),
}

/// Storage key identifying a signer. Secp256r1 carries the WebAuthn
/// credential id (`keyId`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SignerKey {
    Policy(Address),
    Ed25519(BytesN<32>),
    Secp256r1(Bytes),
}

/// Stored signer value. Secp256r1 carries the SEC-1 uncompressed public key.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SignerVal {
    Policy(SignerExpiration, SignerLimits),
    Ed25519(SignerExpiration, SignerLimits),
    Secp256r1(BytesN<65>, SignerExpiration, SignerLimits),
}

/// A WebAuthn assertion over the Soroban authorization payload. The signed
/// message is `authenticator_data || sha256(client_data_json)` and the
/// payload binding lives in clientDataJSON's `challenge` field.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Secp256r1Signature {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub signature: BytesN<64>,
}

/// A signature entry in the signatures map. `Policy` carries no signature
/// material: inclusion of the policy key authorizes an on-chain `policy__`
/// check instead.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Signature {
    Policy,
    Ed25519(BytesN<64>),
    Secp256r1(Secp256r1Signature),
}

/// The `__check_auth` signature object: a map of signer keys to signatures.
/// Map ordering is the host's ScVal ordering. EVERY entry must verify (pass
/// 2 of `__check_auth`) — include only signatures that are needed.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signatures(pub Map<SignerKey, Signature>);
