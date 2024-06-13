<script lang="ts">
	import { PasskeyKit } from "passkey-kit";
	import { Address, Networks, Operation, authorizeEntry } from "@stellar/stellar-sdk";
	import base64url from "base64url";
	import { Buffer } from "buffer";
	import { getBalance, transferSAC } from "./lib/account";
	import { fundKeypair, fundPubkey } from "./lib/common";
	import { arraysEqual } from "./lib/utils";

	let walletData: Map<string, any> = new Map();
	let keyId: string | undefined;
	let contractId: string;
	let balance: string;

	const account = new PasskeyKit({
		rpcUrl: import.meta.env.VITE_rpcUrl,
		launchtubeUrl: import.meta.env.VITE_launchtubeUrl,
		launchtubeJwt: import.meta.env.VITE_launchtubeJwt,
		networkPassphrase: import.meta.env.VITE_networkPassphrase as Networks,
	});

	if (localStorage.hasOwnProperty("sp:keyId")) {
		keyId = localStorage.getItem("sp:keyId")!
		connect(keyId)
	}

	async function register() {
		const user = prompt("Give this passkey a name");

		if (!user) return;

		const { keyId, contractId: cid, xdr } = await account.createWallet(
			"Super Peach",
			user,
		);
		const res = await account.send(xdr);

		console.log(res);

		localStorage.setItem('sp:keyId', base64url(keyId))

		contractId = cid;
		console.log(cid);

		await fundWallet();
		await getWalletBalance();
		await getWalletData();
	}
	async function connect(keyId?: string) {
		const { keyId: kid, contractId: cid } = await account.connectWallet(keyId);

		localStorage.setItem('sp:keyId', base64url(kid))

		contractId = cid;
		console.log(cid);

		await getWalletBalance();
		await getWalletData();
	}
	async function reset() {
		localStorage.removeItem('sp:keyId')
		location.reload()
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

		const { keyId, publicKey } = await account.createKey(
			"Super Peach",
			user,
		);

		const { built } = await account.wallet!.add_sig({
			id: keyId,
			pk: publicKey!,
		});

		const xdr = await account.sign(built!, { keyId: "sudo" });
		const res = await account.send(xdr);

		console.log(res);
	}
	async function removeSigner(signer: Uint8Array) {
		const { built } = await account.wallet!.rm_sig({
			id: Buffer.from(signer),
		});

		const xdr = await account.sign(built!, { keyId: "sudo" });
		const res = await account.send(xdr);

		console.log(res);
	}
	async function resudo(signer: Uint8Array) {
		const { built } = await account.wallet!.resudo({
			id: Buffer.from(signer),
		});

		const xdr = await account.sign(built!, { keyId: "sudo" });
		const res = await account.send(xdr);

		console.log(res);

		// update the sudo signer
		account.sudoKeyId = base64url(signer);
	}

	async function getWalletBalance() {
		balance = await getBalance(contractId);
		console.log(balance);
	}
	async function getWalletData() {
		walletData = await account.getData();
	}

	async function fundWallet() {
		const { txn, sim } = await transferSAC({
			SAC: import.meta.env.VITE_nativeContractId,
			from: fundPubkey,
			to: contractId,
			amount: 100 * 10_000_000,
		});

		const op = txn.operations[0] as Operation.InvokeHostFunction;

		for (const auth of sim.result?.auth || []) {
			const signEntry = await authorizeEntry(
				auth,
				await fundKeypair,
				sim.latestLedger + 60,
				import.meta.env.VITE_networkPassphrase,
			);

			op.auth!.push(signEntry);
		}

		const res = await account.send(txn.toXDR());

		console.log(res);
	}
	async function walletTransfer(signer: Uint8Array) {
		const { built } = await transferSAC({
			SAC: import.meta.env.VITE_nativeContractId,
			from: contractId,
			to: account.factory.options.contractId,
			amount: 10_000_000,
		});

		const xdr = await account.sign(built, { keyId: signer });

		console.log(xdr);

		// const res = await account.send(xdr);

		// console.log(res);
	}
</script>

<main>
	<button on:click={register}>Register</button>
	<button on:click={() => connect()}>Sign In</button>
	<button on:click={reset}>Reset</button>

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

				<button on:click={() => walletTransfer(signer)}
					>Transfer 1 XLM</button
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
