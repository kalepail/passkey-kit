import { SorobanRpc, xdr } from "@stellar/stellar-sdk"
import { PasskeyBase } from "./base"

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
                    await this.rpc.getContractData(contractId, xdr.ScVal.scvBytes(signer.id), SorobanRpc.Durability.Temporary)
                } catch {
                    signer.expired = true
                }
            }
        }

        return signers as { 
            id: string, 
            pk: string, 
            type: string, 
            admin: boolean, 
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
                            id: keyId,
                            type: 'Secp256r1'
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

    /* TODO 
        - Add a method for getting a paginated or filtered list of all a wallet's events
            @Later
    */

    // TODO maybe fee should default to something more dynamic since we have endpoints for getting fee information now
    public async send(xdr: string, fee: number = 10_000) {
        if (!this.launchtubeUrl || !this.launchtubeJwt)
            throw new Error('Launchtube service not configured')

        const data = new FormData();

        data.set('xdr', xdr);
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