use base64::{engine::general_purpose::URL_SAFE, engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use stellar_strkey::{ed25519, Contract, Strkey};
use types::{Signers, SignersActive, SignersAddress, SignersKeyVal, SignersValActive};
use webauthn_wallet::types::{
    SignerKey, SignerVal
};
use zephyr_sdk::{
    soroban_sdk::{
        self, symbol_short,
        xdr::{ScVal, ToXdr},
        Address, Bytes, BytesN, Symbol,
    },
    utils::{address_from_str, address_to_alloc_string},
    EnvClient,
};

mod types;

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
                            let key = &event.topics[2];

                            if etype == symbol_short!("add") {
                                let mut older: Vec<SignersValActive> = env
                                    .read_filter()
                                    .column_equal_to_xdr("address", &address)
                                    .column_equal_to_xdr("key", key)
                                    .read()
                                    .unwrap();

                                if let Some(older) = older.get_mut(0) {
                                    older.val = event.data;
                                    older.active = ScVal::Bool(true);

                                    env.update()
                                        .column_equal_to_xdr("address", &address)
                                        .column_equal_to_xdr("key", key)
                                        .execute(older)
                                        .unwrap();
                                } else {
                                    let signer = Signers {
                                        address,
                                        key: key.clone(),
                                        val: event.data,
                                        active: ScVal::Bool(true),
                                    };

                                    env.put(&signer);
                                }
                            } else if etype == symbol_short!("remove") {
                                let mut older: Vec<SignersActive> = env
                                    .read_filter()
                                    .column_equal_to_xdr("address", &address)
                                    .column_equal_to_xdr("key", key)
                                    .read()
                                    .unwrap();

                                if let Some(older) = older.get_mut(0) {
                                    older.active = ScVal::Bool(false);

                                    env.update()
                                        .column_equal_to_xdr("address", &address)
                                        .column_equal_to_xdr("key", key)
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
pub struct SignersByAddressRequest {
    address: String,
}

#[derive(Serialize)]
pub struct SignersByAddressResponse {
    kind: String,
    key: String,
    val: Option<String>,
    limits: String,
}

#[no_mangle]
pub extern "C" fn get_signers_by_address() {
    let env = EnvClient::empty();
    let SignersByAddressRequest { address } = env.read_request_body();

    let address = address_from_str(&env, address.as_str());
    let address = env.to_scval(address);

    let signers: Vec<SignersKeyVal> = env
        .read_filter()
        .column_equal_to_xdr("address", &address)
        .column_equal_to_xdr("active", &ScVal::Bool(true))
        .read()
        .unwrap();

    let mut response: Vec<SignersByAddressResponse> = vec![];

    for SignersKeyVal { key, val } in signers {
        let signer_key = env.from_scval::<SignerKey>(&key);
        let signer_val = env.from_scval::<SignerVal>(&val);

        let mut val_parsed: Option<String> = None;
        // let limits_parsed: String;

        let (kind_parsed, key_parsed) = match signer_key {
            SignerKey::Policy(policy) =>
                (
                    String::from("Policy"),
                    address_to_alloc_string(&env, policy),
                ),
            SignerKey::Ed25519(ed25519) => (
                String::from("Ed25519"),
                Strkey::PublicKeyEd25519(ed25519::PublicKey(ed25519.to_array())).to_string(),
            ),
            SignerKey::Secp256r1(secp256r1) => (
                String::from("Secp256r1"),
                URL_SAFE_NO_PAD.encode(secp256r1.to_alloc_vec()),
            )
        };

        let signer_limits = match signer_val {
            SignerVal::Policy(signer_limits) => {
                // limits_parsed = process_signer_type(signer_limits);
                signer_limits
            }
            SignerVal::Ed25519(signer_limits) => {
                // limits_parsed = process_signer_type(signer_limits);
                signer_limits
            }
            SignerVal::Secp256r1(secp256r1, signer_limits) => {
                // limits_parsed = process_signer_type(signer_limits);
                val_parsed = Some(URL_SAFE_NO_PAD.encode(secp256r1.to_array()));
                signer_limits
            }
        };

        response.push(SignersByAddressResponse {
            kind: kind_parsed,
            key: key_parsed,
            val: val_parsed,
            // limits: limits_parsed,
            limits: URL_SAFE.encode(signer_limits.to_xdr(&env.soroban()).to_alloc_vec()),
        })
    }

    env.conclude(response)
}

// fn process_signer_limits(signer_limits: SignerLimits) -> String {
    
// }

#[derive(Deserialize)]
pub struct AddressBySignerRequest {
    key: String,
    kind: String,
}

#[no_mangle]
pub extern "C" fn get_address_by_signer() {
    let env = EnvClient::empty();
    let AddressBySignerRequest { key, kind } = env.read_request_body();

    let key_scval: ScVal;

    if kind == "Policy" {
        let key = address_from_str(&env, &key.as_str());
        key_scval = env.to_scval(SignerKey::Policy(key));
    } else if kind == "Ed25519" {
        // This is pretty verbose and manual but there's no easy way to go from a G-address to it's 32 bytes of public key
        let key = address_from_str(&env, &key.as_str()).to_xdr(&env.soroban());
        let key = key.slice(key.len() - 32..);
        let mut slice = [0u8; 32];
        key.copy_into_slice(&mut slice);
        let key = BytesN::from_array(&env.soroban(), &slice);
        key_scval = env.to_scval(SignerKey::Ed25519(key));
    } else if kind == "Secp256r1" {
        let key = URL_SAFE_NO_PAD.decode(key).unwrap();
        let key = Bytes::from_slice(&env.soroban(), key.as_slice());
        key_scval = env.to_scval(SignerKey::Secp256r1(key));
    } else {
        panic!("Invalid signer type");
    }

    let signers: Vec<SignersAddress> = env
        .read_filter()
        .column_equal_to_xdr("key", &key_scval)
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

#[no_mangle]
pub extern "C" fn debug_signers() {
    let env = EnvClient::empty();

    let signers = env.read::<Signers>();

    env.conclude(signers);
}
