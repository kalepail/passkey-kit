/// <reference types="svelte" />
/// <reference types="vite/client" />

/**
 * PUBLIC-ONLY demo configuration.
 *
 * Every value here is safe to ship in the browser bundle. There are deliberately
 * NO secrets: the relayer API key and indexer JWTs live only in the server-side
 * proxy worker (todo 954), which the demo reaches over `VITE_relayerProxyUrl` /
 * `VITE_indexerProxyUrl`. Never add a `VITE_`-prefixed secret here.
 */
interface ImportMetaEnv {
  /** Stellar RPC URL (e.g. https://soroban-testnet.stellar.org). */
  readonly VITE_rpcUrl: string;
  /** Network passphrase (e.g. "Test SDF Network ; September 2015"). */
  readonly VITE_networkPassphrase: string;
  /** Smart-wallet WASM hash (hex), pinned from the deployments manifest. */
  readonly VITE_walletWasmHash: string;
  /** Native XLM Stellar Asset Contract id (C…). */
  readonly VITE_nativeContractId: string;
  /**
   * Optional non-native SAC / SEP-41 token ids to offer in the token picker,
   * comma-separated `label:C…` (or bare `C…`). Exercises non-native SAC support.
   */
  readonly VITE_extraTokenIds?: string;
  /**
   * Optional deployed `sample-policy` contract id (C…) for the policy-signer
   * demo. Deploy an instance of the v1 sample policy and set this; when unset,
   * the policy-signer controls are disabled with a hint.
   */
  readonly VITE_samplePolicyId?: string;
  /**
   * Relayer-proxy worker base URL (submission). The worker holds the relayer
   * key. When unset, submission is disabled with a "pending backend" notice.
   */
  readonly VITE_relayerProxyUrl?: string;
  /**
   * Indexer-proxy base URL (signer discovery). The worker holds the Mercury /
   * Stellar Indexer credentials. When unset, discovery shows "pending backend".
   */
  readonly VITE_indexerProxyUrl?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
