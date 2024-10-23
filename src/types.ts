export type Signer = {
    kind: string
    key: string 
    val: string 
    expiration: number | null
    storage: "Persistent" | "Temporary"
    limits: string
    evicted?: boolean 
}

export class SignerKey {
    private constructor(public key: "Policy" | "Ed25519" | "Secp256r1", public value: string) { }

    static Policy(policy: string): SignerKey {
        return new SignerKey("Policy", policy);
    }

    static Ed25519(publicKey: string): SignerKey {
        return new SignerKey("Ed25519", publicKey);
    }

    static Secp256r1(id: string): SignerKey {
        return new SignerKey("Secp256r1", id);
    }
}

export type SignerLimits = Map<string, SignerKey[] | undefined>

export enum SignerStore {
    Persistent = 'Persistent',
    Temporary = 'Temporary',
}