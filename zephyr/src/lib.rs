use serde::{Deserialize, Serialize};
use stellar_strkey::Contract;
use webauthn_wallet::types::KeyId;
use zephyr_sdk::{
    prelude::*, soroban_sdk::{
        xdr::{Hash, PublicKey, ScAddress, ScVal, ScVec, VecM},
        Bytes, BytesN, Symbol,
    }, utils::address_to_alloc_string, DatabaseDerive, EnvClient
};

// #[derive(DatabaseDerive, Clone, Serialize)]
// #[with_name("adjacent")]
// pub struct AdjacentEvents {
//     contract: String,
//     address: String,
//     topics: ScVal,
//     data: ScVal,
//     date: u64,
// }

#[derive(DatabaseDerive, Clone, Serialize)]
#[with_name("signers")]
pub struct Signers {
    address: String,
    id: Vec<u8>,
    pk: Vec<u8>,
    date: u64,
    admin: i32,
    active: i32,
}

fn to_store(existing_addresses: &Vec<String>, topics: &VecM<ScVal>, data: &ScVal) -> Vec<String> {
    let mut addresses: Vec<String> = Vec::new();

    for topic in topics.to_vec() {
        for address in existing_addresses {
            if find_address_in_scval(
                &topic,
                Contract::from_string(&address).unwrap().0,
            ) {
                addresses.push(address.clone())
            }
        }
    }

    for address in existing_addresses {
        if find_address_in_scval(
            data,
            Contract::from_string(&address).unwrap().0,
        ) {
            addresses.push(address.clone())
        }
    }

    addresses
}

fn find_address_in_scval(val: &ScVal, address: [u8; 32]) -> bool {
    match val {
        ScVal::Address(object) => match object {
            ScAddress::Account(pubkey) => {
                if let PublicKey::PublicKeyTypeEd25519(pubkey) = &pubkey.0 {
                    return pubkey.0 == address;
                }
            }
            ScAddress::Contract(hash) => {
                return hash.0 == address;
            }
        },
        ScVal::Vec(Some(scvec)) => {
            for val in scvec.0.to_vec() {
                if find_address_in_scval(&val, address) {
                    return true;
                }
            }
        }
        ScVal::Map(Some(scmap)) => {
            for kv in scmap.0.to_vec() {
                if find_address_in_scval(&kv.key, address)
                    || find_address_in_scval(&kv.val, address)
                {
                    return true;
                }
            }
        }
        _ => {}
    }

    false
}

#[test]
fn find_val() {
    let scval = ScVal::Address(ScAddress::Contract(Hash([3; 32])));
    assert!(find_address_in_scval(&scval, [3; 32]));
    assert!(!find_address_in_scval(&scval, [2; 32]));

    let scval = ScVal::Vec(Some(ScVec(
        [ScVal::Address(ScAddress::Contract(Hash([3; 32])))]
            .try_into()
            .unwrap(),
    )));
    assert!(find_address_in_scval(&scval, [3; 32]));
    assert!(!find_address_in_scval(&scval, [2; 32]));

    let scval = ScVal::Vec(Some(ScVec(
        [ScVal::Vec(Some(ScVec(
            [ScVal::Address(ScAddress::Contract(Hash([3; 32])))]
                .try_into()
                .unwrap(),
        )))]
        .try_into()
        .unwrap(),
    )));
    assert!(find_address_in_scval(&scval, [3; 32]));
    assert!(!find_address_in_scval(&scval, [2; 32]));
}

fn bytes_to_vec(bytes: Bytes) -> Vec<u8> {
    let mut result = Vec::new();

    for byte in bytes.iter() {
        result.push(byte);
    }

    result
}

fn bytesn_to_vec(bytes: BytesN<65>) -> Vec<u8> {
    let mut result = Vec::new();

    for byte in bytes.iter() {
        result.push(byte);
    }

    result
}

