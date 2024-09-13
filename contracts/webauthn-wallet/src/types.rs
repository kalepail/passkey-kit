use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    NotAuthorized = 2,
    RequirePersistentAdmin = 3,
    TooManySignatures = 4,
    BadSignatureOrder = 5,
    ClientDataJsonChallengeIncorrect = 6,
    JsonParseError = 7,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Policy(pub Address);

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Ed25519PublicKey(pub BytesN<32>);

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Secp256r1Id(pub Bytes);

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Secp256r1PublicKey(pub BytesN<65>);

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SignerStorage {
    Persistent,
    Temporary,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SignerType {
    Admin,
    Basic,
    Policy,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SignerKey {
    Policy(Policy),
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SignerVal {
    Policy(SignerType),
    Ed25519(SignerType),
    Secp256r1(Secp256r1PublicKey, SignerType),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Signer {
    Policy(Policy, SignerStorage, SignerType),
    Ed25519(Ed25519PublicKey, SignerStorage, SignerType),
    Secp256r1(Secp256r1Id, Secp256r1PublicKey, SignerStorage, SignerType),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PolicySignature {
    pub policy: Policy,
    pub signer_keys: Vec<SignerKey>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Ed25519Signature {
    pub public_key: Ed25519PublicKey,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Secp256r1Signature {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub id: Secp256r1Id,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum Signature {
    Policy(PolicySignature),
    Ed25519(Ed25519Signature),
    Secp256r1(Secp256r1Signature),
}
