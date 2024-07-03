<script lang="ts">
	import { PasskeyKit } from "passkey-kit";
	import {
		Operation,
		authorizeEntry,
		scValToNative,
	} from "@stellar/stellar-sdk";
	import base64url from "base64url";
	import { Buffer } from "buffer";
	import { getBalance, getEvents, transferSAC } from "./lib/account";
	import { fundKeypair, fundPubkey, rpc } from "./lib/common";
	import { arraysEqual } from "./lib/utils";

	let walletData: Map<string, any> = new Map();
	let keyId: string | undefined;
	let contractId: string;
	let balance: string;
	let signers: Uint8Array[] = [];

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

		await fundWallet();
		await getWalletData();
	}
	async function connect(keyId?: string) {
		const { keyId: kid, contractId: cid } =
			await account.connectWallet(keyId);

		localStorage.setItem("sp:keyId", base64url(kid));

		contractId = cid;
		console.log("connect", cid);

		await getWalletBalance();
		await getWalletData();
	}
	async function reset() {
		localStorage.removeItem("sp:keyId");
		location.reload();
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

		const xdr = await account.sign(built!, { keyId: "super" });
		const res = await account.send(xdr);

		console.log(res);

		await getWalletData();
	}
	async function removeSigner(signer: Uint8Array) {
		const { built } = await account.wallet!.rm_sig({
			id: Buffer.from(signer),
		});

		const xdr = await account.sign(built!, { keyId: "super" });
		const res = await account.send(xdr);

		console.log(res);

		await getWalletData();
	}
	async function updateSuper(signer: Uint8Array) {
		const { built } = await account.wallet!.re_super({
			id: Buffer.from(signer),
		});

		const xdr = await account.sign(built!, { keyId: "super" });
		const res = await account.send(xdr);

		console.log(res);

		// update the super signer
		account.superKeyId = base64url(signer);

		await getWalletData();
	}

	async function getWalletBalance() {
		balance = await getBalance(contractId);
		console.log(balance);
	}
	async function getWalletData() {
		walletData = await account.getData();

		(await getEvents(contractId))
			.sort((a, b) => {
				if (a.topic2 !== "rm_sig" && b.topic2 === "rm_sig") return -1;
				else if (a.topic2 === "rm_sig" && b.topic2 !== "rm_sig")
					return 1;
				else return 0;
			})
			.forEach(({ topic2, data }) => {
				if (
					topic2 === "add_sig" &&
					!signers.some((signer) => arraysEqual(signer, data))
				)
					signers.push(data);
				else if (topic2 === "rm_sig")
					signers = signers.filter(
						(signer) => !arraysEqual(signer, data),
					);
			});

		signers = signers;
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
	async function walletTransfer(signer: Uint8Array) {
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
		<button on:click={getWalletData}>Get Wallet Data</button>
		<button on:click={addSigner}>Add Signer</button>
	{/if}

	<ul>
		{#each signers as signer}
			<li>
				{base64url(signer)}

				<button on:click={() => walletTransfer(signer)}
					>Transfer 1 XLM</button
				>

				{#if walletData.size && !arraysEqual(signer, walletData.get("super"))}
					<button on:click={() => updateSuper(signer)}
						>Make Super</button
					>
					<button on:click={() => removeSigner(signer)}>Remove</button
					>
				{/if}
			</li>
		{/each}
	</ul>

	{#if contractId}
		<iframe
			src="https://stellar.expert/explorer/testnet/contract/{contractId}"
			frameborder="0"
			width="1000"
			height="600"
		></iframe>
	{/if}
</main>
