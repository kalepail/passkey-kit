import { Client as PasskeyClient } from 'passkey-kit-sdk'
import { Client as FactoryClient, networks } from 'passkey-factory-sdk'
import { Address, Networks, StrKey, hash, xdr, Transaction, SorobanRpc, Operation, scValToNative, TransactionBuilder } from '@stellar/stellar-sdk'
import { bufToBigint, bigintToBuf } from 'bigint-conversion'
import base64url from 'base64url'
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import { decode } from 'cbor-x/decode'
import { Buffer } from 'buffer'
import { PasskeyBase } from './base'

/* TODO 
    - Clean up these params and the interface as a whole
        Might put wallet activities and maybe factory as well into the root of the class vs buried inside this.wallet and this.factory
        @Later
    - Right now publicKey can mean a Stellar public key or a passkey public key, there should be a noted difference
*/

export class PasskeyKit extends PasskeyBase {
    public keyId: string | undefined
    public superKeyId: string | undefined
    public wallet: PasskeyClient | undefined
    public factory: FactoryClient
    public networkPassphrase: Networks
    public rpcUrl: string
    public rpc: SorobanRpc.Server
    public factoryContractId: string = networks.testnet.contractId

    /* NOTE 
        - Consider adding the ability to pass in a keyId and maybe even a contractId in order to preconnect to a wallet
            If just a keyId call `connectWallet` in order to get the contractId
            If both keyId and contractId are passed in then we can skip the connectWallet call (though we won't get the superKeyId in that case)
            We don't strictly _need_ this as a dev can just call `connectWallet` after class instantiation but it might be a nice convenience
            `connectWallet` is async making it tricky to know when the wallet is "ready". Thus I think it's better for `connectWallet` to be called externally
            @No
    */
    constructor(options: {
        rpcUrl: string,
        launchtubeUrl?: string,
        launchtubeJwt?: string,
        factoryContractId?: string,
        networkPassphrase: string,
    }) {
        const {
            rpcUrl,
            launchtubeUrl,
            launchtubeJwt,
            factoryContractId,
            networkPassphrase,
        } = options

        super({
            launchtubeUrl,
            launchtubeJwt,
        })

        if (factoryContractId)
            this.factoryContractId = factoryContractId

        this.rpcUrl = rpcUrl
        this.rpc = new SorobanRpc.Server(rpcUrl)
        this.networkPassphrase = networkPassphrase as Networks
        this.factory = new FactoryClient({
            contractId: this.factoryContractId,
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

        if (!this.keyId) {
            this.keyId = startRegistrationResponse.id

            // If there was no keyId we're likely about to deploy a new wallet so we should set the superKeyId 
            if (!this.superKeyId)
                this.superKeyId = startRegistrationResponse.id
        }

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

    public async connectWallet(keyId?: string) {
        if (!keyId) {
            const { id } = await startAuthentication({
                challenge: base64url("stellaristhebetterblockchain"),
                // rpId: undefined,
                userVerification: "discouraged",
            });

            keyId = id
        }

        if (!this.keyId)
            this.keyId = keyId

        const keyIdBuffer = base64url.toBuffer(keyId)

        // NOTE might not need this for derivation as all signers are stored in the factory and we can use that lookup as both primary and secondary
        let contractId = StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(
            new xdr.HashIdPreimageContractId({
                networkId: hash(Buffer.from(this.networkPassphrase, 'utf-8')),
                contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                    new xdr.ContractIdPreimageFromAddress({
                        address: Address.fromString(this.factoryContractId).toScAddress(),
                        salt: hash(keyIdBuffer),
                    })
                )
            })
        ).toXDR()));

        let contractData: SorobanRpc.Api.LedgerEntryResult | undefined

        // attempt passkey id derivation
        try {
            contractData = await this.rpc.getContractData(contractId, xdr.ScVal.scvLedgerKeyContractInstance())
        }
        // if that fails look up from the factory mapper
        catch {
            const { val } = await this.rpc.getContractData(this.factoryContractId, xdr.ScVal.scvBytes(keyIdBuffer))
            contractId = scValToNative(val.contractData().val())
        }

        this.wallet = new PasskeyClient({
            contractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })

        // get and set the super signer (passing in `contractData` from the `getContractData` call above to avoid dupe requests)
        await this.getData(contractData)

        return {
            keyId: keyIdBuffer,
            contractId
        }
    }

