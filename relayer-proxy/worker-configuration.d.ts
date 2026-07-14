/// <reference types="@cloudflare/workers-types" />

// Worker bindings. Regenerate the full Cloudflare runtime typings with
// `wrangler types` if you need them; this hand-written subset is all the worker
// code references.
interface Env {
  /** Per-IP Relayer API key custody (serialized get-or-create). */
  API_KEY_DO: DurableObjectNamespace;
  /** Global and per-IP fixed-window request limiter. */
  RATE_LIMIT_DO: DurableObjectNamespace;
  /** Which network this instance serves. */
  NETWORK: "testnet" | "mainnet";
  /** OpenZeppelin Relayer Channels base URL for this network. */
  RELAYER_BASE_URL: string;
  /** Stellar RPC used to verify wallet WASM and simulate func/auth fees. */
  STELLAR_RPC_URL: string;
  /** CSV browser origins allowed to call the Worker. Empty is fail-closed. */
  ALLOWED_ORIGINS?: string;
  /** CSV explicit wallet contract IDs (optional shortcut around RPC lookup). */
  ALLOWED_WALLET_CONTRACT_IDS?: string;
  /** CSV passkey-kit wallet WASM hashes allowed for invokes and deploys. */
  ALLOWED_WALLET_WASM_HASHES?: string;
  /** CSV smart-wallet method names allowed for direct invocation. */
  ALLOWED_WALLET_FUNCTIONS?: string;
  /** CSV deployer G-addresses allowed as tx source and contract preimage. */
  ALLOWED_DEPLOYER_ADDRESSES?: string;
  /** Maximum Soroban resource fee in stroops. */
  MAX_RESOURCE_FEE_STROOPS?: string;
  /** Fixed-window duration for both request limits. */
  RATE_LIMIT_WINDOW_SECONDS?: string;
  /** Maximum submissions per IP per fixed window. */
  RATE_LIMIT_PER_IP?: string;
  /** Maximum submissions globally per fixed window. */
  RATE_LIMIT_GLOBAL?: string;
  /** Testnet retry backoff base delay in milliseconds. */
  TESTNET_RETRY_BASE_DELAY_MS?: string;
  /** Testnet retry backoff maximum delay in milliseconds. */
  TESTNET_RETRY_MAX_DELAY_MS?: string;
}