#[no_mangle]
pub extern "C" fn on_close() {
    let env = EnvClient::new();
    // let existing_addresses: Vec<String> = Signers::read_to_rows(&env, None)
    //     .iter()
    //     .map(|signer| signer.address.clone())
    //     .collect();
    let event_tag = Symbol::new(env.soroban(), "sw_v1");

    for event in env.reader().pretty().soroban_events() {
        // if there are events where the address of the wallet is involved in, we track them.
        // This allows us to track all kinds of operations performed by the smart wallets (transfers,
        // swaps, deposits, etc).
        // {
        //     let addresses = to_store(&existing_addresses, &event.topics, &event.data);

        //     for address in addresses {
        //         let event = AdjacentEvents {
        //             contract: Contract(event.contract).to_string(),
        //             topics: ScVal::Vec(Some(ScVec(event.topics.clone().try_into().unwrap()))),
        //             data: event.data.clone(),
        //             address,
        //             date: env.reader().ledger_timestamp(),
        //         };

        //         env.put(&event)
        //     }
        // };

        if let Some(topic0) = event.topics.get(0) {
            let t0 = env.try_from_scval::<Symbol>(topic0);

            if let Ok(t0) = t0 {
                if let Some(topic1) = event.topics.get(1) {
                    let event_type = env.try_from_scval::<Symbol>(topic1);

                    if let Ok(etype) = event_type {
                        if t0 == event_tag {
                            if etype == Symbol::new(env.soroban(), "add") {
                                let id = match env.from_scval::<KeyId>(&event.topics[2]) {
                                    KeyId::Policy(policy) => {
                                        address_to_alloc_string(&env, policy.0).as_bytes().to_vec()
                                    }
                                    KeyId::Ed25519(public_key) => {
                                        public_key.0.to_array().to_vec()
                                    }
                                    KeyId::Secp256r1(id) => {
                                        id.0.to_alloc_vec()
                                    }
                                };
                                let pk = if let Some(pk) = env.from_scval::<Option<BytesN<65>>>(&event.topics[3]) {
                                    bytesn_to_vec(pk)
                                } else {
                                    vec![]
                                };

                                let date = env.reader().ledger_timestamp();
                                let admin = env.from_scval::<bool>(&event.data) as i32;

                                // let (pk, admin): (BytesN<65>, bool) = env.from_scval(&event.data);

                                let older: Vec<Signers> = env
                                    .read_filter()
                                    .column_equal_to("id", id.clone())
                                    .read()
                                    .unwrap();

                                if older.len() == 0 {
                                    let signer = Signers {
                                        address: Contract(event.contract).to_string(),
                                        id,
                                        pk,
                                        date,
                                        admin,
                                        active: 1,
                                    };

                                    env.put(&signer);
                                } else {
                                    let mut older = older[0].clone();

                                    older.active = 1;
                                    older.pk = pk;
                                    older.date = date;
                                    older.admin = admin;

                                    env.update()
                                        .column_equal_to("id", id)
                                        .execute(&older)
                                        .unwrap();
                                }
                            } else if etype == Symbol::new(env.soroban(), "remove") {
                                let id = match env.from_scval::<KeyId>(&event.topics[2]) {
                                    KeyId::Policy(policy) => {
                                        address_to_alloc_string(&env, policy.0).as_bytes().to_vec()
                                    }
                                    KeyId::Ed25519(public_key) => {
                                        public_key.0.to_array().to_vec()
                                    }
                                    KeyId::Secp256r1(id) => {
                                        id.0.to_alloc_vec()
                                    }
                                };
                                let older: Vec<Signers> = env
                                    .read_filter()
                                    .column_equal_to("id", id.clone())
                                    .read()
                                    .unwrap();
                                let mut older = older[0].clone();

                                older.active = 0;

                                env.update()
                                    .column_equal_to("id", id)
                                    .execute(&older)
                                    .unwrap();
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
    id: Vec<u8>,
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

    let signers = env.read::<Signers>();

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

    let signers = env.read::<Signers>();

    // TODO we only need to return unique contract addresses not everything

    env.conclude(signers)
}

// #[no_mangle]
// pub extern "C" fn get_events_by_address() {
//     let env = EnvClient::empty();
//     let request: QueryByAddressRequest = env.read_request_body();
//     let events: Vec<AdjacentEvents> = env
//         .read_filter()
//         .column_equal_to("address", request.address)
//         .read()
//         .unwrap();

//     env.conclude(events)
// }

// TODO make a serverless function to deactivate signers by id

////

#[cfg(test)]
mod test {
    use ledger_meta_factory::TransitionPretty;
    use stellar_xdr::next::{ScBytes, ScSymbol, ScVal};
    use zephyr_sdk::testutils::TestHost;

    fn add_signature(transition: &mut TransitionPretty) {
        transition.inner.set_sequence(8891);
        transition
            .contract_event(
                "CAYFD5TO3QDPUSIM2RDFPWL3B2USBUPHJS3X5OBBTVLKDSNMS6NDDSXU",
                vec![
                    ScVal::Symbol(ScSymbol("sw_v1".try_into().unwrap())),
                    ScVal::Symbol(ScSymbol("add".try_into().unwrap())),
                    ScVal::Bytes(ScBytes([0; 20].try_into().unwrap())),
                    ScVal::Bytes(ScBytes([0; 65].try_into().unwrap())),
                    // ScVal::Symbol(ScSymbol("init".try_into().unwrap())),
                ],
                ScVal::Bool(true), // (
                                   //     ScVal::Bytes(ScBytes([0; 65].try_into().unwrap())),
                                   //     ScVal::Bool(true)
                                   // ).try_into().unwrap(),
            )
            .unwrap();
    }

    // fn remove_signature() {}

    #[tokio::test]
    async fn test() {
        let env = TestHost::default();
        let mut program =
            env.new_program("./target/wasm32-unknown-unknown/release/smart_wallets_data.wasm");

        let mut db = env.database("postgres://postgres:postgres@localhost:5432");
        let _ = db
            .load_table(
                0,
                "signers",
                vec!["address", "id", "pk", "date", "admin", "active"],
                None,
            )
            .await;
        let _ = db
            .load_table(
                0,
                "adjacent",
                vec!["contract", "address", "topics", "data", "date"],
                None,
            )
            .await;

        // assert_eq!(db.get_rows_number(0, "id").await.unwrap(), 0);
        // assert_eq!(db.get_rows_number(0, "deposited").await.unwrap(), 0);

        let mut empty = TransitionPretty::new();
        program.set_transition(empty.inner.clone());

        let invocation = program.invoke_vm("on_close").await;
        assert!(invocation.is_ok());
        let inner_invocation = invocation.unwrap();
        assert!(inner_invocation.is_ok());

        // assert_eq!(db.get_rows_number(0, "id").await.unwrap(), 0);
        // assert_eq!(db.get_rows_number(0, "deposited").await.unwrap(), 0);

        add_signature(&mut empty);
        program.set_transition(empty.inner.clone());

        let invocation = program.invoke_vm("on_close").await;
        assert!(invocation.is_ok());
        let inner_invocation = invocation.unwrap();
        assert!(inner_invocation.is_ok());

        // assert_eq!(db.get_rows_number(0, "id").await.unwrap(), 1);
        // assert_eq!(db.get_rows_number(0, "deposited").await.unwrap(), 1);

        db.close().await
    }
}
