import { PasskeyKit, PasskeyServer, SACClient } from "passkey-kit";
import { Account, Keypair, SorobanRpc, StrKey } from "@stellar/stellar-sdk"
import { Buffer } from "buffer";
import { basicNodeSigner } from "@stellar/stellar-sdk/contract";

export const rpc = new SorobanRpc.Server(import.meta.env.VITE_rpcUrl);

export const mockPubkey = StrKey.encodeEd25519PublicKey(Buffer.alloc(32))
export const mockSource = new Account(mockPubkey, '0')

export const fundKeypair = new Promise<Keypair>(async (resolve) => {
    const now = new Date();

    now.setMinutes(0, 0, 0);

    const nowData = new TextEncoder().encode(now.getTime().toString());
    const hashBuffer = await crypto.subtle.digest('SHA-256', nowData);
    const keypair = Keypair.fromRawEd25519Seed(Buffer.from(hashBuffer))

    rpc
        .requestAirdrop(keypair.publicKey())
        .catch(() => { })

    resolve(keypair)
})
export const fundPubkey = (await fundKeypair).publicKey()
export const fundSigner = basicNodeSigner(await fundKeypair, import.meta.env.VITE_networkPassphrase)

export const account = new PasskeyKit({
    rpcUrl: import.meta.env.VITE_rpcUrl,
    networkPassphrase: import.meta.env.VITE_networkPassphrase,
    factoryContractId: import.meta.env.VITE_factoryContractId,
});
export const server = new PasskeyServer({
    rpcUrl: import.meta.env.VITE_rpcUrl,
    launchtubeUrl: import.meta.env.VITE_launchtubeUrl,
    launchtubeJwt: import.meta.env.VITE_launchtubeJwt,
    mercuryUrl: import.meta.env.VITE_mercuryUrl,
    mercuryJwt: import.meta.env.VITE_mercuryJwt,
});

export const sac = new SACClient({
    rpcUrl: import.meta.env.VITE_rpcUrl,
    networkPassphrase: import.meta.env.VITE_networkPassphrase,
});
export const native = sac.getSACClient(import.meta.env.VITE_nativeContractId)