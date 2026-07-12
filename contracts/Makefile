export STELLAR_NETWORK ?= testnet
export STELLAR_ACCOUNT ?= default

# Native XLM SAC on testnet, used only for sac-sdk bindings generation.
SAC_ID ?= CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# Canonical wasm hashes live in ../docs/deployments-testnet-2026-07-11.md —
# builds only reproduce those hashes from the exact commit recorded there.

# `stellar contract build` optimizes by default (CLI 27+); out/smart_wallet.wasm
# is the canonical, already-optimized artifact.
build:
	rm -rf out/
	stellar contract build --package smart-wallet --out-dir out

# Self-sufficient: smart-wallet's build.rs builds the wasm fixtures tests
# import (native builds only — contract builds skip it).
test:
	cargo test

upload:
	stellar contract upload --wasm out/smart_wallet.wasm --source $(STELLAR_ACCOUNT) --network $(STELLAR_NETWORK)

bindings:
	stellar contract bindings typescript --id $(SAC_ID) --network $(STELLAR_NETWORK) --output-dir out/sac-sdk --overwrite
	stellar contract bindings typescript --wasm out/smart_wallet.wasm --network $(STELLAR_NETWORK) --output-dir out/passkey-kit-sdk --overwrite

fmt:
	cargo fmt --all

clean:
	rm -rf out/
	cargo clean
