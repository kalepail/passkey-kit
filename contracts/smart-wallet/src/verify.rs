use smart_wallet_interface::types::{Error, Secp256r1Signature};
use soroban_sdk::{crypto::Hash, BytesN, Env};

use crate::base64_url;

/// WebAuthn authenticatorData minimum length: rpIdHash (32) + flags (1) +
/// signCount (4).
const AUTHENTICATOR_DATA_MIN_LEN: u32 = 37;
/// WebAuthn authenticatorData maximum accepted length, symmetric with the
/// clientDataJSON cap. Real assertions are 37 bytes plus at most a small
/// CBOR extensions block; anything larger is rejected with a typed error
/// BEFORE being hashed, since this path is reachable without a valid
/// signature and would otherwise spend budget hashing oversized input.
const AUTHENTICATOR_DATA_MAX_LEN: u32 = 1024;
/// Index of the flags byte within authenticatorData.
const AUTHENTICATOR_FLAGS_INDEX: u32 = 32;
/// User Present flag (bit 0).
const FLAG_USER_PRESENT: u8 = 0x01;
/// Parse buffer for clientDataJSON. Browsers emit well under 1KB; anything
/// larger is rejected with a typed error rather than an untyped panic.
const CLIENT_DATA_JSON_MAX_LEN: u32 = 1024;

#[derive(serde::Deserialize)]
struct ClientDataJson<'a> {
    challenge: &'a str,
    #[serde(rename = "type")]
    ty: &'a str,
}

/// Verify a WebAuthn assertion (passkey signature) over the Soroban
/// authorization payload.
///
/// Checks, in order:
/// 1. authenticatorData is structurally valid (37..=1024 bytes) and has the
///    User Present flag set. User Verification (UV) is deliberately NOT
///    required — see `Error::UserPresenceRequired`.
/// 2. clientDataJSON parses, is a "webauthn.get" assertion, and its
///    `challenge` equals base64url(signature_payload). The challenge
///    equality is the ONLY binding between the WebAuthn assertion and the
///    Soroban authorization entry — it is load-bearing and must not be
///    weakened. rpIdHash and origin are deliberately not pinned on-chain:
///    the wallet is rp-agnostic and origin policy is a client-side concern.
/// 3. The secp256r1 signature verifies over
///    sha256(authenticatorData || sha256(clientDataJSON)) per the WebAuthn
///    spec (host panics on an invalid signature).
pub fn verify_secp256r1_signature(
    env: &Env,
    signature_payload: &Hash<32>,
    public_key: &BytesN<65>,
    signature: Secp256r1Signature,
) -> Result<(), Error> {
    let Secp256r1Signature {
        mut authenticator_data,
        client_data_json,
        signature,
    } = signature;

    if authenticator_data.len() < AUTHENTICATOR_DATA_MIN_LEN {
        return Err(Error::InvalidAuthenticatorData);
    }

    if authenticator_data.len() > AUTHENTICATOR_DATA_MAX_LEN {
        return Err(Error::AuthenticatorDataTooLarge);
    }

    let flags = authenticator_data
        .get(AUTHENTICATOR_FLAGS_INDEX)
        .ok_or(Error::InvalidAuthenticatorData)?;

    if flags & FLAG_USER_PRESENT == 0 {
        return Err(Error::UserPresenceRequired);
    }

    if client_data_json.len() > CLIENT_DATA_JSON_MAX_LEN {
        return Err(Error::ClientDataJsonTooLarge);
    }

    let client_data_json_buffer = client_data_json.to_buffer::<1024>();
    let (client_data, _): (ClientDataJson, _) =
        serde_json_core::de::from_slice(client_data_json_buffer.as_slice())
            .map_err(|_| Error::ClientDataJsonParseError)?;

    if client_data.ty != "webauthn.get" {
        return Err(Error::InvalidWebAuthnType);
    }

    // base64url of 32 bytes is exactly 43 chars (unpadded).
    let mut expected_challenge = [0u8; 43];
    base64_url::encode(&mut expected_challenge, &signature_payload.to_array());

    if client_data.challenge.as_bytes() != expected_challenge {
        return Err(Error::ClientDataJsonChallengeIncorrect);
    }

    authenticator_data.extend_from_array(&env.crypto().sha256(&client_data_json).to_array());

    env.crypto().secp256r1_verify(
        public_key,
        &env.crypto().sha256(&authenticator_data),
        &signature,
    );

    Ok(())
}
