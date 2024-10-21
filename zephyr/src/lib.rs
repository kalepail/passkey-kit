use base64::{
    engine::general_purpose::URL_SAFE, engine::general_purpose::URL_SAFE_NO_PAD, Engine as _,
};
use serde::{Deserialize, Serialize};
use smart_wallet_interface::types::{SignerKey, SignerLimits, SignerStorage, SignerVal};
use stellar_strkey::{ed25519, Strkey};
use types::{
    Signers, SignersActive, SignersAddress, SignersKeyValLimitsExpStorage,
    SignersValLimitsExpStorageActive,
};
use zephyr_sdk::{
    soroban_sdk::{
        self, symbol_short,
        xdr::{Hash, ScAddress, ScVal, ToXdr},
        Address, Bytes, BytesN, Symbol,
    },
    utils::{address_from_str, address_to_alloc_string},
    EnvClient,
};

mod types;

const SW_V1: Symbol = symbol_short!("sw_v1");
const ADD: Symbol = symbol_short!("add");
const UPDATE: Symbol = symbol_short!("update");
const REMOVE: Symbol = symbol_short!("remove");

#[no_mangle]
pub extern "C" fn on_close() {
    let env = EnvClient::new();

    for event in env.reader().pretty().soroban_events() {
        if let Some(topic0) = event.topics.get(0) {
            if let Ok(t0) = env.try_from_scval::<Symbol>(topic0) {
                if t0 == SW_V1 {
                    if let Some(topic1) = event.topics.get(1) {
                        if let Ok(t1) = env.try_from_scval::<Symbol>(topic1) {
                            if let Some(key) = event.topics.get(2) {
                                let address =
                                    ScVal::Address(ScAddress::Contract(Hash::from(event.contract)));

                                if t1 == ADD || t1 == UPDATE {
                                    let mut older: Vec<SignersValLimitsExpStorageActive> = env
                                        .read_filter()
                                        .column_equal_to_xdr("address", &address)
                                        .column_equal_to_xdr("key", key)
                                        .read()
                                        .unwrap();

                                    let (signer_val, signer_storage): (SignerVal, SignerStorage) =
                                        env.from_scval(&event.data);

                                    if let Some(older) = older.get_mut(0) {
                                        let (public_key, signer_expiration, signer_limits) =
                                            get_signer_expiration_limits(signer_val);

                                        older.val = env.to_scval(public_key);
                                        older.exp = signer_expiration.unwrap_or(u32::MAX);
                                        older.limits = env.to_scval(signer_limits);
                                        older.storage = env.to_scval(signer_storage);
                                        older.active = ScVal::Bool(true);

                                        env.update()
                                            .column_equal_to_xdr("address", &address)
                                            .column_equal_to_xdr("key", key)
                                            .execute(older)
                                            .unwrap();
                                    } else {
                                        let (public_key, signer_expiration, signer_limits) =
                                            get_signer_expiration_limits(signer_val);
                                        let signer = Signers {
                                            address,
                                            key: key.clone(),
                                            val: env.to_scval(public_key),
                                            limits: env.to_scval(signer_limits),
                                            exp: signer_expiration.unwrap_or(u32::MAX),
                                            storage: env.to_scval(signer_storage),
                                            active: ScVal::Bool(true),
                                        };

                                        env.put(&signer);
                                    }
                                } else if t1 == REMOVE {
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
}

fn get_signer_expiration_limits(
    signer_val: SignerVal,
) -> (Option<BytesN<65>>, Option<u32>, SignerLimits) {
    match signer_val {
        SignerVal::Policy(signer_expiration, signer_limits) => {
            (None, signer_expiration, signer_limits)
        }
        SignerVal::Ed25519(signer_expiration, signer_limits) => {
            (None, signer_expiration, signer_limits)
        }
        SignerVal::Secp256r1(public_key, signer_expiration, signer_limits) => {
            (Some(public_key), signer_expiration, signer_limits)
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
    expiration: Option<u32>,
    storage: String,
    limits: String,
}

#[no_mangle]
pub extern "C" fn get_signers_by_address() {
    let env = EnvClient::empty();
    let SignersByAddressRequest { address } = env.read_request_body();

    let address = address_from_str(&env, address.as_str());
    let address = env.to_scval(address);

    let signers: Vec<SignersKeyValLimitsExpStorage> = env
        .read_filter()
        .column_equal_to_xdr("address", &address)
        .column_equal_to_xdr("active", &ScVal::Bool(true))
        .column_gt("exp", env.soroban().ledger().sequence())
        .read()
        .unwrap();

    let mut response: Vec<SignersByAddressResponse> = vec![];

    for SignersKeyValLimitsExpStorage {
        key,
        val,
        limits,
        exp,
        storage,
    } in signers
    {
        let signer_key = env.from_scval::<SignerKey>(&key);
        let signer_limits = env.from_scval::<SignerLimits>(&limits);
        let signer_storage = env.from_scval::<SignerStorage>(&storage);

        let (kind_parsed, key_parsed) = match signer_key {
            SignerKey::Policy(policy) => (
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
            ),
        };

        let mut val_parsed: Option<String> = None;

        if let Some(public_key) = env.from_scval::<Option<BytesN<65>>>(&val) {
            val_parsed = Some(URL_SAFE_NO_PAD.encode(public_key.to_array()));
        }

        let storage_parsed = match signer_storage {
            SignerStorage::Persistent => String::from("Persistent"),
            SignerStorage::Temporary => String::from("Temporary"),
        };

        response.push(SignersByAddressResponse {
            kind: kind_parsed,
            key: key_parsed,
            val: val_parsed,
            expiration: if exp == u32::MAX { None } else { Some(exp) },
            storage: storage_parsed,
            limits: URL_SAFE.encode(signer_limits.to_xdr(&env.soroban()).to_alloc_vec()),
        })
    }

    env.conclude(response)
}

#[derive(Deserialize)]
pub struct AddressBySignerRequest {
    key: String,
    kind: String,
}

#[no_mangle]
pub extern "C" fn get_addresses_by_signer() {
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

    if signers.is_empty() {
        env.conclude::<Vec<String>>(Vec::default());
    } else {
        let contracts = signers
            .iter()
            .map(|SignersAddress { address }| {
                address_to_alloc_string(&env, env.from_scval::<Address>(address))
            })
            .collect::<Vec<String>>();

        env.conclude(contracts);
    }
}

#[no_mangle]
pub extern "C" fn debug_signers() {
    let env = EnvClient::empty();

    let signers = env.read::<Signers>();

    env.conclude(signers);
}
