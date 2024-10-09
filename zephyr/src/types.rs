use serde::Serialize;
use zephyr_sdk::{
    bincode,
    prelude::{Limits, ReadXdr, WriteXdr},
    soroban_sdk::xdr::ScVal,
    Condition, DatabaseDerive, DatabaseInteract, EnvClient, ZephyrVal,
};

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct Signers {
    pub address: ScVal,
    pub key: ScVal,
    pub val: ScVal,
    pub limits: ScVal,
    pub exp: u32,
    pub storage: ScVal,
    pub active: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersKeyValLimitsExpStorage {
    pub key: ScVal,
    pub val: ScVal,
    pub limits: ScVal,
    pub exp: u32,
    pub storage: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersValLimitsExpStorageActive {
    pub val: ScVal,
    pub limits: ScVal,
    pub exp: u32,
    pub storage: ScVal,
    pub active: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersAddress {
    pub address: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone, Debug)]
#[with_name("signers")]
pub struct SignersActive {
    pub active: ScVal,
}
