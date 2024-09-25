import { Client as PasskeyClient, type Signature, type SignerKey } from 'passkey-kit-sdk'
import { Client as FactoryClient } from 'passkey-factory-sdk'
import { Address, StrKey, hash, xdr, Transaction, SorobanRpc, Operation, TransactionBuilder, Keypair } from '@stellar/stellar-sdk'
import base64url from 'base64url'
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import type { AuthenticatorAttestationResponseJSON, AuthenticatorSelectionCriteria } from "@simplewebauthn/types"
import { Buffer } from 'buffer'
import { PasskeyBase } from './base'
import { DEFAULT_TIMEOUT } from '@stellar/stellar-sdk/contract'

export const DEFAULT_LTL = 12

export class PasskeyKit extends PasskeyBase {
    declare public rpc: SorobanRpc.Server
    declare public rpcUrl: string
    public keyId: string | undefined
    public networkPassphrase: string
    public factory: FactoryClient
    public wallet: PasskeyClient | undefined
    public WebAuthn: {
        startRegistration: typeof startRegistration,
        startAuthentication: typeof startAuthentication
    }

    constructor(options: {
        rpcUrl: string,
        networkPassphrase: string,
        factoryContractId: string,
        WebAuthn?: {
            startRegistration: typeof startRegistration,
            startAuthentication: typeof startAuthentication
        }
    }) {
        const { rpcUrl, networkPassphrase, factoryContractId, WebAuthn } = options

        super(rpcUrl)

        this.networkPassphrase = networkPassphrase
        this.factory = new FactoryClient({
            contractId: factoryContractId,
            networkPassphrase,
            rpcUrl
        })
        this.WebAuthn = WebAuthn || { startRegistration, startAuthentication }
    }

    public async createWallet(app: string, user: string) {
        const { keyId, publicKey } = await this.createKey(app, user)

        const { result, built } = await this.factory.deploy({
            salt: hash(keyId),
            signer: {
                tag: 'Secp256r1',
                values: [
                    keyId,
                    publicKey,
                    [new Map()],
                    { tag: 'Persistent', values: undefined },
                ]
            },
        })

        if (result.isErr())
            throw new Error(result.unwrapErr().message)

        if (!built)
            throw new Error('Failed to create wallet')

        const contractId = result.unwrap()

        this.wallet = new PasskeyClient({
            contractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })

        return {
            keyId,
            contractId,
            xdr: built.toXDR()
        }
    }

    public async createKey(app: string, user: string, settings?: {
        rpId?: string
        authenticatorSelection?: AuthenticatorSelectionCriteria
    }) {
        const now = new Date()
        const displayName = `${user} — ${now.toLocaleString()}`
        const { rpId, authenticatorSelection } = settings || {}
        const { id, response } = await this.WebAuthn.startRegistration({
            challenge: base64url("stellaristhebetterblockchain"),
            rp: {
                id: rpId,
                name: app,
            },
            user: {
                id: base64url(`${user}:${now.getTime()}:${Math.random()}`),
                name: displayName,
                displayName
            },
            authenticatorSelection,
            pubKeyCredParams: [{ alg: -7, type: "public-key" }],
            // attestation: "none",
            // timeout: 120_000,
        });

        if (!this.keyId)
            this.keyId = id;

        return {
            keyId: base64url.toBuffer(id),
            publicKey: await this.getPublicKey(response)
        }
    }

