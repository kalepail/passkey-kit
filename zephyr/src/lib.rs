use serde::{Deserialize, Serialize};
use stellar_strkey::Contract;
use webauthn_wallet::types::Signer;
use zephyr_sdk::{
    prelude::*, soroban_sdk::{
        BytesN, Symbol,
    }, utils::address_to_alloc_string, DatabaseDerive, EnvClient
};

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct Signers {
    address: String,
    id: Vec<u8>, // TODO store this as a String vs a Vec I think
    pk: Vec<u8>, // TODO store this as Optional, maybe an ScVal
    date: u64,
    admin: i32, // because zephyr doesn't support bools
    active: i32, // because zephyr doesn't support bools
}
#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersPkDateAdminActive {
    pk: Vec<u8>, // TODO store this as Optional, maybe an ScVal
    date: u64,
    admin: i32, // because zephyr doesn't support bools
    active: i32, // because zephyr doesn't support bools
}
#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersActive {
    active: i32, // because zephyr doesn't support bools
}

#[no_mangle]
pub extern "C" fn on_close() {
    let env = EnvClient::new();
    let event_tag = Symbol::new(env.soroban(), "sw_v1");

    for event in env.reader().pretty().soroban_events() {
        if let Some(topic0) = event.topics.get(0) {
            let t0 = env.try_from_scval::<Symbol>(topic0);

            if let Ok(t0) = t0 {
                if let Some(topic1) = event.topics.get(1) {
                    let event_type = env.try_from_scval::<Symbol>(topic1);

                    if let Ok(etype) = event_type {
                        if t0 == event_tag {
                            if etype == Symbol::new(env.soroban(), "add") {
                                let address = Contract(event.contract).to_string();
                                let id = match env.from_scval::<Signer>(&event.topics[2]) {
                                    Signer::Policy(policy) => {
                                        address_to_alloc_string(&env, policy.0).as_bytes().to_vec()
                                    }
                                    Signer::Ed25519(public_key) => {
                                        public_key.0.to_array().to_vec()
                                    }
                                    Signer::Secp256r1(id) => {
                                        id.0.to_alloc_vec()
                                    }
                                };
                                let date = env.reader().ledger_timestamp();
                                let (pk, admin): (Vec<u8>, i32) = {
                                    let (pk, admin): (Option<BytesN<65>>, bool) = env.from_scval(&event.data);
                                    (
                                        pk.map_or_else(Vec::new, |pk| pk.to_array().to_vec()),
                                        if admin { 1 } else { 0 }
                                    )
                                };

                                let mut older: Vec<SignersPkDateAdminActive> = env
                                    .read_filter()
                                    .column_equal_to("address", address.clone())
                                    .column_equal_to("id", id.clone())
                                    .read()
                                    .unwrap();

                                if let Some(older) = older.get_mut(0) {
                                    older.pk = pk;
                                    older.date = date;
                                    older.admin = admin as i32;
                                    older.active = 1;

                                    env.update()
                                        .column_equal_to("address", address)
                                        .column_equal_to("id", id)
                                        .execute(older)
                                        .unwrap();
                                } else {
                                    let signer = Signers {
                                        address,
                                        id,
                                        pk,
                                        date,
                                        admin: admin as i32,
                                        active: 1,
                                    };

                                    env.put(&signer);
                                }
                            } else if etype == Symbol::new(env.soroban(), "remove") {
                                let address = Contract(event.contract).to_string();
                                let id = match env.from_scval::<Signer>(&event.topics[2]) {
                                    Signer::Policy(policy) => {
                                        address_to_alloc_string(&env, policy.0).as_bytes().to_vec()
                                    }
                                    Signer::Ed25519(public_key) => {
                                        public_key.0.to_array().to_vec()
                                    }
                                    Signer::Secp256r1(id) => {
                                        id.0.to_alloc_vec()
                                    }
                                };
                                let mut older: Vec<SignersActive> = env
                                    .read_filter()
                                    .column_equal_to("address", address.clone())
                                    .column_equal_to("id", id.clone())
                                    .read()
                                    .unwrap();

                                if let Some(older) = older.get_mut(0) {
                                    older.active = 0;

                                    env.update()
                                        .column_equal_to("address", address)
                                        .column_equal_to("id", id)
                                        .execute(older)
                                        .unwrap();
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[derive(Deserialize)]
pub struct QueryByAddressRequest {
    address: String,
}

#[derive(Deserialize)]
pub struct AddressBySignerRequest {
    id: Vec<u8>, // Make this look up a String converted to a Vec<u8>
}

#[no_mangle]
pub extern "C" fn get_signers_by_address() {
    let env = EnvClient::empty();
    let request: QueryByAddressRequest = env.read_request_body();
    let signers: Vec<Signers> = env
        .read_filter()
        .column_equal_to("address", request.address)
        .column_equal_to("active", 1)
        .read()
        .unwrap();

    env.conclude(signers)
}

#[no_mangle]
pub extern "C" fn get_address_by_signer() {
    let env = EnvClient::empty();
    let request: AddressBySignerRequest = env.read_request_body();
    let signers: Vec<Signers> = env
        .read_filter()
        .column_equal_to("id", request.id)
        .column_equal_to("active", 1)
        .read()
        .unwrap();

    // TODO we only need to return unique contract addresses not everything

    env.conclude(signers)
}