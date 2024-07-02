import { xdr, Account, Operation, SorobanRpc, TransactionBuilder, nativeToScVal, scValToNative, StrKey } from '@stellar/stellar-sdk'
import { rpc } from './common'
import { Buffer } from 'buffer'

export const mockPubkey = StrKey.encodeEd25519PublicKey(Buffer.alloc(32))
export const mockSource = new Account(mockPubkey, '0')

export async function getEvents(contractId: string) {
    const query = `
        query {
            eventByContractId(
                searchedContractId: "${contractId}"
            ) {
                nodes {
                    topic1
                    topic2
                    data
                }
            }
        }
    `;

    const { data } = await fetch(import.meta.env.VITE_mercuryUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_mercuryJwt}`
        },
        body: JSON.stringify({ query })
    })
    .then(async (res) => {
        if (res.ok)
            return res.json()
        
        throw await res.json()
    })

    const nodes: {topic1: string, topic2: string, data: string}[] = data.eventByContractId.nodes

    return nodes.map((node) => {
        return {
            topic1: scValToNative(xdr.ScVal.fromXDR(node.topic1, 'base64')),
            topic2: scValToNative(xdr.ScVal.fromXDR(node.topic2, 'base64')),
            data: scValToNative(xdr.ScVal.fromXDR(node.data, 'base64'))
        }
    })
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