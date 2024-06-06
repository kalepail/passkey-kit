import { xdr, Account, Operation, SorobanRpc, TransactionBuilder, nativeToScVal, scValToNative } from '@stellar/stellar-sdk'
import { rpc, horizon, fundKeypair, fundPubkey, sequencePubkey } from './common'

export async function fund(to: string) {
    const account = await rpc.getAccount(fundPubkey).then((res) => new Account(res.accountId(), res.sequenceNumber()))

    const simTxn = new TransactionBuilder(account, {
        fee: (10_000_000).toString(),
        networkPassphrase: import.meta.env.VITE_networkPassphrase
    })
        .addOperation(Operation.invokeContractFunction({
            contract: import.meta.env.VITE_nativeContractId,
            function: 'transfer',
            args: [
                nativeToScVal(fundPubkey, { type: 'address' }),
                nativeToScVal(to, { type: 'address' }),
                nativeToScVal(100 * 10_000_000, { type: 'i128' })
            ]
        }))
        .setTimeout(0)
        .build()

    const sim = await rpc.simulateTransaction(simTxn)

    if (
        SorobanRpc.Api.isSimulationError(sim)
        || SorobanRpc.Api.isSimulationRestore(sim)
    ) throw sim

    const transaction = SorobanRpc
        .assembleTransaction(simTxn, sim)
        .build()

    transaction.sign(fundKeypair)

    return horizon.submitTransaction(transaction)
}

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

export async function transfer(from: string, to: string, amount: number = 10_000_000) {
    const account = await rpc.getAccount(sequencePubkey).then((res) => new Account(res.accountId(), res.sequenceNumber()))

    const simTxn = new TransactionBuilder(account, {
        fee: '0',
        networkPassphrase: import.meta.env.VITE_networkPassphrase
    })
        .addOperation(Operation.invokeContractFunction({
            contract: import.meta.env.VITE_nativeContractId,
            function: 'transfer',
            args: [
                nativeToScVal(from, { type: 'address' }),
                nativeToScVal(to, { type: 'address' }),
                nativeToScVal(amount, { type: 'i128' })
            ]
        }))
        .setTimeout(0)
        .build()

    const sim = await rpc.simulateTransaction(simTxn)

    if (
        SorobanRpc.Api.isSimulationError(sim)
        || SorobanRpc.Api.isSimulationRestore(sim)
    ) throw sim

    const authTxn = SorobanRpc.assembleTransaction(simTxn, sim).build()

    return authTxn
}