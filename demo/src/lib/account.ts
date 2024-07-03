import { xdr, Operation, SorobanRpc, TransactionBuilder, nativeToScVal, scValToNative } from '@stellar/stellar-sdk'
import { mockSource, rpc } from './common'

export async function getSigners(contractId: string) {
    const res = await fetch(`${import.meta.env.VITE_mercuryUrl}/zephyr/execute`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_mercuryJwt}`
        },
        body: JSON.stringify({
            mode: {
                Function: {
                    fname: "get_signers_by_address",
                    arguments: JSON.stringify({
                        address: contractId
                    })
                }
            }
        })
    })
        .then(async (res) => {
            if (res.ok)
                return res.json()

            throw await res.json()
        })

    return res.map(({ id }: { id: number[] }) => new Uint8Array(id))
}

export async function getAddress(signer: Uint8Array) {
    const res = await fetch(`${import.meta.env.VITE_mercuryUrl}/zephyr/execute`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${import.meta.env.VITE_mercuryJwt}`
        },
        body: JSON.stringify({
            mode: {
                Function: {
                    fname: "get_address_by_signer",
                    arguments: JSON.stringify({
                        id: [...signer]
                    })
                }
            }
        })
    })
        .then(async (res) => {
            if (res.ok)
                return res.json()

            throw await res.json()
        })

    return res[0].address
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