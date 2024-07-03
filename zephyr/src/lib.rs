use serde::{Deserialize, Serialize};
use zephyr_sdk::{prelude::*, soroban_sdk::{xdr::{Hash, PublicKey, ScAddress, ScVal, ScVec, VecM}, Address, Bytes, BytesN, String as SorobanString, Symbol}, DatabaseDerive, EnvClient};

#[derive(DatabaseDerive, Clone, Serialize)]
#[with_name("signers")]
pub struct Signers {
    address: String,
    id: Vec<u8>,
    pubkey: Vec<u8>,
    active: i32
}

#[derive(DatabaseDerive, Clone, Serialize)]
#[with_name("adjacent")]
pub struct AdjacentEvents {
    address: String,
    contract: String,
    topics: ScVal,
    data: ScVal,
}

fn to_store(existing_addresses: &Vec<String>, topics: &VecM<ScVal>, data: &ScVal) -> Vec<String> {
    let mut addresses: Vec<String> = Vec::new();

    for topic in topics.to_vec() {
        for address in existing_addresses {
            if find_address_in_scval(&topic, stellar_strkey::Contract::from_string(&address).unwrap().0) {
                addresses.push(address.clone())
            }
        }
    }

    for address in existing_addresses {
        if find_address_in_scval(data, stellar_strkey::Contract::from_string(&address).unwrap().0) {
            addresses.push(address.clone())
        }
    }

    addresses
}

fn find_address_in_scval(val: &ScVal, address: [u8; 32]) -> bool {
    match val {
        ScVal::Address(object) => {
            match object {
                ScAddress::Account(pubkey) => {
                    if let PublicKey::PublicKeyTypeEd25519(pubkey) = &pubkey.0 {
                        return pubkey.0 == address;
                    }
                }
                ScAddress::Contract(hash) => {
                    return hash.0 == address;
                }
            }
        }
        ScVal::Vec(Some(scvec)) => {
            for val in scvec.0.to_vec() {
                if find_address_in_scval(&val, address) {
                    return true;
                }
            }
        }
        ScVal::Map(Some(scmap)) => {
            for kv in scmap.0.to_vec() {
                if find_address_in_scval(&kv.key, address) || find_address_in_scval(&kv.val, address) {
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

    let scval = ScVal::Vec(Some(ScVec([ScVal::Address(ScAddress::Contract(Hash([3; 32])))].try_into().unwrap())));
    assert!(find_address_in_scval(&scval, [3; 32]));
    assert!(!find_address_in_scval(&scval, [2; 32]));

    let scval = ScVal::Vec(Some(ScVec([ScVal::Vec(Some(ScVec([ScVal::Address(ScAddress::Contract(Hash([3; 32])))].try_into().unwrap())))].try_into().unwrap())));
    assert!(find_address_in_scval(&scval, [3; 32]));
    assert!(!find_address_in_scval(&scval, [2; 32]));

    println!("{}", ScVal::Address(ScAddress::Contract(Hash(stellar_strkey::Contract::from_string("CBLWEW63G2KU7ZGVQTTFTJLGQSXAU5PU5ZXERQDDLL4LBA72D7ER6C75").unwrap().0))).to_xdr_base64(Limits::none()).unwrap());
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
    let existing_addresses: Vec<String> = Signers::read_to_rows(&env, None).iter().map(|signer| signer.address.clone()).collect();
    let factory_address = SorobanString::from_str(&env.soroban(), "CA4JRRQ52GDJGWIWE7W6J4AUDGLYSEEUUYM4OXERVQ7AUFGS72YNIF65");

    for event in env.reader().pretty().soroban_events() {
        // if there are events where the address of the wallet is involved in, we track them.
        // This allows us to track all kinds of operations performed by the smart wallets (transfers, 
        // swaps, deposits, etc).
        {
            let addresses = to_store(&existing_addresses, &event.topics, &event.data); 
            
            for address in addresses {
                let event = AdjacentEvents {
                    contract: stellar_strkey::Contract(event.contract).to_string(),
                    topics: ScVal::Vec(Some(ScVec(event.topics.clone().try_into().unwrap()))),
                    data: event.data.clone(),
                    address
                };

                env.put(&event)
            }
        };

        if let Some(topic0) = event.topics.get(0) {
            let factory = env.try_from_scval::<Address>(topic0);
            if let Ok(factory) = factory {
                if let Some(topic1) = event.topics.get(1) {
                    let event_type = env.try_from_scval::<Symbol>(&topic1);
                    if let Ok(etype) = event_type {
                        if factory.to_string() == factory_address {
                            env.log().debug("Found factory", None);
                            
                            if etype == Symbol::new(env.soroban(), "add_sig") {
                                let id: Bytes = env.from_scval(&event.topics[2]);
                                let pk: BytesN<65> = env.from_scval(&event.data);

                                env.log().debug("creating signer", None);
                                let signer = Signers {
                                    address: stellar_strkey::Contract(event.contract).to_string(),
                                    id: bytes_to_vec(id),
                                    pubkey: bytesn_to_vec(pk),
                                    active: 0
                                };
                                env.log().debug("created signer", None);

                                env.put(&signer);
                            } if etype == Symbol::new(env.soroban(), "rm_sig") {
                                let id: Bytes = env.from_scval(&event.topics[2]);
                                let id = bytes_to_vec(id);
                                let older: Vec<Signers> = env.read_filter().column_equal_to("id", id.clone()).column_equal_to("active", 0).read().unwrap();
                                let mut older = older[0].clone();
                                older.active = 1;

                                env.update().column_equal_to("id", id).execute(&older).unwrap();
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
    address: String
}

#[derive(Deserialize)]
pub struct AddressBySignerRequest {
    id: Vec<u8>
}

#[no_mangle]
pub extern "C" fn get_signers_by_address() {
    let env = EnvClient::empty();
    let request: QueryByAddressRequest = env.read_request_body();
    let signers: Vec<Signers> = env.read_filter().column_equal_to("address", request.address).column_equal_to("active", 0).read().unwrap();

    env.conclude(&signers)
}

#[no_mangle]
pub extern "C" fn get_address_by_signer() {
    let env = EnvClient::empty();
    let request: AddressBySignerRequest = env.read_request_body();
    let signers: Vec<Signers> = env.read_filter().column_equal_to("id", request.id).column_equal_to("active", 0).read().unwrap();

    env.conclude(&signers)
}

#[no_mangle]
pub extern "C" fn get_events_by_address() {
    let env = EnvClient::empty();
    let request: QueryByAddressRequest = env.read_request_body();
    let events: Vec<AdjacentEvents> = env.read_filter().column_equal_to("address", request.address).read().unwrap();

    env.conclude(&events)
}
