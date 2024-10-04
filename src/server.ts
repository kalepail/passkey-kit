import { SorobanRpc, xdr } from "@stellar/stellar-sdk/minimal"
import { PasskeyBase } from "./base"
import base64url from "base64url"
import type { Tx } from "@stellar/stellar-sdk/contract"

export class PasskeyServer extends PasskeyBase {
    public launchtubeUrl: string | undefined
    public launchtubeJwt: string | undefined
    public mercuryUrl: string | undefined
    public mercuryJwt: string | undefined
    public mercuryKey: string | undefined

    constructor(options: {
        rpcUrl?: string,
        launchtubeUrl?: string,
        launchtubeJwt?: string,
        mercuryUrl?: string,
        mercuryJwt?: string,
        mercuryKey?: string,
    }) {
        const {
            rpcUrl,
            launchtubeUrl,
            launchtubeJwt,
            mercuryUrl,
            mercuryJwt,
            mercuryKey,
        } = options

        super(rpcUrl)

        if (launchtubeUrl)
            this.launchtubeUrl = launchtubeUrl

        if (launchtubeJwt)
            this.launchtubeJwt = launchtubeJwt

        if (mercuryUrl)
            this.mercuryUrl = mercuryUrl

        if (mercuryJwt)
            this.mercuryJwt = mercuryJwt

        if (mercuryKey)
            this.mercuryKey = mercuryKey
    }

    public async getSigners(contractId: string) {
        if (!this.rpc || !this.mercuryUrl || (!this.mercuryJwt && !this.mercuryKey))
            throw new Error('Mercury service not configured')

        const signers = await fetch(`${this.mercuryUrl}/zephyr/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.mercuryJwt ? `Bearer ${this.mercuryJwt}` : this.mercuryKey!
            },
            body: JSON.stringify({
                project_name: 'smart-wallets-data-multi-signer-multi-sig',
                mode: {
                    Function: {
                        fname: "get_signers_by_address",
                        arguments: JSON.stringify({
                            address: contractId
                        })
                    }
                }
            })
        })
            .then(async (res) => {
                if (res.ok)
                    return res.json()

                throw await res.json()
            })

        for (const signer of signers) {
            if (!signer.admin) {
                try {
                    await this.rpc.getContractData(contractId, xdr.ScVal.scvBytes(base64url.toBuffer(signer.key)), SorobanRpc.Durability.Temporary)
                } catch {
                    signer.expired = true
                }
            }
        }

        return signers as { 
            kind: string,
            key: string, 
            val: string, 
            limits: string,
            expired?: boolean 
        }[]
    }

    public async getContractId(options: {
        keyId?: string,
        publicKey?: string,
        policy?: string,
    }, index = 0) {
        if (!this.mercuryUrl || (!this.mercuryJwt && !this.mercuryKey))
            throw new Error('Mercury service not configured')

        let { keyId, publicKey, policy } = options || {}

        if ([keyId, publicKey, policy].filter((arg) => !!arg).length > 1)
            throw new Error('Exactly one of `options.keyId`, `options.publicKey`, or `options.policy` must be provided.');

        let args: { key: string, kind: 'Secp256r1' | 'Ed25519' | 'Policy' }

        if (keyId)
            args = { key: keyId, kind: 'Secp256r1' }
        else if (publicKey)
            args = { key: publicKey, kind: 'Ed25519' }
        else if (policy)
            args = { key: policy, kind: 'Policy' }

        const res = await fetch(`${this.mercuryUrl}/zephyr/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: this.mercuryJwt ? `Bearer ${this.mercuryJwt}` : this.mercuryKey!
            },
            body: JSON.stringify({
                project_name: 'smart-wallets-data-multi-signer-multi-sig',
                mode: {
                    Function: {
                        fname: "get_addresses_by_signer",
                        arguments: JSON.stringify(args!)
                    }
                }
            })
        })
            .then(async (res) => {
                if (res.ok)
                    return await res.json() as string[]

                throw await res.json()
            })

        return res[index]
    }

    /* LATER
        - Add a method for getting a paginated or filtered list of all a wallet's events
    */

    public async send(txn: Tx, fee?: number) {
        if (!this.launchtubeUrl || !this.launchtubeJwt)
            throw new Error('Launchtube service not configured')

        const data = new FormData();

        data.set('xdr', txn.toXDR());

        if (fee)
            data.set('fee', fee.toString());

        return fetch(this.launchtubeUrl, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${this.launchtubeJwt}`,
            },
            body: data
        }).then(async (res) => {
            if (res.ok)
                return res.json()
            else throw await res.json()
        })
    }
}