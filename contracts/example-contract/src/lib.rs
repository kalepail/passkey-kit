#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn call(_env: Env, address: Address) -> u32 {
        address.require_auth();
        8891
    }
}
