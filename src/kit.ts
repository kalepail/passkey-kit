import { Client as PasskeyClient, type Signature, type Signatures, type SignerKey } from 'passkey-kit-sdk'
import { Client as FactoryClient } from 'passkey-factory-sdk'
import { Address, StrKey, hash, xdr, SorobanRpc, Keypair, Transaction, Operation, nativeToScVal } from '@stellar/stellar-sdk'
import base64url from 'base64url'
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import type { AuthenticatorAttestationResponseJSON, AuthenticatorSelectionCriteria } from "@simplewebauthn/types"
import { Buffer } from 'buffer'
import { PasskeyBase } from './base'
import { AssembledTransaction, DEFAULT_TIMEOUT, type Tx } from '@stellar/stellar-sdk/contract'

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
            built
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
                const lastLedger = await this.rpc.getLatestLedger().then(({ sequence }) => sequence)
                expiration = lastLedger + DEFAULT_TIMEOUT / 5;
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
        let key: SignerKey
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

    public async sign(
        txn: AssembledTransaction<unknown>,
        options?: {
            rpId?: string,
            keyId?: 'any' | string | Uint8Array
            keypair?: Keypair,
            policy?: string,
            expiration?: number
        }
    ) {
        await txn.signAuthEntries({
            address: this.wallet!.options.contractId,
            authorizeEntry: (entry) => {
                const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR())
                return this.signAuthEntry(clone, options)    
            },
        })
    }

    // Add little utility helpers for adding and removing signers

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