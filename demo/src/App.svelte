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
	import type { SignerKey, SignerLimits } from "passkey-kit-sdk";

	// TODO need to support two toggles:
	// - between temp and persistent
	// - and admin, basic and policy
	// - full visual support for admin, basic and policy keys

	const ADMIN_KEY = "AAAAEAAAAAEAAAABAAAAEQAAAAEAAAAA"; // TODO very rough until we're actually parsing the limits object
	const NATIVE_SAC =
		"CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
	const SAMPLE_POLICY =
		"CAPPNPLUWDDMQNA2AZFFSVE7BEWSVQMRP3NBJ3OSAGT2UH4WWRE7XTRJ";
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
						id,
						pk,
						[new Map()],
						{ tag: "Temporary", values: undefined },
					],
				},
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
		const pubkey = PUBLIC; // prompt('Enter public key');

		if (pubkey) {
			const keypair = Keypair.fromPublicKey(pubkey);
			const signer_limits: SignerLimits = [new Map()];
			// const signer_keys: SignerKey[] = [];

			// signer_keys.push({
			// 	tag: "Policy",
			// 	values: [SAMPLE_POLICY],
			// });

			// signer_limits[0].set(NATIVE_SAC, signer_keys);

			const { built } = await account.wallet!.add({
				signer: {
					tag: "Ed25519",
					values: [
						keypair.rawPublicKey(),
						signer_limits,
						{ tag: "Temporary", values: undefined },
					],
				},
			});

			const xdr = await account.sign(built!, { keyId: adminSigner });
			const res = await server.send(xdr);

			console.log(res);

			await getWalletSigners();
		}
	}
	async function addPolicySigner() {
		const keypair = Keypair.fromPublicKey(PUBLIC);
		const signer_limits: SignerLimits = [new Map()];
		const signer_keys: SignerKey[] = [];

		signer_keys.push({
			tag: "Ed25519",
			values: [keypair.rawPublicKey()],
		});

		signer_limits[0].set(NATIVE_SAC, signer_keys);

		const { built } = await account.wallet!.add({
			signer: {
				tag: "Policy",
				values: [
					SAMPLE_POLICY,
					signer_limits,
					{ tag: "Temporary", values: undefined },
				],
			},
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
								values: [base64url.toBuffer(signer)],
							}
						: type === "Policy"
							? {
									tag: "Policy",
									values: [signer],
								}
							: {
									tag: "Ed25519",
									values: [
										Keypair.fromPublicKey(
											signer,
										).rawPublicKey(),
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
		const keypair = Keypair.fromSecret(SECRET);

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
		const secp256r1_sig = secp256r1_auth
			.credentials()
			.address()
			.signature();

		const entry = (built!.operations[0] as Operation.InvokeHostFunction)
			.auth![0];
		const ed25519_auth = await signAuthEntry(
			entry,
			keypair,
			secp256r1_auth.credentials().address().signatureExpirationLedger(),
			import.meta.env.VITE_networkPassphrase,
		);
		const ed25519_sig = ed25519_auth.credentials().address().signature();

		// console.log(xdr.ScMapEntry.fromXDR(secp256r1_sig.map()?.pop()?.toXDR()).toXDR('base64'));
		// console.log(ed25519_sig.map()?.pop()?.toXDR());

		const __check_auth_args = new xdr.InvokeContractArgs({
			contractAddress: Address.fromString(contractId).toScAddress(),
			functionName: "__check_auth",
			args: [
				xdr.ScVal.scvVec([
					xdr.ScVal.scvSymbol("Contract"),
					xdr.ScVal.scvMap([
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("args"),
							val: xdr.ScVal.scvVec(
								secp256r1_auth
									.rootInvocation()
									.function()
									.contractFn()
									.args(),
							),
						}),
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("contract"),
							val: Address.contract(
								secp256r1_auth
									.rootInvocation()
									.function()
									.contractFn()
									.contractAddress()
									.contractId(),
							).toScVal(),
						}),
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("fn_name"),
							val: xdr.ScVal.scvSymbol(
								secp256r1_auth
									.rootInvocation()
									.function()
									.contractFn()
									.functionName(),
							),
						}),
					]),
				]),
			],
		});

		const __check_auth_invocation = new xdr.SorobanAuthorizedInvocation({
			function:
				xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
					__check_auth_args,
				),
			subInvocations: [],
		});

		const { sequence } = await account.rpc.getLatestLedger();
		const nonce = new xdr.Int64(Math.random().toString().substring(2));
		const __check_auth = new xdr.SorobanAuthorizationEntry({
			credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
				new xdr.SorobanAddressCredentials({
					address: Address.fromString(SAMPLE_POLICY).toScAddress(),
					nonce,
					signatureExpirationLedger: sequence + DEFAULT_LTL,
					signature: xdr.ScVal.scvVec([]),
				}),
			),
			rootInvocation: __check_auth_invocation,
		});

		(built!.operations[0] as Operation.InvokeHostFunction).auth?.push(
			__check_auth,
		);

		const sig = xdr.ScVal.scvMap([
			xdr.ScMapEntry.fromXDR(ed25519_sig.map()?.pop()?.toXDR()),
			xdr.ScMapEntry.fromXDR(secp256r1_sig.map()?.pop()?.toXDR()),
		]);

		entry
			.credentials()
			.address()
			.signatureExpirationLedger(
				secp256r1_auth
					.credentials()
					.address()
					.signatureExpirationLedger(),
			);
		entry.credentials().address().signature(sig);

		console.log(built!.toXDR());

		const res = await server.send(built!.toXDR());

		console.log(res);

		await getWalletBalance();
	}
	////

	async function ed25519Transfer() {
		const secret = SECRET; // prompt('Enter secret key');

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

			// NOTE won't work if the ed25519 signer has a policy signer_key restriction
			// If you want this to work you need to remove the policy restriction from the ed25519 signer first 
			// (though that will make the policy transfer less interesting)
			const res = await server.send(built!.toXDR());

			console.log(res);

			await getWalletBalance();
		}
	}

	////
	async function policySigTransfer() {
		const keypair = Keypair.fromSecret(SECRET);

		const { built } = await native.transfer({
			to: account.factory.options.contractId,
			from: contractId,
			amount: BigInt(10_000_000),
		});

		const { sequence } = await account.rpc.getLatestLedger();

		const op = built!.operations[0] as Operation.InvokeHostFunction;
		const auths = op.auth!;
		const auth = xdr.SorobanAuthorizationEntry.fromXDR(auths[0].toXDR());
		const credentials = auth.credentials().address();
		const invokeContract = op.func.invokeContract();

		const ed25519_auth = await signAuthEntry(
			auth,
			keypair,
			sequence + DEFAULT_LTL,
			import.meta.env.VITE_networkPassphrase,
		);
		const ed25519_sig = ed25519_auth.credentials().address().signature();

		credentials.signatureExpirationLedger(sequence + DEFAULT_LTL);
		credentials.signature(
			xdr.ScVal.scvMap([
				xdr.ScMapEntry.fromXDR(ed25519_sig.map()?.pop()?.toXDR()),
			]),
		);

		auths.splice(0, 1, auth);

		const __check_auth_args = new xdr.InvokeContractArgs({
			contractAddress: Address.fromString(contractId).toScAddress(),
			functionName: "__check_auth",
			args: [
				xdr.ScVal.scvVec([
					xdr.ScVal.scvSymbol("Contract"),
					xdr.ScVal.scvMap([
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("args"),
							val: xdr.ScVal.scvVec(invokeContract.args()),
						}),
						new xdr.ScMapEntry({
							key: xdr.ScVal.scvSymbol("contract"),
							val: Address.contract(
								invokeContract.contractAddress().contractId(),
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
			],
		});

		const __check_auth_invocation = new xdr.SorobanAuthorizedInvocation({
			function:
				xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
					__check_auth_args,
				),
			subInvocations: [],
		});

		const nonce = new xdr.Int64(Math.random().toString().substring(2));
		const __check_auth = new xdr.SorobanAuthorizationEntry({
			credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
				new xdr.SorobanAddressCredentials({
					address: Address.fromString(SAMPLE_POLICY).toScAddress(),
					nonce,
					signatureExpirationLedger: sequence + DEFAULT_LTL,
					signature: xdr.ScVal.scvVec([]),
				}),
			),
			rootInvocation: __check_auth_invocation,
		});

		auths.push(__check_auth);

		const res = await server.send(built!.toXDR());

		console.log(res);

		await getWalletBalance();
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
