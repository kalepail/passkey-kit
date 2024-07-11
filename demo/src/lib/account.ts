import { xdr, Operation, SorobanRpc, TransactionBuilder, nativeToScVal, scValToNative } from '@stellar/stellar-sdk'
import { mockSource, rpc } from './common'

export async function getBalance(id: string) {
    const val = xdr.ScVal.scvVec([
        nativeToScVal('Balance', { type: 'symbol' }),
        nativeToScVal(id, { type: 'address' }),
    ])

    return rpc
        .getContractData(import.meta.env.VITE_nativeContractId, val)
        .then(({ val }) => {
            const { amount } = scValToNative(val.contractData().val())
            return (amount as BigInt).toString()
        })
        .catch(() => '0')
}

export async function transferSAC(args: {
    SAC: string,
    from: string,
    to: string,
    amount: number,
    fee?: number
}) {
    const { SAC, from, to, amount, fee = 0 } = args
    const txn = new TransactionBuilder(mockSource, {
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
            ],
        }))
        .setTimeout(5 * 60)
        .build()

    const sim = await rpc.simulateTransaction(txn)

    if (
        SorobanRpc.Api.isSimulationError(sim)
        || SorobanRpc.Api.isSimulationRestore(sim)
    ) throw sim

    return {
        txn,
        sim,
        built: SorobanRpc.assembleTransaction(txn, sim).build()
    }
}