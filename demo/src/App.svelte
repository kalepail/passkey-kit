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
	import { Keypair } from "@stellar/stellar-sdk";
    import { SignerStore, SignerKey, type SignerLimits } from "passkey-kit";

	// TODO need to support two toggles:
	// - between temp and persistent
	// - and admin, basic and policy
	// - full visual support for admin, basic and policy keys

	const ADMIN_KEY = "AAAAEAAAAAEAAAABAAAAEQAAAAEAAAAA"; // TODO very rough until we're actually parsing the limits object
	const NATIVE_SAC =
		"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
	const SAMPLE_POLICY =
		"CBIRRYPWSJDAY5DB2SVWUTOEWITOWWMET5INMBSHOUXECGYYBSZDWPTA";
	const SECRET = "SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W";
	const PUBLIC = "GBVQMKYWGELU6IKLK2U6EIIHTNW5LIUYJE7FUQPG4FAB3QQ3KAINFVYS";

	let keyId: string;
	let contractId: string;
	let admins: number;
	let adminSigner: string | undefined;
	let balance: string;
	let signers: {
		kind: string;
		key: string;
		val: string;
		limits: string;
		expired?: boolean;
	}[] = [];

	let keyName: string = "";
	// let keyAdmin: boolean = false;

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
				built,
			} = await account.createWallet("Super Peach", user);
			const res = await server.send(built);

			console.log(res);

			keyId = base64url(kid);
			localStorage.setItem("sp:keyId", keyId);

			contractId = cid;
			console.log("register", cid);

			await getWalletSigners();
			await fundWallet();
		} catch (err: any) {
			alert(err.message);
		}
	}
	async function connect(keyId_?: string) {
		try {
			const { keyId: kid, contractId: cid } = await account.connectWallet(
				{
					keyId: keyId_,
					getContractId: (keyId) => server.getContractId(keyId),
				},
			);

			keyId = base64url(kid);
			localStorage.setItem("sp:keyId", keyId);

			contractId = cid;
			console.log("connect", cid);

			await getWalletBalance();
			await getWalletSigners();
		} catch (err: any) {
			// alert(err.message)
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
				// keyAdmin = false;
			} else {
				if (!keyName) return;

				const { keyId: kid, publicKey } = await account.createKey(
					"Super Peach",
					keyName,
				);

				id = kid;
				pk = publicKey;
			}

			const at = await account.addSecp256r1(id, pk, new Map(), SignerStore.Temporary);

			await account.sign(at, { keyId: adminSigner });
			const res = await server.send(at.built!);

			console.log(res);

			await getWalletSigners();

			keyName = "";
			// keyAdmin = false;
		} catch (err: any) {
			alert(err.message);
		}
	}
	async function addEd25519Signer() {
		const pubkey = PUBLIC; // prompt('Enter public key');

		if (pubkey) {
			const signer_limits: SignerLimits = new Map();
			// const signer_keys: SignerKey[] = [];

			// signer_keys.push({
			// 	tag: "Policy",
			// 	values: [SAMPLE_POLICY],
			// });

			// signer_limits[0].set(NATIVE_SAC, signer_keys);

			const at = await account.addEd25519(pubkey, signer_limits, SignerStore.Temporary);

			await account.sign(at, { keyId: adminSigner });
			const res = await server.send(at.built!);

			console.log(res);

			await getWalletSigners();
		}
	}
	async function addPolicySigner() {
		const signer_limits: SignerLimits = new Map();
		const signer_keys: SignerKey[] = [];

		signer_keys.push(SignerKey.Ed25519(PUBLIC));

		signer_limits.set(NATIVE_SAC, signer_keys);

		const at = await account.addPolicy(SAMPLE_POLICY, signer_limits, SignerStore.Temporary);

		await account.sign(at, { keyId: adminSigner });
		const res = await server.send(at.built!);

		console.log(res);

		await getWalletSigners();
	}
	async function removeSigner(signer: string, type: string) {
		try {
			let key: SignerKey;

			switch (type) {
				case "Policy":
					key = SignerKey.Policy(signer);
					break;
				case "Ed25519":
					key = SignerKey.Ed25519(signer);
					break;
				case "Secp256r1":
					key = SignerKey.Secp256r1(signer);
					break;
				default:
					throw new Error("Invalid signer type");
			}

			const at = await account.remove(key);

			await account.sign(at, { keyId: adminSigner });
			const res = await server.send(at.built!);

			console.log(res);

			await getWalletSigners();
		} catch (err: any) {
			alert(err.message);
		}
	}
	async function fundWallet() {
		const { built, ...transfer } = await native.transfer({
			to: contractId,
			from: fundPubkey,
			amount: BigInt(100 * 10_000_000),
		});

		await transfer.signAuthEntries({
			address: fundPubkey,
			signAuthEntry: fundSigner.signAuthEntry,
		});

		const res = await server.send(built!);

		console.log(res);

		await getWalletBalance();
	}

	////
	async function multisigTransfer() {
		const keypair = Keypair.fromSecret(SECRET);

		const at = await native.transfer({
			to: account.factory.options.contractId,
			from: contractId,
			amount: BigInt(10_000_000),
		});

		await account.sign(at, { keyId: adminSigner });
		await account.sign(at, { keypair });
		await account.sign(at, { policy: SAMPLE_POLICY });

		console.log(at.built!.toXDR());

		const res = await server.send(at.built!);

		console.log(res);

		await getWalletBalance();
	}
	////

	async function ed25519Transfer() {
		const secret = SECRET; // prompt('Enter secret key');

		if (secret) {
			const keypair = Keypair.fromSecret(secret);
			const at = await native.transfer({
				to: account.factory.options.contractId,
				from: contractId,
				amount: BigInt(10_000_000),
			});

			await account.sign(at, { keypair });

			// NOTE won't work if the ed25519 signer has a policy signer_key restriction
			// If you want this to work you need to remove the policy restriction from the ed25519 signer first
			// (though that will make the policy transfer less interesting)
			const res = await server.send(at.built!);

			console.log(res);

			await getWalletBalance();
		}
	}

	////
	async function policyTransfer() {
		const keypair = Keypair.fromSecret(SECRET);

		let at = await native.transfer({
			to: account.factory.options.contractId,
			from: contractId,
			amount: BigInt(10_000_000),
		});

		await account.sign(at, { keypair });
		await account.sign(at, { policy: SAMPLE_POLICY });

		console.log(at.built!.toXDR());

		const res = await server.send(at.built!);

		console.log(res);

		await getWalletBalance();
	}
	////

	async function walletTransfer(signer: string, kind: string) {
		if (kind === "Policy") {
			return policyTransfer();
		} else if (kind === "Ed25519") {
			return ed25519Transfer();
		}

		const at = await native.transfer({
			to: account.factory.options.contractId,
			from: contractId,
			amount: BigInt(10_000_000),
		});

		await account.sign(at, { keyId: signer });
		const res = await server.send(at.built!);

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

		const adminKeys = signers.filter(({ limits }) => limits === ADMIN_KEY);

		adminSigner = (
			adminKeys.find(({ key }) => keyId === key) || adminKeys[0]
		).key;

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
		<br />
		<button on:click={addEd25519Signer}>Add Ed25519 Signer</button>
		<button on:click={ed25519Transfer}>Ed25519 Transfer</button>
		<br />
		<button on:click={addPolicySigner}>Add Policy Signer</button>
		<button on:click={policyTransfer}>Policy Transfer</button>
		<br />
		<button on:click={multisigTransfer}>Multisig Transfer</button>

		<form on:submit|preventDefault>
			<ul style="list-style: none; padding: 0;">
				<li>
					<input
						type="text"
						placeholder="Signer name"
						bind:value={keyName}
					/>
				</li>
				<!-- <li>
					<label for="admin">Make admin?</label>
					<input
						type="checkbox"
						id="admin"
						name="admin"
						bind:checked={keyAdmin}
					/>
				</li> -->
				<li>
					<button on:click={() => addSigner()}>Add Signer</button>
				</li>
			</ul>
		</form>
	{/if}

	<ul>
		{#each signers as { kind, key, val, limits, expired }}
			<li>
				<button disabled>
					{#if adminSigner === key}
						{#if keyId === key}◉{:else}◎{/if}&nbsp;
					{:else if keyId === key}
						●&nbsp;
					{/if}
					{#if limits === ADMIN_KEY}
						ADMIN
					{:else}
						SESSION
					{/if}
				</button>

				{key}

				<button on:click={() => walletTransfer(key, kind)}
					>Transfer 1 XLM</button
				>

				<!-- TODO rethink {#if (limits !== ADMIN_KEY || admins > 1) && key !== keyId} -->
				<button on:click={() => removeSigner(key, kind)}>Remove</button>
				<!-- {/if} -->

				<!-- TODO redo {#if limits === ADMIN_KEY && key !== adminSigner}
					<button on:click={() => (adminSigner = key)}
						>Set Active Admin</button
					>
				{:else if expired && key === account.keyId}
					<button on:click={() => addSigner(val)}>Reload</button>
				{/if} -->
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
