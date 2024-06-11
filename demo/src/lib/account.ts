import { xdr, Account, Operation, SorobanRpc, TransactionBuilder, nativeToScVal, scValToNative } from '@stellar/stellar-sdk'
import { rpc } from './common'

export async function getBalance(id: string) {
    const val = xdr.ScVal.scvVec([
        nativeToScVal('Balance', { type: 'symbol' }),
        nativeToScVal(id, { type: 'address' }),
    ])

    const { amount } = await rpc
        .getContractData(import.meta.env.VITE_nativeContractId, val)
        .then((res) => scValToNative(res.val.contractData().val()))

    return (amount as BigInt).toString()
}

export async function transferSAC(args: {
    SAC: string, 
    source: string, 
    from: string, 
    to: string, 
    amount: number,
    fee?: number
}) {
    const { SAC, source, from, to, amount, fee = 0 } = args
    const account = await rpc.getAccount(source).then((res) => new Account(res.accountId(), res.sequenceNumber()))

    const simTxn = new TransactionBuilder(account, {
        fee: fee.toString(),
        networkPassphrase: import.meta.env.VITE_networkPassphrase
    })
        .addOperation(Operation.invokeContractFunction({
            contract: SAC,
            function: 'transfer',
            args: [
                nativeToScVal(from, { type: 'address' }),
                nativeToScVal(to, { type: 'address' }),
                nativeToScVal(amount, { type: 'i128' })
            ]
        }))
        .setTimeout(5 * 60)
        .build()

    const sim = await rpc.simulateTransaction(simTxn)

    if (
        SorobanRpc.Api.isSimulationError(sim)
        || SorobanRpc.Api.isSimulationRestore(sim)
    ) throw sim

    const authTxn = SorobanRpc.assembleTransaction(simTxn, sim).build()

    return authTxn
}