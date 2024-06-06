<script lang="ts">
	import { PasskeyAccount } from "passkey-kit";
	import { Networks, Transaction } from "@stellar/stellar-sdk";
	import base64url from "base64url";
	import { Buffer } from "buffer";
	import { fund, getBalance, transfer } from "./lib/account";
    import { sequenceKeypair } from "./lib/common";
	import { arraysEqual } from "./lib/utils";

	let walletData: Map<string, any> = new Map();
	let contractId: string;
	let balance: string;

	const account = new PasskeyAccount({
		sequencePublicKey: sequenceKeypair.publicKey(),
		networkPassphrase: import.meta.env.VITE_networkPassphrase as Networks,
		horizonUrl: import.meta.env.VITE_horizonUrl,
		rpcUrl: import.meta.env.VITE_rpcUrl,
		feeBumpUrl: import.meta.env.VITE_feeBumpUrl,
		feeBumpJwt: import.meta.env.VITE_feeBumpJwt,
	});

	async function register() {
		const user = prompt("Give this passkey a name");

		if (!user) return;

		const { contractId: cid, xdr } = await account.createWallet("Super Peach", user);

		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

		const res = await account.send(txn);

		contractId = cid;
		console.log(contractId);
		console.log(res);
	}
	async function signIn() {
		contractId = await account.connectWallet();
		console.log(contractId);
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

		const { keyId, publicKey } = await account.createKey("Super Peach", user);

		const { built } = await account.wallet!.add_sig({
			id: keyId,
			pk: publicKey!,
		});

		// xdr to txn funk due to TypeError: XDR Write Error: [object Object] is not a DecoratedSignature
		const xdr = await account.sign(built!, { id: 'sudo' });
		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

		const res = await account.send(txn);

		console.log(res);
	}
	async function removeSigner(signer: Uint8Array) {
		const { built } = await account.wallet!.rm_sig({
			id: Buffer.from(signer),
		});

		const xdr = await account.sign(built!, { id: 'sudo' });
		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

		const res = await account.send(txn);

		console.log(res);
	}
	async function resudo(signer: Uint8Array) {
		const { built } = await account.wallet!.resudo({
			id: Buffer.from(signer)
		});

		const xdr = await account.sign(built!, { id: "sudo" });
		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

		const res = await account.send(txn);

		console.log(res);

		// update the sudo signer
		account.sudo = base64url(signer);
	}

	async function getWalletData() {
		walletData = await account.getData();
	}
	async function fundWallet() {
		const res = await fund(contractId);
		console.log(res);
	}
	async function getWalletBalance() {
		balance = await getBalance(contractId);
		console.log(balance);
	}
	async function walletTransfer(signer: Uint8Array) {
		const built = await transfer(
			contractId,
			account.factory.options.contractId,
		);

		const xdr = await account.sign(built, { id: signer });
		const txn = new Transaction(xdr, import.meta.env.VITE_networkPassphrase)

		txn.sign(sequenceKeypair);

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
			<p>{parseFloat((Number(balance) / 10_000_000).toFixed(7))} XLM</p>
		{/if}

		<button on:click={fundWallet}>Add Funds</button>
		<button on:click={getWalletBalance}>Get Balance</button>
		<button on:click={getWalletData}>Get Wallet Data</button>
		<button on:click={addSigner}>Add Signer</button>
	{/if}

	<ul>
		{#each walletData.size ? walletData.get("sigs") : [] as signer}
			<li>
				{base64url(signer)}

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
