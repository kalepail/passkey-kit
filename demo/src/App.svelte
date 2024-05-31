<script lang="ts">
	import * as PasskeyKit from "./passkey-kit";
	import { Networks, Keypair } from "@stellar/stellar-sdk";
	import { Buffer } from "buffer";

	let keys: {
		contractSalt: Buffer;
		publicKey: Buffer | undefined;
		contractId: string;
	};

	// Sign in
	// Sign
	// Add key
	// Remove key
	// List keys
	// Swap sudo signer

	const sequenceKeypair = Keypair.fromSecret(
		// GDDRNRFPWBRJ6NNC2SDEPR7AXBVFWGIS3O66NKDZ7BUERB37H4P4GVIM
		"SCQZ7CEQZ3R47SECW4XKMOMSA3QO5YPGKVPPWALXMDVWR5N2CLPGKDMP",
	);
	const feeBumpJwt =
		"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3MTJmM2FmNjA2MWQyNmFjNGM1NzMxNTFlMTE2NTQ3YTNiNThiMzY0ZmNmNWE2ZGY4ZjFhNTkxNmQ1NDBjYWUzIiwiZXhwIjoxNzMyODExOTU2LCJpYXQiOjE3MTcwODcxNTZ9.VfHVZOSleLvYVfH5nmdWFgDgHJ5Ddfa1m1e1WtlFTgA";

	const { PasskeyAccount } = PasskeyKit;
	const account = new PasskeyAccount({
		sequencePublicKey: sequenceKeypair.publicKey(),
		networkPassphrase: Networks.TESTNET,
		horizonUrl: "https://horizon-testnet.stellar.org",
		rpcUrl: "https://soroban-testnet.stellar.org",
		feeBumpUrl: "https://feebump.sdf-ecosystem.workers.dev",
		feeBumpJwt,
	});

	async function register() {
		keys = await account.startRegistration("Super Peach", "superpeach");
		console.log(keys);

		const res = await account.deployWallet(
			keys.contractSalt,
			keys.publicKey!,
			sequenceKeypair.secret(),
		);
		console.log(res);
	}
</script>

<main>
	<button on:click={register}>Register</button>
	{#if keys?.contractId}
		<p>{keys.contractId}</p>
	{/if}
</main>

<style>
</style>
