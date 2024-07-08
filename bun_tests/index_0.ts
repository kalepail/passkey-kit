import { Account, nativeToScVal, Operation, SorobanRpc, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';

const networkPassphrase = 'Test SDF Network ; September 2015'
const rpcUrl = 'https://soroban-testnet.stellar.org'
const rpc = new SorobanRpc.Server(rpcUrl)

const mockPubkey = StrKey.encodeEd25519PublicKey(Buffer.alloc(32))
const mockSource = new Account(mockPubkey, '0')

const id = Buffer.from([125,176,117,115,57,12,172,162,174,94,93,239,223,251,112,31,79,213,168,149])
const pk = Buffer.from([4,145,97,10,184,102,167,68,139,113,167,62,97,52,78,114,175,146,41,171,173,84,128,243,131,159,105,166,51,123,134,42,245,34,106,52,208,45,27,210,224,216,175,242,131,119,135,110,65,212,130,170,215,213,20,100,121,31,108,140,154,13,115,198,184])

const transaction = new TransactionBuilder(mockSource, {
    fee: '0',
    networkPassphrase,
})
.addOperation(Operation.invokeContractFunction({
    contract: 'CCU4ZFRZXJO4YWOUJDO7PWCYN6YFTMBDYFJFQ6R7SEOLFU5PNJNZA46W',
    function: 'deploy',
    args: [
        nativeToScVal(id),
        nativeToScVal(pk),
    ]
}))
.setTimeout(0)
.build()

console.log(transaction.toXDR());

const sim = await rpc._simulateTransaction(transaction)

console.log(sim);

// if (!SorobanRpc.Api.isSimulationSuccess(sim)) {
//     throw sim
// }

// console.log(sim);
