use soroban_sdk::{contracterror, contracttype, Address, Bytes, BytesN, Map, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotFound = 1,
    AlreadyExists = 2,
    MissingContext = 3,
    SignerExpired = 4,
    FailedSignerLimits = 5,
    FailedPolicySignerLimits = 6,
    SignatureKeyValueMismatch = 7,
    ClientDataJsonChallengeIncorrect = 8,
    JsonParseError = 9,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
// Map of contexts this signer can authorize if present in the __check_auth auth_contexts list
// Map value is a list of SignerKeys which must all be present in the __check_auth signatures list in order for the signer to authorize the context
// e.g. a policy runs on a SAC token to check how much it's withdrawing and also requires a signature from an additional ed25519 signer
// e.g. an ed25519 signer can only be used to authorize a specific contract's invocations and no further keys are required
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
    Policy(Option<u32>, SignerLimits),
    Ed25519(Option<u32>, SignerLimits),
    Secp256r1(BytesN<65>, Option<u32>, SignerLimits),
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
    Policy(Address, Option<u32>, SignerLimits, SignerStorage),
    Ed25519(BytesN<32>, Option<u32>, SignerLimits, SignerStorage),
    Secp256r1(Bytes, BytesN<65>, Option<u32>, SignerLimits, SignerStorage),
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

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Signatures(pub Map<SignerKey, Option<Signature>>);
