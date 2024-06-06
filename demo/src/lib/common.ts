import { Horizon, Keypair, SorobanRpc } from "@stellar/stellar-sdk"

export const rpc = new SorobanRpc.Server(import.meta.env.VITE_rpcUrl);
export const horizon = new Horizon.Server(import.meta.env.VITE_horizonUrl)

export const sequenceKeypair = Keypair.fromSecret(import.meta.env.VITE_sequenceSecret);
export const sequencePubkey = sequenceKeypair.publicKey()

export const fundKeypair = Keypair.fromSecret(import.meta.env.VITE_fundSecret)
export const fundPubkey = fundKeypair.publicKey()