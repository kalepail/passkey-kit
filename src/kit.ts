import { Client as PasskeyClient } from 'passkey-kit-sdk'
import { Client as FactoryClient } from 'passkey-factory-sdk'
import { Address, Networks, StrKey, hash, xdr, Transaction, SorobanRpc, Operation, scValToNative, TransactionBuilder } from '@stellar/stellar-sdk'
import base64url from 'base64url'
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import { decode } from 'cbor-x/decode'
import { Buffer } from 'buffer'
import { PasskeyBase } from './base'
import BigNumber from 'bignumber.js';

type GetContractIdFunction = (keyId: string) => Promise<string>;

export class PasskeyKit extends PasskeyBase {
    public keyId: string | undefined
    public keyExpired: boolean | undefined
    public wallet: PasskeyClient | undefined
    public factory: FactoryClient
    public networkPassphrase: Networks
    public rpcUrl: string
    public rpc: SorobanRpc.Server

    constructor(options: {
        rpcUrl: string,
        launchtubeUrl?: string,
        launchtubeJwt?: string,
        networkPassphrase: string,
        factoryContractId: string,
    }) {
        const {
            rpcUrl,
            launchtubeUrl,
            launchtubeJwt,
            networkPassphrase,
            factoryContractId,
        } = options

        super({
            launchtubeUrl,
            launchtubeJwt,
        })

        this.rpcUrl = rpcUrl
        this.rpc = new SorobanRpc.Server(rpcUrl)
        this.networkPassphrase = networkPassphrase as Networks
        this.factory = new FactoryClient({
            contractId: factoryContractId,
            networkPassphrase,
            rpcUrl
        })
    }

    public async createWallet(name: string, user: string) {
        const { keyId, publicKey } = await this.createKey(name, user)

        const { result, built } = await this.factory.deploy({
            id: keyId,
            pk: publicKey!
        })

        const contractId = result.unwrap() as string

        this.wallet = new PasskeyClient({
            contractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })

        return {
            keyId,
            contractId,
            xdr: built!.toXDR() as string
        }
    }

    public async createKey(name: string, user: string) {
        const startRegistrationResponse = await startRegistration({
            challenge: base64url("stellaristhebetterblockchain"),
            rp: {
                // id: undefined,
                name,
            },
            user: {
                id: base64url(user),
                name: user,
                displayName: user,
            },
            authenticatorSelection: {
                requireResidentKey: false,
                residentKey: "preferred",
                userVerification: "discouraged",
            },
            pubKeyCredParams: [{ alg: -7, type: "public-key" }],
            attestation: "none",
        });

        if (!this.keyId)
            this.keyId = startRegistrationResponse.id

        const { publicKeyObject } = this.getPublicKeyObject(startRegistrationResponse.response.attestationObject);

        const publicKey = Buffer.from([
            4, // (0x04 prefix) https://en.bitcoin.it/wiki/Elliptic_Curve_Digital_Signature_Algorithm
            ...publicKeyObject.get('-2')!,
            ...publicKeyObject.get('-3')!
        ])

        return {
            keyId: base64url.toBuffer(startRegistrationResponse.id),
            publicKey
        }
    }

    public async connectWallet(opts: {
        keyId?: string | Uint8Array,
        getContractId?: GetContractIdFunction
    }) {
        let { keyId, getContractId } = opts
        let keyIdBuffer: Buffer

        if (!keyId) {
            const { id } = await startAuthentication({
                challenge: base64url("stellaristhebetterblockchain"),
                // rpId: undefined,
                userVerification: "discouraged",
            });

            keyId = id
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
                networkId: hash(Buffer.from(this.networkPassphrase, 'utf-8')),
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
            await this.rpc.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance())
        }
        // if that fails look up from the factory mapper
        catch {
            contractId = undefined

            if (getContractId) {
                contractId = await getContractId(keyId)

                // Handle case where temporary session signer is missing on-chain (so we can queue up a re-add)
                try {
                    await this.rpc.getContractData(contractId, xdr.ScVal.scvBytes(keyIdBuffer), SorobanRpc.Durability.Temporary)
                    // throw true
                } catch {
                    this.keyExpired = true
                }
            }
        }

