import { Client as PasskeyClient, type Signature, type SignerKey as SDKSignerKey, type SignerLimits as SDKSignerLimits } from 'passkey-kit-sdk'
import { StrKey, hash, xdr, Keypair, Address, TransactionBuilder, Operation } from '@stellar/stellar-sdk/minimal'
import { Buffer } from 'buffer'
import base64url from 'base64url'
import type { SignerKey, SignerLimits, SignerStore } from './types'
import { PasskeyBase } from './base'
import { AssembledTransaction, basicNodeSigner, type AssembledTransactionOptions, type Tx } from '@stellar/stellar-sdk/minimal/contract'
import type { Server } from '@stellar/stellar-sdk/minimal/rpc'
import { PasskeyService, type AuthenticationResponseJSON, type AuthenticatorAttestationResponseJSON, type AuthenticatorSelectionCriteria } from './passkey-service'
import { PasskeyPlugin } from 'capacitor-passkey-plugin';

export class PasskeyKit extends PasskeyBase {
    declare rpc: Server
    declare rpcUrl: string

    private walletKeypair: Keypair
    private walletPublicKey: string
    private walletWasmHash: string
    private timeoutInSeconds: number
    private passkeyService: PasskeyService

    public keyId: string | undefined
    public networkPassphrase: string
    public wallet: PasskeyClient | undefined

    constructor(options: {
        rpcUrl: string,
        networkPassphrase: string,
        walletWasmHash: string,
        timeoutInSeconds?: number
    }) {
        const { rpcUrl, networkPassphrase, walletWasmHash } = options

        super(rpcUrl)

        this.networkPassphrase = networkPassphrase
        // this account exists as the seed source for deploying new wallets
        // not using the genesis wallet as on mainnet the account has no usable signers
        // there's a chance this isn't the best move and should instead be a constructor variable
        // alternatively when we create a new wallet we shouldn't inherit the source as the auth entry signer
        // Keypair.fromRawEd25519Seed(hash(Buffer.from(this.networkPassphrase)))
        this.walletKeypair = Keypair.fromRawEd25519Seed(hash(Buffer.from('kalepail')));
        this.walletPublicKey = this.walletKeypair.publicKey()
        this.walletWasmHash = walletWasmHash
        this.timeoutInSeconds = options.timeoutInSeconds || 30 // Launchtube requires <= 30 second timeout so let's default to that

        this.passkeyService = new PasskeyService({
            passkeyPlugin: PasskeyPlugin
        })
    }


    public async createWallet(app: string, user: string, rpId: string) {
        const { rawResponse, keyId, keyIdBase64, publicKey } = await this.createKey(app, user,
             {rpId: rpId}
        )
        const at = await PasskeyClient.deploy(
            {
                signer: {
                    tag: 'Secp256r1',
                    values: [
                        keyId,
                        publicKey,
                        [undefined],
                        [undefined],
                        { tag: 'Persistent', values: undefined },
                    ]
                }
            },
            {
                rpcUrl: this.rpcUrl,
                wasmHash: this.walletWasmHash,
                networkPassphrase: this.networkPassphrase,
                publicKey: this.walletPublicKey,
                salt: hash(keyId),
                timeoutInSeconds: this.timeoutInSeconds,
            }
        )

        const contractId = at.result.options.contractId

        this.wallet = new PasskeyClient({
            contractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })

        await at.sign({
            signTransaction: basicNodeSigner(this.walletKeypair, this.networkPassphrase).signTransaction
        })

        return {
            rawResponse,
            keyId,
            keyIdBase64,
            contractId,
            signedTx: at.signed!
        }
    }

