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
    import { Keypair, nativeToScVal, Operation, scValToNative, Transaction, xdr } from "@stellar/stellar-sdk";
    import { signAuthEntry } from "./lib/sign-auth-entry";
    import { DEFAULT_LTL } from "passkey-kit";
    import { lexicographicalSortNumbers } from "./lib/utils";

	let keyId: string;
	let contractId: string;
	let admins: number;
	let adminSigner: string | undefined;
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
				id: {
					tag: 'Secp256r1',
					values: [[id]]
				},
				pk,
				admin: keyAdmin,
			});

			const xdr = await account.sign(built!, { keyId: adminSigner });
			const res = await server.send(xdr);

			console.log(res);

			await getWalletSigners();

			keyName = "";
			keyAdmin = false;
		} catch (err: any) {
			alert(err.message)
		}
	}
	async function addEd25519Signer() {
		// GBVQMKYWGELU6IKLK2U6EIIHTNW5LIUYJE7FUQPG4FAB3QQ3KAINFVYS
		const pubkey = 'GBVQMKYWGELU6IKLK2U6EIIHTNW5LIUYJE7FUQPG4FAB3QQ3KAINFVYS' // prompt('Enter public key');

		if (pubkey) {
			const keypair = Keypair.fromPublicKey(pubkey);

			console.log(keypair.rawPublicKey());

			const { built } = await account.wallet!.add({
				id: {
					tag: 'Ed25519',
					values: [[keypair.rawPublicKey()]]
				},
				pk: undefined,
				admin: keyAdmin,
			});

			const xdr = await account.sign(built!, { keyId: adminSigner });
			const res = await server.send(xdr);

			console.log(res);

			await getWalletSigners();
		}
	}
	async function removeSigner(signer: string) {
		try {
			const { built } = await account.wallet!.remove({
				id: {
					tag: 'Secp256r1',
					values: [[base64url.toBuffer(signer)]]
				},
			});

			const xdr = await account.sign(built!, { keyId: adminSigner });
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


	async function multiSigTransfer() {
		const keypair = Keypair.fromSecret('SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W');

		const { built } = await native.transfer({
			to: account.factory.options.contractId,
			from: contractId,
			amount: BigInt(10_000_000),
		});

		const tx = await account.sign(built!, { keyId: adminSigner });
		const { operations } = new Transaction(tx, import.meta.env.VITE_networkPassphrase)
		const secp256r1_auth = (operations[0] as Operation.InvokeHostFunction).auth![0]
		const secp256r1_sig = scValToNative(secp256r1_auth.credentials().address().signature())

		const entry = (built!.operations[0] as Operation.InvokeHostFunction).auth![0];
		const ed25519_auth = await signAuthEntry(
			entry,
			keypair,
			secp256r1_auth.credentials().address().signatureExpirationLedger(),
			import.meta.env.VITE_networkPassphrase
		)
		const ed25519_sig = scValToNative(ed25519_auth.credentials().address().signature())		

		// Order this lexicographically by signer bytes
		const signatures: [number[], xdr.ScVal][] = [
			[ed25519_sig[0][1].public_key[0], xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Ed25519'),
				xdr.ScVal.scvMap([
					new xdr.ScMapEntry({
						key: xdr.ScVal.scvSymbol('public_key'),
						val: xdr.ScVal.scvVec([
							xdr.ScVal.scvBytes(ed25519_sig[0][1].public_key[0])
						]),
					}),
					new xdr.ScMapEntry({
						key: xdr.ScVal.scvSymbol('signature'),
						val: xdr.ScVal.scvBytes(ed25519_sig[0][1].signature),
					}),
				])
			])],
			[secp256r1_sig[0][1].id[0], xdr.ScVal.scvVec([
				xdr.ScVal.scvSymbol('Secp256r1'),
				xdr.ScVal.scvMap([
					new xdr.ScMapEntry({
                        key: xdr.ScVal.scvSymbol('authenticator_data'),
                        val: xdr.ScVal.scvBytes(secp256r1_sig[0][1].authenticator_data),
                    }),
                    new xdr.ScMapEntry({
                        key: xdr.ScVal.scvSymbol('client_data_json'),
                        val: xdr.ScVal.scvBytes(secp256r1_sig[0][1].client_data_json),
                    }),
                    new xdr.ScMapEntry({
                        key: xdr.ScVal.scvSymbol('id'),
                        val: xdr.ScVal.scvVec([
                            xdr.ScVal.scvBytes(secp256r1_sig[0][1].id[0])
                        ]),
                    }),
                    new xdr.ScMapEntry({
                        key: xdr.ScVal.scvSymbol('signature'),
                        val: xdr.ScVal.scvBytes(secp256r1_sig[0][1].signature),
                    }),
				])
			])]
		]

		const big_sig = lexicographicalSortNumbers(signatures).map(([, sig]) => sig);

		entry.credentials().address().signatureExpirationLedger(secp256r1_auth.credentials().address().signatureExpirationLedger())
		entry.credentials().address().signature(xdr.ScVal.scvVec(big_sig))

		console.log(built?.toXDR());

		const res = await server.send(built!.toXDR());

		console.log(res);

		await getWalletBalance();
	}


	async function ed25519Transfer() {
		// SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W
		const secret = 'SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W' // prompt('Enter secret key');

		if (secret) {
			const keypair = Keypair.fromSecret(secret);

			const { built } = await native.transfer({
				to: account.factory.options.contractId,
				from: contractId,
				amount: BigInt(10_000_000),
			});

			const { sequence } = await account.rpc.getLatestLedger()

			for (const op of built!.operations) {
				const auths = (op as Operation.InvokeHostFunction).auth

				if (auths?.length) {
					for (let i in auths) {
						auths[i] = await signAuthEntry(
							auths[i],
							keypair,
							sequence + DEFAULT_LTL,
							import.meta.env.VITE_networkPassphrase
						)
					}
				}
        	}

			console.log(built?.toXDR());

			const res = await server.send(built!.toXDR());

			console.log(res);

			await getWalletBalance();
		}
	}
	async function walletTransfer(signer: string) {
		const { built } = await native.transfer({
			to: account.factory.options.contractId,
			from: contractId,
			amount: BigInt(10_000_000),
		});

		const xdr = await account.sign(built!, { keyId: signer });
		const res = await server.send(xdr);

		console.log(built?.toXDR());

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
		adminSigner = (adminKeys.find(({ id }) => keyId === id) || adminKeys[0])
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
		<button on:click={addEd25519Signer}>Add Ed25519 Signer</button>
		<button on:click={ed25519Transfer}>Ed25519 Transfer</button>
		<button on:click={multiSigTransfer}>Multisig Transfer</button>

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
					{#if adminSigner === id}
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

				{#if admin && id !== adminSigner}
					<button on:click={() => (adminSigner = id)}
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
