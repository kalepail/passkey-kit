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
	let superKeyId: string;
	let balance: string;
	let signers: Map<string, Uint8Array> = new Map();

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

	async function addSigner(pubkey?: Uint8Array) {
		let id: Buffer;
		let pk: Buffer;

		if (pubkey && keyId) {
			id = base64url.toBuffer(keyId);
			pk = Buffer.from(pubkey);
		} else {
			const user = prompt("Give this passkey a name");

			if (!user) return;

			const { keyId: kid, publicKey } = await account.createKey(
				"Super Peach",
				user,
			);

			id = kid;
			pk = publicKey;
		}

		const { built } = await account.wallet!.add_sig({
			id,
			pk,
		});

		const xdr = await account.sign(built!, { keyId: superKeyId });
		const res = await account.send(xdr);

		console.log(res);

		await getWalletSigners();
	}
	async function removeSigner(signer: string) {
		const { built } = await account.wallet!.rm_sig({
			id: base64url.toBuffer(signer),
		});

		const xdr = await account.sign(built!, { keyId: superKeyId });
		const res = await account.send(xdr);

		console.log(res);

		await getWalletSigners();
	}
	async function updateSuper(signer: string) {
		const { built } = await account.wallet!.re_super({
			id: base64url.toBuffer(signer),
		});

		const xdr = await account.sign(built!, { keyId: superKeyId });
		const res = await account.send(xdr);

		console.log(res);

		await getWalletSigners();
	}

	async function getWalletBalance() {
		balance = await getBalance(contractId);
		console.log(balance);
	}
	async function getWalletSigners() {
		superKeyId = await account.getSuperKeyId();
		signers = await getSigners(contractId);
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
		<button on:click={() => addSigner()}>Add Signer</button>
	{/if}

	<ul>
		{#each signers.entries() as [id]}
			<li>
				{id}

				<button on:click={() => walletTransfer(id)}
					>Transfer 1 XLM</button
				>

				{#if id !== superKeyId}
					<button on:click={() => updateSuper(id)}>Make Super</button>

					{#if account.keyExpired && id === account.keyId}
						<button on:click={() => addSigner(signers.get(keyId))}
							>Reload</button
						>
					{:else}
						<button on:click={() => removeSigner(id)}>Remove</button
						>
					{/if}
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
