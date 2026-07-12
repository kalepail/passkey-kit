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
    /// The authenticator did not set the User Present (UP) flag. User
    /// Verification (UV) is deliberately NOT required; requiring UP only
    /// keeps silent, non-interactive assertions out while remaining
    /// compatible with authenticators that don't do user verification.
    UserPresenceRequired = 125,
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
///   of contract `address` only if every listed key also passes: non-policy
///   keys must be present in the transaction's signatures map (and therefore
///   fully verified in pass 2 of `__check_auth`); policy keys are invoked via
///   `policy__` for the specific context (and, if the policy key is also
///   stored on this wallet, its own stored limits are verified recursively,
///   bounded by a fixed depth guard).
///
/// Notes:
/// - Deploy permission is NOT grantable through limits: `CreateContract*`
///   contexts require an unlimited (`None`) signer. (Pre-1.0 a limits entry
///   for the wallet's own address doubled as deploy permission.)
/// - A limited signer may ALWAYS authorize `remove_signer(its own key)` on
///   this wallet, regardless of its limits map, and without co-signer
///   requirements. Self-removal is never escalation.
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
