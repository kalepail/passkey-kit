import { Horizon, Keypair, SorobanRpc } from "@stellar/stellar-sdk"

export const rpc = new SorobanRpc.Server(import.meta.env.VITE_rpcUrl);
export const horizon = new Horizon.Server(import.meta.env.VITE_horizonUrl)

// TODO secret should be an env var
// GDHO3UDJ7WTHNQM6PU2HCAKCIGIA24H3MQ4GS6GWAJJJ2AKCUEYYYLXU
export const keypair = Keypair.fromSecret('SB5W64DFQYNXG2AEZUB6DJ5EVF6L4DOJGZQUYWNDZLLUTLLR2N5WCKDP')
export const publickey = keypair.publicKey()