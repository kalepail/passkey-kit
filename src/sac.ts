import { Client as SacClient } from 'sac-sdk'
import { PasskeyBase } from "./base"
import type { Server } from '@stellar/stellar-sdk/rpc'

export class SACClient extends PasskeyBase {
    declare rpc: Server
    declare rpcUrl: string

    public networkPassphrase: string
    
    constructor(options: {
        networkPassphrase: string,
        rpcUrl: string
    }) {
        const { networkPassphrase, rpcUrl } = options

        super(rpcUrl)

        this.networkPassphrase = networkPassphrase
    }

    public getSACClient(SACContractId: string) {
        return new SacClient({
            contractId: SACContractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl,
        })
    }
}