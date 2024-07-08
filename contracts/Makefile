# export SOROBAN_RPC_URL=http://67.205.175.159:8000/soroban/rpc
# export SOROBAN_NETWORK_PASSPHRASE=Standalone Network ; February 2017
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
export SOROBAN_ACCOUNT=default
export WEBAUTHN_FACTORY=CAYFD5TO3QDPUSIM2RDFPWL3B2USBUPHJS3X5OBBTVLKDSNMS6NDDSXU
export WEBAUTHN_WASM=9e799f993928679b62fb41c922b8e8283b2b12d233785b7ef07ffd7a73827694

build:
	rm -rf out/
	
	rm -rf contract-webauthn-factory/target/wasm32-unknown-unknown/
	@cd contract-webauthn-factory && soroban contract build --out-dir ../out
	soroban contract optimize --wasm ./out/webauthn_factory.wasm

	rm -rf contract-webauthn-secp256r1/target/wasm32-unknown-unknown/
	@cd contract-webauthn-secp256r1 && soroban contract build --out-dir ../out
	soroban contract optimize --wasm ./out/webauthn_secp256r1.wasm

deploy:
	soroban keys fund $(SOROBAN_ACCOUNT) || true
	soroban contract asset deploy --asset native || true
	soroban contract deploy --wasm ./out/webauthn_factory.optimized.wasm
	soroban contract install --wasm ./out/webauthn_secp256r1.optimized.wasm

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