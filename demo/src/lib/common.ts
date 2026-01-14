import { PasskeyKit, PasskeyServer, SACClient } from "passkey-kit";
import { Account, Keypair, StrKey } from "@stellar/stellar-sdk/minimal"
import { Buffer } from "buffer";
import { basicNodeSigner } from "@stellar/stellar-sdk/minimal/contract";
import { Server } from "@stellar/stellar-sdk/minimal/rpc";

export const rpc = new Server(import.meta.env.VITE_rpcUrl);

export const mockPubkey = StrKey.encodeEd25519PublicKey(Buffer.alloc(32))
export const mockSource = new Account(mockPubkey, '0')

export const fundKeypair = new Promise<Keypair>(async (resolve) => {
    const now = new Date();

    now.setMinutes(0, 0, 0);

    const nowData = new TextEncoder().encode(now.getTime().toString());
    const hashBuffer = await crypto.subtle.digest('SHA-256', nowData);
    const keypair = Keypair.fromRawEd25519Seed(Buffer.from(hashBuffer))
    const publicKey = keypair.publicKey()

    rpc.getAccount(publicKey)
        .catch(() => rpc.requestAirdrop(publicKey))
        .catch(() => { })

    resolve(keypair)
})
export const fundPubkey = (await fundKeypair).publicKey()
export const fundSigner = basicNodeSigner(await fundKeypair, import.meta.env.VITE_networkPassphrase)

export const account = new PasskeyKit({
    rpcUrl: import.meta.env.VITE_rpcUrl,
    networkPassphrase: import.meta.env.VITE_networkPassphrase,
    walletWasmHash: import.meta.env.VITE_walletWasmHash,
});
export const server = new PasskeyServer({
    rpcUrl: import.meta.env.VITE_rpcUrl,
    relayerUrl: import.meta.env.VITE_relayerUrl,
    relayerApiKey: import.meta.env.VITE_relayerApiKey,
    mercuryProjectName: import.meta.env.VITE_mercuryProjectName,
    mercuryUrl: import.meta.env.VITE_mercuryUrl,
    mercuryJwt: import.meta.env.VITE_mercuryJwt,
});

export const sac = new SACClient({
    rpcUrl: import.meta.env.VITE_rpcUrl,
    networkPassphrase: import.meta.env.VITE_networkPassphrase,
});
export const native = sac.getSACClient(import.meta.env.VITE_nativeContractId)