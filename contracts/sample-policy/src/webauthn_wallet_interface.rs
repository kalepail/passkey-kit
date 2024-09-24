use soroban_sdk::auth::Context;

#[soroban_sdk::contractclient(name = "Client")]
pub trait Contract {
    fn add(env: soroban_sdk::Env, signer: Signer) -> Result<(), soroban_sdk::Error>;
    fn remove(
        env: soroban_sdk::Env,
        signer_key: SignerKey,
    ) -> Result<(), soroban_sdk::Error>;
    fn update(
        env: soroban_sdk::Env,
        hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), soroban_sdk::Error>;
    fn __check_auth(
        env: soroban_sdk::Env,
        signature_payload: soroban_sdk::BytesN<32>,
        signatures: soroban_sdk::Map<SignerKey, Option<Signature>>,
        auth_contexts: soroban_sdk::Vec<Context>,
    ) -> Result<(), soroban_sdk::Error>;
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct SignerLimits(
    pub soroban_sdk::Map<soroban_sdk::Address, Option<soroban_sdk::Vec<SignerKey>>>,
);
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Secp256r1Signature {
    pub authenticator_data: soroban_sdk::Bytes,
    pub client_data_json: soroban_sdk::Bytes,
    pub signature: soroban_sdk::BytesN<64>,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerKey {
    Policy(soroban_sdk::Address),
    Ed25519(soroban_sdk::BytesN<32>),
    Secp256r1(soroban_sdk::Bytes),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerVal {
    Policy(SignerLimits),
    Ed25519(SignerLimits),
    Secp256r1(soroban_sdk::BytesN<65>, SignerLimits),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerStorage {
    Persistent,
    Temporary,
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Signer {
    Policy(soroban_sdk::Address, SignerLimits, SignerStorage),
    Ed25519(soroban_sdk::BytesN<32>, SignerLimits, SignerStorage),
    Secp256r1(soroban_sdk::Bytes, soroban_sdk::BytesN<65>, SignerLimits, SignerStorage),
}
#[soroban_sdk::contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Signature {
    Ed25519(soroban_sdk::BytesN<64>),
    Secp256r1(Secp256r1Signature),
}
#[soroban_sdk::contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Error {
    NotFound = 1,
    MissingContext = 2,
    MissingSignerLimits = 3,
    FailedPolicySignerLimits = 4,
    SignatureKeyValueMismatch = 5,
    ClientDataJsonChallengeIncorrect = 6,
    JsonParseError = 7,
}