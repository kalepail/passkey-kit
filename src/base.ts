import { SorobanRpc } from "@stellar/stellar-sdk"

export class PasskeyBase {
    public rpcUrl: string | undefined
    public rpc: SorobanRpc.Server | undefined
    
    constructor(rpcUrl?: string) {
        if (rpcUrl) {
            this.rpcUrl = rpcUrl
            this.rpc = new SorobanRpc.Server(rpcUrl)
        }
    }
}