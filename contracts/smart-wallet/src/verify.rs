use smart_wallet_interface::types::{Error, Secp256r1Signature};
use soroban_sdk::{crypto::Hash, panic_with_error, BytesN, Env};

use crate::base64_url;

#[derive(serde::Deserialize)]
struct ClientDataJson<'a> {
    challenge: &'a str,
}

pub fn verify_secp256r1_signature(
    env: &Env,
    signature_payload: &Hash<32>,
    public_key: &BytesN<65>,
    signature: Secp256r1Signature,
) {
    let Secp256r1Signature {
        mut authenticator_data,
        client_data_json,
        signature,
    } = signature;

    authenticator_data.extend_from_array(&env.crypto().sha256(&client_data_json).to_array());

    env.crypto().secp256r1_verify(
        &public_key,
        &env.crypto().sha256(&authenticator_data),
        &signature,
    );

    // Parse the client data JSON, extracting the base64 url encoded challenge.
    let client_data_json = client_data_json.to_buffer::<1024>(); // <- TODO why 1024?
    let client_data_json = client_data_json.as_slice();
    let (client_data_json, _): (ClientDataJson, _) =
        serde_json_core::de::from_slice(client_data_json)
            .unwrap_or_else(|_| panic_with_error!(env, Error::JsonParseError));

    // Build what the base64 url challenge is expecting.
    let mut expected_challenge = [0u8; 43];

    base64_url::encode(&mut expected_challenge, &signature_payload.to_array());

    // Check that the challenge inside the client data JSON that was signed is identical to the expected challenge.
    // TODO is this check actually necessary or is the secp256r1_verify sufficient?
    if client_data_json.challenge.as_bytes() != expected_challenge {
        panic_with_error!(env, Error::ClientDataJsonChallengeIncorrect)
    }
}
