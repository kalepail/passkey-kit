/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_networkPassphrase: string;
    readonly VITE_nativeContractId: string;
    readonly VITE_rpcUrl: string;
    readonly VITE_horizonUrl: string;
    readonly VITE_fundSecret: string;
    readonly VITE_sequenceSecret: string;
    readonly VITE_feeBumpUrl: string;
    readonly VITE_feeBumpJwt: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}