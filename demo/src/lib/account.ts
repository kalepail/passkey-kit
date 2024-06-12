import { xdr, Account, Operation, SorobanRpc, TransactionBuilder, nativeToScVal, scValToNative, Keypair } from '@stellar/stellar-sdk'
import { rpc } from './common'
import { Buffer } from 'buffer'

export const mockKeypair = Keypair.fromRawEd25519Seed(Buffer.alloc(32)) // NOTE this isn't the actual zero address
export const mockPubkey = mockKeypair.publicKey()
export const mockSource = new Account(mockPubkey, '0')

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