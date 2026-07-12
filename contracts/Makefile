export STELLAR_NETWORK ?= testnet
export STELLAR_ACCOUNT ?= default

# Native XLM SAC on testnet, used only for sac-sdk bindings generation.
SAC_ID ?= CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# Canonical wasm hashes live in docs/deployments-testnet.md — this Makefile
# does not pin them; `make build` output is the source of truth.

# `stellar contract build` optimizes by default (CLI 27+); out/smart_wallet.wasm
# is the canonical, already-optimized artifact.
build:
	rm -rf out/
	stellar contract build --package smart-wallet --out-dir out

# Tests import sample_policy.wasm (cross-contract fixture), so build it first.
test:
	stellar contract build --package sample-policy
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
