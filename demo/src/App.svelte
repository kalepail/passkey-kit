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
	import {
		Address,
		hash,
		Keypair,
		nativeToScVal,
		Operation,
		scValToNative,
		Transaction,
		xdr,
	} from "@stellar/stellar-sdk";
	import { signAuthEntry } from "./lib/sign-auth-entry";
	import { DEFAULT_LTL } from "passkey-kit";
	import { lexicographicalSortNumbers } from "./lib/utils";

	// TODO need to support two toggles:
	// - between temp and persistent
	// - and admin, basic and policy
	// - full visual support for admin, basic and policy keys

	let keyId: string;
	let contractId: string;
	let admins: number;
	let adminSigner: string | undefined;
	let balance: string;
	let signers: {
		kind: string;
		key: string;
		val: string;
		type: string;
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

			const { built } = await account.wallet!.add({
				signer: {
					tag: "Secp256r1",
					values: [
						[id],
						[pk],
						{ tag: "Temporary", values: undefined },
						{ tag: "Basic", values: undefined },
					],
				},
				// admin: keyAdmin,
			});

			const xdr = await account.sign(built!, { keyId: adminSigner });
			const res = await server.send(xdr);

			console.log(res);

			await getWalletSigners();

			keyName = "";
			// keyAdmin = false;
		} catch (err: any) {
			alert(err.message);
		}
	}
	async function addEd25519Signer() {
		// GBVQMKYWGELU6IKLK2U6EIIHTNW5LIUYJE7FUQPG4FAB3QQ3KAINFVYS
		const pubkey =
			"GBVQMKYWGELU6IKLK2U6EIIHTNW5LIUYJE7FUQPG4FAB3QQ3KAINFVYS"; // prompt('Enter public key');

		if (pubkey) {
			const keypair = Keypair.fromPublicKey(pubkey);

			const { built } = await account.wallet!.add({
				signer: {
					tag: "Ed25519",
					values: [
						[keypair.rawPublicKey()],
						{ tag: "Temporary", values: undefined },
						{ tag: "Basic", values: undefined },
					],
				},
				// admin: keyAdmin,
			});

			const xdr = await account.sign(built!, { keyId: adminSigner });
			const res = await server.send(xdr);

			console.log(res);

			await getWalletSigners();
		}
	}
	async function addPolicySigner() {
		const sample_policy =
			"CA74HHGO6MVIENYEEDNCBMRIKVYRRDEXJZGVWVLC3PDRBBNTEH65AE4F";

		const { built } = await account.wallet!.add({
			signer: {
				tag: "Policy",
				values: [
					[sample_policy],
					{ tag: "Temporary", values: undefined },
					{ tag: "Basic", values: undefined },
				],
			},
			// admin: keyAdmin,
		});

		const xdr = await account.sign(built!, { keyId: adminSigner });
		const res = await server.send(xdr);

		console.log(res);

		await getWalletSigners();
	}
	async function removeSigner(signer: string, type: string) {
		try {
			const { built } = await account.wallet!.remove({
				signer_key:
					type === "Secp256r1"
						? {
								tag: "Secp256r1",
								values: [[base64url.toBuffer(signer)]],
							}
						: type === "Policy"
							? {
									tag: "Policy",
									values: [[signer]],
								}
							: {
									tag: "Ed25519",
									values: [
										[
											Keypair.fromPublicKey(
												signer,
											).rawPublicKey(),
										],
									],
								},
			});

			const xdr = await account.sign(built!, { keyId: adminSigner });
			const res = await server.send(xdr);

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
			publicKey: fundPubkey,
			signAuthEntry: (auth) => fundSigner.signAuthEntry(auth),
		});

		const res = await server.send(built!.toXDR());

		console.log(res);

		await getWalletBalance();
	}

	////
	async function multiSigTransfer() {
		const keypair = Keypair.fromSecret(
			"SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W",
		);

		const { built } = await native.transfer({
			to: account.factory.options.contractId,
			from: contractId,
			amount: BigInt(10_000_000),
		});

		const tx = await account.sign(built!, { keyId: adminSigner });
		const { operations } = new Transaction(
			tx,
			import.meta.env.VITE_networkPassphrase,
		);
		const secp256r1_auth = (operations[0] as Operation.InvokeHostFunction)
			.auth![0];
		const secp256r1_sig = scValToNative(
			secp256r1_auth.credentials().address().signature(),
		);

		const entry = (built!.operations[0] as Operation.InvokeHostFunction)
			.auth![0];
		const ed25519_auth = await signAuthEntry(
			entry,
			keypair,
			secp256r1_auth.credentials().address().signatureExpirationLedger(),
			import.meta.env.VITE_networkPassphrase,
		);
		const ed25519_sig = scValToNative(
			ed25519_auth.credentials().address().signature(),
		);

		// Order this lexicographically by signer bytes
		const signatures: [number[], xdr.ScVal][] = [
			[
				ed25519_sig[0][1].public_key[0],
				xdr.ScVal.scvVec([
					xdr.ScVal.scvSymbol("Ed25519"),
					xdr.ScVal.scvMap([
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("public_key"),
							val: xdr.ScVal.scvVec([
								xdr.ScVal.scvBytes(
									ed25519_sig[0][1].public_key[0],
								),
							]),
						}),
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("signature"),
							val: xdr.ScVal.scvBytes(
								ed25519_sig[0][1].signature,
							),
						}),
					]),
				]),
			],
			[
				secp256r1_sig[0][1].id[0],
				xdr.ScVal.scvVec([
					xdr.ScVal.scvSymbol("Secp256r1"),
					xdr.ScVal.scvMap([
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("authenticator_data"),
							val: xdr.ScVal.scvBytes(
								secp256r1_sig[0][1].authenticator_data,
							),
						}),
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("client_data_json"),
							val: xdr.ScVal.scvBytes(
								secp256r1_sig[0][1].client_data_json,
							),
						}),
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("id"),
							val: xdr.ScVal.scvVec([
								xdr.ScVal.scvBytes(secp256r1_sig[0][1].id[0]),
							]),
						}),
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("signature"),
							val: xdr.ScVal.scvBytes(
								secp256r1_sig[0][1].signature,
							),
						}),
					]),
				]),
			],
		];

		const big_sig = lexicographicalSortNumbers(signatures).map(
			([, sig]) => sig,
		);

		entry
			.credentials()
			.address()
			.signatureExpirationLedger(
				secp256r1_auth
					.credentials()
					.address()
					.signatureExpirationLedger(),
			);
		entry.credentials().address().signature(xdr.ScVal.scvVec(big_sig));

		const res = await server.send(built!.toXDR());

		console.log(res);

		await getWalletBalance();
	}
	////

	async function ed25519Transfer() {
		// SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W
		const secret =
			"SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W"; // prompt('Enter secret key');

		if (secret) {
			const keypair = Keypair.fromSecret(secret);

			const { built } = await native.transfer({
				to: account.factory.options.contractId,
				from: contractId,
				amount: BigInt(10_000_000),
			});

			const { sequence } = await account.rpc.getLatestLedger();

			for (const op of built!.operations) {
				const auths = (op as Operation.InvokeHostFunction).auth;

				if (auths?.length) {
					for (let i in auths) {
						auths[i] = await signAuthEntry(
							auths[i],
							keypair,
							sequence + DEFAULT_LTL,
							import.meta.env.VITE_networkPassphrase,
						);
					}
				}
			}

			const res = await server.send(built!.toXDR());

			console.log(res);

			await getWalletBalance();
		}
	}

	////
	async function policySigTransfer() {
		const sample_policy =
			"CA74HHGO6MVIENYEEDNCBMRIKVYRRDEXJZGVWVLC3PDRBBNTEH65AE4F";

		// SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W
		const secret =
			"SBEIDWQVWNLPCP35EYQ6GLWKFQ2MDY7APRLOQ3AJNU6KSE7FXGA7C55W"; // prompt('Enter secret key');

		if (secret) {
			const keypair = Keypair.fromSecret(secret);

			const { built } = await native.transfer({
				to: account.factory.options.contractId,
				from: contractId,
				amount: BigInt(10_000_000),
			});

			const { sequence } = await account.rpc.getLatestLedger();

			const op = built!.operations[0] as Operation.InvokeHostFunction;
			const auths = op.auth!;
			const auth = xdr.SorobanAuthorizationEntry.fromXDR(
				auths[0].toXDR(),
			);
			const credentials = auth.credentials().address();
			const invokeContract = op.func.invokeContract();

			const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
				new xdr.HashIdPreimageSorobanAuthorization({
					networkId: hash(
						Buffer.from(import.meta.env.VITE_networkPassphrase),
					),
					nonce: credentials.nonce(),
					signatureExpirationLedger: sequence + DEFAULT_LTL,
					invocation: auth.rootInvocation(),
				}),
			);
			const payload = hash(preimage.toXDR());
			const signature = keypair.sign(payload);

			credentials.signatureExpirationLedger(sequence + DEFAULT_LTL);
			credentials.signature(
				xdr.ScVal.scvVec([
					xdr.ScVal.scvVec([
						xdr.ScVal.scvSymbol("Policy"),
						xdr.ScVal.scvVec([
							Address.fromString(sample_policy).toScVal(),
						]),
					]),
					xdr.ScVal.scvVec([
						xdr.ScVal.scvSymbol("Ed25519"),
						xdr.ScVal.scvMap([
							new xdr.ScMapEntry({
								key: xdr.ScVal.scvSymbol("public_key"),
								val: xdr.ScVal.scvVec([
									xdr.ScVal.scvBytes(
										keypair.rawPublicKey(),
									),
								]),
							}),
							new xdr.ScMapEntry({
								key: xdr.ScVal.scvSymbol("signature"),
								val: xdr.ScVal.scvBytes(signature),
							}),
						]),
					]),
				]),
			);

			auths.splice(0, 1, auth);			

			const invoke_contract_args = new xdr.InvokeContractArgs({
				contractAddress: Address.fromString(contractId).toScAddress(),
				functionName: "__check_auth",
				args: [
					nativeToScVal(payload),
					credentials.signature(),
					xdr.ScVal.scvVec([
						xdr.ScVal.scvVec([
							xdr.ScVal.scvSymbol("Contract"),
							xdr.ScVal.scvMap([
								new xdr.ScMapEntry({
									key: xdr.ScVal.scvSymbol("args"),
									val: xdr.ScVal.scvVec(
										invokeContract.args(),
									),
								}),
								new xdr.ScMapEntry({
									key: xdr.ScVal.scvSymbol("contract"),
									val: Address.contract(
										invokeContract
											.contractAddress()
											.contractId(),
									).toScVal(),
								}),
								new xdr.ScMapEntry({
									key: xdr.ScVal.scvSymbol("fn_name"),
									val: xdr.ScVal.scvSymbol(
										invokeContract.functionName(),
									),
								}),
							]),
						]),
					]),
				],
			});

			const invocation = new xdr.SorobanAuthorizedInvocation({
				function:
					xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
						invoke_contract_args,
					),
				subInvocations: [],
			});

			const nonce = new xdr.Int64(Math.random().toString().substring(2));
			const __check_auth = new xdr.SorobanAuthorizationEntry({
				credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
					new xdr.SorobanAddressCredentials({
						address:
							Address.fromString(sample_policy).toScAddress(),
						nonce,
						signatureExpirationLedger: sequence + DEFAULT_LTL,
						signature: xdr.ScVal.scvVec([]),
					}),
				),
				rootInvocation: invocation,
			});

			auths.push(__check_auth);

			const res = await server.send(built!.toXDR());

			console.log(res);

			await getWalletBalance();
		}
	}
	////

	async function walletTransfer(signer: string, kind: string) {
		if (kind === "Policy") {
			return policySigTransfer();
		} else if (kind === "Ed25519") {
			return ed25519Transfer();
		}

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

		const adminKeys = signers.filter(({ type }) => type === "Admin");
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
		<button on:click={policySigTransfer}>Policy Transfer</button>
		<br />
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
		{#each signers as { key, val, type, kind, expired }}
			<li>
				<button disabled>
					{#if adminSigner === key}
						{#if keyId === key}◉{:else}◎{/if}&nbsp;
					{:else if keyId === key}
						●&nbsp;
					{/if}
					{#if type === "Admin"}
						ADMIN
					{:else}
						SESSION
					{/if}
				</button>

				{key}

				<button on:click={() => walletTransfer(key, kind)}
					>Transfer 1 XLM</button
				>

				{#if (type !== "Admin" || admins > 1) && key !== keyId}
					<button on:click={() => removeSigner(key, kind)}
						>Remove</button
					>
				{/if}

				{#if type === "Admin" && key !== adminSigner}
					<button on:click={() => (adminSigner = key)}
						>Set Active Admin</button
					>
				{:else if expired && key === account.keyId}
					<button on:click={() => addSigner(val)}>Reload</button>
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
