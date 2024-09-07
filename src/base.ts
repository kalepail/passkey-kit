import { SorobanRpc } from "@stellar/stellar-sdk"

// TODO consider adding support for a signAuthEntry method that conforms to the ed25519 signature scheme of this passkey interface
// once we do that we can clean the code a little with the `xdr.HashIdPreimage.envelopeTypeSorobanAuthorization` stuff

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