import { SorobanRpc, xdr } from "@stellar/stellar-sdk"
import { PasskeyBase } from "./base"
import base64url from "base64url"

export class PasskeyServer extends PasskeyBase {
    public launchtubeUrl: string | undefined
    public launchtubeJwt: string | undefined
    public mercuryUrl: string | undefined
    public mercuryJwt: string | undefined

    constructor(options: {
        rpcUrl?: string,
        launchtubeUrl?: string,
        launchtubeJwt?: string,
        mercuryUrl?: string,
        mercuryJwt?: string,
    }) {
        const {
            rpcUrl,
            launchtubeUrl,
            launchtubeJwt,
            mercuryUrl,
            mercuryJwt,
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
    }

    public async getSigners(contractId: string) {
        if (!this.rpc || !this.mercuryUrl || !this.mercuryJwt)
            throw new Error('Mercury service not configured')

        const signers = await fetch(`${this.mercuryUrl}/zephyr/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.mercuryJwt}`
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

    public async getContractId(keyId: string) {
        if (!this.mercuryUrl || !this.mercuryJwt)
            return

        const res = await fetch(`${this.mercuryUrl}/zephyr/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.mercuryJwt}`
            },
            body: JSON.stringify({
                project_name: 'smart-wallets-data-multi-signer-multi-sig',
                mode: {
                    Function: {
                        fname: "get_address_by_signer",
                        arguments: JSON.stringify({
                            key: keyId,
                            kind: 'Secp256r1'
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

        return res || undefined as string | undefined
    }

    /* LATER
        - Add a method for getting a paginated or filtered list of all a wallet's events
    */

    public async send(xdr: string, fee?: number) {
        if (!this.launchtubeUrl || !this.launchtubeJwt)
            throw new Error('Launchtube service not configured')

        const data = new FormData();

        data.set('xdr', xdr);

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