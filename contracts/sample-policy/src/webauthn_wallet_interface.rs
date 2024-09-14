use soroban_sdk::auth::Context;

#[soroban_sdk::contractclient(name = "Client")]
pub trait Contract {
    fn add(env: soroban_sdk::Env, signer: Signer) -> Result<(), soroban_sdk::Error>;
    fn remove(env: soroban_sdk::Env, signer_key: SignerKey) -> Result<(), soroban_sdk::Error>;
    fn update(
        env: soroban_sdk::Env,
        hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), soroban_sdk::Error>;
    fn __check_auth(
        env: soroban_sdk::Env,
        signature_payload: soroban_sdk::BytesN<32>,
        signatures: soroban_sdk::Vec<Signature>,
        auth_contexts: soroban_sdk::Vec<Context>,
    ) -> Result<(), soroban_sdk::Error>;
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Policy(pub soroban_sdk::Address);
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Ed25519PublicKey(pub soroban_sdk::BytesN<32>);
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Secp256r1Id(pub soroban_sdk::Bytes);
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Secp256r1PublicKey(pub soroban_sdk::BytesN<65>);
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct PolicySignature {
    pub policy: Policy,
    pub signer_keys: soroban_sdk::Vec<SignerKey>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Ed25519Signature {
    pub public_key: Ed25519PublicKey,
    pub signature: soroban_sdk::BytesN<64>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Secp256r1Signature {
    pub authenticator_data: soroban_sdk::Bytes,
    pub client_data_json: soroban_sdk::Bytes,
    pub id: Secp256r1Id,
    pub signature: soroban_sdk::BytesN<64>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerStorage {
    Persistent,
    Temporary,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerType {
    Admin,
    Basic,
    Policy,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerKey {
    Policy(Policy),
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerVal {
    Policy(SignerType),
    Ed25519(SignerType),
    Secp256r1(Secp256r1PublicKey, SignerType),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Signer {
    Policy(Policy, SignerStorage, SignerType),
    Ed25519(Ed25519PublicKey, SignerStorage, SignerType),
    Secp256r1(Secp256r1Id, Secp256r1PublicKey, SignerStorage, SignerType),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Signature {
    Policy(PolicySignature),
    Ed25519(Ed25519Signature),
    Secp256r1(Secp256r1Signature),
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Error {
    NotFound = 1,
    NotAuthorized = 2,
    RequirePersistentAdmin = 3,
    MissingSignerKeys = 4,
    BadSignatureOrder = 5,
    ClientDataJsonChallengeIncorrect = 6,
    JsonParseError = 7,
}
