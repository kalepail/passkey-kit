import { SorobanRpc } from "@stellar/stellar-sdk"
import { Client as SacClient } from 'sac-sdk'

export class SACClient {
    public networkPassphrase: string
    public rpcUrl: string
    public rpc: SorobanRpc.Server
    
    constructor(options: {
        networkPassphrase: string,
        rpcUrl: string
    }) {
        const { networkPassphrase, rpcUrl } = options

        this.networkPassphrase = networkPassphrase
        this.rpcUrl = rpcUrl
        this.rpc = new SorobanRpc.Server(rpcUrl)
    }

    public getSACClient(SACContractId: string) {
        return new SacClient({
            contractId: SACContractId,
            networkPassphrase: this.networkPassphrase,
            rpcUrl: this.rpcUrl
        })

        // switch (command) {
        //     case SacCommands.Allowance:
        //         return sac.allowance(args)
        //     case SacCommands.Authorized:
        //         return sac.authorized(args)
        //     case SacCommands.Approve:
        //         return sac.approve(args)
        //     case SacCommands.Balance:
        //         return sac.balance(args)
        //     case SacCommands.Burn:
        //         return sac.burn(args)
        //     case SacCommands.BurnFrom:
        //         return sac.burn_from(args)
        //     case SacCommands.Clawback:
        //         return sac.clawback(args)
        //     case SacCommands.Decimals:
        //         return sac.decimals(args)
        //     case SacCommands.Mint:
        //         return sac.mint(args)
        //     case SacCommands.Name:
        //         return sac.name(args)
        //     case SacCommands.SetAdmin:
        //         return sac.set_admin(args)
        //     case SacCommands.Admin:
        //         return sac.admin(args)
        //     case SacCommands.SetAuthorized:
        //         return sac.set_authorized(args)
        //     case SacCommands.Symbol:
        //         return sac.symbol(args)
        //     case SacCommands.Transfer:
        //         return sac.transfer(args)
        //     case SacCommands.TransferFrom:
        //         return sac.transfer_from(args)
        //     default:
        //         throw new Error('Invalid command')
        // }

        // const { SAC, from, to, amount, fee = 0 } = args
        // const txn = new TransactionBuilder(mockSource, {
        //     fee: fee.toString(),
        //     networkPassphrase: import.meta.env.VITE_networkPassphrase
        // })
        //     .addOperation(Operation.invokeContractFunction({
        //         contract: SAC,
        //         function: 'transfer',
        //         args: [
        //             nativeToScVal(from, { type: 'address' }),
        //             nativeToScVal(to, { type: 'address' }),
        //             nativeToScVal(amount, { type: 'i128' })
        //         ],
        //     }))
        //     .setTimeout(5 * 60)
        //     .build()
    
        // const sim = await rpc.simulateTransaction(txn)
    
        // if (
        //     SorobanRpc.Api.isSimulationError(sim)
        //     || SorobanRpc.Api.isSimulationRestore(sim)
        // ) throw sim
    
        // return {
        //     txn,
        //     sim,
        //     built: SorobanRpc.assembleTransaction(txn, sim).build()
        // }
    }
}