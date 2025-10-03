export STELLAR_NETWORK=testnet
export STELLAR_ACCOUNT=default
# export STELLAR_NETWORK=vc
# export STELLAR_ACCOUNT=live

# TESTNET
export SMART_WALLET_WASM=e45c42b944a767bd5f37f8c4a469b48917d28e23481dbfd550419c84cdacde92

build:
	rm -rf out/
	rm -rf smart-wallet/target/wasm32v1-none/

	stellar contract build
		
	@cd smart-wallet && stellar contract build --package smart-wallet --out-dir ../out
	stellar contract optimize --wasm ./out/smart_wallet.wasm

upload:
	stellar contract upload --wasm ./out/smart_wallet.optimized.wasm --source $(STELLAR_ACCOUNT)

bindings:
	stellar contract bindings typescript --id CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC --network $(STELLAR_NETWORK) --output-dir ./out/sac-sdk --overwrite
	stellar contract bindings typescript --wasm ./target/wasm32v1-none/release/smart_wallet.wasm --network $(STELLAR_NETWORK) --output-dir ./out/passkey-kit-sdk --overwrite

fmt:
	@cd smart-wallet && cargo fmt --all

clean:
	rm -rf out/
	rm -rf smart-wallet/target/
	@cd smart-wallet && cargo clean