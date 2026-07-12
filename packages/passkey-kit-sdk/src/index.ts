import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}




/**
 * Contract errors.
 * 
 * Deliberately renumbered for the v1 interface so the error space is disjoint
 * from the legacy (pre-1.0) contract's 1-9 range. A client decoding an error
 * code < 100 is talking to a legacy wallet.
 * 
 * Ranges:
 * - 100-109: signer storage / management
 * - 110-119: auth (`__check_auth`)
 * - 120-129: WebAuthn (secp256r1) verification
 */
export const Errors = {
  /**
   * The requested signer does not exist on this smart wallet.
   */
  100: {message:"SignerNotFound"},
  /**
   * `add_signer` was called with a signer key that already exists.
   */
  101: {message:"SignerAlreadyExists"},
  /**
   * The signer's expiration timestamp is in the past.
   */
  102: {message:"SignerExpired"},
  /**
   * No signer in the signatures map is permitted to authorize one of the
   * requested auth contexts.
   */
  110: {message:"MissingContext"},
  /**
   * A signature's variant does not match the stored signer it claims to be
   * for (e.g. an Ed25519 signature submitted for a Policy signer key).
   */
  111: {message:"SignatureKeyValueMismatch"},
  /**
   * clientDataJSON exceeds the 1024 byte parse buffer.
   */
  120: {message:"ClientDataJsonTooLarge"},
  /**
   * clientDataJSON is not parseable JSON (or is missing required fields).
   */
  121: {message:"ClientDataJsonParseError"},
  /**
   * The challenge in clientDataJSON does not match the base64url-encoded
   * signature payload. This binds the WebAuthn assertion to the Soroban
   * authorization entry and MUST NOT be weakened.
   */
  122: {message:"ClientDataJsonChallengeIncorrect"},
  /**
   * clientDataJSON `type` is not "webauthn.get".
   */
  123: {message:"InvalidWebAuthnType"},
  /**
   * authenticatorData is shorter than the WebAuthn minimum of 37 bytes
   * (rpIdHash 32 + flags 1 + signCount 4).
   */
  124: {message:"InvalidAuthenticatorData"},
  /**
   * The authenticator did not set the User Present (UP) flag.
   * 
   * UP-only is the deliberate default (audit FIX-7). Requiring UP keeps
   * silent, non-interactive assertions out while staying compatible with
   * authenticators that cannot do User Verification (UV — biometric/PIN).
   * UV is therefore NOT required by this contract. A deployment that wants
   * UV-required assertions should enforce it at the client/relayer layer,
   * or via a future per-signer flag (which would be a signer-model change,
   * not a change to this check); the contract cannot upgrade UP-only
   * signers to UV-required retroactively without such a flag.
   */
  125: {message:"UserPresenceRequired"}
}

/**
 * Full signer description used by `__constructor`, `add_signer` and
 * `update_signer`.
 */
export type Signer = {tag: "Policy", values: readonly [string, SignerExpiration, SignerLimits, SignerStorage]} | {tag: "Ed25519", values: readonly [Buffer, SignerExpiration, SignerLimits, SignerStorage]} | {tag: "Secp256r1", values: readonly [Buffer, Buffer, SignerExpiration, SignerLimits, SignerStorage]};

/**
 * A signature entry in the signatures map. `Policy` carries no signature
 * material: inclusion of the policy key authorizes an on-chain `policy__`
 * check instead.
 */
export type Signature = {tag: "Policy", values: void} | {tag: "Ed25519", values: readonly [Buffer]} | {tag: "Secp256r1", values: readonly [Secp256r1Signature]};

/**
 * Storage key identifying a signer. Secp256r1 carries the WebAuthn
 * credential id (`keyId`).
 */
export type SignerKey = {tag: "Policy", values: readonly [string]} | {tag: "Ed25519", values: readonly [Buffer]} | {tag: "Secp256r1", values: readonly [Buffer]};

/**
 * Stored signer value. Secp256r1 carries the SEC-1 uncompressed public key.
 */
