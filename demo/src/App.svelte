<script lang="ts">
	import { PasskeyAccount } from "../../passkey-kit";
	import { Networks, Keypair, Transaction } from "@stellar/stellar-sdk";
	import base64url from "base64url";
	import { Buffer } from "buffer";
	import { fund, getBalance, transfer } from "./lib/account";
    import { keypair } from "./lib/common";
	import { arraysEqual } from "./lib/utils";

	let walletData: Map<string, any> = new Map();
	let contractId: string;
	let keys: {
		passKeyId: Buffer;
		publicKey: Buffer | undefined;
	};
	let balance: string;

	/* TODO 
		- Review base fee of inner tx as related to the outer. 
			Right now I'm passing a 10,000 hard code for both. 
			Do I need the inner or is that already accounted for in simulation?
	*/

	const sequenceKeypair = Keypair.fromSecret(
		// GDDRNRFPWBRJ6NNC2SDEPR7AXBVFWGIS3O66NKDZ7BUERB37H4P4GVIM
		"SCQZ7CEQZ3R47SECW4XKMOMSA3QO5YPGKVPPWALXMDVWR5N2CLPGKDMP",
	);
	const feeBumpJwt =
		"eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI3MTJmM2FmNjA2MWQyNmFjNGM1NzMxNTFlMTE2NTQ3YTNiNThiMzY0ZmNmNWE2ZGY4ZjFhNTkxNmQ1NDBjYWUzIiwiZXhwIjoxNzMyODExOTU2LCJpYXQiOjE3MTcwODcxNTZ9.VfHVZOSleLvYVfH5nmdWFgDgHJ5Ddfa1m1e1WtlFTgA";

	// TODO use env vars everywhere it makes sense
	const account = new PasskeyAccount({
		sequencePublicKey: sequenceKeypair.publicKey(),
		networkPassphrase: import.meta.env.VITE_networkPassphrase as Networks,
		horizonUrl: import.meta.env.VITE_horizonUrl,
		rpcUrl: import.meta.env.VITE_rpcUrl,
		feeBumpUrl: "https://feebump.sdf-ecosystem.workers.dev",
		feeBumpJwt,
	});

	async function register() {
		const user = prompt("Give this passkey a name");

		if (!user) return;

		keys = await account.createWallet("Super Peach", user);
		const { contractId: cid, xdr } = await account.deployWallet(
			keys.passKeyId,
			keys.publicKey!,
		)
		contractId = cid;
		console.log(contractId);

		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

		const res = await account.send(txn);

		console.log(res);
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
		/* TODO 
			- Add existing signer vs always creating a new one
				Will require a lookup onchain for the existing passkey public key on an existing wallet
				I also think this currently will require removing that signer from its current wallet in order to add it as a signer to an alternative wallet
				@Later
		*/

		const user = prompt("Give this passkey a name");

		if (!user) return;

		keys = await account.createWallet("Super Peach", user);
		console.log(keys);

		const { built } = await account.wallet!.add_sig({
			id: keys.passKeyId,
			pk: keys.publicKey!,
		});

		// xdr to txn funk due to TypeError: XDR Write Error: [object Object] is not a DecoratedSignature
		const xdr = await account.sign(built!, "sudo");
		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

		const res = await account.send(txn);

		console.log(res);
	}
	async function removeSigner(signer: Uint8Array) {
		const { built } = await account.wallet!.rm_sig({
			id: Buffer.from(signer),
		});

		const xdr = await account.sign(built!, "sudo");
		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

		const res = await account.send(txn);

		console.log(res);
	}
	async function resudo(signer: Uint8Array) {
		const id = Buffer.from(signer);
		const { built } = await account.wallet!.resudo({
			id,
		});

		const xdr = await account.sign(built!, "sudo");
		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

		const res = await account.send(txn);

		console.log(res);

		// update the sudo signer
		account.sudo = base64url(id);
	}

	async function fundWallet() {
		const res = await fund(contractId);
		console.log(res);
	}
	async function getWalletBalance() {
		balance = await getBalance(contractId);
	}
	async function walletTransfer(signer: Uint8Array) {
		const built = await transfer(
			contractId,
			account.factory.options.contractId,
		);

		const xdr = await account.sign(built, base64url(signer));
		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(keypair);

		const res = await account.send(txn);

		console.log(res);
	}
</script>

<main>
	<button on:click={register}>Register</button>
	<button on:click={signIn}>Sign In</button>

	{#if contractId}
		<p>{contractId}</p>

		{#if balance}
			<p>{Math.floor(Number(balance) / 10_000_000)} XLM</p>
		{/if}

		<button on:click={fundWallet}>Add Funds</button>
		<button on:click={getWalletBalance}>Get Balance</button>
		<button on:click={getWalletData}>Get Wallet Data</button>
		<button on:click={addSigner}>Add Signer</button>
	{/if}

	<ul>
		{#each walletData.size ? walletData.get("sigs") : [] as signer}
			<li>
				{Buffer.from(signer).toString("base64")}

				<button on:click={() => walletTransfer(signer)}>Transfer 1 XLM</button
				>

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
