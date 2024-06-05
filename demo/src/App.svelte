<script lang="ts">
	import * as PasskeyKit from "./passkey-kit";
	import { Networks, Keypair } from "@stellar/stellar-sdk";
	import { Buffer } from "buffer";

	let walletData: Map<string, any> = new Map();
	let contractId: string;
	let keys: {
		contractSalt: Buffer;
		publicKey: Buffer | undefined;
	};

	// Remove signers
	// Sign
	// Swap sudo signer

	// TODO review base fee of inner tx as related to the outer. Right now I'm passing a 10,000 hard code for both. Do I need the inner or is that already accounted for in simulation?
	// TODO how do you sign in when you've resudo'd? The sudo sig contract id derivation will be broken
	// You need to sign in with the original sudo key to get the contract id

	// CALCPXOL25W5ZXEOCXOOJNHEQV2R7IJVSBOREWEPNGQJI4CO7M7LD3TE

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
		const user = prompt("Give this passkey a name");

		if (!user) return;

		keys = await account.createWallet("Super Peach", user);
		contractId = await account.deployWallet(
			keys.contractSalt,
			keys.publicKey!,
			sequenceKeypair.secret(),
		);
		console.log(contractId);
	}
	async function signIn() {
		const { contractId: cid } = await account.connectWallet();
		contractId = cid;
		console.log(contractId);
	}
	async function getWalletData() {
		walletData = await account.getWalletData();
	}
	async function addSigner() {
		// TODO add existing signer vs always creating a new one
		// Will require a lookup onchain for the existing signer on an existing wallet
		// I also think this currently will require removing that signer from its current wallet in order to add it as a signer to an alternative wallet

		const user = prompt("Give this passkey a name");

		if (!user) return;

		keys = await account.createWallet("Super Peach", user);
		console.log(keys);

		const { built } = await account.wallet!.add_sig({
			id: keys.contractSalt,
			pk: keys.publicKey!,
		});

		const txn = await account.sign(built!, 'sudo');

		const res = await account.send(txn, sequenceKeypair.secret());

		console.log(res);
	}
	async function removeSigner(signer: Uint8Array) {
		const { built } = await account.wallet!.rm_sig({
			id: Buffer.from(signer),
		});

		const txn = await account.sign(built!, 'sudo');

		const res = await account.send(txn, sequenceKeypair.secret());

		console.log(res);
	}
	async function resudo(signer: Uint8Array) {
		// TODO when resudo'ing we need to update the account.id to the new sudo sig
		// Or really we should probably just generally be smarter about what signature we need for a given wallet by tracking all available signers and if we're signing a sudo tx use the sudo key

		// TODO at the very least we need to update account.sudo to the new sudo sig
		// Otherwise we'll keep the old sudo sig which will break future sudo calls 

		const { built } = await account.wallet!.resudo({
			id: Buffer.from(signer),
		});

		const txn = await account.sign(built!, 'sudo');

		const res = await account.send(txn, sequenceKeypair.secret());

		console.log(res);
	}
	async function transfer() {}

	function arraysEqual(arr1: Uint8Array, arr2: Uint8Array) {
		return (
			arr1?.length === arr2?.length &&
			arr1.every((value, index) => value === arr2[index])
		);
	}
</script>

<main>
	<button on:click={register}>Register</button>
	<button on:click={signIn}>Sign In</button>

	{#if contractId}
		<p>{contractId}</p>
		<button on:click={addSigner}>Add Signer</button>
		<!-- <button on:click={listSigners}>List Signers</button> -->
		<button on:click={getWalletData}>Get Wallet Data</button>
	{/if}

	<ul>
		{#each walletData.size ? walletData.get("sigs") : [] as signer}
			<li>
				{Buffer.from(signer).toString("base64")}
				{#if walletData.size && !arraysEqual(signer, walletData.get("sudo_sig"))}
					<button on:click={() => resudo(signer)}>Make Sudo</button>
					<button on:click={() => removeSigner(signer)}>Remove</button
					>
				{/if}
			</li>
		{/each}
	</ul>
</main>

<style>
</style>
