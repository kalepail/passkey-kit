import { Client as PasskeyClient } from 'passkey-kit-sdk'
import { Client as FactoryClient } from 'passkey-factory-sdk'
import { Address, StrKey, hash, xdr, Transaction, SorobanRpc, Operation, TransactionBuilder } from '@stellar/stellar-sdk'
import base64url from 'base64url'
import { startRegistration, startAuthentication } from "@simplewebauthn/browser"
import type { AuthenticatorAttestationResponseJSON, AuthenticatorSelectionCriteria } from "@simplewebauthn/types"
import { Buffer } from 'buffer'
import { PasskeyBase } from './base'
import { DEFAULT_TIMEOUT } from '@stellar/stellar-sdk/contract'

/**
 * The client-centrict passkey kit class. Used to create, register, and sign
 * with client-generated passkeys.
 */
export class PasskeyKit extends PasskeyBase {
    declare public rpc: SorobanRpc.Server
    declare public rpcUrl: string
    public keyId: string | undefined
    /**
     * The network passphrase used by the configured RPC instance.
     */
    public networkPassphrase: string
    /**
     * A client for the deployer factory which will create the client's smart
     * wallets.
     */
    public factory: FactoryClient
    /**
     * A client which can be used with smart wallets deployed by this
     * PasskeyKit.
     */
    public wallet: PasskeyClient | undefined
    /**
     * A WebAuthn implementation that can be used to create and register
     * passkeys.
     */
    public WebAuthn: {
        /**
         * Begin authenticator "registration" via WebAuthn attestation.
         */
        startRegistration: typeof startRegistration,
        /**
         * Begin authenticator "login" via WebAuthn assertion.
         */
        startAuthentication: typeof startAuthentication
    }

    /**
     * Create a new PasskeyKit object.
     *
     * @param options - The configuration options for this passkey kit.
     * @param options.rpcUrl - The URL of the RPC server.
     * @param options.networkPassphrase - The network passphrase used by the configured RPC instance.
     * @param options.factoryContractId - The `C...` address of a factory contract used to deploy smart wallets.
     * @param options.WebAuthn - A WebAuthn implementation that can be used to create and register passkeys.
     * @param options.WebAuthn.startRegistration - Function to begin authenticator "registration" via WebAuthn attestation.
     * @param options.WebAuthn.startAuthentication - Function to begin authenticator "login" via WebAuthn assertion.
     */
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

    /**
     * Create a passkey and deploy a smart wallet using it as a signer.
     *
     * @param app - The application this passkey is used on. Similar to a
     * website title.
     * @param user - The username associated (client-side) with this passkey.
     * @returns The passkey's ID, public key, and a transaction that can be
     * sent to the network, which will result in the creation of a smart wallet
     * contract.
     */
    public async createWallet(app: string, user: string) {
        const { keyId, publicKey } = await this.createKey(app, user)

        const { result, built } = await this.factory.deploy({
            salt: hash(keyId),
            id: keyId,
            pk: publicKey
        })

        const contractId = result.unwrap()

        this.wallet = new PasskeyClient({
            contractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })

        return {
            keyId,
            contractId,
            xdr: built?.toXDR()
        }
    }

    /**
     * Generate and return a passkey the user will use to register and then
     * login to the service.
     *
     * @param app - The application this passkey is used on. Similar to a
     * website title.
     * @param user - The username associated (client-side) with this passkey.
     * @param settings - Settings used to create the passkey.
     * @param settings.rpId - The `id` (or domain) of the "relying party" that
     * is responsible for registering and authenticating the user.
     * @param settings.authenticatorSelection - The desired restrictions that
     * should be placed concerning the _types_ of authenticators allowed.
     * @returns A passkey's ID and public key.
     */
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
            // authenticatorSelection: {
            //     requireResidentKey: false,
            //     residentKey: "preferred",
            //     userVerification: "discouraged",
            // },
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

    /**
     * Login to an existing smart wallet, using a passkey.
     *
     * @param opts - The configuration options for this wallet connection.
     * @param opts.keyId - The ID of the passkey.
     * @param opts.rpId - The `id` (or domain) of the relying party with which
     * we will authenticate.
     * @param opts.getContractId - A function which will return a deployed smart
     * wallet `C...` address, given a passkey's public key.
     * @returns The passkey's ID and its associated smart wallet contract
     * address.
     */
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

    /**
     * Sign a Soroban transaction authorization entry with a passkey.
     *
     * @param entry - An authorization entry which is to be signed using the passkey
     * @param options - Configuration options for this signature.
     * @param options.keyId - The ID of the passkey.
     * @param options.rpId - The `id` (or domain) of the "relying party."
     * @param options.ledgersToLive - How many ledgers into the future this
     * signature should be valid for.
     * @returns A signed authorization entry.
     */
    public async signAuthEntry(
        entry: xdr.SorobanAuthorizationEntry,
        options?: {
            keyId?: 'any' | string | Uint8Array
            rpId?: string,
            ledgersToLive?: number
        }
    ) {
        let { keyId, rpId, ledgersToLive = DEFAULT_TIMEOUT } = options || {}

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

        const signature = this.compactSignature(
            base64url.toBuffer(authenticationResponse.response.signature)
        );

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

    /**
     * For each entry in an array, sign the authorization entry using the
     * passkey.
     *
     * @param entries - An array of entries to sign.
     * @param options - Configuration options for this signature.
     * @param options.keyId - The ID of the passkey.
     * @param options.ledgersToLive - How many ledgers into the future this
     * signature should be valid for.
     * @returns An array of signed authorization entries.
     */
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
                if (Address.contract(auth.credentials().address().address().contractId()).toString() === this.wallet?.options.contractId)
                    await this.signAuthEntry(auth, options)
            }
        }

        return entries
    }

    /**
     * Sign a transaction using a passkey, and prepare it for submission to the
     * network.
     *
     * @param txn - The transaction that should be signed using the passkey.
     * @param options - Configuration options for this transaction signature.
     * @param options.keyId - The ID of the passkey.
     * @param options.ledgersToLive - How many ledgers into the future this
     * signature should be valid for.
     * @returns A base64-encoded transaction that has been simulated, assembled,
     * and signed by the passkey.
     */
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

    /**
     * @todo Add a getKeyInfo action to get info about a specific passkey.
     * Specifically looking for name, type, etc. data so a user could grok what
     * signer mapped to what passkey.
     */

    /**
     * Extract the passkey's public key from the registration response JSON
     * object.
     *
     * @param response - The response JSON from the WebAuthn registration process.
     * @returns The public key of the passkey, as a buffer.
     *
     * @see {@link https://w3c.github.io/webauthn/#dictdef-authenticatorattestationresponsejson}
     *
     * @todo We're doing some pretty "smart" public key decoding stuff so we
     * should verify the signature against this final public key before
     * assuming it's safe to use and save on-chain. Given that
     * `startRegistration` doesn't produce a signature, verifying we've got
     * the correct public key isn't really possible
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

        return publicKey
    }

    /**
     * Compact an authorization entry signature.
     *
     * @param signature - The signature for the authorization entry.
     * @returns A 32-byte signature buffer that is (somehow?) better than the
     * one that was provided.
     */
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
