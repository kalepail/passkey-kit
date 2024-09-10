use serde::{Deserialize, Serialize, Serializer};
use stellar_strkey::{ed25519, Contract, Strkey};
use types::{Signers, SignersActive, SignersAddress, SignersKeyValAdmin, SignersValAdminActive};
use webauthn_wallet::types::{Ed25519PublicKey, Policy, PolicySigner, Secp256r1Id, SignerKey, SignerVal};
use zephyr_sdk::{
    soroban_sdk::{
        self, symbol_short, xdr::{ScVal, ToXdr}, Address, Bytes, BytesN, Symbol
    },
    utils::{address_from_str, address_to_alloc_string},
    EnvClient, 
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

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
                                let (val, admin): (ScVal, ScVal) = {
                                    let (val, admin) =
                                        env.from_scval::<(Option<SignerVal>, bool)>(&event.data);
                                    (
                                        if let Some(val) = val {
                                            env.to_scval(val)
                                        } else {
                                            ScVal::Void
                                        },
                                        ScVal::Bool(admin),
                                    )
                                };

                                let mut older: Vec<SignersValAdminActive> = env
                                    .read_filter()
                                    .column_equal_to_xdr("address", &address)
                                    .column_equal_to_xdr("key", key)
                                    .read()
                                    .unwrap();

                                if let Some(older) = older.get_mut(0) {
                                    older.val = val;
                                    older.admin = admin;
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
                                        val,
                                        admin,                   
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

pub enum StringOrVecOfStrings {
    String(String),
    Vec(Vec<String>),
}

impl Serialize for StringOrVecOfStrings {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            StringOrVecOfStrings::String(s) => serializer.serialize_str(s),
            StringOrVecOfStrings::Vec(v) => v.serialize(serializer),
        }
    }
}

#[derive(Serialize)]
pub struct SignersByAddressResponse {
    key: String,
    val: Option<StringOrVecOfStrings>,
    #[serde(rename = "type")]
    signer: String,
    admin: bool,
}

#[no_mangle]
pub extern "C" fn get_signers_by_address() {
    let env = EnvClient::empty();
    let SignersByAddressRequest { address } = env.read_request_body();

    let address = address_from_str(&env, address.as_str());
    let address = env.to_scval(address);

    let signers: Vec<SignersKeyValAdmin> = env
        .read_filter()
        .column_equal_to_xdr("address", &address)
        .column_equal_to_xdr("active", &ScVal::Bool(true))
        .read()
        .unwrap();

    let mut response: Vec<SignersByAddressResponse> = vec![];

    for SignersKeyValAdmin { key, val, admin } in signers {
        let key = env.from_scval::<SignerKey>(&key);
        let key_parsed: String;
        let val = env.from_scval::<Option<SignerVal>>(&val);
        let mut val_parsed: Option<StringOrVecOfStrings> = None;
        let signer: String; 
        let admin = env.from_scval::<bool>(&admin);
        
        match key {
            SignerKey::Policy(policy) => {
                signer = String::from("Policy");
                key_parsed = address_to_alloc_string(&env, policy.0);
            }
            SignerKey::Ed25519(ed25519) => {
                signer = String::from("Ed25519");
                key_parsed = Strkey::PublicKeyEd25519(ed25519::PublicKey(ed25519.0.to_array())).to_string();
            }
            SignerKey::Secp256r1(secp256r1) => {
                signer = String::from("Secp256r1");
                key_parsed = URL_SAFE_NO_PAD.encode(secp256r1.0.to_alloc_vec());
            }
        }

        if let Some(val) = val {
            match val {
                SignerVal::Policy(policy) => {
                    let policy_strings: Vec<String> = policy.iter().map(|policy| {
                        match policy {
                            PolicySigner::Policy(policy) => {
                                // TODO untested
                                address_to_alloc_string(&env, policy.0)
                            }
                            PolicySigner::Ed25519(ed25519_public_key) => {
                                Strkey::PublicKeyEd25519(ed25519::PublicKey(ed25519_public_key.0.to_array())).to_string()
                            }
                            PolicySigner::Secp256r1(secp256r1_id, secp256r1_public_key) => {
                                // TODO untested
                                format!("{}:{}", URL_SAFE_NO_PAD.encode(secp256r1_id.0.to_alloc_vec()), URL_SAFE_NO_PAD.encode(secp256r1_public_key.0.to_array().to_vec()))
                            }
                        }
                    }).collect();

                    val_parsed = Some(StringOrVecOfStrings::Vec(policy_strings));
                }
                SignerVal::Secp256r1(secp256r1) => {
                    val_parsed = Some(StringOrVecOfStrings::String(URL_SAFE_NO_PAD.encode(secp256r1.0.to_array())));
                }
            }
        }

        response.push(SignersByAddressResponse {
            key: key_parsed,
            val: val_parsed,
            signer,
            admin,
        })
    }

    env.conclude(response)
}

#[derive(Deserialize)]
pub struct AddressBySignerRequest {
    key: String,
    #[serde(rename = "type")]
    signer: String,
}

#[no_mangle]
pub extern "C" fn get_address_by_signer() {
    let env = EnvClient::empty();
    let AddressBySignerRequest { key, signer } = env.read_request_body();

    let key_scval: ScVal;

    if signer == "Policy" {
        let key = address_from_str(&env, &key.as_str());
        key_scval = env.to_scval(SignerKey::Policy(Policy(key)));
    } else if signer == "Ed25519" {
        // This is pretty verbose and manual but there's no easy way to go from a G-address to it's 32 bytes of public key
        let key = address_from_str(&env, &key.as_str()).to_xdr(&env.soroban());
        let key = key.slice(key.len() - 32..);
        let mut slice = [0u8; 32];
        key.copy_into_slice(&mut slice);
        let key = BytesN::from_array(&env.soroban(), &slice);
        key_scval = env.to_scval(SignerKey::Ed25519(Ed25519PublicKey(key)));
    } else if signer == "Secp256r1" {
        let key = URL_SAFE_NO_PAD.decode(key).unwrap();
        let key = Bytes::from_slice(&env.soroban(), key.as_slice());
        key_scval = env.to_scval(SignerKey::Secp256r1(Secp256r1Id(key)));
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