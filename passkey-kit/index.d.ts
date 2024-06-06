import { Client as PasskeyClient } from 'passkey-kit-sdk';
import { Client as FactoryClient } from 'passkey-factory-sdk';
import { Networks, Transaction, Horizon, SorobanRpc } from '@stellar/stellar-sdk';
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
        contractId: string;
        xdr: string;
    }>;
    createKey(name: string, user: string): Promise<{
        passKeyId: Buffer;
        publicKey: Buffer | undefined;
    }>;
    connectWallet(): Promise<{
        passKeyId: Buffer;
        publicKey: Buffer | undefined;
        contractId: string;
    }>;
    sign(txn: Transaction | string, options?: {
        id?: 'any' | 'sudo' | string | Uint8Array;
        ttl?: number;
    }): Promise<string>;
    send(txn: Transaction, fee?: number): Promise<Horizon.HorizonApi.SubmitTransactionResponse>;
    getData(): Promise<Map<string, any>>;
    private getKey;
    private getPublicKeyObject;
    private convertEcdsaSignatureAsnToCompact;
}
