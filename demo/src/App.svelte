<script lang="ts">
	import { PasskeyKit } from "passkey-kit";
	import { Operation, authorizeEntry } from "@stellar/stellar-sdk";
	import base64url from "base64url";
	import { Buffer } from "buffer";
	import {
		getContractId,
		getBalance,
		getSigners,
		transferSAC,
	} from "./lib/account";
	import { fundKeypair, fundPubkey } from "./lib/common";

	let keyId: string;
	let contractId: string;
	let adminKeyId: string | undefined;
	let balance: string;
	let signers: { id: string, pk: string, admin: boolean }[] = [];

	let keyName: string;
	let keyAdmin: boolean = false;

	const account = new PasskeyKit({
		rpcUrl: import.meta.env.VITE_rpcUrl,
		launchtubeUrl: import.meta.env.VITE_launchtubeUrl,
		launchtubeJwt: import.meta.env.VITE_launchtubeJwt,
		networkPassphrase: import.meta.env.VITE_networkPassphrase,
		factoryContractId: import.meta.env.VITE_factoryContractId,
	});

	if (localStorage.hasOwnProperty("sp:keyId")) {
		keyId = localStorage.getItem("sp:keyId")!;
		connect(keyId);
	}

	async function register() {
		const user = prompt("Give this passkey a name");

		if (!user) return;

		const {
			keyId,
			contractId: cid,
			xdr,
		} = await account.createWallet("Super Peach", user);
		const res = await account.send(xdr);

		console.log(res);

		localStorage.setItem("sp:keyId", base64url(keyId));

		contractId = cid;
		console.log("register", cid);

		await getWalletSigners();
		await fundWallet();
	}
	async function connect(keyId?: string) {
		const { keyId: kid, contractId: cid } = await account.connectWallet({
			keyId,
			getContractId, // only strictly needed when the passed keyId will not derive to any or the correct contractId
		});

		localStorage.setItem("sp:keyId", base64url(kid));

		contractId = cid;
		console.log("connect", cid);

		await getWalletBalance();
		await getWalletSigners();
	}
	async function reset() {
		localStorage.removeItem("sp:keyId");
		location.reload();
	}

	async function addSigner(publicKey?: string) {
		let id: Buffer;
		let pk: Buffer;

		if (publicKey && keyId) {
			id = base64url.toBuffer(keyId);
			pk = base64url.toBuffer(publicKey);
			keyAdmin = false;
		} else {
			if (!keyName) return;

			const { keyId: kid, publicKey } = await account.createKey(
				"Super Peach",
				keyName,
			);

			id = kid;
			pk = publicKey;
		}

		const { built } = await account.wallet!.add({
			id,
			pk,
			admin: keyAdmin
		});

		const xdr = await account.sign(built!, { keyId: adminKeyId });
		const res = await account.send(xdr);

		console.log(res);

		await getWalletSigners();
	}
	async function removeSigner(signer: string) {
		const { built } = await account.wallet!.remove({
			id: base64url.toBuffer(signer),
		});

		const xdr = await account.sign(built!, { keyId: adminKeyId });
		const res = await account.send(xdr);

		console.log(res);

		await getWalletSigners();
	}

	async function getWalletBalance() {
		balance = await getBalance(contractId);
		console.log(balance);
	}
	async function getWalletSigners() {
		signers = await getSigners(contractId);
		adminKeyId = signers.find(({ admin }) => admin)?.id;
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

		await getWalletBalance();
	}
	async function walletTransfer(signer: string) {
		const { built } = await transferSAC({
			SAC: import.meta.env.VITE_nativeContractId,
			from: contractId,
			to: account.factory.options.contractId,
			amount: 10_000_000,
		});

		const xdr = await account.sign(built, { keyId: signer });
		const res = await account.send(xdr);

		console.log(res);

		await getWalletBalance();
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

		<ul style="list-style: none; padding: 0;">
			<li><input type="text" placeholder="Signer name" bind:value={keyName}></li>
			<li>
				<label for="admin">Make admin?</label>
				<input type="checkbox" id="admin" name="admin" bind:checked={keyAdmin}>
			</li>
			<li>
				<button on:click={() => addSigner()}>Add Signer</button>
			</li>
		</ul>
	{/if}

	<ul>
		{#each signers as { id, pk, admin }}
			<li>
				{#if admin}
					<button disabled>
						{#if adminKeyId === id} ◉ {/if}&nbsp;
						ADMIN
					</button>
				{:else}
					<button disabled>SESSION</button>
				{/if}

				{ id }

				<button on:click={() => walletTransfer(id)}
					>Transfer 1 XLM</button
				>

				{#if account.keyExpired && id === account.keyId}
					<button on:click={() => addSigner(pk)}
						>Reload</button
					>
				{:else if admin && id !== adminKeyId}
					<button on:click={() => adminKeyId = id}>Set Active Admin</button>
				{:else}
					<button on:click={() => removeSigner(id)}>Remove</button
					>
				{/if}
			</li>
		{/each}
	</ul>

	<!-- {#if contractId}
		<iframe
			src="https://stellar.expert/explorer/testnet/contract/{contractId}"
			frameborder="0"
			width="1000"
			height="600"
		></iframe>
	{/if} -->
</main>
