import { Client as PasskeyClient } from 'passkey-kit-sdk'
import { Client as FactoryClient } from 'passkey-factory-sdk'
import { Address, Networks, StrKey, hash, xdr, Transaction, Keypair, Horizon, FeeBumpTransaction } from '@stellar/stellar-sdk'
import { bufToBigint, bigintToBuf } from 'bigint-conversion'
import Base64URL from "base64url"
import * as WebAuthn from "@simplewebauthn/browser"
import * as CBOR from 'cbor-x/decode'
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/types';
import { Buffer } from 'buffer'

const { default: base64url } = Base64URL

export class PasskeyAccount {
    public wallet: PasskeyClient | undefined
    public factory: FactoryClient
    public networkPassphrase: Networks
    public horizonUrl: string
    public horizon: Horizon.Server
    public rpcUrl: string
    public feeBumpUrl: string
    public feeBumpJwt: string
    public factoryContractId = 'CAON467XAJ6DXEC7CYVQUZBGRSGA23LBTNOD4VLOHERRCW5UIN356IIH'

    constructor(options: {
        sequencePublicKey: string,
        networkPassphrase: Networks,
        horizonUrl: string,
        rpcUrl: string,
        feeBumpUrl: string,
        feeBumpJwt: string,
        factoryContractId?: string,
    }) {
        const {
            sequencePublicKey,
            networkPassphrase,
            horizonUrl,
            rpcUrl,
            feeBumpUrl,
            feeBumpJwt,
            factoryContractId
        } = options

        this.networkPassphrase = networkPassphrase
        this.horizonUrl = horizonUrl
        this.horizon = new Horizon.Server(horizonUrl)
        this.rpcUrl = rpcUrl
        this.feeBumpUrl = feeBumpUrl
        this.feeBumpJwt = feeBumpJwt

        if (factoryContractId)
            this.factoryContractId = factoryContractId

        this.factory = new FactoryClient({
            publicKey: sequencePublicKey,
            contractId: this.factoryContractId,
            networkPassphrase,
            rpcUrl
        })
    }

    // TODO support a "sign in" method
    public async startRegistration(name: string, user: string) {
        const registrationResponse = await WebAuthn.startRegistration({
            challenge: base64url("sorobanisbest"),
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

        const publicKeys = await this.getPublicKeys(registrationResponse)
        const contractId = StrKey.encodeContract(hash(xdr.HashIdPreimage.envelopeTypeContractId(
            new xdr.HashIdPreimageContractId({
                networkId: hash(Buffer.from(this.networkPassphrase, 'utf-8')),
                contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                    new xdr.ContractIdPreimageFromAddress({
                        address: Address.fromString(this.factoryContractId).toScAddress(),
                        salt: publicKeys.contractSalt,
                    })
                )
            })
        ).toXDR()));

        this.wallet = new PasskeyClient({
            contractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })

        return {
            contractId,
            ...publicKeys,
        }
    }

    public async startAuthentication(authHash: string, id: string) {
        const authenticationResponse = await WebAuthn.startAuthentication({
            challenge: base64url(authHash),
            // rpId: undefined,
            allowCredentials: id
                ? [
                    {
                        id,
                        type: "public-key",
                    },
                ]
                : undefined,
            userVerification: "discouraged",
        });

        authenticationResponse.response.signature = this.convertEcdsaSignatureAsnToCompact(base64url.toBuffer(authenticationResponse.response.signature));

        return authenticationResponse
    }

    public async deployWallet(contractSalt: Buffer, publicKey: Buffer, secret: string) {
        const source = Keypair.fromSecret(secret)
        const { built } = await this.factory.deploy({
            salt: contractSalt,
            pk: publicKey
        })

        const txn = new Transaction(built!.toXDR(), this.networkPassphrase);

        txn.sign(source);

        const data = new FormData();

        data.set('xdr', txn.toXDR());
        data.set('fee', (10_000_000).toString());

        const bumptxn = await fetch(this.feeBumpUrl, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${this.feeBumpJwt}`,
            },
            body: data
        }).then(async (res) => {
            if (res.ok)
                return res.text()
            else throw await res.json()
        })

        return this.horizon.submitTransaction(new FeeBumpTransaction(bumptxn, this.networkPassphrase))
    }

    private async getPublicKeys(value: RegistrationResponseJSON | AuthenticationResponseJSON) {
        const contractSalt = hash(base64url.toBuffer(value.id))

        let publicKey: Buffer | undefined

        if (isAuthentication(value)) {
            const { publicKeyObject } = this.getPublicKeyObject(value.response.attestationObject);

            publicKey = Buffer.from([
                4, // (0x04 prefix) https://en.bitcoin.it/wiki/Elliptic_Curve_Digital_Signature_Algorithm
                ...publicKeyObject.get('-2')!,
                ...publicKeyObject.get('-3')!
            ])
        }

        return {
            contractSalt,
            publicKey
        }
    }

    private getPublicKeyObject(attestationObject: string) {
        const { authData } = CBOR.decode(base64url.toBuffer(attestationObject));
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
            const publicKeyObject = new Map<string, any>(Object.entries(CBOR.decode(credentialPublicKey)));

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

        let signature64

        // Force low S range
        // https://github.com/stellar/stellar-protocol/discussions/1435#discussioncomment-8809175
        // https://discord.com/channels/897514728459468821/1233048618571927693
        if (bufToBigint(s) > ((bufToBigint(q) - BigInt(1)) / BigInt(2))) {
            signature64 = Buffer.from([...r, ...Buffer.from(bigintToBuf(bufToBigint(q) - bufToBigint(s), true) as ArrayBuffer)]);
        } else {
            signature64 = Buffer.from([...r, ...s]);
        }

        return base64url(signature64);
    }
}

function isAuthentication(value: any): value is RegistrationResponseJSON {
    return value?.response?.attestationObject;
}