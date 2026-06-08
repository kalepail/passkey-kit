// Test an XDR that deploys a contract

import { Networks, Operation, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { AssembledTransaction, type AssembledTransactionOptions, type Tx } from '@stellar/stellar-sdk/contract';
import { Client as PasskeyClient } from 'passkey-kit-sdk';

let xdr_base64 = 'AAAAAgAAAAC4YTsgfBnWL+VK8itDD/gCnqtirv5cWHO3MXxqONNVmgAAAGQAESPAAAAAAQAAAAEAAAAAAAAAAAAAAABnrkStAAAAAAAAAAEAAAAAAAAAGAAAAAMAAAAAAAAAAAAAAAC4YTsgfBnWL+VK8itDD/gCnqtirv5cWHO3MXxqONNVmvsvbA+ypiNL9AWBaQhdhXtpba5tIv74SARYfnqYLTICAAAAAMH9pZirYl7himeZ8T6ddEuJwyaE/xqaJTNnneY4XZSXAAAAAwAAABIAAAABg53yKxwbQoljlymK88aXMGcZomvOAI8tWIoxYZ7dk3UAAAASAAAAAdeSi3LCcDzP6vfrn/TvTVBKVai5efybRQ6iyEK00c5hAAAAAwAAAAYAAAAAAAAAAAAAAAA=';

let wallet = new PasskeyClient({
    contractId: 'CC6XIO7LP5GZL6WEAEM2FH2MKTNZ7CL2JF4TKYYGLALLLTWKF5TNJD7U',
    networkPassphrase: Networks.TESTNET,
    rpcUrl: 'https://soroban-testnet.stellar.org',
})

const built = TransactionBuilder.fromXDR(xdr_base64, Networks.TESTNET);
const operation = built.operations[0] as Operation.InvokeHostFunction;
const op = Operation.invokeHostFunction({
    func: operation.func,
})

const tx = await AssembledTransaction.buildWithOp(op, {
    ...wallet.options,
    simulate: false
} as unknown as AssembledTransactionOptions); // buildWithOp(operation, wallet.options);

console.log(tx);