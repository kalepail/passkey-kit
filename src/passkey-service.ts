import { PasskeyPlugin, type PasskeyCreateResult, type PasskeyAuthResult } from 'capacitor-passkey-plugin';

// WebAuthn-compatible response types (abstraction layer)
export interface AuthenticatorAttestationResponseJSON {
    attestationObject: string;
    clientDataJSON: string;
    authenticatorData?: string;
    transports?: string[];
    publicKeyAlgorithm?: number;
    publicKey?: string;
}

export interface RegistrationResponseJSON {
    id: string;
    rawId: string;
    response: AuthenticatorAttestationResponseJSON;
    authenticatorAttachment?: 'platform' | 'cross-platform';
    clientExtensionResults?: Record<string, any>;
    type: 'public-key';
}

export interface AuthenticationResponseJSON {
    id: string;
    rawId: string;
    response: {
        authenticatorData: string;
        clientDataJSON: string;
        signature: string;
        userHandle?: string;
    };
    authenticatorAttachment?: 'platform' | 'cross-platform';
    clientExtensionResults?: Record<string, any>;
    type: 'public-key';
}

export interface AuthenticatorSelectionCriteria {
    authenticatorAttachment?: 'platform' | 'cross-platform';
    residentKey?: 'required' | 'preferred' | 'discouraged';
    requireResidentKey?: boolean;
    userVerification?: 'required' | 'preferred' | 'discouraged';
}

export interface PasskeyServiceOptions {
    passkeyPlugin?: typeof PasskeyPlugin;
}

export interface CreatePasskeyOptions {
    challenge: string;
    rp: {
        id?: string;
        name: string;
    };
    user: {
        id: string;
        name: string;
        displayName: string;
    };
    authenticatorSelection?: {
        residentKey?: "required" | "preferred" | "discouraged";
        userVerification?: "required" | "preferred" | "discouraged";
        authenticatorAttachment?: "platform" | "cross-platform";
        requireResidentKey?: boolean;
    };
    pubKeyCredParams?: Array<{ alg: number; type: "public-key" }>;
    timeout?: number;
    attestation?: "none" | "indirect" | "direct" | "enterprise";
    excludeCredentials?: Array<{
        id: string;
        type: "public-key";
        transports?: Array<"usb" | "nfc" | "ble" | "internal">;
    }>;
}

export interface AuthenticateOptions {
    challenge: string;
    rpId?: string;
    allowCredentials?: Array<{
        id: string;
        type: "public-key";
        transports?: Array<"usb" | "nfc" | "ble" | "internal">;
    }>;
    userVerification?: "required" | "preferred" | "discouraged";
    timeout?: number;
}

export class PasskeyService {
    private passkeyPlugin: typeof PasskeyPlugin;

    constructor(options?: PasskeyServiceOptions) {
        this.passkeyPlugin = options?.passkeyPlugin || PasskeyPlugin;
    }

    async createPasskey(options: CreatePasskeyOptions): Promise<RegistrationResponseJSON> {
        // Convert options to plugin format
        const pluginOptions = {
            publicKey: {
                challenge: options.challenge,
                rp: options.rp,
                user: options.user,
                pubKeyCredParams: options.pubKeyCredParams || [{ alg: -7, type: "public-key" as const }],
                authenticatorSelection: options.authenticatorSelection,
                timeout: options.timeout,
                attestation: options.attestation,
                excludeCredentials: options.excludeCredentials
            }
        };

        const result: PasskeyCreateResult = await this.passkeyPlugin.createPasskey(pluginOptions);

        // Convert plugin response to WebAuthn-compatible format
        return {
            id: result.id,
            rawId: result.rawId,
            response: {
                attestationObject: result.response.attestationObject,
                clientDataJSON: result.response.clientDataJSON,
                authenticatorData: undefined,
                transports: undefined,
                publicKeyAlgorithm: -7,
                publicKey: undefined
            },
            authenticatorAttachment: 'platform',
            clientExtensionResults: {},
            type: 'public-key'
        };
    }

    async authenticate(options: AuthenticateOptions): Promise<AuthenticationResponseJSON> {
        // Convert options to plugin format
        const pluginOptions = {
            publicKey: {
                challenge: options.challenge,
                rpId: options.rpId,
                allowCredentials: options.allowCredentials,
                userVerification: options.userVerification || 'preferred',
                timeout: options.timeout
            }
        };

        const result: PasskeyAuthResult = await this.passkeyPlugin.authenticate(pluginOptions);

        // Convert plugin response to WebAuthn-compatible format
        return {
            id: result.id,
            rawId: result.rawId,
            response: result.response,
            authenticatorAttachment: 'platform',
            clientExtensionResults: {},
            type: 'public-key'
        };
    }

}