    public async connectWallet(opts?: {
        keyId?: string | Uint8Array,
        rpId?: string,
        getContractId?: (keyId: string) => Promise<string | undefined>
    }) {
        let { keyId, rpId, getContractId } = opts || {}
        let keyIdBuffer: Buffer

        if (!keyId) {
            const response = await this.WebAuthn.startAuthentication({
                challenge: base64url("stellaristhebetterblockchain"),
                rpId,
                // userVerification: "discouraged",
                // timeout: 120_000
            });

            keyId = response.id
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
        let contractId: string | undefined = StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(
            new xdr.HashIdPreimageContractId({
                networkId: hash(Buffer.from(this.networkPassphrase)),
                contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                    new xdr.ContractIdPreimageFromAddress({
                        address: Address.fromString(this.factory.options.contractId).toScAddress(),
                        salt: hash(keyIdBuffer),
                    })
                )
            })
        ).toXDR()));

        // attempt passkey id derivation
        try {
            // TODO what is the error if the entry exists but is archived?
            await this.rpc.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance())
        }
        // if that fails look up from the `getContractId` function
        catch {
            contractId = getContractId ? await getContractId(keyId) : undefined
        }

        if (!contractId)
            throw new Error('Failed to connect wallet')

        this.wallet = new PasskeyClient({
            contractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })

        return {
            keyId: keyIdBuffer,
            contractId
        }
    }

    public async signAuthEntry(
        entry: xdr.SorobanAuthorizationEntry,
        options?: {
            rpId?: string,
            keyId?: 'any' | string | Uint8Array
            keypair?: Keypair,
            validUntilLedgerSeq?: number
        }
    ) {
        let { rpId, keyId, keypair, validUntilLedgerSeq } = options || {}

        if (keyId && keypair)
            throw new Error('Cannot provide both a keyId and keypair')

        if (!validUntilLedgerSeq) {
            const lastLedger = await this.rpc.getLatestLedger().then(({ sequence }) => sequence)
            validUntilLedgerSeq = lastLedger + DEFAULT_TIMEOUT / 5;
        }

        const credentials = entry.credentials().address();
        const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
            new xdr.HashIdPreimageSorobanAuthorization({
                networkId: hash(Buffer.from(this.networkPassphrase)),
                nonce: credentials.nonce(),
                signatureExpirationLedger: validUntilLedgerSeq,
                invocation: entry.rootInvocation()
            })
        )
        const payload = hash(preimage.toXDR())

        let key: SignerKey
        let val: Signature

        // Sign with the keypair as an ed25519 signer
        if (keypair) {
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
            const authenticationResponse = await this.WebAuthn.startAuthentication(
                keyId === 'any'
                    || (!keyId && !this.keyId)
                    ? {
                        challenge: base64url(payload),
                        rpId,
                        // userVerification: "discouraged",
                        // timeout: 120_000
                    }
                    : {
                        challenge: base64url(payload),
                        rpId,
                        allowCredentials: [
                            {
                                id: keyId instanceof Uint8Array
                                    ? base64url(Buffer.from(keyId))
                                    : keyId || this.keyId!,
                                type: "public-key",
                            },
                        ],
                        // userVerification: "discouraged",
                        // timeout: 120_000
                    }
            );

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
        const scVal = this.wallet!.spec.nativeToScVal(val, scValType);
        const scKey = this.wallet!.spec.nativeToScVal(key, scKeyType);
        const scEntry = new xdr.ScMapEntry({
            key: scKey,
            val: scVal,
        })

        switch (credentials.signature().switch().name) {
            case 'scvVoid':
                credentials.signature(xdr.ScVal.scvMap([scEntry]))
                break;
            case 'scvMap':
                credentials.signature().map()?.push(scEntry)
                break;
            default:
                throw new Error('Unsupported signature')
        }

        credentials.signatureExpirationLedger(validUntilLedgerSeq)

        return entry
    }

    public async signAuthEntries(
        entries: xdr.SorobanAuthorizationEntry[],
        options?: {
            rpId?: string,
            keyId?: 'any' | string | Uint8Array
            keypair?: Keypair,
            validUntilLedgerSeq?: number
        }
    ) {
        for (const auth of entries) {
            if (
                auth.credentials().switch().name === 'sorobanCredentialsAddress'
                && auth.credentials().address().address().switch().name === 'scAddressTypeContract'
            ) {
                // If auth entry matches our Smart Wallet move forward with the signature request
                if (Address.contract(auth.credentials().address().address().contractId()).toString() === this.wallet?.options.contractId)
                    await this.signAuthEntry(auth, options)
            }
        }

        return entries
    }

    public async sign(
        txn: Transaction | string,
        options?: {
            rpId?: string,
            keyId?: 'any' | string | Uint8Array
            keypair?: Keypair,
            validUntilLedgerSeq?: number
        }
    ) {
        txn = this.getTxn(txn)

        // Only need to sign auth for `invokeHostFunction` operations
        if (txn.operations[0].type === 'invokeHostFunction') {
            const entries = txn.operations[0].auth

            if (entries)
                await this.signAuthEntries(entries, options)
        }

        return txn.toXDR()
    }

    public async attachPolicy(
        txn: Transaction | string,
        index: number,
        policy: string
    ) {
        txn = this.getTxn(txn)

        // Only need to sign auth for `invokeHostFunction` operations
        if (txn.operations[0].type !== 'invokeHostFunction')
            return txn.toXDR()

        if (!this.wallet)
            throw new Error('Wallet not connected')

        let context_arg: xdr.ScVal

        const auth = txn.operations[0].auth?.[index]
        const context = auth?.rootInvocation().function()

        if (!auth || !context)
            throw new Error('No context found')

        switch (context.switch().name) {
            case 'sorobanAuthorizedFunctionTypeContractFn':
                switch (context.contractFn().contractAddress().switch().name) {
                    case 'scAddressTypeContract':
                        context_arg = xdr.ScVal.scvVec([
                            xdr.ScVal.scvSymbol("Contract"),
                            xdr.ScVal.scvMap([
                                new xdr.ScMapEntry({
                                    key: xdr.ScVal.scvSymbol("args"),
                                    val: xdr.ScVal.scvVec(context.contractFn().args()),
                                }),
                                new xdr.ScMapEntry({
                                    key: xdr.ScVal.scvSymbol("contract"),
                                    val: Address.contract(context.contractFn().contractAddress().contractId()).toScVal(),
                                }),
                                new xdr.ScMapEntry({
                                    key: xdr.ScVal.scvSymbol("fn_name"),
                                    val: xdr.ScVal.scvSymbol(context.contractFn().functionName()),
                                }),
                            ]),
                        ])
                        break;
                    default:
                        throw new Error('Unsupported contractAddress')
                }
                break;
            case 'sorobanAuthorizedFunctionTypeCreateContractHostFn':
                switch (context.createContractHostFn().contractIdPreimage().switch().name) {
                    case 'contractIdPreimageFromAddress':
                        context_arg = xdr.ScVal.scvVec([
                            xdr.ScVal.scvSymbol("CreateContractHostFn"),
                            xdr.ScVal.scvMap([
                                new xdr.ScMapEntry({
                                    key: xdr.ScVal.scvSymbol("executable"),
                                    val: xdr.ScVal.scvVec([
                                        xdr.ScVal.scvSymbol("Wasm"),
                                        xdr.ScVal.scvBytes(context.createContractHostFn().executable().wasmHash())
                                    ]),
                                }),
                                new xdr.ScMapEntry({
                                    key: xdr.ScVal.scvSymbol("salt"),
                                    val: xdr.ScVal.scvBytes(context.createContractHostFn().contractIdPreimage().fromAddress().salt()),
                                }),
                            ]),
                        ])
                        break;
                    default:
                        throw new Error('Unsupported contractIdPreimage')
                }
                break;
            default:
                throw new Error('Unsupported context')
        }

        const __check_auth_args = new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(this.wallet.options.contractId).toScAddress(),
            functionName: "__check_auth",
            args: [context_arg],
        });

        const __check_auth_invocation = new xdr.SorobanAuthorizedInvocation({
            function:
                xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                    __check_auth_args,
                ),
            subInvocations: [],
        });

        const __check_auth = new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
                new xdr.SorobanAddressCredentials({
                    address: Address.fromString(policy).toScAddress(),
                    nonce: auth.credentials().address().nonce(),
                    signatureExpirationLedger: auth.credentials().address().signatureExpirationLedger(),
                    signature: xdr.ScVal.scvVec([]),
                }),
            ),
            rootInvocation: __check_auth_invocation,
        });

        txn.operations[0].auth?.push(__check_auth)

        return txn.toXDR()
    }

    private getTxn(txn: Transaction | string): Transaction {
        txn = TransactionBuilder.cloneFrom(new Transaction(
            typeof txn === 'string'
                ? txn
                : txn.toXDR(),
            this.networkPassphrase
        ), { fee: '0' }).build()

        if (txn.operations.length !== 1)
            throw new Error('Must include only one Soroban operation')

        for (const op of txn.operations) {
            if (
                op.type !== 'invokeHostFunction'
                && op.type !== 'extendFootprintTtl'
                && op.type !== 'restoreFootprint'
            ) throw new Error('Must include only one operation of type `invokeHostFunction` or `extendFootprintTtl` or `restoreFootprint`')
        }

        return txn
    }

    /* LATER 
        - Add a getKeyInfo action to get info about a specific passkey
            Specifically looking for name, type, etc. data so a user could grok what signer mapped to what passkey
    */

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