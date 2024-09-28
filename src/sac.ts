import { Client as SacClient } from 'sac-sdk'
import { PasskeyBase } from "./base"
import type { SorobanRpc } from '@stellar/stellar-sdk'

/**
 * A client class that can be used to interact with various Stellar Asset
 * Contracts (SACs).
 *
 * @see {@link https://developers.stellar.org/docs/tokens/stellar-asset-contract | SAC Documentation}
 */
export class SACClient extends PasskeyBase {
    declare public rpc: SorobanRpc.Server
    declare public rpcUrl: string
    /**
     * The network passphrase used by the configured RPC instance.
     */
    public networkPassphrase: string

    /**
     * Create a new SAC client
     *
     * @param options - The configuration options for this passkey server.
     * @param options.networkPassphrase - The network passphrase used by the configured RPC instance.
     * @param options.rpcUrl - The URL of the RPC server.
     */
    constructor(options: {
        networkPassphrase: string,
        rpcUrl: string
    }) {
        const { networkPassphrase, rpcUrl } = options

        super(rpcUrl)

        this.networkPassphrase = networkPassphrase
    }

    /**
     * Create a client object with invocable methods for all of the SAC
     * functionality.
     *
     * @param SACContractId - The `C...` address for a deployed SAC
     * @returns A client generated from the contract spec for the deployed SAC
     */
    public getSACClient(SACContractId: string) {
        return new SacClient({
            contractId: SACContractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })
    }
}
