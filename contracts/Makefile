# export SOROBAN_RPC_URL=http://67.205.175.159:8000/soroban/rpc
# export SOROBAN_NETWORK_PASSPHRASE=Standalone Network ; February 2017
# export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
# export SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
# export SOROBAN_ACCOUNT=default
export SOROBAN_RPC_URL=https://svc.blockdaemon.com/stellar/mainnet/native/soroban-rpc?apiKey=
export SOROBAN_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
export SOROBAN_ACCOUNT=live
export WEBAUTHN_FACTORY=CBSHUYG2HXQES5BXH4DPEO3NTV6OACM6DBXTFZERI5FPCTEN2RPB6GKR
export WEBAUTHN_WASM=cec175385911bb959a92b4f27d4be583514ac39ecd16c2e9f7c5d3a3d9397b1e

build:
	rm -rf out/
	
	rm -rf contract-webauthn-factory/target/
	@cd contract-webauthn-factory && soroban contract build --out-dir ../out
	soroban contract optimize --wasm ./out/webauthn_factory.wasm

	rm -rf contract-webauthn-secp256r1/target/
	@cd contract-webauthn-secp256r1 && soroban contract build --out-dir ../out
	soroban contract optimize --wasm ./out/webauthn_secp256r1.wasm

deploy:
	soroban keys fund $(SOROBAN_ACCOUNT) || true
	soroban contract asset deploy --asset native || true
	soroban contract deploy --wasm ./out/webauthn-factory_v0.1.0.wasm --ignore-checks
	soroban contract install --wasm ./out/webauthn-secp256r1_v0.1.0.wasm --ignore-checks
	# soroban contract deploy --wasm ./out/webauthn_factory.optimized.wasm
	# soroban contract install --wasm ./out/webauthn_secp256r1.optimized.wasm

init:
	soroban contract invoke --id $(WEBAUTHN_FACTORY) -- init --wasm_hash $(WEBAUTHN_WASM)

bindings:
	soroban contract bindings typescript --id $(WEBAUTHN_FACTORY) --network testnet --output-dir ./out/passkey-factory-sdk --overwrite
	soroban contract bindings typescript --id $(WEBAUTHN_FACTORY) --wasm ./out/webauthn_secp256r1.optimized.wasm --network testnet --output-dir ./out/passkey-kit-sdk --overwrite

fmt:
	@cd contract-webauthn-factory && cargo fmt --all
	@cd contract-webauthn-secp256r1 && cargo fmt --all

clean:
	rm -rf out/
	rm -rf contract-webauthn-factory/target/
	rm -rf contract-webauthn-secp256r1/target/
	@cd contract-webauthn-factory && cargo clean
	@cd contract-webauthn-secp256r1 && cargo clean