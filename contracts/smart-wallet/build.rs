//! Builds the wasm fixtures the test suite imports (sample_policy.wasm for
//! cross-contract policy tests and the deploy path; smart_wallet.wasm for the
//! upgrade path), so a clean-checkout `cargo test` is self-sufficient.
//!
//! Only runs for native builds: contract (wasm) builds skip it entirely, so
//! the canonical wasm artifact is never affected by this script.

use std::{env, path::PathBuf, process::Command};

fn main() {
    let target = env::var("TARGET").unwrap_or_default();
    if target.starts_with("wasm32") {
        return;
    }

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    let fixture_target = out_dir.join("fixture-target");
    let cargo = env::var("CARGO").unwrap_or_else(|_| "cargo".into());

    let status = Command::new(&cargo)
        .args([
            "build",
            "--package",
            "sample-policy",
            "--package",
            "smart-wallet",
            "--target",
            "wasm32v1-none",
            "--release",
            "--locked",
        ])
        .env("CARGO_TARGET_DIR", &fixture_target)
        .status()
        .expect("failed to spawn cargo to build test fixture wasms");
    assert!(status.success(), "building test fixture wasms failed");

    // contractimport! only accepts literal paths (resolved relative to the
    // crate manifest), so surface the artifacts at a stable, gitignored
    // location the test imports can name.
    let release = fixture_target.join("wasm32v1-none").join("release");
    let fixtures = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap()).join("fixtures");
    std::fs::create_dir_all(&fixtures).unwrap();
    for wasm in ["sample_policy.wasm", "smart_wallet.wasm"] {
        std::fs::copy(release.join(wasm), fixtures.join(wasm))
            .unwrap_or_else(|e| panic!("copying fixture {wasm}: {e}"));
    }

    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=../sample-policy/src");
    println!("cargo:rerun-if-changed=../smart-wallet-interface/src");
}