    public async signAuthEntry(
        entry: xdr.SorobanAuthorizationEntry,
        options?: {
            keyId?: 'any' | 'super' | string | Uint8Array
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
                || (keyId === 'super' && !this.superKeyId)
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
                            id: keyId === 'super'
                                ? this.superKeyId!
                                : keyId instanceof Uint8Array
                                    ? base64url(keyId)
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
            keyId?: 'any' | 'super' | string | Uint8Array
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
    /* NOTE 
        - Is there anything to be done with using the TS bindings `signAuthEntries` logic? Likely not but worth exploring 
            Perhaps not but maybe the js-sdk's `authorizeEntry` or `authorizeInvocation`
            https://stellar.github.io/js-stellar-sdk/global.html#authorizeInvocation
            These methods all only support ed25519 Keypairs
            @No
    */
    public async sign(
        txn: Transaction | string,
        options?: {
            keyId?: 'any' | 'super' | string | Uint8Array
            ledgersToLive?: number
        }
    ) {
        /* NOTE 
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

    public async getData(contractData?: SorobanRpc.Api.LedgerEntryResult) {
        const data: Map<string, any> = new Map()

        /* TODO 
            - Pretty easy to get into a state where there is no contractId and this we error at `this.wallet!.options.contractId,`
                We should have a better error or maybe just handle no-wallet scenarios more gracefully
        */
        const { val } = contractData || await this.rpc.getContractData(
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

        this.superKeyId = base64url(data.get('super'))

        return data
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

    private convertEcdsaSignatureAsnToCompact(sig: Buffer) {
        // Define the order of the curve secp256k1
        // https://github.com/RustCrypto/elliptic-curves/blob/master/p256/src/lib.rs#L72
        const q = Buffer.from('ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551', 'hex')

        // ASN Sequence
        let offset = 0;
        if (sig[offset] != 0x30) {
            throw "signature is not a sequence";
        }
        offset += 1;

        // ASN Sequence Byte Length
        offset += 1;

        // ASN Integer (R)
        if (sig[offset] != 0x02) {
            throw "first element in sequence is not an integer";
        }
        offset += 1;

        // ASN Integer (R) Byte Length
        const rLen = sig[offset];
        offset += 1;

        // ASN Integer (R) Byte Value
        if (rLen >= 33) {
            if (rLen != 33 || sig[offset] != 0x00) {
                throw "can only handle larger than 32 byte R's that are len 33 and lead with zero";
            }
            offset += 1;
        }
        const r = sig.slice(offset, offset + 32);
        offset += 32;

        // ASN Integer (S)
        if (sig[offset] != 0x02) {
            throw "second element in sequence is not an integer";
        }
        offset += 1;

        // ASN Integer (S) Byte Length
        const sLen = sig[offset];
        offset += 1;

        // ASN Integer (S) Byte Value
        if (sLen >= 33) {
            if (sLen != 33 || sig[offset] != 0x00) {
                throw "can only handle larger than 32 byte R's that are len 33 and lead with zero";
            }
            offset += 1;
        }

        const s = sig.slice(offset, offset + 32);

        offset += 32;

        let signature64: Buffer

        // Force low S range
        // https://github.com/stellar/stellar-protocol/discussions/1435#discussioncomment-8809175
        // https://discord.com/channels/897514728459468821/1233048618571927693
        if (bufToBigint(s) > ((bufToBigint(q) - BigInt(1)) / BigInt(2))) {
            signature64 = Buffer.from([...r, ...Buffer.from(bigintToBuf(bufToBigint(q) - bufToBigint(s), true) as ArrayBuffer)]);
        } else {
            signature64 = Buffer.from([...r, ...s]);
        }

        return signature64;
    }
}