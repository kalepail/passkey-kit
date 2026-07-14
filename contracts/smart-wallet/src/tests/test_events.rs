#![cfg(test)]
//! Event WIRE-FORMAT golden vectors.
//!
//! The rest of the suite asserts events via the same `#[contractevent]`
//! derive that emits them — self-referential, so a derive/schema drift keeps
//! tests green while silently breaking every indexer decoding the raw XDR
//! (and mainnet events are permanent). These tests pin the exact serialized
//! topic/data bytes for each event, built from fully fixed field values.
//!
//! If one of these fails, the event wire format CHANGED: that is a breaking
//! change for Mercury/indexer decoders and must be treated as such — never
//! "fix the test" without versioning the event schema.

extern crate std;

use smart_wallet_interface::{
    events::{SignerAdded, SignerRemoved, SignerUpdated, Upgraded},
    types::{SignerExpiration, SignerKey, SignerLimits, SignerStorage, SignerVal},
};
use soroban_sdk::{
    map,
    testutils::Events as _,
    xdr::{ContractEventBody, Limits, WriteXdr},
    Address, Bytes, BytesN, Env, String as SdkString,
};

use crate::tests::test_common::*;

/// A fixed contract address so every field is deterministic.
const FIXED_CONTRACT: &str = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

fn hex(bytes: &[u8]) -> std::string::String {
    bytes.iter().map(|b| std::format!("{b:02x}")).collect()
}

/// Serialize the LAST emitted event's raw XDR as (topics hex, data hex).
fn last_event_hex(env: &Env) -> (std::vec::Vec<std::string::String>, std::string::String) {
    let all = env.events().all();
    let event = all.events().last().unwrap().clone();
    let ContractEventBody::V0(body) = event.body;

    (
        body.topics
            .iter()
            .map(|t| hex(&t.to_xdr(Limits::none()).unwrap()))
            .collect(),
        hex(&body.data.to_xdr(Limits::none()).unwrap()),
    )
}