        if (!contractId)
            throw new Error('No `contractId` was found')

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
            keyId?: 'any' | string | Uint8Array
            ledgersToLive?: number
        }
    ) {
        // Default mirrors DEFAULT_TIMEOUT (currently 5 minutes) https://github.com/stellar/js-stellar-sdk/blob/master/src/contract/utils.ts#L7
        let { keyId, ledgersToLive = 60 } = options || {}

        const lastLedger = await this.rpc.getLatestLedger().then(({ sequence }) => sequence)
        const credentials = entry.credentials().address();
        const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
            new xdr.HashIdPreimageSorobanAuthorization({
                networkId: hash(Buffer.from(this.networkPassphrase)),
                nonce: credentials.nonce(),
                signatureExpirationLedger: lastLedger + ledgersToLive,
                invocation: entry.rootInvocation()
            })
        )
        const payload = hash(preimage.toXDR())

        const authenticationResponse = await startAuthentication(
            keyId === 'any'
                || (!keyId && !this.keyId)
                ? {
                    challenge: base64url(payload),
                    // rpId: undefined,
                    userVerification: "discouraged",
                }
                : {
                    challenge: base64url(payload),
                    // rpId: undefined,
                    allowCredentials: [
                        {
                            id: keyId instanceof Uint8Array
                                ? base64url(Buffer.from(keyId))
                                : keyId || this.keyId!,
                            type: "public-key",
                        },
                    ],
                    userVerification: "discouraged",
                }
        );

        const signatureRaw = base64url.toBuffer(authenticationResponse.response.signature);
        const signature = this.convertEcdsaSignatureAsnToCompact(signatureRaw);

        credentials.signatureExpirationLedger(lastLedger + ledgersToLive)
        credentials.signature(xdr.ScVal.scvMap([
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('authenticator_data'),
                val: xdr.ScVal.scvBytes(base64url.toBuffer(authenticationResponse.response.authenticatorData)),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('client_data_json'),
                val: xdr.ScVal.scvBytes(base64url.toBuffer(authenticationResponse.response.clientDataJSON)),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('id'),
                val: xdr.ScVal.scvBytes(base64url.toBuffer(authenticationResponse.id)),
            }),
            new xdr.ScMapEntry({
                key: xdr.ScVal.scvSymbol('signature'),
                val: xdr.ScVal.scvBytes(signature),
            }),
        ]))

        return entry
    }
    public async signAuthEntries(
        entries: xdr.SorobanAuthorizationEntry[],
        options?: {
            keyId?: 'any' | string | Uint8Array
            ledgersToLive?: number
        }
    ) {
        for (const auth of entries) {
            if (
                auth.credentials().switch().name === 'sorobanCredentialsAddress'
                && auth.credentials().address().address().switch().name === 'scAddressTypeContract'
            ) {
                // If auth entry matches our Smart Wallet move forward with the signature request
                if (Address.contract(auth.credentials().address().address().contractId()).toString() === this.wallet!.options.contractId)
                    await this.signAuthEntry(auth, options)
            }
        }

        return entries
    }
    public async sign(
        txn: Transaction | string,
        options?: {
            keyId?: 'any' | string | Uint8Array
            ledgersToLive?: number
        }
    ) {
        /*
            - Hack to ensure we don't stack fees when simulating and assembling multiple times
                AssembleTransaction always adds the resource fee onto the transaction fee. 
                This is bad in cases where you need to simulate multiple times
        */
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

        // Only need to sign auth for `invokeHostFunction` operations
        if (txn.operations[0].type === 'invokeHostFunction') {
            const entries = (txn.operations[0] as Operation.InvokeHostFunction).auth

            if (entries)
                await this.signAuthEntries(entries, options)
        }

        const sim = await this.rpc.simulateTransaction(txn)

        if (
            SorobanRpc.Api.isSimulationError(sim)
            || SorobanRpc.Api.isSimulationRestore(sim) // TODO handle state archival
        ) throw sim

        return SorobanRpc.assembleTransaction(txn, sim).build().toXDR()
    }
    public async getSuperKeyId() {
        const data: Map<string, any> = new Map()

        const { val } = await this.rpc.getContractData(
            this.wallet!.options.contractId,
            xdr.ScVal.scvLedgerKeyContractInstance(),
        );

        val.contractData()
            .val()
            .instance()
            .storage()
            ?.forEach((entry) => {
                data.set(
                    scValToNative(entry.key()),
                    scValToNative(entry.val()),
                );
            });

        return base64url(data.get('super'))
    }

    /* TODO 
        - Add a getKeyInfo action to get info about a specific passkey
            Specifically looking for name, type, etc. data so a user could grok what signer mapped to what passkey
            @Later
    */

    private getPublicKeyObject(attestationObject: string) {
        const { authData } = decode(base64url.toBuffer(attestationObject));
        const authDataUint8Array = new Uint8Array(authData);
        const authDataView = new DataView(authDataUint8Array.buffer, 0, authDataUint8Array.length);

        let offset = 0;

        // RP ID Hash (32 bytes)
        const rpIdHash = authData.slice(offset, offset + 32);
        offset += 32;

        // Flags (1 byte)
        const flags = authDataView.getUint8(offset);
        offset += 1;

        // Sign Count (4 bytes, big endian)
        const signCount = authDataView.getUint32(offset, false);
        offset += 4;

        // Attested Credential Data, if present
        if (flags & 0x40) { // Checking the AT flag
            // AAGUID (16 bytes)
            const aaguid = authData.slice(offset, offset + 16);
            offset += 16;

            // Credential ID Length (2 bytes, big endian)
            const credIdLength = authDataView.getUint16(offset, false);
            offset += 2;

            // Credential ID (variable length)
            const credentialId = authData.slice(offset, offset + credIdLength);
            offset += credIdLength;

            // Credential Public Key - (77 bytes...I hope)
            const credentialPublicKey = authData.slice(offset, offset + 77);
            offset += 77;

            // Any leftover bytes. I found some when using a YubiKey
            const theRest = authData.slice(offset);

            // Decode the credential public key to COSE
            const publicKeyObject = new Map<string, any>(Object.entries(decode(credentialPublicKey)));

            return {
                rpIdHash,
                flags,
                signCount,
                aaguid,
                credIdLength,
                credentialId,
                credentialPublicKey,
                theRest,
                publicKeyObject
            };
        }

        throw new Error("Attested credential data not present in the flags.");
    }
    private convertEcdsaSignatureAsnToCompact(signature: Buffer) {
        // Decode the DER signature
        let offset = 2;

        const rLength = signature[offset + 1];
        const r = signature.slice(offset + 2, offset + 2 + rLength);

        offset += 2 + rLength;

        const sLength = signature[offset + 1];
        const s = signature.slice(offset + 2, offset + 2 + sLength);
    
        // Convert r and s to BigNumber
        const rBigNum = new BigNumber(r.toString('hex'), 16);

        let sBigNum = new BigNumber(s.toString('hex'), 16);
    
        // Ensure s is in the low-S form
        // https://github.com/stellar/stellar-protocol/discussions/1435#discussioncomment-8809175
        // https://discord.com/channels/897514728459468821/1233048618571927693
        // Define the order of the curve secp256r1
        // https://github.com/RustCrypto/elliptic-curves/blob/master/p256/src/lib.rs#L72
        const n = new BigNumber('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551', 16);
        const halfN = n.dividedBy(2);
    
        if (sBigNum.isGreaterThan(halfN))
            sBigNum = n.minus(sBigNum);
    
        // Convert back to buffers and ensure they are 32 bytes
        const rPadded = Buffer.from(rBigNum.toString(16).padStart(64, '0'), 'hex');
        const sLowS = Buffer.from(sBigNum.toString(16).padStart(64, '0'), 'hex');
    
        // Concatenate r and low-s
        const concatSignature = Buffer.concat([rPadded, sLowS]);
    
        return concatSignature;
    }
}