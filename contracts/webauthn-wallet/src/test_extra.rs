#![cfg(test)]

use base64::{engine::general_purpose::URL_SAFE, Engine as _};

#[test]
fn who_am_i() {
    let env: Env = Env::default();

    let none = None::<Address>;
    let none = none.to_xdr(&env);
    let mut none_bytes: [u8; 4] = [0; 4];

    none.copy_into_slice(&mut none_bytes);

    println!("{:?}", URL_SAFE.encode(none_bytes));
    println!("{:?}", ScVal::Void.to_xdr_base64(Limits::none()).unwrap());
}