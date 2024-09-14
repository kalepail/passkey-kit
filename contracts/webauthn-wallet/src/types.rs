use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Map, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    NotAuthorized = 2,
    RequirePersistentAdmin = 3,
    MissingSignerKeys = 4,
    BadSignatureOrder = 5,
    ClientDataJsonChallengeIncorrect = 6,
    JsonParseError = 7,
    MissingSignatures = 8,
    SignatureKeyValueMismatch = 9,
    InvalidSignatureForSignerKey = 10,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
// Map of contexts this signer can authorize if present in the __check_auth auth_contexts list
// Map value is a list of SignerKeys which must all be present in the __check_auth signatures list in order for the signer to authorize the context
pub struct SignerLimits(pub Map<Address, Option<Vec<SignerKey>>>);

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SignerKey {
    Policy(Address),
    Ed25519(BytesN<32>),
    Secp256r1(Bytes),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SignerVal {
    Policy(SignerLimits),
    Ed25519(SignerLimits),
    Secp256r1(BytesN<65>, SignerLimits),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SignerStorage {
    Persistent,
    Temporary,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Signer {
    Policy(Address, SignerLimits, SignerStorage),
    Ed25519(BytesN<32>, SignerLimits, SignerStorage),
    Secp256r1(Bytes, BytesN<65>, SignerLimits, SignerStorage),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Secp256r1Signature {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Signature {
    Ed25519(BytesN<64>),
    Secp256r1(Secp256r1Signature),
}
