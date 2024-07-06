export class PasskeyBase {
    public launchtubeUrl: string | undefined
    public launchtubeJwt: string | undefined

    constructor(options: {
        launchtubeUrl?: string,
        launchtubeJwt?: string,
    }) {
        const {
            launchtubeUrl,
            launchtubeJwt,
        } = options

        if (launchtubeUrl)
            this.launchtubeUrl = launchtubeUrl

        if (launchtubeJwt)
            this.launchtubeJwt = launchtubeJwt
    }

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
        .catch((err) => {
            alert(JSON.stringify(err))
            throw err
        })
    }
}