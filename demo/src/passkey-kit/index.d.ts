import { Client as PasskeyClient } from 'passkey-kit-sdk';
import { Client as FactoryClient } from 'passkey-factory-sdk';
import { Networks, Transaction, Horizon, SorobanRpc, Operation } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
export declare class PasskeyAccount {
    id: string | undefined;
    sudo: string | undefined;
    wallet: PasskeyClient | undefined;
    factory: FactoryClient;
    sequencePublicKey: string;
    networkPassphrase: Networks;
    horizonUrl: string;
    horizon: Horizon.Server;
    rpcUrl: string;
    rpc: SorobanRpc.Server;
    feeBumpUrl: string;
    feeBumpJwt: string;
    factoryContractId: string;
    constructor(options: {
        sequencePublicKey: string;
        networkPassphrase: Networks;
        horizonUrl: string;
        rpcUrl: string;
        feeBumpUrl: string;
        feeBumpJwt: string;
        factoryContractId?: string;
    });
    createWallet(name: string, user: string): Promise<{
        passKeyId: Buffer;
        publicKey: Buffer | undefined;
    }>;
    deployWallet(passKeyId: Buffer, publicKey: Buffer, secret: string): Promise<any>;
    connectWallet(): Promise<{
        passKeyId: Buffer;
        publicKey: Buffer | undefined;
        contractId: string;
    }>;
    sign(txn: Transaction, id?: string | 'sudo' | 'all'): Promise<Transaction<import("passkey-kit-sdk").Memo<import("passkey-kit-sdk").MemoType>, Operation[]>>;
    send(txn: Transaction, secret: string): Promise<Horizon.HorizonApi.SubmitTransactionResponse>;
    getWalletData(): Promise<Map<string, any>>;
    private getPublicKeys;
    private getPublicKeyObject;
    private convertEcdsaSignatureAsnToCompact;
}
