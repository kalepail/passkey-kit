import { SorobanRpc } from "@stellar/stellar-sdk/minimal"

// TODO consider adding support for a signAuthEntry method that conforms to the ed25519 signature scheme of this passkey interface
// once we do that we can clean the code a little with the `xdr.HashIdPreimage.envelopeTypeSorobanAuthorization` stuff
// ... note I've re-read the above and I've currently got no clue what this is asking for. Maybe check git-blame for when it was added to try and find some context
// actually this is just talking about adding support for signing transactions with an ed25519 key as well as a passkey. Simple enough

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