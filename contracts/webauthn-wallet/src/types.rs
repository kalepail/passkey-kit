use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    NotPermitted = 2,
    BadSignatureOrder = 3,
    ClientDataJsonChallengeIncorrect = 4,
    Secp256r1PublicKeyParse = 5,
    Secp256r1SignatureParse = 6,
    Secp256r1VerifyFailed = 7,
    JsonParseError = 8,
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
    Policy(Policy),
    Ed25519(Ed25519Signature),
    Secp256r1(Secp256r1Signature),
}
