use soroban_sdk::{contracterror, contracttype, Bytes, BytesN};

#[contracterror]
#[derive(Copy, Clone, Debug)]
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
#[derive(Clone, PartialEq)]
pub struct Ed25519PublicKey(pub BytesN<32>);

#[contracttype]
#[derive(Clone, PartialEq)]
pub struct Secp256r1Id(pub Bytes);

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum KeyId {
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id),
}

#[contracttype]
#[derive(Clone)]
pub struct Ed25519Signature {
    pub public_key: Ed25519PublicKey,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone)]
pub struct Secp256r1Signature {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub id: Secp256r1Id,
    pub signature: BytesN<64>,
}

#[contracttype]
#[derive(Clone)]
pub enum Signature {
    Ed25519(Ed25519Signature),
    Secp256r1(Secp256r1Signature),
}
