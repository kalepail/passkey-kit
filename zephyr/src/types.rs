use serde::Serialize;
use zephyr_sdk::{
    prelude::{Limits, WriteXdr},
    soroban_sdk::xdr::{ReadXdr, ScVal},
    Condition, DatabaseDerive, DatabaseInteract, EnvClient,
};

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct Signers {
    pub address: ScVal,
    pub key: ScVal,
    pub val: ScVal,
    pub active: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersKeyVal {
    pub key: ScVal,
    pub val: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersValActive {
    pub val: ScVal,
    pub active: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersAddress {
    pub address: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersActive {
    pub active: ScVal,
}
