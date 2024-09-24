import { SorobanRpc } from "@stellar/stellar-sdk"

/**
 * A base class that is used internally by the server and kit classes.
 * @internal
 */
export class PasskeyBase {
    /**
     * The URL of the RPC server.
     */
    public rpcUrl: string | undefined
    /**
     * The configured instance of the RPC server.
     */
    public rpc: SorobanRpc.Server | undefined

    /**
     * Create a new base passkey kit object.
     *
     * @param rpcUrl - The URL of the RPC server.
     */
    constructor(rpcUrl?: string) {
        if (rpcUrl) {
            this.rpcUrl = rpcUrl
            this.rpc = new SorobanRpc.Server(rpcUrl)
        }
    }
}
