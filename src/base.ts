import { Networks, Transaction, Horizon, FeeBumpTransaction } from '@stellar/stellar-sdk'

export class PasskeyBase {
    public networkPassphrase: Networks
    public horizonUrl: string
    public horizon: Horizon.Server
    public feeBumpUrl: string | undefined
    public feeBumpJwt: string | undefined

    constructor(options: {
        networkPassphrase: Networks,
        horizonUrl: string,
        feeBumpUrl?: string,
        feeBumpJwt?: string,
    }) {
        const {
            networkPassphrase,
            horizonUrl,
            feeBumpUrl,
            feeBumpJwt,
        } = options

        this.networkPassphrase = networkPassphrase
        this.horizonUrl = horizonUrl
        this.horizon = new Horizon.Server(horizonUrl)

        if (feeBumpUrl)
            this.feeBumpUrl = feeBumpUrl

        if (feeBumpJwt)
            this.feeBumpJwt = feeBumpJwt
    }

    public async send(txn: Transaction, fee: number = 10_000) {
        const data = new FormData();

        data.set('xdr', txn.toXDR());
        data.set('fee', fee.toString());

        const bumptxn = await fetch(this.feeBumpUrl!, {
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
}