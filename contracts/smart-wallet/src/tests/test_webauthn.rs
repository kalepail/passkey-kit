#![cfg(test)]
//! WebAuthn (secp256r1 passkey) verification vectors, driven through
//! `__check_auth` via `try_invoke_contract_check_auth`.
//!
//! Assertions are generated with deterministic keys (RFC 6979) and shaped
//! exactly like real authenticator output: rpIdHash = sha256("localhost"),
//! flags byte, zero sign counter, and a Chrome-style clientDataJSON with
//! type/challenge/origin/crossOrigin fields.

extern crate std;

use smart_wallet_interface::types::{
    Error, Signatures, SignerExpiration, SignerKey, SignerLimits, SignerStorage,
};
use soroban_sdk::{auth::Context, map, testutils::Address as _, Address, Env, IntoVal, Vec};

use crate::tests::test_common::*;

struct Setup {
    env: Env,
    wallet: Address,
    passkey: Passkey,
    payload: soroban_sdk::BytesN<32>,
    contexts: Vec<Context>,
}

fn setup() -> Setup {
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
    let contexts = soroban_sdk::vec![&env, transfer_context(&env, &token, &wallet, 1_000_000)];

    Setup {
        env,
        wallet,
        passkey,
        payload,
        contexts,
    }
}

fn check(
    s: &Setup,
    signature: smart_wallet_interface::types::Signature,
) -> Result<(), Result<Error, soroban_sdk::InvokeError>> {
    let signatures = Signatures(map![&s.env, (s.passkey.signer_key(&s.env), signature)]);

    s.env.try_invoke_contract_check_auth::<Error>(
        &s.wallet,
        &s.payload,
        signatures.into_val(&s.env),
        &s.contexts,
    )
}

#[test]
fn valid_assertion() {
    let s = setup();
    let signature = s.passkey.sign(&s.env, &s.payload);

    assert_eq!(check(&s, signature), Ok(()));
}

/// Pin the derived challenge for a fixed payload: base64url([0x07; 32]),
/// 43 chars, unpadded. This is the load-bearing payload binding.
#[test]
fn fixed_vector_challenge() {
    let s = setup();

    assert_eq!(
        base64_url_encode(&s.payload.to_array()),
        "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc"
    );

    let signature = s.passkey.sign(&s.env, &s.payload);
    assert_eq!(check(&s, signature), Ok(()));
}

/// UV is deliberately not required: a UP-only assertion (flags 0x01) is valid.
#[test]
fn user_verification_not_required() {
    let s = setup();
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            flags: 0x01,
            ..Default::default()
        },
    );

    assert_eq!(check(&s, signature), Ok(()));
}

/// UP flag missing (UV alone doesn't count).
#[test]
fn user_presence_required() {
    let s = setup();
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            flags: 0x04,
            ..Default::default()
        },
    );

    assert_eq!(check(&s, signature), Err(Ok(Error::UserPresenceRequired)));
}

#[test]
fn no_flags_set() {
    let s = setup();
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            flags: 0x00,
            ..Default::default()
        },
    );

    assert_eq!(check(&s, signature), Err(Ok(Error::UserPresenceRequired)));
}

/// authenticatorData shorter than the WebAuthn minimum of 37 bytes.
#[test]
fn truncated_authenticator_data() {
    let s = setup();
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            truncate_authenticator_data: true,
            ..Default::default()
        },
    );

    assert_eq!(
        check(&s, signature),
        Err(Ok(Error::InvalidAuthenticatorData))
    );
}

/// A registration ceremony response replayed as an assertion must fail.
#[test]
fn wrong_webauthn_type() {
    let s = setup();
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            json_type: "webauthn.create",
            ..Default::default()
        },
    );

    assert_eq!(check(&s, signature), Err(Ok(Error::InvalidWebAuthnType)));
}

