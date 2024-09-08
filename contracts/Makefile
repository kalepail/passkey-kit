export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
export SOROBAN_ACCOUNT=default

export NATIVE_CONTRACT=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

export WEBAUTHN_FACTORY=CBK7SWB27SPHOPD6PFBEIERZJKZTPXIZDZL3IZ4PQJPKCGDXVTDSQNKE
export WEBAUTHN_WASM=87a34d4ced09d08ae2c690240aa906d246b187edf0e3f125ffc7edfd76fb6886

build:
	rm -rf out/
	
	rm -rf webauthn-wallet/target/wasm32-unknown-unknown/
	@cd webauthn-wallet && soroban contract build --package webauthn-wallet --out-dir ../out
	soroban contract optimize --wasm ./out/webauthn_wallet.wasm

	rm -rf webauthn-factory/target/wasm32-unknown-unknown/
	@cd webauthn-factory && soroban contract build --package webauthn-factory --out-dir ../out
	soroban contract optimize --wasm ./out/webauthn_factory.wasm

deploy:
	soroban keys fund $(SOROBAN_ACCOUNT) || true
	soroban contract asset deploy --asset native || true
	soroban contract deploy --wasm ./out/webauthn_factory.optimized.wasm
	soroban contract install --wasm ./out/webauthn_wallet.optimized.wasm

init:
	soroban contract invoke --id $(WEBAUTHN_FACTORY) -- init --wasm_hash $(WEBAUTHN_WASM)

bindings:
	soroban contract bindings typescript --id $(NATIVE_CONTRACT) --network testnet --output-dir ./out/sac-sdk --overwrite
	soroban contract bindings typescript --id $(WEBAUTHN_FACTORY) --network testnet --output-dir ./out/passkey-factory-sdk --overwrite
	soroban contract bindings typescript --id $(WEBAUTHN_FACTORY) --wasm ./out/webauthn_wallet.optimized.wasm --network testnet --output-dir ./out/passkey-kit-sdk --overwrite

fmt:
	@cd webauthn-factory && cargo fmt --all
	@cd webauthn-wallet && cargo fmt --all

clean:
	rm -rf out/
	rm -rf webauthn-factory/target/
	rm -rf webauthn-wallet/target/
	@cd webauthn-factory && cargo clean
	@cd webauthn-wallet && cargo clean