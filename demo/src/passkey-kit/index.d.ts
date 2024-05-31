import { Client as FactoryClient } from './passkey-factory-sdk/src/index.js';
import { Networks, Horizon } from '@stellar/stellar-sdk';
import { Buffer } from 'buffer';
export declare class PasskeyAccount {
    factory: FactoryClient;
    networkPassphrase: Networks;
    horizonUrl: string;
    horizon: Horizon.Server;
    rpcUrl: string;
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
    startRegistration(name: string, user: string): Promise<{
        contractSalt: Buffer;
        publicKey: Buffer | undefined;
        contractId: string;
    }>;
    startAuthentication(authHash: string, id: string): Promise<any>;
    deployWallet(contractSalt: Buffer, publicKey: Buffer, secret: string): Promise<Horizon.HorizonApi.SubmitTransactionResponse>;
    private getPublicKeys;
    private getPublicKeyObject;
    private convertEcdsaSignatureAsnToCompact;
}
