use soroban_sdk::{contractclient, contracterror, contracttype, Address, Bytes, BytesN, Env, Vec};

// NOTE It seems dumb we have to dupe this stuff just to use the `wallet::Signer` type as a function arg, but it wasn't working without this
// https://discord.com/channels/897514728459468821/1281696488199553025

#[contractclient(name = "Client")]
pub trait Contract {
    fn add(env: Env, signer: Signer, admin: bool) -> Result<(), Error>;
}

#[contracttype(export = true)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Policy(pub Address);

#[contracttype(export = true)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Ed25519PublicKey(pub BytesN<32>);

#[contracttype(export = true)]
#[derive(Debug, Clone, Eq, PartialEq, Ord, PartialOrd)]
pub struct Secp256r1Id(pub Bytes);

#[contracttype(export = true)]
#[derive(Clone, Debug, PartialEq)]
pub struct Secp256r1PublicKey(pub BytesN<65>);

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum SignerKey {
    Policy(Policy),
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id),
}

#[contracttype(export = true)]
#[derive(Clone, Debug, PartialEq)]
pub enum PolicySigner {
    Policy(Policy),
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id, Secp256r1PublicKey),
}

#[contracttype(export = true)]
#[derive(Clone, Debug, PartialEq)]
pub enum Signer {
    Policy(Policy, Vec<PolicySigner>),
    Ed25519(Ed25519PublicKey),
    Secp256r1(Secp256r1Id, Secp256r1PublicKey),
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
