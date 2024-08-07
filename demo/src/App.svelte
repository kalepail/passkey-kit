<script lang="ts">
	import base64url from "base64url";
	import { Buffer } from "buffer";
	import {
		account,
		fundPubkey,
		fundSigner,
		native,
		server,
	} from "./lib/common";

	let keyId: string;
	let contractId: string;
	let admins: number;
	let adminKeyId: string | undefined;
	let balance: string;
	let signers: {
		id: string;
		pk: string;
		admin: boolean;
		expired?: boolean | undefined;
	}[] = [];

	let keyName: string = "";
	let keyAdmin: boolean = false;

	if (localStorage.hasOwnProperty("sp:keyId")) {
		keyId = localStorage.getItem("sp:keyId")!;
		connect(keyId);
	}

	async function register() {
		const user = prompt("Give this passkey a name");

		if (!user) return;

		try {
			const {
				keyId: kid,
				contractId: cid,
				xdr,
			} = await account.createWallet("Super Peach", user);
			const res = await server.send(xdr);

			console.log(res);

			keyId = base64url(kid);
			localStorage.setItem("sp:keyId", keyId);

			contractId = cid;
			console.log("register", cid);

			await getWalletSigners();
			await fundWallet();
		} catch (err: any) {
			alert(err.message)
		}
	}
	async function connect(keyId_?: string) {
		try {
			const { keyId: kid, contractId: cid } = await account.connectWallet({
				keyId: keyId_,
				getContractId: (keyId) => server.getContractId(keyId),
			});

			keyId = base64url(kid);
			localStorage.setItem("sp:keyId", keyId);

			contractId = cid;
			console.log("connect", cid);

			await getWalletBalance();
			await getWalletSigners();
		} catch (err: any) {
			alert(err.message)
		}
	}
	async function reset() {
		localStorage.removeItem("sp:keyId");
		location.reload();
	}

	async function addSigner(publicKey?: string) {
		try {
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
				admin: keyAdmin,
			});

			const xdr = await account.sign(built!, { keyId: adminKeyId });
			const res = await server.send(xdr);

			console.log(res);

			await getWalletSigners();

			keyName = "";
			keyAdmin = false;
		} catch (err: any) {
			alert(err.message)
		}
	}
	async function removeSigner(signer: string) {
		try {
			const { built } = await account.wallet!.remove({
				id: base64url.toBuffer(signer),
			});

			const xdr = await account.sign(built!, { keyId: adminKeyId });
			const res = await server.send(xdr);

			console.log(res);

			await getWalletSigners();
		} catch (err: any) {
			alert(err.message)
		}
	}
	async function fundWallet() {
		const { built, ...transfer } = await native.transfer({
			to: contractId,
			from: fundPubkey,
			amount: BigInt(100 * 10_000_000),
		});

		await transfer.signAuthEntries({
			publicKey: fundPubkey,
			signAuthEntry: (auth) => fundSigner.signAuthEntry(auth),
		});

		const res = await server.send(built!.toXDR());

		console.log(res);

		await getWalletBalance();
	}
	async function walletTransfer(signer: string) {
		const { built } = await native.transfer({
			to: account.factory.options.contractId,
			from: contractId,
			amount: BigInt(10_000_000),
		});

		const xdr = await account.sign(built!, { keyId: signer });
		const res = await server.send(xdr);

		console.log(res);

		await getWalletBalance();
	}
	async function getWalletBalance() {
		const { result } = await native.balance({ id: contractId });

		balance = result.toString();
		console.log(balance);
	}
	async function getWalletSigners() {
		signers = await server.getSigners(contractId);
		console.log(signers);

		const adminKeys = signers.filter(({ admin }) => admin);
		adminKeyId = (adminKeys.find(({ id }) => keyId === id) || adminKeys[0])
			.id;
		admins = adminKeys.length;
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

		<form on:submit|preventDefault>
			<ul style="list-style: none; padding: 0;">
				<li>
					<input
						type="text"
						placeholder="Signer name"
						bind:value={keyName}
					/>
				</li>
				<li>
					<label for="admin">Make admin?</label>
					<input
						type="checkbox"
						id="admin"
						name="admin"
						bind:checked={keyAdmin}
					/>
				</li>
				<li>
					<button on:click={() => addSigner()}>Add Signer</button>
				</li>
			</ul>
		</form>
	{/if}

	<ul>
		{#each signers as { id, pk, admin, expired }}
			<li>
				<button disabled>
					{#if adminKeyId === id}
						{#if keyId === id}◉{:else}◎{/if}&nbsp;
					{:else if keyId === id}
						●&nbsp;
					{/if}
					{#if admin}
						ADMIN
					{:else}
						SESSION
					{/if}
				</button>

				{id}

				<button on:click={() => walletTransfer(id)}
					>Transfer 1 XLM</button
				>

				{#if (!admin || admins > 1) && id !== keyId}
					<button on:click={() => removeSigner(id)}>Remove</button>
				{/if}

				{#if admin && id !== adminKeyId}
					<button on:click={() => (adminKeyId = id)}
						>Set Active Admin</button
					>
				{:else if expired && id === account.keyId}
					<button on:click={() => addSigner(pk)}>Reload</button>
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
