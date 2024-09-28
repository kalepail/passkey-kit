import { SorobanRpc, xdr } from "@stellar/stellar-sdk"
import base64url from "base64url"
import { PasskeyBase } from "./base"

/**
 * A server class used to communicate with Launchtube and Mercury to send
 * transactions, and query for signers and contracts.
 */
export class PasskeyServer extends PasskeyBase {
    /**
     * The URL that will be used to communicate with a Launchtube service.
     *
     * @see {@link https://github.com/stellar/launchtube | Launchtube}
     */
    public launchtubeUrl: string | undefined
    /**
     * The bearer token used to authenticate with a Launchtube service.
     *
     * @remarks
     * The required JWT token can be requested inside the `#passkeys` of the
     * {@link https://discord.gg/stellardev | Stellar Developers discord server}.
     */
    public launchtubeJwt: string | undefined
    /**
     * The URL that will be used to communicate with the Mercury data indexer.
     *
     * @see {@link https://www.mercurydata.app | Mercury}
     */
   public mercuryUrl: string | undefined
    /**
     * The bearer token used to authenticate with the Mercury data indexer.
     *
     * @see {@link https://docs.mercurydata.app/get-started-with-mercury/authentication | Mercury Documentation}
     */
    public mercuryJwt: string | undefined

    /**
     * Create a new PasskeyServer object.
     *
     * @param options - The configuration options for this passkey server.
     * @param options.rpcUrl - The URL of the RPC server.
     * @param options.launchtubeUrl - The URL that will be used to communicate
     * with a Launchtube service.
     * @param options.launchtubeJwt - The bearer token used to authenticate with
     * a Launchtube service.
     * @param options.mercuryUrl - The URL that will be used to communicate with
     * the Mercury data indexer.
     * @param options.mercuryJwt - The bearer token used to authenticate with
     * the Mercury data indexer.
     */
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

    /**
     * Query the smart wallet contract's event history in order to retrieve all
     * signer passkeys that have been added to the smart wallet.
     *
     * @param contractId - The contract address for which you want to find all
     * added signers
     * @returns An array of signers. Each returned singer contains the signer's
     * ID, public key, whether it's an admin, and whether it's expired.
     *
     * @throws
     * Will throw an error if:
     * - the RPC server is not configured
     * - the Mercury URL is not configured
     * - the Mercury authorization token is not configured
     */
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
                project_name: 'smart-wallets-data',
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

    /**
     * Query network event history in order to retrieve the contract address a
     * passkey signer was added to.
     *
     * @param keyId - The public key of the client-generated passkey
     * @returns The contract address on which this passkey has been added as a
     * signer. If not contract is found, returns `undefined`.
     *
     * @throws
     * Will throw an error if:
     * - the Mercury query does not succeed
     * - the Mercury URL is not configured
     * - the Mercury authorization token is not configured
     */
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
                project_name: 'smart-wallets-data',
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

    /**
     * @todo Add a method for getting a paginated or filtered list of all a
     * wallet's events
     */

    /**
     * Send a signed transaction to the network via the configured Launchtube
     * service.
     *
     * @param xdr - The base64-encoded transaction to be sent to the network.
     * @param fee - The fee to be used in Launchtube's feebump transaction.
     * @returns The final transaction result and a `X-Credits-Remaining` header,
     * telling how many Launchtube credits the user has left.
     *
     * @throws
     * Will throw an error if:
     * - the Launchtube URL is not configured
     * - the Launchtube authorization token is not configured
     * - the transaction submission to the network fails
     *
     * @todo Maybe fee should default to something more dynamic since we have
     * endpoints for getting fee information now?
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