export type SignerVal = {tag: "Policy", values: readonly [SignerExpiration, SignerLimits]} | {tag: "Ed25519", values: readonly [SignerExpiration, SignerLimits]} | {tag: "Secp256r1", values: readonly [Buffer, SignerExpiration, SignerLimits]};

/**
 * The `__check_auth` signature object: a map of signer keys to signatures.
 * Map ordering is the host's ScVal ordering. EVERY entry must verify (pass
 * 2 of `__check_auth`) — include only signatures that are needed.
 */
export type Signatures = readonly [Map<SignerKey, Signature>];

/**
 * Restrictions on which auth contexts a signer may authorize.
 * 
 * - `None`: unlimited. The signer can authorize anything, including
 * `CreateContract*` (deploy) contexts and this wallet's own admin
 * functions.
 * - `Some(empty map)`: NO permissions (fail-closed). The signer can authorize
 * nothing except removing itself (see below). v1 breaking change: pre-1.0
 * an empty map meant unlimited, leaving two unlimited encodings and no
 * "none" encoding.
 * - `Some({address -> None})`: the signer may authorize any invocation of
 * contract `address`, with no co-signers required.
 * - `Some({address -> Some([keys])})`: the signer may authorize invocations
 * of contract `address` only if every listed key also APPROVES. The listed
 * keys are required CO-SIGNERS.
 * 
 * ## Required co-signers are scope-independent approvers (audit FIX-5)
 * 
 * A required co-signer's OWN `SignerLimits` do NOT constrain its co-signer
 * role — a key's limits govern only its INDEPENDENT authority (whether it can
 * cover a context on its own). This is symmetric across key kinds:
 * 
 * - 
 */
export type SignerLimits = readonly [Option<Map<string, Option<Array<SignerKey>>>>];

/**
 * Which durability a signer entry is stored under. At most one entry exists
 * per signer key; lookups check Temporary before Persistent.
 */
export type SignerStorage = {tag: "Persistent", values: void} | {tag: "Temporary", values: void};

/**
 * Optional expiration for a signer as a UNIX timestamp in seconds, INCLUSIVE:
 * the signer is valid while `ledger timestamp <= expiration` and expired once
 * `ledger timestamp > expiration`. `None` never expires.
 * 
 * v1 breaking change: this was a ledger sequence number pre-1.0. Timestamps
 * don't drift with changes to ledger close time (e.g. CAP-0070 dynamic
 * timing), which ledger-sequence expirations did.
 */
export type SignerExpiration = readonly [Option<u64>];


/**
 * A WebAuthn assertion over the Soroban authorization payload. The signed
 * message is `authenticator_data || sha256(client_data_json)` and the
 * payload binding lives in clientDataJSON's `challenge` field.
 */
export interface Secp256r1Signature {
  authenticator_data: Buffer;
  client_data_json: Buffer;
  signature: Buffer;
}