#[test]
fn event_wire_format_golden_vectors() {
    let env = test_env();
    let a = Ed25519Signer::new(1);
    let (wallet, _) = register_wallet(
        &env,
        &a.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let fixed = Address::from_string(&SdkString::from_str(&env, FIXED_CONTRACT));

    let mut actual: std::vec::Vec<(
        &str,
        std::vec::Vec<std::string::String>,
        std::string::String,
    )> = std::vec::Vec::new();

    // SignerAdded: Ed25519 key, expiring, with a limits map requiring a
    // policy co-signer — exercises every nested type.
    let evt = SignerAdded {
        key: SignerKey::Ed25519(BytesN::from_array(&env, &[0x11; 32])),
        val: SignerVal::Ed25519(
            SignerExpiration(Some(1_735_689_600)),
            SignerLimits(Some(map![
                &env,
                (
                    fixed.clone(),
                    Some(soroban_sdk::vec![&env, SignerKey::Policy(fixed.clone())])
                )
            ])),
        ),
        storage: SignerStorage::Persistent,
    };
    env.as_contract(&wallet, || evt.publish(&env));
    let (topics, data) = last_event_hex(&env);
    actual.push(("signer_added", topics, data));

    // SignerUpdated: Secp256r1 key/val, durability flip Temporary<-Persistent.
    let evt = SignerUpdated {
        key: SignerKey::Secp256r1(Bytes::from_slice(&env, &[0x22; 20])),
        val: SignerVal::Secp256r1(
            BytesN::from_array(&env, &[0x33; 65]),
            SignerExpiration(None),
            SignerLimits(None),
        ),
        storage: SignerStorage::Temporary,
        old_storage: SignerStorage::Persistent,
    };
    env.as_contract(&wallet, || evt.publish(&env));
    let (topics, data) = last_event_hex(&env);
    actual.push(("signer_updated", topics, data));

    // SignerRemoved: Policy key.
    let evt = SignerRemoved {
        key: SignerKey::Policy(fixed.clone()),
        storage: SignerStorage::Temporary,
    };
    env.as_contract(&wallet, || evt.publish(&env));
    let (topics, data) = last_event_hex(&env);
    actual.push(("signer_removed", topics, data));

    // Upgraded: both Option<old_hash> encodings.
    let evt = Upgraded {
        old_hash: None,
        new_hash: BytesN::from_array(&env, &[0x44; 32]),
    };
    env.as_contract(&wallet, || evt.publish(&env));
    let (topics, data) = last_event_hex(&env);
    actual.push(("upgraded_first", topics, data));

    let evt = Upgraded {
        old_hash: Some(BytesN::from_array(&env, &[0x55; 32])),
        new_hash: BytesN::from_array(&env, &[0x44; 32]),
    };
    env.as_contract(&wallet, || evt.publish(&env));
    let (topics, data) = last_event_hex(&env);
    actual.push(("upgraded_subsequent", topics, data));

    // GOLDEN VECTORS — raw ScVal XDR hex, captured from soroban-sdk 27.0.0's
    // #[contractevent] derive. First topic: Symbol(<snake_case struct name>);
    // second topic (when present): the #[topic] key field. Data: ScMap of the
    // remaining fields, sorted by field-name symbol.
    let expected: std::vec::Vec<(
        &str,
        std::vec::Vec<std::string::String>,
        std::string::String,
    )> = std::vec![
        (
            "signer_added",
            std::vec![
                // Symbol("signer_added")
                "0000000f0000000c7369676e65725f6164646564".into(),
                // SignerKey::Ed25519([0x11; 32])
                "0000001000000001000000020000000f0000000745643235353139000000000d000000201111111111111111111111111111111111111111111111111111111111111111".into(),
            ],
            // { storage: Persistent, val: Ed25519(exp Some(1735689600), limits Some({C… -> Some([Policy(C…)])})) }
            "0000001100000001000000020000000f0000000773746f72616765000000001000000001000000010000000f0000000a50657273697374656e7400000000000f0000000376616c000000001000000001000000030000000f0000000745643235353139000000001000000001000000010000000500000000677485800000001000000001000000010000001100000001000000010000001200000001d7928b72c2703ccfeaf7eb9ff4ef4d504a55a8b979fc9b450ea2c842b4d1ce610000001000000001000000010000001000000001000000020000000f00000006506f6c69637900000000001200000001d7928b72c2703ccfeaf7eb9ff4ef4d504a55a8b979fc9b450ea2c842b4d1ce61".into(),
        ),
        (
            "signer_updated",
            std::vec![
                // Symbol("signer_updated")
                "0000000f0000000e7369676e65725f757064617465640000".into(),
                // SignerKey::Secp256r1(bytes [0x22; 20])
                "0000001000000001000000020000000f000000095365637032353672310000000000000d000000142222222222222222222222222222222222222222".into(),
            ],
            // { old_storage: Persistent, storage: Temporary, val: Secp256r1(pk [0x33; 65], exp None, limits None) }
            "0000001100000001000000030000000f0000000b6f6c645f73746f72616765000000001000000001000000010000000f0000000a50657273697374656e7400000000000f0000000773746f72616765000000001000000001000000010000000f0000000954656d706f726172790000000000000f0000000376616c000000001000000001000000040000000f000000095365637032353672310000000000000d0000004133333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333333330000000000001000000001000000010000000100000010000000010000000100000001".into(),
        ),
        (
            "signer_removed",
            std::vec![
                // Symbol("signer_removed")
                "0000000f0000000e7369676e65725f72656d6f7665640000".into(),
                // SignerKey::Policy(C…)
                "0000001000000001000000020000000f00000006506f6c69637900000000001200000001d7928b72c2703ccfeaf7eb9ff4ef4d504a55a8b979fc9b450ea2c842b4d1ce61".into(),
            ],
            // { storage: Temporary }
            "0000001100000001000000010000000f0000000773746f72616765000000001000000001000000010000000f0000000954656d706f72617279000000".into(),
        ),
        (
            "upgraded_first",
            std::vec![
                // Symbol("upgraded") — no key topic.
                "0000000f000000087570677261646564".into(),
            ],
            // { new_hash: [0x44; 32], old_hash: Void } — None encodes as SCV_VOID.
            "0000001100000001000000020000000f000000086e65775f686173680000000d0000002044444444444444444444444444444444444444444444444444444444444444440000000f000000086f6c645f6861736800000001".into(),
        ),
        (
            "upgraded_subsequent",
            std::vec![
                "0000000f000000087570677261646564".into(),
            ],
            // { new_hash: [0x44; 32], old_hash: [0x55; 32] } — Some encodes as the bare inner value.
            "0000001100000001000000020000000f000000086e65775f686173680000000d0000002044444444444444444444444444444444444444444444444444444444444444440000000f000000086f6c645f686173680000000d000000205555555555555555555555555555555555555555555555555555555555555555".into(),
        ),
    ];

    assert_eq!(actual, expected);
}
