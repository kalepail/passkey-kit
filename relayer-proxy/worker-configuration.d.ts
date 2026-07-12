/// <reference types="@cloudflare/workers-types" />

// Worker bindings. Regenerate the full Cloudflare runtime typings with
// `wrangler types` if you need them; this hand-written subset is all the worker
// code references.
interface Env {
  /** Per-IP Relayer API key cache. */
  API_KEYS: KVNamespace;
  /** Which network this instance serves. */
  NETWORK: "testnet" | "mainnet";
  /** OpenZeppelin Relayer Channels base URL for this network. */
  RELAYER_BASE_URL: string;
}
