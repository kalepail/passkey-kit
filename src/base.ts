import { SorobanRpc } from "@stellar/stellar-sdk"

export class PasskeyBase {
    public rpc: SorobanRpc.Server | undefined
    public rpcUrl: string | undefined
    
    constructor(rpcUrl?: string) {
        if (rpcUrl) {
            this.rpcUrl = rpcUrl
            this.rpc = new SorobanRpc.Server(rpcUrl)
        }
    }
}