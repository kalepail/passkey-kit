/**
 * Public demo configuration + shared singletons.
 *
 * Everything constructed here is browser-safe. Submission and indexer discovery
 * go through server-side proxy workers (URLs below) so no relayer key or indexer
 * JWT is ever bundled. The old demo inlined the relayer API key + Mercury JWT and
 * a hard-coded Stellar secret seed into the client — all purged.
 */

import { Buffer } from "buffer";
import { Account, Keypair, StrKey } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";
import { PasskeyKit, SACClient } from "passkey-kit";
import { LocalStorageAdapter } from "passkey-kit/storage";
import { RelayerProxyClient } from "./relayer-proxy";
import { IndexerProxyClient } from "./indexer-proxy";

const env = import.meta.env;

/** A SAC/SEP-41 token the demo can transfer/read. */
export interface TokenOption {
  label: string;
  contractId: string;
  native: boolean;
}

function parseTokens(): TokenOption[] {
  const tokens: TokenOption[] = [
    { label: "XLM (native)", contractId: env.VITE_nativeContractId, native: true },
  ];
  const extra = env.VITE_extraTokenIds?.trim();
  if (extra) {
    for (const raw of extra.split(",")) {
      const part = raw.trim();
      if (!part) continue;
      const idx = part.indexOf(":");
      const [label, contractId] =
        idx > 0
          ? [part.slice(0, idx).trim(), part.slice(idx + 1).trim()]
          : [`${part.slice(0, 4)}…${part.slice(-4)}`, part];
      if (contractId) tokens.push({ label, contractId, native: false });
    }
  }
  return tokens;
}

/** Typed, public-only config surface. */
export const config = {
  rpcUrl: env.VITE_rpcUrl,
  networkPassphrase: env.VITE_networkPassphrase,
  walletWasmHash: env.VITE_walletWasmHash,
  nativeContractId: env.VITE_nativeContractId,
  samplePolicyId: env.VITE_samplePolicyId?.trim() || undefined,
  relayerProxyUrl: env.VITE_relayerProxyUrl?.trim() || undefined,
  indexerProxyUrl: env.VITE_indexerProxyUrl?.trim() || undefined,
  tokens: parseTokens(),
};

/** Which network the explorer links point at. */
export const network: "testnet" | "public" = config.networkPassphrase.includes(
  "Test",
)
  ? "testnet"
  : "public";

export const explorerTx = (hash: string): string =>
  `https://stellar.expert/explorer/${network}/tx/${hash}`;
export const explorerContract = (contractId: string): string =>
  `https://stellar.expert/explorer/${network}/contract/${contractId}`;

export const rpc = new Server(config.rpcUrl);

/** Passkey-record storage (adapter, not hand-rolled localStorage). */
export const storage = new LocalStorageAdapter();

/** The browser-side kit. Signs; never submits (that's the relayer proxy). */
export const account = new PasskeyKit({
  rpcUrl: config.rpcUrl,
  networkPassphrase: config.networkPassphrase,
  walletWasmHash: config.walletWasmHash,
  storage,
});

/** SAC factory for token balance reads + transfers. */
export const sac = new SACClient({
  rpcUrl: config.rpcUrl,
  networkPassphrase: config.networkPassphrase,
});

/** Server-side submission (fee-sponsored, keyless — worker mints the key). */
export const relayer = new RelayerProxyClient(config.relayerProxyUrl);

/** Server-side signer discovery (Mercury + Stellar Indexer behind the proxy). */
export const indexer = new IndexerProxyClient(config.indexerProxyUrl);

/**
 * An ephemeral testnet FUNDING source — a deterministic per-hour keypair kept
 * topped up by Friendbot. This is NOT a wallet secret: it holds only throwaway
 * testnet XLM used to seed freshly created wallets. Regenerated every hour.
 */
export const fundKeypair: Promise<Keypair> = (async () => {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const seed = new TextEncoder().encode(now.getTime().toString());
  const hash = await crypto.subtle.digest("SHA-256", seed);
  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(hash));

  rpc
    .getAccount(keypair.publicKey())
    .catch(() => rpc.requestAirdrop(keypair.publicKey()))
    .catch(() => {});

  return keypair;
})();

export async function fundPubkey(): Promise<string> {
  return (await fundKeypair).publicKey();
}

export async function fundSigner() {
  return basicNodeSigner(await fundKeypair, config.networkPassphrase);
}

/** A never-funded placeholder source for read-only simulation. */
export const mockPubkey = StrKey.encodeEd25519PublicKey(Buffer.alloc(32));
export const mockSource = new Account(mockPubkey, "0");