/// A (correctly signed) assertion over the WRONG challenge must fail: this is
/// the binding between the WebAuthn assertion and the Soroban auth payload.
#[test]
fn challenge_mismatch() {
    let s = setup();
    let other_payload = payload(&s.env, 8);
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            challenge_override: Some(base64_url_encode(&other_payload.to_array())),
            ..Default::default()
        },
    );

    assert_eq!(
        check(&s, signature),
        Err(Ok(Error::ClientDataJsonChallengeIncorrect))
    );
}

/// clientDataJSON larger than the 1024-byte parse buffer: typed error, not an
/// untyped panic.
#[test]
fn oversized_client_data_json() {
    let s = setup();
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            json_pad_to: 1025,
            ..Default::default()
        },
    );

    assert_eq!(check(&s, signature), Err(Ok(Error::ClientDataJsonTooLarge)));
}

/// Exactly 1024 bytes still parses (boundary).
#[test]
fn max_size_client_data_json() {
    let s = setup();
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            json_pad_to: 1024,
            ..Default::default()
        },
    );

    assert_eq!(check(&s, signature), Ok(()));
}

#[test]
fn malformed_client_data_json() {
    let s = setup();
    let signature = s.passkey.sign_with(
        &s.env,
        &s.payload,
        WebAuthnOptions {
            malformed_json: true,
            ..Default::default()
        },
    );

    assert_eq!(
        check(&s, signature),
        Err(Ok(Error::ClientDataJsonParseError))
    );
}

/// Corrupted signature bytes fail secp256r1 verification in the host — not
/// one of the wallet's typed errors. (The cross-payload case is covered by
/// `challenge_mismatch`: the challenge IS the payload binding.)
#[test]
fn invalid_signature() {
    let s = setup();
    let signature = match s.passkey.sign(&s.env, &s.payload) {
        smart_wallet_interface::types::Signature::Secp256r1(mut sig) => {
            let mut bytes = sig.signature.to_array();
            bytes[63] ^= 0xff;
            sig.signature = soroban_sdk::BytesN::from_array(&s.env, &bytes);
            smart_wallet_interface::types::Signature::Secp256r1(sig)
        }
        _ => unreachable!(),
    };

    let result = check(&s, signature);
    assert!(result.is_err(), "corrupted signature must not verify");
    assert!(
        !matches!(result, Err(Ok(_))),
        "must fail in host crypto, not a wallet-typed error: {result:?}"
    );
}

/// An assertion from a DIFFERENT key for this signer's key id fails host
/// crypto verification.
#[test]
fn wrong_key_signature() {
    let s = setup();
    let other_passkey = Passkey::new(2);
    let signature = other_passkey.sign(&s.env, &s.payload);

    let result = check(&s, signature);
    assert!(result.is_err(), "foreign-key signature must not verify");
    assert!(!matches!(result, Err(Ok(_))));
}

/// A secp256r1 signature submitted for a stored Ed25519 signer key is a
/// key/value mismatch.
#[test]
fn signature_for_wrong_signer_type() {
    let env = test_env();
    let passkey = Passkey::new(1);
    let ed25519 = Ed25519Signer::new(3);

    let (wallet, _) = register_wallet(
        &env,
        &ed25519.signer(
            &env,
            SignerExpiration(None),
            SignerLimits(None),
            SignerStorage::Persistent,
        ),
    );

    let payload = payload(&env, 7);
    let token = Address::generate(&env);
    let contexts = soroban_sdk::vec![&env, transfer_context(&env, &token, &wallet, 1_000_000)];

    // Ed25519 signer key mapped to a Secp256r1 (WebAuthn) signature.
    let signatures = Signatures(map![
        &env,
        (
            SignerKey::Ed25519(ed25519.public_key(&env)),
            passkey.sign(&env, &payload)
        )
    ]);

    assert_eq!(
        env.try_invoke_contract_check_auth::<Error>(
            &wallet,
            &payload,
            signatures.into_val(&env),
            &contexts,
        ),
        Err(Ok(Error::SignatureKeyValueMismatch))
    );
}
