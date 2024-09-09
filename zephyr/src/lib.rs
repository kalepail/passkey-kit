use serde::{Deserialize, Serialize};
use stellar_strkey::{ed25519, Contract, Strkey};
use webauthn_wallet::types::{Ed25519PublicKey, Policy, Secp256r1Id, Signer};
use zephyr_sdk::{
    prelude::*,
    soroban_sdk::{
        self, symbol_short, xdr::{ScVal, ToXdr}, Address, Bytes, BytesN, Symbol
    },
    utils::{address_from_str, address_to_alloc_string},
    DatabaseDerive, EnvClient, 
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct Signers {
    address: ScVal,
    id: ScVal,
    pk: ScVal,
    admin: ScVal,
    active: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersIdPkAdmin {
    id: ScVal,
    pk: ScVal,
    admin: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersPkDateAdminActive {
    pk: ScVal,
    admin: ScVal,
    active: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersAddress {
    address: ScVal,
}

#[derive(DatabaseDerive, Serialize, Clone)]
#[with_name("signers")]
pub struct SignersActive {
    active: ScVal,
}

#[no_mangle]
pub extern "C" fn on_close() {
    let env = EnvClient::new();
    let event_tag = symbol_short!("sw_v1");

    for event in env.reader().pretty().soroban_events() {
        if let Some(topic0) = event.topics.get(0) {
            if let Ok(t0) = env.try_from_scval::<Symbol>(topic0) {
                if let Some(topic1) = event.topics.get(1) {
                    if let Ok(etype) = env.try_from_scval::<Symbol>(topic1) {
                        if t0 == event_tag {
                            let address = address_from_str(
                                &env,
                                Contract(event.contract).to_string().as_str(),
                            );
                            let address = env.to_scval(address);
                            let id = &event.topics[2];

                            if etype == symbol_short!("add") {
                                let (pk, admin): (ScVal, ScVal) = {
                                    let (pk, admin) =
                                        env.from_scval::<(Option<BytesN<65>>, bool)>(&event.data);
                                    (
                                        if let Some(pk) = pk {
                                            env.to_scval(pk)
                                        } else {
                                            ScVal::Void
                                        },
                                        ScVal::Bool(admin),
                                    )
                                };

                                let mut older: Vec<SignersPkDateAdminActive> = env
                                    .read_filter()
                                    .column_equal_to_xdr("address", &address)
                                    .column_equal_to_xdr("id", id)
                                    .read()
                                    .unwrap();

                                if let Some(older) = older.get_mut(0) {
                                    older.pk = pk;
                                    older.admin = admin;
                                    older.active = ScVal::Bool(true);

                                    env.update()
                                        .column_equal_to_xdr("address", &address)
                                        .column_equal_to_xdr("id", id)
                                        .execute(older)
                                        .unwrap();
                                } else {
                                    let signer = Signers {
                                        address,
                                        id: id.clone(),
                                        pk,
                                        admin,                   
                                        active: ScVal::Bool(true),
                                    };

                                    env.put(&signer);
                                }
                            } else if etype == symbol_short!("remove") {
                                let mut older: Vec<SignersActive> = env
                                    .read_filter()
                                    .column_equal_to_xdr("address", &address)
                                    .column_equal_to_xdr("id", id)
                                    .read()
                                    .unwrap();

                                if let Some(older) = older.get_mut(0) {
                                    older.active = ScVal::Bool(false);

                                    env.update()
                                        .column_equal_to_xdr("address", &address)
                                        .column_equal_to_xdr("id", id)
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

#[derive(Serialize)]
pub struct SignersIdPkAdminClean {
    id: String,
    pk: Option<String>,
    #[serde(rename = "type")]
    signer: String,
    admin: bool,
}

#[no_mangle]
pub extern "C" fn get_signers_by_address() {
    let env = EnvClient::empty();
    let QueryByAddressRequest { address } = env.read_request_body();

    let address = address_from_str(&env, address.as_str());
    let address = env.to_scval(address);

    let signers: Vec<SignersIdPkAdmin> = env
        .read_filter()
        .column_equal_to_xdr("address", &address)
        .column_equal_to_xdr("active", &ScVal::Bool(true))
        .read()
        .unwrap();

    let mut response: Vec<SignersIdPkAdminClean> = vec![];

    for SignersIdPkAdmin { id, pk, admin } in signers {
        let id = env.from_scval::<Signer>(&id);
        let id_parsed: String;
        let mut pk_parsed: Option<String> = None;
        let signer: String; 
        let admin = env.from_scval::<bool>(&admin);
        
        match id {
            Signer::Policy(policy) => {
                id_parsed = address_to_alloc_string(&env, policy.0);
                signer = String::from("Policy");
            }
            Signer::Ed25519(ed25519) => {
                id_parsed = Strkey::PublicKeyEd25519(ed25519::PublicKey(ed25519.0.to_array())).to_string();
                signer = String::from("Ed25519");
            }
            Signer::Secp256r1(secp256r1) => {
                id_parsed = URL_SAFE_NO_PAD.encode(secp256r1.0.to_alloc_vec());
                pk_parsed = Some(URL_SAFE_NO_PAD.encode(env.from_scval::<Bytes>(&pk).to_alloc_vec()));
                signer = String::from("Secp256r1");
            }
        }

        response.push(SignersIdPkAdminClean {
            id: id_parsed,
            pk: pk_parsed,
            signer,
            admin,
        })
    }

    env.conclude(response)
}

#[derive(Deserialize)]
pub struct AddressBySignerRequest {
    id: String,
    #[serde(rename = "type")]
    signer: String,
}

#[no_mangle]
pub extern "C" fn get_address_by_signer() {
    let env = EnvClient::empty();
    let AddressBySignerRequest { id, signer } = env.read_request_body();

    let id_scval: ScVal;

    if signer == "Policy" {
        // TODO untested
        let id = address_from_str(&env, &id.as_str());
        id_scval = env.to_scval(Signer::Policy(Policy(id)));
    } else if signer == "Ed25519" {
        // This is pretty verbose and manual but there's no easy way to go from a G-address to it's 32 bytes of public key
        let id = address_from_str(&env, &id.as_str()).to_xdr(&env.soroban());
        let id = id.slice(id.len() - 32..);
        let mut slice = [0u8; 32];
        id.copy_into_slice(&mut slice);
        let id = BytesN::from_array(&env.soroban(), &slice);
        id_scval = env.to_scval(Signer::Ed25519(Ed25519PublicKey(id)));
    } else if signer == "Secp256r1" {
        let id = URL_SAFE_NO_PAD.decode(id).unwrap();
        let id = Bytes::from_slice(&env.soroban(), id.as_slice());
        id_scval = env.to_scval(Signer::Secp256r1(Secp256r1Id(id)));
    } else {
        panic!("Invalid signer type");
    }

    let signers: Vec<SignersAddress> = env
        .read_filter()
        .column_equal_to_xdr("id", &id_scval)
        .column_equal_to_xdr("active", &ScVal::Bool(true))
        .read()
        .unwrap();

    if let Some(SignersAddress { address }) = signers.get(0) {
        let address = address_to_alloc_string(&env, env.from_scval::<Address>(address));
        env.conclude(address);
    } else {
        env.conclude(None::<String>);
    }
}