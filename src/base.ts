import { SorobanRpc, xdr } from "@stellar/stellar-sdk"
import base64url from "base64url"

export class PasskeyBase {
    public rpc: SorobanRpc.Server | undefined
    public rpcUrl: string | undefined
    public launchtubeUrl: string | undefined
    public launchtubeJwt: string | undefined
    public mercuryUrl: string | undefined
    public mercuryJwt: string | undefined
    public mercuryEmail: string | undefined
    public mercuryPassword: string | undefined

    constructor(options: {
        rpcUrl?: string,
        launchtubeUrl?: string,
        launchtubeJwt?: string,
        mercuryUrl?: string,
        mercuryJwt?: string,
        mercuryEmail?: string,
        mercuryPassword?: string
    }) {
        const {
            rpcUrl,
            launchtubeUrl,
            launchtubeJwt,
            mercuryUrl,
            mercuryJwt,
            mercuryEmail,
            mercuryPassword
        } = options

        if (launchtubeUrl)
            this.launchtubeUrl = launchtubeUrl

        if (launchtubeJwt)
            this.launchtubeJwt = launchtubeJwt

        if (mercuryUrl)
            this.mercuryUrl = mercuryUrl

        if (mercuryJwt)
            this.mercuryJwt = mercuryJwt

        if (mercuryEmail)
            this.mercuryEmail = mercuryEmail

        if (mercuryPassword)
            this.mercuryPassword = mercuryPassword

        if (rpcUrl) {
            this.rpcUrl = rpcUrl
            this.rpc = new SorobanRpc.Server(rpcUrl)
        }
    }

    public async setMercuryJwt() {
        if (!this.mercuryUrl || !this.mercuryEmail || !this.mercuryPassword)
            throw new Error('Mercury service not configured')

        const { data: { authenticate: { jwtToken } } } = await fetch(`${this.mercuryUrl}/graphql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: `mutation {
                    authenticate(input: {
                        email: "${this.mercuryEmail}"
                        password: "${this.mercuryPassword}"
                    }) {
                        jwtToken
                    }
                }`
            })
        })
            .then(async (res) => {
                if (res.ok)
                    return res.json()

                throw await res.json()
            })

        this.mercuryJwt = jwtToken
        return jwtToken
    }

    public async getSigners(contractId: string) {
        if (this.rpc && this.mercuryUrl && !this.mercuryJwt)
            await this.setMercuryJwt()

        if (!this.rpc || !this.mercuryUrl || !this.mercuryJwt)
            throw new Error('Mercury service not configured')

        const signers = await fetch(`${this.mercuryUrl}/zephyr/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.mercuryJwt}`
            },
            body: JSON.stringify({
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

            signer.id = base64url(signer.id)
            signer.pk = base64url(signer.pk)
        }

        return signers as { id: string, pk: string, admin: boolean, expired?: boolean }[]
    }

    public async getContractId(keyId: string) {
        if (this.mercuryUrl && !this.mercuryJwt)
            await this.setMercuryJwt()

        if (!this.mercuryUrl || !this.mercuryJwt)
            return

        const res = await fetch(`${this.mercuryUrl}/zephyr/execute`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.mercuryJwt}`
            },
            body: JSON.stringify({
                mode: {
                    Function: {
                        fname: "get_address_by_signer",
                        arguments: JSON.stringify({
                            id: [...base64url.toBuffer(keyId)]
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

        return res[0]?.address as string | undefined
    }

    /* TODO 
        - Add a method for getting a paginated or filtered list of all a wallet's events
            @Later
    */

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