    public async createKey(app: string, user: string, settings?: {
        rpId?: string
        authenticatorSelection?: AuthenticatorSelectionCriteria
    }) {
        const now = new Date()
        const displayName = `${user} — ${now.toLocaleString()}`
        const { rpId, authenticatorSelection = {
            residentKey: "preferred",
            userVerification: "preferred",
        } } = settings || {}

        // TODO discover the contract id before creating the key so we can use it in the key name
        // TODO it's possible for the creation to fail in which case we've created a passkey but it's not onchain.
        // In this case we should save the passkey info and retry uploading it async vs asking the user to create another passkey
        // This does introduce a storage dependency though so it likely needs to be a function with some logic for choosing how to store the passkey data

        const userIdString = `${user}:${now.getTime()}:${Math.random()}`
        const userIdBytes = new TextEncoder().encode(userIdString);
        const userId = this.toBase64Url(userIdBytes);

        const challengeBytes = new TextEncoder().encode('stellaristhebetterblockchain');
        const challenge = this.toBase64Url(challengeBytes);

        const rawResponse = await this.passkeyService.createPasskey({
            challenge,
            rp: {
                id: rpId,
                name: app,
            },
            user: {
                id: userId,
                name: displayName,
                displayName
            },
            authenticatorSelection,
            pubKeyCredParams: [{ alg: -7, type: "public-key" }],
            timeout: 60000,
            attestation: 'none'
        });

        const { id, response } = rawResponse

        if (!this.keyId)
            this.keyId = id;

        return {
            rawResponse,
            keyId: base64url.toBuffer(id),
            keyIdBase64: id,
            publicKey: await this.getPublicKey(response),
        }
    }

    public async connectWallet(opts?: {
        rpId?: string,
        keyId?: string | Uint8Array,
        getContractId?: (keyId: string) => Promise<string | undefined>,
        // TEMP for backwards compatibility for when we seeded wallets from a factory address
        // Consider putting this somewhere else??
        walletPublicKey?: string
    }) {
        let { rpId, keyId, getContractId, walletPublicKey } = opts || {}
        let keyIdBuffer: Buffer
        let rawResponse: AuthenticationResponseJSON | undefined;
        if (!keyId) {

            const challengeBytes = new TextEncoder().encode('stellaristhebetterblockchain');//Uint8Array
            rawResponse = await this.passkeyService.authenticate({
                // challenge: "stellaristhebetterblockchain",
                challenge: this.toBase64Url(challengeBytes),
                rpId: rpId,
                allowCredentials: [],
                userVerification: 'preferred',
                timeout: 60000
            });

            keyId = rawResponse.id
        }

        if (keyId instanceof Uint8Array) {
            keyIdBuffer = Buffer.from(keyId)
            keyId = base64url(keyIdBuffer)
        } else {
            keyIdBuffer = base64url.toBuffer(keyId)
        }

        if (!this.keyId)
            this.keyId = keyId

        // Check for the contractId on-chain as a derivation from the keyId. This is the easiest and "cheapest" check however it will only work for the initially deployed passkey if it was used as derivation
        let contractId: string | undefined = this.encodeContract(this.walletPublicKey, keyIdBuffer);

        // attempt passkey id derivation
        try {
            // TODO what is the error if the entry exists but is archived?
            await this.rpc.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance())
        }
        // if that fails look up from the `getContractId` function
        catch {
            contractId = getContractId && await getContractId(keyId)
        }