export interface Client {
  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash}: {new_wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a add_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_signer: ({signer}: {signer: Signer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_signer: ({signer_key}: {signer_key: SignerKey}, options?: MethodOptions) => Promise<AssembledTransaction<Option<SignerVal>>>

  /**
   * Construct and simulate a remove_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_signer: ({signer_key}: {signer_key: SignerKey}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a update_signer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  update_signer: ({signer}: {signer: Signer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {signer}: {signer: Signer},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({signer}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAKYWRkX3NpZ25lcgAAAAAAAQAAAAAAAAAGc2lnbmVyAAAAAAfQAAAABlNpZ25lcgAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAKZ2V0X3NpZ25lcgAAAAAAAQAAAAAAAAAKc2lnbmVyX2tleQAAAAAH0AAAAAlTaWduZXJLZXkAAAAAAAABAAAD6AAAB9AAAAAJU2lnbmVyVmFsAAAA",
        "AAAAAAAAAAAAAAAMX19jaGVja19hdXRoAAAAAwAAAAAAAAARc2lnbmF0dXJlX3BheWxvYWQAAAAAAAPuAAAAIAAAAAAAAAAKc2lnbmF0dXJlcwAAAAAH0AAAAApTaWduYXR1cmVzAAAAAAAAAAAADWF1dGhfY29udGV4dHMAAAAAAAPqAAAH0AAAAAdDb250ZXh0AAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAEAAAAAAAAABnNpZ25lcgAAAAAH0AAAAAZTaWduZXIAAAAAAAA=",
        "AAAAAAAAAAAAAAANcmVtb3ZlX3NpZ25lcgAAAAAAAAEAAAAAAAAACnNpZ25lcl9rZXkAAAAAB9AAAAAJU2lnbmVyS2V5AAAAAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAANdXBkYXRlX3NpZ25lcgAAAAAAAAEAAAAAAAAABnNpZ25lcgAAAAAH0AAAAAZTaWduZXIAAAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAABAAAAVBDb250cmFjdCBlcnJvcnMuCgpEZWxpYmVyYXRlbHkgcmVudW1iZXJlZCBmb3IgdGhlIHYxIGludGVyZmFjZSBzbyB0aGUgZXJyb3Igc3BhY2UgaXMgZGlzam9pbnQKZnJvbSB0aGUgbGVnYWN5IChwcmUtMS4wKSBjb250cmFjdCdzIDEtOSByYW5nZS4gQSBjbGllbnQgZGVjb2RpbmcgYW4gZXJyb3IKY29kZSA8IDEwMCBpcyB0YWxraW5nIHRvIGEgbGVnYWN5IHdhbGxldC4KClJhbmdlczoKLSAxMDAtMTA5OiBzaWduZXIgc3RvcmFnZSAvIG1hbmFnZW1lbnQKLSAxMTAtMTE5OiBhdXRoIChgX19jaGVja19hdXRoYCkKLSAxMjAtMTI5OiBXZWJBdXRobiAoc2VjcDI1NnIxKSB2ZXJpZmljYXRpb24AAAAAAAAABUVycm9yAAAAAAAACwAAADlUaGUgcmVxdWVzdGVkIHNpZ25lciBkb2VzIG5vdCBleGlzdCBvbiB0aGlzIHNtYXJ0IHdhbGxldC4AAAAAAAAOU2lnbmVyTm90Rm91bmQAAAAAAGQAAAA+YGFkZF9zaWduZXJgIHdhcyBjYWxsZWQgd2l0aCBhIHNpZ25lciBrZXkgdGhhdCBhbHJlYWR5IGV4aXN0cy4AAAAAABNTaWduZXJBbHJlYWR5RXhpc3RzAAAAAGUAAAAxVGhlIHNpZ25lcidzIGV4cGlyYXRpb24gdGltZXN0YW1wIGlzIGluIHRoZSBwYXN0LgAAAAAAAA1TaWduZXJFeHBpcmVkAAAAAAAAZgAAAF1ObyBzaWduZXIgaW4gdGhlIHNpZ25hdHVyZXMgbWFwIGlzIHBlcm1pdHRlZCB0byBhdXRob3JpemUgb25lIG9mIHRoZQpyZXF1ZXN0ZWQgYXV0aCBjb250ZXh0cy4AAAAAAAAOTWlzc2luZ0NvbnRleHQAAAAAAG4AAACJQSBzaWduYXR1cmUncyB2YXJpYW50IGRvZXMgbm90IG1hdGNoIHRoZSBzdG9yZWQgc2lnbmVyIGl0IGNsYWltcyB0byBiZQpmb3IgKGUuZy4gYW4gRWQyNTUxOSBzaWduYXR1cmUgc3VibWl0dGVkIGZvciBhIFBvbGljeSBzaWduZXIga2V5KS4AAAAAAAAZU2lnbmF0dXJlS2V5VmFsdWVNaXNtYXRjaAAAAAAAAG8AAAAyY2xpZW50RGF0YUpTT04gZXhjZWVkcyB0aGUgMTAyNCBieXRlIHBhcnNlIGJ1ZmZlci4AAAAAABZDbGllbnREYXRhSnNvblRvb0xhcmdlAAAAAAB4AAAARWNsaWVudERhdGFKU09OIGlzIG5vdCBwYXJzZWFibGUgSlNPTiAob3IgaXMgbWlzc2luZyByZXF1aXJlZCBmaWVsZHMpLgAAAAAAABhDbGllbnREYXRhSnNvblBhcnNlRXJyb3IAAAB5AAAAtlRoZSBjaGFsbGVuZ2UgaW4gY2xpZW50RGF0YUpTT04gZG9lcyBub3QgbWF0Y2ggdGhlIGJhc2U2NHVybC1lbmNvZGVkCnNpZ25hdHVyZSBwYXlsb2FkLiBUaGlzIGJpbmRzIHRoZSBXZWJBdXRobiBhc3NlcnRpb24gdG8gdGhlIFNvcm9iYW4KYXV0aG9yaXphdGlvbiBlbnRyeSBhbmQgTVVTVCBOT1QgYmUgd2Vha2VuZWQuAAAAAAAgQ2xpZW50RGF0YUpzb25DaGFsbGVuZ2VJbmNvcnJlY3QAAAB6AAAALGNsaWVudERhdGFKU09OIGB0eXBlYCBpcyBub3QgIndlYmF1dGhuLmdldCIuAAAAE0ludmFsaWRXZWJBdXRoblR5cGUAAAAAewAAAGlhdXRoZW50aWNhdG9yRGF0YSBpcyBzaG9ydGVyIHRoYW4gdGhlIFdlYkF1dGhuIG1pbmltdW0gb2YgMzcgYnl0ZXMKKHJwSWRIYXNoIDMyICsgZmxhZ3MgMSArIHNpZ25Db3VudCA0KS4AAAAAAAAYSW52YWxpZEF1dGhlbnRpY2F0b3JEYXRhAAAAfAAAAlpUaGUgYXV0aGVudGljYXRvciBkaWQgbm90IHNldCB0aGUgVXNlciBQcmVzZW50IChVUCkgZmxhZy4KClVQLW9ubHkgaXMgdGhlIGRlbGliZXJhdGUgZGVmYXVsdCAoYXVkaXQgRklYLTcpLiBSZXF1aXJpbmcgVVAga2VlcHMKc2lsZW50LCBub24taW50ZXJhY3RpdmUgYXNzZXJ0aW9ucyBvdXQgd2hpbGUgc3RheWluZyBjb21wYXRpYmxlIHdpdGgKYXV0aGVudGljYXRvcnMgdGhhdCBjYW5ub3QgZG8gVXNlciBWZXJpZmljYXRpb24gKFVWIOKAlCBiaW9tZXRyaWMvUElOKS4KVVYgaXMgdGhlcmVmb3JlIE5PVCByZXF1aXJlZCBieSB0aGlzIGNvbnRyYWN0LiBBIGRlcGxveW1lbnQgdGhhdCB3YW50cwpVVi1yZXF1aXJlZCBhc3NlcnRpb25zIHNob3VsZCBlbmZvcmNlIGl0IGF0IHRoZSBjbGllbnQvcmVsYXllciBsYXllciwKb3IgdmlhIGEgZnV0dXJlIHBlci1zaWduZXIgZmxhZyAod2hpY2ggd291bGQgYmUgYSBzaWduZXItbW9kZWwgY2hhbmdlLApub3QgYSBjaGFuZ2UgdG8gdGhpcyBjaGVjayk7IHRoZSBjb250cmFjdCBjYW5ub3QgdXBncmFkZSBVUC1vbmx5CnNpZ25lcnMgdG8gVVYtcmVxdWlyZWQgcmV0cm9hY3RpdmVseSB3aXRob3V0IHN1Y2ggYSBmbGFnLgAAAAAAFFVzZXJQcmVzZW5jZVJlcXVpcmVkAAAAfQ==",
        "AAAAAgAAAFJGdWxsIHNpZ25lciBkZXNjcmlwdGlvbiB1c2VkIGJ5IGBfX2NvbnN0cnVjdG9yYCwgYGFkZF9zaWduZXJgIGFuZApgdXBkYXRlX3NpZ25lcmAuAAAAAAAAAAAABlNpZ25lcgAAAAAAAwAAAAEAAAAAAAAABlBvbGljeQAAAAAABAAAABMAAAfQAAAAEFNpZ25lckV4cGlyYXRpb24AAAfQAAAADFNpZ25lckxpbWl0cwAAB9AAAAANU2lnbmVyU3RvcmFnZQAAAAAAAAEAAAAAAAAAB0VkMjU1MTkAAAAABAAAA+4AAAAgAAAH0AAAABBTaWduZXJFeHBpcmF0aW9uAAAH0AAAAAxTaWduZXJMaW1pdHMAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAAAAAABAAAAAAAAAAlTZWNwMjU2cjEAAAAAAAAFAAAADgAAA+4AAABBAAAH0AAAABBTaWduZXJFeHBpcmF0aW9uAAAH0AAAAAxTaWduZXJMaW1pdHMAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAA=",
        "AAAAAgAAAJ1BIHNpZ25hdHVyZSBlbnRyeSBpbiB0aGUgc2lnbmF0dXJlcyBtYXAuIGBQb2xpY3lgIGNhcnJpZXMgbm8gc2lnbmF0dXJlCm1hdGVyaWFsOiBpbmNsdXNpb24gb2YgdGhlIHBvbGljeSBrZXkgYXV0aG9yaXplcyBhbiBvbi1jaGFpbiBgcG9saWN5X19gCmNoZWNrIGluc3RlYWQuAAAAAAAAAAAAAAlTaWduYXR1cmUAAAAAAAADAAAAAAAAAAAAAAAGUG9saWN5AAAAAAABAAAAAAAAAAdFZDI1NTE5AAAAAAEAAAPuAAAAQAAAAAEAAAAAAAAACVNlY3AyNTZyMQAAAAAAAAEAAAfQAAAAElNlY3AyNTZyMVNpZ25hdHVyZQAA",
        "AAAAAgAAAFlTdG9yYWdlIGtleSBpZGVudGlmeWluZyBhIHNpZ25lci4gU2VjcDI1NnIxIGNhcnJpZXMgdGhlIFdlYkF1dGhuCmNyZWRlbnRpYWwgaWQgKGBrZXlJZGApLgAAAAAAAAAAAAAJU2lnbmVyS2V5AAAAAAAAAwAAAAEAAAAAAAAABlBvbGljeQAAAAAAAQAAABMAAAABAAAAAAAAAAdFZDI1NTE5AAAAAAEAAAPuAAAAIAAAAAEAAAAAAAAACVNlY3AyNTZyMQAAAAAAAAEAAAAO",
        "AAAAAgAAAElTdG9yZWQgc2lnbmVyIHZhbHVlLiBTZWNwMjU2cjEgY2FycmllcyB0aGUgU0VDLTEgdW5jb21wcmVzc2VkIHB1YmxpYyBrZXkuAAAAAAAAAAAAAAlTaWduZXJWYWwAAAAAAAADAAAAAQAAAAAAAAAGUG9saWN5AAAAAAACAAAH0AAAABBTaWduZXJFeHBpcmF0aW9uAAAH0AAAAAxTaWduZXJMaW1pdHMAAAABAAAAAAAAAAdFZDI1NTE5AAAAAAIAAAfQAAAAEFNpZ25lckV4cGlyYXRpb24AAAfQAAAADFNpZ25lckxpbWl0cwAAAAEAAAAAAAAACVNlY3AyNTZyMQAAAAAAAAMAAAPuAAAAQQAAB9AAAAAQU2lnbmVyRXhwaXJhdGlvbgAAB9AAAAAMU2lnbmVyTGltaXRz",
        "AAAAAQAAANNUaGUgYF9fY2hlY2tfYXV0aGAgc2lnbmF0dXJlIG9iamVjdDogYSBtYXAgb2Ygc2lnbmVyIGtleXMgdG8gc2lnbmF0dXJlcy4KTWFwIG9yZGVyaW5nIGlzIHRoZSBob3N0J3MgU2NWYWwgb3JkZXJpbmcuIEVWRVJZIGVudHJ5IG11c3QgdmVyaWZ5IChwYXNzCjIgb2YgYF9fY2hlY2tfYXV0aGApIOKAlCBpbmNsdWRlIG9ubHkgc2lnbmF0dXJlcyB0aGF0IGFyZSBuZWVkZWQuAAAAAAAAAAAKU2lnbmF0dXJlcwAAAAAAAQAAAAAAAAABMAAAAAAAA+wAAAfQAAAACVNpZ25lcktleQAAAAAAB9AAAAAJU2lnbmF0dXJlAAAA",
        "AAAAAQAABABSZXN0cmljdGlvbnMgb24gd2hpY2ggYXV0aCBjb250ZXh0cyBhIHNpZ25lciBtYXkgYXV0aG9yaXplLgoKLSBgTm9uZWA6IHVubGltaXRlZC4gVGhlIHNpZ25lciBjYW4gYXV0aG9yaXplIGFueXRoaW5nLCBpbmNsdWRpbmcKYENyZWF0ZUNvbnRyYWN0KmAgKGRlcGxveSkgY29udGV4dHMgYW5kIHRoaXMgd2FsbGV0J3Mgb3duIGFkbWluCmZ1bmN0aW9ucy4KLSBgU29tZShlbXB0eSBtYXApYDogTk8gcGVybWlzc2lvbnMgKGZhaWwtY2xvc2VkKS4gVGhlIHNpZ25lciBjYW4gYXV0aG9yaXplCm5vdGhpbmcgZXhjZXB0IHJlbW92aW5nIGl0c2VsZiAoc2VlIGJlbG93KS4gdjEgYnJlYWtpbmcgY2hhbmdlOiBwcmUtMS4wCmFuIGVtcHR5IG1hcCBtZWFudCB1bmxpbWl0ZWQsIGxlYXZpbmcgdHdvIHVubGltaXRlZCBlbmNvZGluZ3MgYW5kIG5vCiJub25lIiBlbmNvZGluZy4KLSBgU29tZSh7YWRkcmVzcyAtPiBOb25lfSlgOiB0aGUgc2lnbmVyIG1heSBhdXRob3JpemUgYW55IGludm9jYXRpb24gb2YKY29udHJhY3QgYGFkZHJlc3NgLCB3aXRoIG5vIGNvLXNpZ25lcnMgcmVxdWlyZWQuCi0gYFNvbWUoe2FkZHJlc3MgLT4gU29tZShba2V5c10pfSlgOiB0aGUgc2lnbmVyIG1heSBhdXRob3JpemUgaW52b2NhdGlvbnMKb2YgY29udHJhY3QgYGFkZHJlc3NgIG9ubHkgaWYgZXZlcnkgbGlzdGVkIGtleSBhbHNvIEFQUFJPVkVTLiBUaGUgbGlzdGVkCmtleXMgYXJlIHJlcXVpcmVkIENPLVNJR05FUlMuCgojIyBSZXF1aXJlZCBjby1zaWduZXJzIGFyZSBzY29wZS1pbmRlcGVuZGVudCBhcHByb3ZlcnMgKGF1ZGl0IEZJWC01KQoKQSByZXF1aXJlZCBjby1zaWduZXIncyBPV04gYFNpZ25lckxpbWl0c2AgZG8gTk9UIGNvbnN0cmFpbiBpdHMgY28tc2lnbmVyCnJvbGUg4oCUIGEga2V5J3MgbGltaXRzIGdvdmVybiBvbmx5IGl0cyBJTkRFUEVOREVOVCBhdXRob3JpdHkgKHdoZXRoZXIgaXQgY2FuCmNvdmVyIGEgY29udGV4dCBvbiBpdHMgb3duKS4gVGhpcyBpcyBzeW1tZXRyaWMgYWNyb3NzIGtleSBraW5kczoKCi0gAAAAAAAAAAxTaWduZXJMaW1pdHMAAAABAAAAAAAAAAEwAAAAAAAD6AAAA+wAAAATAAAD6AAAA+oAAAfQAAAACVNpZ25lcktleQAAAA==",
        "AAAAAgAAAIRXaGljaCBkdXJhYmlsaXR5IGEgc2lnbmVyIGVudHJ5IGlzIHN0b3JlZCB1bmRlci4gQXQgbW9zdCBvbmUgZW50cnkgZXhpc3RzCnBlciBzaWduZXIga2V5OyBsb29rdXBzIGNoZWNrIFRlbXBvcmFyeSBiZWZvcmUgUGVyc2lzdGVudC4AAAAAAAAADVNpZ25lclN0b3JhZ2UAAAAAAAACAAAAAAAAAAAAAAAKUGVyc2lzdGVudAAAAAAAAAAAAAAAAAAJVGVtcG9yYXJ5AAAA",
        "AAAAAQAAAY5PcHRpb25hbCBleHBpcmF0aW9uIGZvciBhIHNpZ25lciBhcyBhIFVOSVggdGltZXN0YW1wIGluIHNlY29uZHMsIElOQ0xVU0lWRToKdGhlIHNpZ25lciBpcyB2YWxpZCB3aGlsZSBgbGVkZ2VyIHRpbWVzdGFtcCA8PSBleHBpcmF0aW9uYCBhbmQgZXhwaXJlZCBvbmNlCmBsZWRnZXIgdGltZXN0YW1wID4gZXhwaXJhdGlvbmAuIGBOb25lYCBuZXZlciBleHBpcmVzLgoKdjEgYnJlYWtpbmcgY2hhbmdlOiB0aGlzIHdhcyBhIGxlZGdlciBzZXF1ZW5jZSBudW1iZXIgcHJlLTEuMC4gVGltZXN0YW1wcwpkb24ndCBkcmlmdCB3aXRoIGNoYW5nZXMgdG8gbGVkZ2VyIGNsb3NlIHRpbWUgKGUuZy4gQ0FQLTAwNzAgZHluYW1pYwp0aW1pbmcpLCB3aGljaCBsZWRnZXItc2VxdWVuY2UgZXhwaXJhdGlvbnMgZGlkLgAAAAAAAAAAABBTaWduZXJFeHBpcmF0aW9uAAAAAQAAAAAAAAABMAAAAAAAA+gAAAAG",
        "AAAAAQAAAMhBIFdlYkF1dGhuIGFzc2VydGlvbiBvdmVyIHRoZSBTb3JvYmFuIGF1dGhvcml6YXRpb24gcGF5bG9hZC4gVGhlIHNpZ25lZAptZXNzYWdlIGlzIGBhdXRoZW50aWNhdG9yX2RhdGEgfHwgc2hhMjU2KGNsaWVudF9kYXRhX2pzb24pYCBhbmQgdGhlCnBheWxvYWQgYmluZGluZyBsaXZlcyBpbiBjbGllbnREYXRhSlNPTidzIGBjaGFsbGVuZ2VgIGZpZWxkLgAAAAAAAAASU2VjcDI1NnIxU2lnbmF0dXJlAAAAAAADAAAAAAAAABJhdXRoZW50aWNhdG9yX2RhdGEAAAAAAA4AAAAAAAAAEGNsaWVudF9kYXRhX2pzb24AAAAOAAAAAAAAAAlzaWduYXR1cmUAAAAAAAPuAAAAQA==",
        "AAAABQAAASBUaGUgY29udHJhY3QncyB3YXNtIHdhcyByZXBsYWNlZCB2aWEgYHVwZ3JhZGVgLiBgb2xkX2hhc2hgIGlzIGBOb25lYCBvbiBhCndhbGxldCdzIGZpcnN0LWV2ZXIgdXBncmFkZTogdGhlIGhvc3QgZXhwb3NlcyBubyB3YXkgZm9yIGEgY29udHJhY3QgdG8KcmVhZCBpdHMgb3duIGV4ZWN1dGFibGUgaGFzaCwgc28gdGhlIHdhbGxldCBjYWNoZXMgdGhlIGhhc2ggaW4gaW5zdGFuY2UKc3RvcmFnZSBhdCBlYWNoIHVwZ3JhZGUgYW5kIHRoZSBnZW5lc2lzIGhhc2ggaXMgdW5rbm93YWJsZSBpbi1jb250cmFjdC4AAAAAAAAACFVwZ3JhZGVkAAAAAQAAAAh1cGdyYWRlZAAAAAIAAAAAAAAACG9sZF9oYXNoAAAD6AAAA+4AAAAgAAAAAAAAAAAAAAAIbmV3X2hhc2gAAAPuAAAAIAAAAAAAAAAC",
        "AAAABQAAADlBIHNpZ25lciB3YXMgYWRkZWQgKHZpYSBgX19jb25zdHJ1Y3RvcmAgb3IgYGFkZF9zaWduZXJgKS4AAAAAAAAAAAAAC1NpZ25lckFkZGVkAAAAAAEAAAAMc2lnbmVyX2FkZGVkAAAAAwAAAAAAAAADa2V5AAAAB9AAAAAJU2lnbmVyS2V5AAAAAAAAAQAAAAAAAAADdmFsAAAAB9AAAAAJU2lnbmVyVmFsAAAAAAAAAAAAAAAAAAAHc3RvcmFnZQAAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAAAAAAAAAAAAg==",
        "AAAABQAAAGFBIHNpZ25lciB3YXMgcmVtb3ZlZCB2aWEgYHJlbW92ZV9zaWduZXJgLiBgc3RvcmFnZWAgaXMgdGhlIGR1cmFiaWxpdHkgdGhlCmVudHJ5IHdhcyByZW1vdmVkIGZyb20uAAAAAAAAAAAAAA1TaWduZXJSZW1vdmVkAAAAAAAAAQAAAA5zaWduZXJfcmVtb3ZlZAAAAAAAAgAAAAAAAAADa2V5AAAAB9AAAAAJU2lnbmVyS2V5AAAAAAAAAQAAAAAAAAAHc3RvcmFnZQAAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAAAAAAAAAAAAg==",
        "AAAABQAAADRBbiBleGlzdGluZyBzaWduZXIgd2FzIG1vZGlmaWVkIHZpYSBgdXBkYXRlX3NpZ25lcmAuAAAAAAAAAA1TaWduZXJVcGRhdGVkAAAAAAAAAQAAAA5zaWduZXJfdXBkYXRlZAAAAAAABAAAAAAAAAADa2V5AAAAB9AAAAAJU2lnbmVyS2V5AAAAAAAAAQAAAAAAAAADdmFsAAAAB9AAAAAJU2lnbmVyVmFsAAAAAAAAAAAAAAAAAAAHc3RvcmFnZQAAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAAAAAAAAAAAAAAAAAtvbGRfc3RvcmFnZQAAAAfQAAAADVNpZ25lclN0b3JhZ2UAAAAAAAAAAAAAAg==" ]),
      options
    )
  }
  public readonly fromJSON = {
    upgrade: this.txFromJSON<Result<void>>,
        add_signer: this.txFromJSON<Result<void>>,
        get_signer: this.txFromJSON<Option<SignerVal>>,
        remove_signer: this.txFromJSON<Result<void>>,
        update_signer: this.txFromJSON<Result<void>>
  }
}