/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_networkPassphrase: string;
    readonly VITE_nativeContractId: string;
    readonly VITE_rpcUrl: string;
    readonly VITE_launchtubeUrl: string;
    readonly VITE_launchtubeJwt: string;
    readonly VITE_mercuryUrl: string;
    readonly VITE_mercuryJwt: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}