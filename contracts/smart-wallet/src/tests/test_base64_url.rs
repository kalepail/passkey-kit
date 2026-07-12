#![cfg(test)]
//! Unit vectors for the no_std base64url (unpadded) encoder used to build
//! the expected WebAuthn challenge.

extern crate std;

use crate::base64_url;
use crate::tests::test_common::base64_url_encode;

fn encode_to_string(src: &[u8]) -> std::string::String {
    // Unpadded base64 length: ceil(len * 4 / 3).
    let encoded_len = src.len().div_ceil(3) * 4
        - match src.len() % 3 {
            1 => 2,
            2 => 1,
            _ => 0,
        };
    let mut dst = std::vec![0u8; encoded_len];

    base64_url::encode(&mut dst, src);

    std::string::String::from_utf8(dst).unwrap()
}

/// RFC 4648 §10 test vectors (unpadded, url-safe alphabet).
#[test]
fn rfc4648_vectors() {
    assert_eq!(encode_to_string(b""), "");
    assert_eq!(encode_to_string(b"f"), "Zg");
    assert_eq!(encode_to_string(b"fo"), "Zm8");
    assert_eq!(encode_to_string(b"foo"), "Zm9v");
    assert_eq!(encode_to_string(b"foob"), "Zm9vYg");
    assert_eq!(encode_to_string(b"fooba"), "Zm9vYmE");
    assert_eq!(encode_to_string(b"foobar"), "Zm9vYmFy");
}

/// The url-safe alphabet must be used ('-' and '_', not '+' and '/').
#[test]
fn url_safe_alphabet() {
    // 0xfb 0xef 0xbe encodes to "----" in url-safe, "++++" in standard.
    assert_eq!(encode_to_string(&[0xfb, 0xef, 0xbe]), "----");
    // 0xff 0xff 0xff encodes to "____" in url-safe, "////" in standard.
    assert_eq!(encode_to_string(&[0xff, 0xff, 0xff]), "____");
}

/// Cross-check every length 0..=64 against the reference implementation —
/// 32-byte inputs (the challenge case) matter most, but the encoder is
/// length-generic.
#[test]
fn matches_reference_implementation() {
    for len in 0usize..=64 {
        let src: std::vec::Vec<u8> = (0..len).map(|i| (i * 37 + len * 11) as u8).collect();
        assert_eq!(
            encode_to_string(&src),
            base64_url_encode(&src),
            "mismatch at len {len}"
        );
    }
}

/// The exact challenge shape: 32 bytes always encode to 43 chars, unpadded.
#[test]
fn challenge_length() {
    let encoded = encode_to_string(&[0xa5; 32]);
    assert_eq!(encoded.len(), 43);
    assert_eq!(encoded, base64_url_encode(&[0xa5; 32]));
}
