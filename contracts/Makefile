export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
export SOROBAN_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
export SOROBAN_ACCOUNT=default

export NATIVE_CONTRACT=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

export SMART_WALLET_FACTORY=CCD7M4VVKELWL2RO4XJOZOGBDF3ESFIKG2EAU4ETVNAKMRRKE6YIQU5E
export SMART_WALLET_WASM=e0753bf6aa81563c29ccad9f2cb088fc45ad3f7a99b1643ee0d97d9783b34da7

build:
	rm -rf out/

	stellar contract build
	
	rm -rf smart-wallet/target/wasm32-unknown-unknown/
	@cd smart-wallet && soroban contract build --package smart-wallet --out-dir ../out
	soroban contract optimize --wasm ./out/smart_wallet.wasm

	rm -rf smart-wallet-factory/target/wasm32-unknown-unknown/
	@cd smart-wallet-factory && soroban contract build --package smart-wallet-factory --out-dir ../out
	soroban contract optimize --wasm ./out/smart_wallet_factory.wasm

deploy:
	soroban keys fund $(SOROBAN_ACCOUNT) || true
	soroban contract asset deploy --asset native || true
	soroban contract deploy --wasm ./out/smart_wallet_factory.optimized.wasm
	soroban contract install --wasm ./out/smart_wallet.optimized.wasm

init:
	soroban contract invoke --id $(SMART_WALLET_FACTORY) -- init --wasm_hash $(SMART_WALLET_WASM)

bindings:
	soroban contract bindings typescript --id CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC --network testnet --output-dir ./out/sac-sdk --overwrite
	soroban contract bindings typescript --id NIL --wasm ./target/wasm32-unknown-unknown/release/smart_wallet_factory.wasm --network testnet --output-dir ./out/passkey-factory-sdk --overwrite
	soroban contract bindings typescript --id NIL --wasm ./target/wasm32-unknown-unknown/release/smart_wallet.wasm --network testnet --output-dir ./out/passkey-kit-sdk --overwrite

fmt:
	@cd smart-wallet-factory && cargo fmt --all
	@cd smart-wallet && cargo fmt --all

clean:
	rm -rf out/
	rm -rf smart-wallet-factory/target/
	rm -rf smart-wallet/target/
	@cd smart-wallet-factory && cargo clean
	@cd smart-wallet && cargo clean