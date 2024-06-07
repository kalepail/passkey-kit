import { Horizon, Keypair, SorobanRpc } from "@stellar/stellar-sdk"
import { Buffer } from "buffer";

export const rpc = new SorobanRpc.Server(import.meta.env.VITE_rpcUrl);
export const horizon = new Horizon.Server(import.meta.env.VITE_horizonUrl)

export const sequenceKeypair = Keypair.fromSecret(import.meta.env.VITE_sequenceSecret);
export const sequencePubkey = sequenceKeypair.publicKey()

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