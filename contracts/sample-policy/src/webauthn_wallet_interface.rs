use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Vec};

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Policy(pub Address);

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Ed25519PublicKey(pub BytesN<32>);

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Secp256r1Id(pub Bytes);

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Secp256r1PublicKey(pub BytesN<65>);

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Ed25519Signature {
    pub public_key: Ed25519PublicKey,
    pub signature: BytesN<64>,
}

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Secp256r1Signature {
    pub authenticator_data: Bytes,
    pub client_data_json: Bytes,
    pub id: Secp256r1Id,
    pub signature: BytesN<64>,
}

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerKey {
    Policy(Policy),
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id),
}

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum PolicySigner {
    Policy(Policy),
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id, Secp256r1PublicKey),
}

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum SignerVal {
    Policy(Vec<PolicySigner>),
    Secp256r1(Secp256r1PublicKey),
}

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Signer {
    Policy(Policy, Vec<PolicySigner>),
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id, Secp256r1PublicKey),
}

#[contracttype(export = false)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub enum Signature {
    Policy(Policy),
    Ed25519(Ed25519Signature),
    Secp256r1(Secp256r1Signature),
}

#[contracterror(export = false)]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Ord, PartialOrd)]
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