        ////
        // TEMP for backwards compatibility for when we seeded wallets from a factory address
        // Consider putting this in the constructor
        if (!contractId && walletPublicKey) {
            contractId = this.encodeContract(walletPublicKey, keyIdBuffer);

            try {
                await this.rpc.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance())
            } catch {
                contractId = undefined
            }
        }
        ////

        if (!contractId)
            throw new Error('Failed to connect wallet')

        this.wallet = new PasskeyClient({
            contractId,
            rpcUrl: this.rpcUrl,
            networkPassphrase: this.networkPassphrase,
        })

        return {
            rawResponse,
            keyId: keyIdBuffer,
            keyIdBase64: keyId,
            contractId
        }
    }

    toBase64Url(uint8: any) {
        return btoa(String.fromCharCode.apply(null, uint8))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');
    }

    base64urlToArrayBuffer(base64url: string) {
        const base64 = base64url
            .replace(/-/g, '+')
            .replace(/_/g, '/')
            .padEnd(Math.ceil(base64url.length / 4) * 4, '=');

        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return bytes.buffer;
    }


    public async signAuthEntry(
        entry: xdr.SorobanAuthorizationEntry,
        options?: {
            rpId?: string,
            keyId?: 'any' | string | Uint8Array
            keypair?: Keypair,
            policy?: string,
            expiration?: number
        }
    ) {
        let { rpId, keyId, keypair, policy, expiration } = options || {}

        if ([keyId, keypair, policy].filter((arg) => !!arg).length > 1)
            throw new Error('Exactly one of `options.keyId`, `options.keypair`, or `options.policy` must be provided.');

        const credentials = entry.credentials().address();

        if (!expiration) {
            expiration = credentials.signatureExpirationLedger()

            if (!expiration) {
                const { sequence } = await this.rpc.getLatestLedger()
                expiration = sequence + this.timeoutInSeconds / 5; // assumes 5 second ledger time
            }
        }

        credentials.signatureExpirationLedger(expiration)

        const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
            new xdr.HashIdPreimageSorobanAuthorization({
                networkId: hash(Buffer.from(this.networkPassphrase)),
                nonce: credentials.nonce(),
                signatureExpirationLedger: credentials.signatureExpirationLedger(),
                invocation: entry.rootInvocation()
            })
        )

        const payload = hash(preimage.toXDR())

        // let signatures: Signatures
        let key: SDKSignerKey
        let val: Signature | undefined

        // const scSpecTypeDefSignatures = xdr.ScSpecTypeDef.scSpecTypeUdt(
        //     new xdr.ScSpecTypeUdt({ name: "Signatures" }),
        // );

        // switch (credentials.signature().switch()) {
        //     case xdr.ScValType.scvVoid():
        //         signatures = [new Map()]
        //         break;
        //     default: {
        //         signatures = this.wallet!.spec.scValToNative(credentials.signature(), scSpecTypeDefSignatures)
        //     }
        // }

        // Sign with a policy
        if (policy) {
            key = {
                tag: "Policy",
                values: [policy]
            }
            val = {
                tag: "Policy",
                values: undefined,
            }
        }

        // Sign with the keypair as an ed25519 signer
        else if (keypair) {
            const signature = keypair.sign(payload);

            key = {
                tag: "Ed25519",
                values: [keypair.rawPublicKey()]
            }
            val = {
                tag: "Ed25519",
                values: [signature],
            }
        }

        // Default, use passkey
        else {
            const authOptions = keyId === 'any' || (!keyId && !this.keyId)
                ? {
                    challenge: base64url(payload),
                    rpId,
                    userVerification: "preferred" as const,
                }
                : {
                    challenge: base64url(payload),
                    rpId,
                    allowCredentials: [
                        {
                            id: keyId instanceof Uint8Array
                                ? base64url(Buffer.from(keyId))
                                : keyId || this.keyId!,
                            type: "public-key" as const,
                        },
                    ],
                    userVerification: "preferred" as const,
                };

            const authenticationResponse = await this.passkeyService.authenticate(authOptions);

            key = {
                tag: "Secp256r1",
                values: [base64url.toBuffer(authenticationResponse.id)]
            }
            val = {
                tag: "Secp256r1",
                values: [
                    {
                        authenticator_data: base64url.toBuffer(
                            authenticationResponse.response.authenticatorData,
                        ),
                        client_data_json: base64url.toBuffer(
                            authenticationResponse.response.clientDataJSON,
                        ),
                        signature: this.compactSignature(
                            base64url.toBuffer(authenticationResponse.response.signature)
                        ),
                    },
                ],
            }
        }

        const scKeyType = xdr.ScSpecTypeDef.scSpecTypeUdt(
            new xdr.ScSpecTypeUdt({ name: "SignerKey" }),
        );
        const scValType = xdr.ScSpecTypeDef.scSpecTypeUdt(
            new xdr.ScSpecTypeUdt({ name: "Signature" }),
        );
        const scKey = this.wallet!.spec.nativeToScVal(key, scKeyType);
        const scVal = val ? this.wallet!.spec.nativeToScVal(val, scValType) : xdr.ScVal.scvVoid();
        const scEntry = new xdr.ScMapEntry({
            key: scKey,
            val: scVal,
        })

        switch (credentials.signature().switch().name) {
            case 'scvVoid':
                credentials.signature(xdr.ScVal.scvVec([
                    xdr.ScVal.scvMap([scEntry])
                ]))
                break;
            case 'scvVec':
                // Add the new signature to the existing map
                credentials.signature().vec()?.[0].map()?.push(scEntry)

                // Order the map by key
                // Not using Buffer.compare because Symbols are 9 bytes and unused bytes _append_ 0s vs prepending them, which is too bad
                credentials.signature().vec()?.[0].map()?.sort((a, b) => {
                    return (
                        a.key().vec()![0].sym() +
                        a.key().vec()![1].toXDR().join('')
                    ).localeCompare(
                        b.key().vec()![0].sym() +
                        b.key().vec()![1].toXDR().join('')
                    )
                })
                break;
            default:
                throw new Error('Unsupported signature')
        }

        // Insert the new signature into the signatures Map
        // signatures[0].set(key, val)

        // Insert the new signatures Map into the credentials
        // credentials.signature(
        //     this.wallet!.spec.nativeToScVal(signatures, scSpecTypeDefSignatures)
        // )

        // Order the signatures map
        // credentials.signature().vec()?.[0].map()?.sort((a, b) => {
        //     return (
        //         a.key().vec()![0].sym() +
        //         a.key().vec()![1].toXDR().join('')
        //     ).localeCompare(
        //         b.key().vec()![0].sym() +
        //         b.key().vec()![1].toXDR().join('')
        //     )
        // })

        return entry
    }

    public async sign<T>(
        txn: AssembledTransaction<T> | Tx | string,
        options?: {
            rpId?: string,
            keyId?: 'any' | string | Uint8Array
            keypair?: Keypair,
            policy?: string,
            expiration?: number
        }
    ) {
        if (!(txn instanceof AssembledTransaction)) {
            try {
                txn = AssembledTransaction.fromXDR(this.wallet!.options, typeof txn === 'string' ? txn : txn.toXDR(), this.wallet!.spec);
            } catch {
                if (!(txn instanceof AssembledTransaction)) {
                    const built = TransactionBuilder.fromXDR(typeof txn === 'string' ? txn : txn.toXDR(), this.networkPassphrase);
                    const operation = built.operations[0] as Operation.InvokeHostFunction;

                    txn = await AssembledTransaction.buildWithOp<T>(
                        Operation.invokeHostFunction({ func: operation.func }),
                        this.wallet!.options as AssembledTransactionOptions<T>
                    );
                }
            }
        }

        await txn.signAuthEntries({
            address: this.wallet!.options.contractId,
            authorizeEntry: (entry) => {
                const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR())
                return this.signAuthEntry(clone, options)
            },
        })

        return txn
    }

    public addSecp256r1(keyId: string | Uint8Array, publicKey: string | Uint8Array, limits: SignerLimits, store: SignerStore, expiration?: number) {
        return this.secp256r1(keyId, publicKey, limits, store, 'add_signer', expiration)
    }
    public addEd25519(publicKey: string, limits: SignerLimits, store: SignerStore, expiration?: number) {
        return this.ed25519(publicKey, limits, store, 'add_signer', expiration)
    }
    public addPolicy(policy: string, limits: SignerLimits, store: SignerStore, expiration?: number) {
        return this.policy(policy, limits, store, 'add_signer', expiration)
    }

    public updateSecp256r1(keyId: string | Uint8Array, publicKey: string | Uint8Array, limits: SignerLimits, store: SignerStore, expiration?: number) {
        return this.secp256r1(keyId, publicKey, limits, store, 'update_signer', expiration)
    }
    public updateEd25519(publicKey: string, limits: SignerLimits, store: SignerStore, expiration?: number) {
        return this.ed25519(publicKey, limits, store, 'update_signer', expiration)
    }
    public updatePolicy(policy: string, limits: SignerLimits, store: SignerStore, expiration?: number) {
        return this.policy(policy, limits, store, 'update_signer', expiration)
    }

    public remove(signer: SignerKey) {
        return this.wallet!.remove_signer({
            signer_key: this.getSignerKey(signer)
        }, {
            timeoutInSeconds: this.timeoutInSeconds,
        });
    }

    private secp256r1(keyId: string | Uint8Array, publicKey: string | Uint8Array, limits: SignerLimits, store: SignerStore, fn: 'add_signer' | 'update_signer', expiration?: number) {
        keyId = typeof keyId === 'string' ? base64url.toBuffer(keyId) : keyId
        publicKey = typeof publicKey === 'string' ? base64url.toBuffer(publicKey) : publicKey

        return this.wallet![fn]({
            signer: {
                tag: "Secp256r1",
                values: [
                    Buffer.from(keyId),
                    Buffer.from(publicKey),
                    [expiration],
                    this.getSignerLimits(limits),
                    { tag: store, values: undefined },
                ],
            },
        }, {
            timeoutInSeconds: this.timeoutInSeconds,
        });
    }
    private ed25519(publicKey: string, limits: SignerLimits, store: SignerStore, fn: 'add_signer' | 'update_signer', expiration?: number) {
        return this.wallet![fn]({
            signer: {
                tag: "Ed25519",
                values: [
                    Keypair.fromPublicKey(publicKey).rawPublicKey(),
                    [expiration],
                    this.getSignerLimits(limits),
                    { tag: store, values: undefined },
                ],
            },
        }, {
            timeoutInSeconds: this.timeoutInSeconds,
        });
    }
    private policy(policy: string, limits: SignerLimits, store: SignerStore, fn: 'add_signer' | 'update_signer', expiration?: number) {
        return this.wallet![fn]({
            signer: {
                tag: "Policy",
                values: [
                    policy,
                    [expiration],
                    this.getSignerLimits(limits),
                    { tag: store, values: undefined },
                ],
            },
        }, {
            timeoutInSeconds: this.timeoutInSeconds,
        });
    }

    /* LATER
        - Add a getKeyInfo action to get info about a specific passkey
            Specifically looking for name, type, etc. data so a user could grok what signer mapped to what passkey
    */

    private getSignerLimits(limits: SignerLimits) {
        if (!limits)
            return [undefined] as SDKSignerLimits

        const sdk_limits: SDKSignerLimits = [new Map()]

        for (const [contract, signer_keys] of limits.entries()) {
            let sdk_signer_keys: SDKSignerKey[] | undefined

            if (signer_keys?.length) {
                sdk_signer_keys = []

                for (const signer_key of signer_keys) {
                    sdk_signer_keys.push(
                        this.getSignerKey(signer_key)
                    )
                }
            }

            sdk_limits[0]?.set(contract, sdk_signer_keys)
        }

        return sdk_limits
    }

    private getSignerKey({ key: tag, value }: SignerKey) {
        let signer_key: SDKSignerKey

        switch (tag) {
            case 'Policy':
                signer_key = {
                    tag,
                    values: [value]
                }
                break;
            case 'Ed25519':
                signer_key = {
                    tag,
                    values: [Keypair.fromPublicKey(value).rawPublicKey()]
                }
                break;
            case 'Secp256r1':
                signer_key = {
                    tag,
                    values: [base64url.toBuffer(value)]
                }
                break;
        }

        return signer_key
    }

    private encodeContract(walletPublicKey: string, keyIdBuffer: Buffer) {
        let contractId: string | undefined = StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(
            new xdr.HashIdPreimageContractId({
                networkId: hash(Buffer.from(this.networkPassphrase)),
                contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                    new xdr.ContractIdPreimageFromAddress({
                        address: Address.fromString(walletPublicKey).toScAddress(),
                        salt: hash(keyIdBuffer),
                    })
                )
            })
        ).toXDR()));

        return contractId
    }

    private async getPublicKey(response: AuthenticatorAttestationResponseJSON) {
        let publicKey: Buffer | undefined

        if (response.publicKey) {
            publicKey = base64url.toBuffer(response.publicKey)
            publicKey = publicKey?.slice(publicKey.length - 65)
        }

        if (
            !publicKey
            || publicKey[0] !== 0x04
            || publicKey.length !== 65
        ) {
            let x: Buffer
            let y: Buffer

            if (response.authenticatorData) {
                const authenticatorData = base64url.toBuffer(response.authenticatorData)
                const credentialIdLength = (authenticatorData[53] << 8) | authenticatorData[54]

                x = authenticatorData.slice(65 + credentialIdLength, 97 + credentialIdLength)
                y = authenticatorData.slice(100 + credentialIdLength, 132 + credentialIdLength)
            } else {
                const attestationObject = base64url.toBuffer(response.attestationObject)

                let publicKeykPrefixSlice = Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20])
                let startIndex = attestationObject.indexOf(publicKeykPrefixSlice)
                startIndex = startIndex + publicKeykPrefixSlice.length

                x = attestationObject.slice(startIndex, 32 + startIndex)
                y = attestationObject.slice(35 + startIndex, 67 + startIndex)
            }

            publicKey = Buffer.from([
                0x04, // (0x04 prefix) https://en.bitcoin.it/wiki/Elliptic_Curve_Digital_Signature_Algorithm
                ...x,
                ...y
            ])
        }

        /* TODO
            - We're doing some pretty "smart" public key decoding stuff so we should verify the signature against this final public key before assuming it's safe to use and save on-chain
                Hmm...Given that `startRegistration` doesn't produce a signature, verifying we've got the correct public key isn't really possible
            - This probably needs to be an onchain check, even if just a simulation, just to ensure everything looks good before we get too far adding value etc.
        */

        return publicKey
    }

    private compactSignature(signature: Buffer) {
        // Decode the DER signature
        let offset = 2;

        const rLength = signature[offset + 1];
        const r = signature.slice(offset + 2, offset + 2 + rLength);

        offset += 2 + rLength;

        const sLength = signature[offset + 1];
        const s = signature.slice(offset + 2, offset + 2 + sLength);

        // Convert r and s to BigInt
        const rBigInt = BigInt('0x' + r.toString('hex'));
        let sBigInt = BigInt('0x' + s.toString('hex'));

        // Ensure s is in the low-S form
        // https://github.com/stellar/stellar-protocol/discussions/1435#discussioncomment-8809175
        // https://discord.com/channels/897514728459468821/1233048618571927693
        // Define the order of the curve secp256r1
        // https://github.com/RustCrypto/elliptic-curves/blob/master/p256/src/lib.rs#L72
        const n = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
        const halfN = n / 2n;

        if (sBigInt > halfN)
            sBigInt = n - sBigInt;

        // Convert back to buffers and ensure they are 32 bytes
        const rPadded = Buffer.from(rBigInt.toString(16).padStart(64, '0'), 'hex');
        const sLowS = Buffer.from(sBigInt.toString(16).padStart(64, '0'), 'hex');

        // Concatenate r and low-s
        const concatSignature = Buffer.concat([rPadded, sLowS]);

        return concatSignature;
    }
}