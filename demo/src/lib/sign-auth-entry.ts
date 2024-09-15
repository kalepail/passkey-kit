import { hash, Keypair, Networks, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

export async function signAuthEntry(
    entry: xdr.SorobanAuthorizationEntry,
    signer: Keypair,
    validUntilLedgerSeq: number,
    networkPassphrase: string = Networks.TESTNET
) {
    const clone = xdr.SorobanAuthorizationEntry.fromXDR(entry.toXDR());
    const credentials = clone.credentials().address();
    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
        new xdr.HashIdPreimageSorobanAuthorization({
            networkId: hash(Buffer.from(networkPassphrase)),
            nonce: credentials.nonce(),
            signatureExpirationLedger: validUntilLedgerSeq,
            invocation: clone.rootInvocation()
        })
    )
    const payload = hash(preimage.toXDR())
    const signature = signer.sign(payload);
    const sig = xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Ed25519'),
                xdr.ScVal.scvBytes(signer.rawPublicKey())
            ]),
            val: xdr.ScVal.scvVec([
                xdr.ScVal.scvSymbol('Ed25519'),
                xdr.ScVal.scvBytes(signature) 
            ])
        })
    ])

    credentials.signatureExpirationLedger(validUntilLedgerSeq)
    credentials.signature(sig)

    return clone
}