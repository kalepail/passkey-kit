import { xdr, Operation, SorobanRpc, TransactionBuilder, nativeToScVal, scValToNative } from '@stellar/stellar-sdk'
import { mockSource, rpc } from './common'

export async function getBalance(id: string) { // TODO USE `NATIVE` FOR THIS
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