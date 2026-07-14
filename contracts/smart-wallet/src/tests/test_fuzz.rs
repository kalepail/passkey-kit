#![cfg(test)]
//! Property tests over the WebAuthn verification path with arbitrary
//! `authenticatorData`/`clientDataJSON`/signature input.
//!
//! The claim under test is verify.rs's "typed error rather than an untyped
//! panic": for ANY input, `__check_auth` must return an error (typed wallet
//! error or contained host error) — never authorize, and never escape as an
//! unwinding panic. `try_invoke_contract_check_auth` surfaces an escaped
//! panic as a test failure.

extern crate std;

use proptest::prelude::*;
use smart_wallet_interface::types::{
    Error, Secp256r1Signature, Signature, Signatures, SignerExpiration, SignerLimits, SignerStorage,
};
use soroban_sdk::{map, testutils::Address as _, Address, Bytes, BytesN, IntoVal, InvokeError};

use crate::tests::test_common::*;

/// Drive a raw `Secp256r1Signature` through a real `__check_auth`.
fn check_raw(
    authenticator_data: &[u8],
    client_data_json: &[u8],
    signature_bytes: &[u8; 64],
) -> Result<(), Result<Error, InvokeError>> {
    let env = test_env();
    let passkey = Passkey::new(1);

    let (wallet, _) = register_wallet(
        &env,
        &passkey.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = soroban_sdk::vec![&env, transfer_context(&env, &token, &wallet, 1)];

    let signatures = Signatures(map![
        &env,
        (
            passkey.signer_key(&env),
            Signature::Secp256r1(Secp256r1Signature {
                authenticator_data: Bytes::from_slice(&env, authenticator_data),
                client_data_json: Bytes::from_slice(&env, client_data_json),
                signature: BytesN::from_array(&env, signature_bytes),
            })
        )
    ]);

    env.try_invoke_contract_check_auth::<Error>(
        &wallet,
        &payload,
        signatures.into_val(&env),
        &contexts,
    )
}

/// The (only) challenge that would bind to `payload(&env, 7)`.
const VALID_CHALLENGE: &str = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc";

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Arbitrary raw bytes in every field: never a panic, never an
    /// authorization.
    #[test]
    fn raw_bytes_never_panic_never_authorize(
        authenticator_data in proptest::collection::vec(any::<u8>(), 0..1200),
        client_data_json in proptest::collection::vec(any::<u8>(), 0..1200),
        signature in proptest::collection::vec(any::<u8>(), 64..=64),
    ) {
        let signature: [u8; 64] = signature.try_into().unwrap();
        let result = check_raw(&authenticator_data, &client_data_json, &signature);
        prop_assert!(result.is_err(), "arbitrary input must never authorize: {result:?}");
    }

    /// Structurally WebAuthn-shaped input — well-formed JSON with a random
    /// challenge/type, random flags, random authenticatorData size — with a
    /// signature genuinely computed over it, so the failure is forced through
    /// the deep (structural/binding) checks rather than the JSON parser.
    #[test]
    fn structured_assertions_never_panic_never_authorize(
        challenge in "[A-Za-z0-9_-]{0,64}",
        json_type in prop_oneof![
            Just(std::string::String::from("webauthn.get")),
            Just(std::string::String::from("webauthn.create")),
            "[a-z.]{0,16}",
        ],
        flags in any::<u8>(),
        ad_len in 0usize..1200,
        json_pad_to in 0usize..1200,
    ) {
        // The one input this generator must not produce: a fully VALID
        // assertion (correct type + correct challenge + UP flag + in-bounds
        // authenticatorData), which would rightly authorize.
        prop_assume!(
            !(json_type == "webauthn.get"
                && challenge == VALID_CHALLENGE
                && flags & 0x01 != 0
                && (37..=1024).contains(&ad_len))
        );

        let env = test_env();
        let passkey = Passkey::new(1);

        let (wallet, _) = register_wallet(
            &env,
            &passkey.signer(
                &env,
                SignerExpiration(None),
                SignerLimits(None),
                SignerStorage::Persistent,
            ),
        );

        let payload = payload(&env, 7);
        let token = Address::generate(&env);
        let contexts = soroban_sdk::vec![&env, transfer_context(&env, &token, &wallet, 1)];

        // Build JSON + authenticatorData by hand (sign_with can't take a
        // non-'static type string), signing for real over the result.
        use sha2::{Digest, Sha256};
        use p256::ecdsa::signature::hazmat::PrehashSigner;

        let mut client_data_json = std::format!(
            r#"{{"type":"{json_type}","challenge":"{challenge}","origin":"http://localhost:4507","crossOrigin":false}}"#
        );
        while client_data_json.len() < json_pad_to {
            client_data_json.push(' ');
        }

        let mut authenticator_data = std::vec::Vec::new();
        authenticator_data.extend_from_slice(&Sha256::digest(b"localhost"));
        authenticator_data.push(flags);
        authenticator_data.extend_from_slice(&[0u8; 4]);
        authenticator_data.resize(ad_len, 0);

        let mut message = authenticator_data.clone();
        message.extend_from_slice(&Sha256::digest(client_data_json.as_bytes()));
        let digest = Sha256::digest(&message);
        let signature: p256::ecdsa::Signature =
            passkey.signing_key.sign_prehash(&digest).unwrap();
        let signature = signature.normalize_s().unwrap_or(signature);

        let signatures = Signatures(map![
            &env,
            (
                passkey.signer_key(&env),
                Signature::Secp256r1(Secp256r1Signature {
                    authenticator_data: Bytes::from_slice(&env, &authenticator_data),
                    client_data_json: Bytes::from_slice(&env, client_data_json.as_bytes()),
                    signature: BytesN::from_array(&env, &signature.to_bytes().into()),
                })
            )
        ]);

        let result = env.try_invoke_contract_check_auth::<Error>(
            &wallet,
            &payload,
            signatures.into_val(&env),
            &contexts,
        );
        prop_assert!(result.is_err(), "non-binding assertion must never authorize: {result:?}");
    }
}
