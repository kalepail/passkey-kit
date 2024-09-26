import { Spec } from "./spec";
import { AssembledTransaction } from "./assembled_transaction";
import type { ClientOptions } from "./types";
/**
 * Generate a class from the contract spec that where each contract method
 * gets included with an identical name.
 *
 * Each method returns an {@link module:contract.AssembledTransaction | AssembledTransaction} that can
 * be used to modify, simulate, decode results, and possibly sign, & submit the
 * transaction.
 *
 * @memberof module:contract
 *
 * @class
 * @param {module:contract.Spec} spec {@link Spec} to construct a Client for
 * @param {ClientOptions} options see {@link ClientOptions}
 */
export declare class Client {
    readonly spec: Spec;
    readonly options: ClientOptions;
    constructor(spec: Spec, options: ClientOptions);
    /**
     * Generates a Client instance from the provided ClientOptions and the contract's wasm hash.
     * The wasmHash can be provided in either hex or base64 format.
     *
     * @param {Buffer | string} wasmHash The hash of the contract's wasm binary, in either hex or base64 format.
     * @param {ClientOptions} options The ClientOptions object containing the necessary configuration, including the rpcUrl.
     * @param {('hex' | 'base64')} [format='hex'] The format of the provided wasmHash, either "hex" or "base64". Defaults to "hex".
     * @returns {Promise<module:contract.Client>} A Promise that resolves to a Client instance.
     * @throws {TypeError} If the provided options object does not contain an rpcUrl.
     */
    static fromWasmHash(wasmHash: Buffer | string, options: ClientOptions, format?: "hex" | "base64"): Promise<Client>;
    /**
     * Generates a Client instance from the provided ClientOptions and the contract's wasm binary.
     *
     * @param {Buffer} wasm The contract's wasm binary as a Buffer.
     * @param {ClientOptions} options The ClientOptions object containing the necessary configuration.
     * @returns {Promise<module:contract.Client>} A Promise that resolves to a Client instance.
     * @throws {Error} If the contract spec cannot be obtained from the provided wasm binary.
     */
    static fromWasm(wasm: Buffer, options: ClientOptions): Promise<Client>;
    /**
     * Generates a Client instance from the provided ClientOptions, which must include the contractId and rpcUrl.
     *
     * @param {ClientOptions} options The ClientOptions object containing the necessary configuration, including the contractId and rpcUrl.
     * @returns {Promise<module:contract.Client>} A Promise that resolves to a Client instance.
     * @throws {TypeError} If the provided options object does not contain both rpcUrl and contractId.
     */
    static from(options: ClientOptions): Promise<Client>;
    txFromJSON: <T>(json: string) => AssembledTransaction<T>;
    txFromXDR: <T>(xdrBase64: string) => AssembledTransaction<T>;
}
