/**
 * Local signer model + `SignerLimits` construction.
 *
 * The demo keeps its own optimistic registry of the signers it has added, so the
 * core flows work without a round-trip; the Discovery panel then cross-checks the
 * registry against Mercury's hosted indexer. A signer's `limits` are what
 * define "admin" vs "session": an UNLIMITED signer (`SignerLimits` = None) can
 * authorize anything (admin); a restricted or empty map is a scoped session key.
 */

import { SignerKey, SignerStore, type SignerKeyTag, type SignerLimits } from "passkey-kit";

export type SignerKind = SignerKeyTag;

/** Limits presets exposed by the builder. */
export type LimitsMode = "unlimited" | "none" | "restricted";

/** One restricted-limits row: which signer keys this signer may co-authorize on a contract. */
export interface LimitsEntry {
  contract: string;
  keys: { kind: SignerKind; value: string }[];
}

/** UI model for building a `SignerLimits`. */
export interface LimitsSpec {
  mode: LimitsMode;
  entries: LimitsEntry[];
}

export const UNLIMITED: LimitsSpec = { mode: "unlimited", entries: [] };

/** A signer the demo knows about (optimistic registry). */
export interface LocalSigner {
  kind: SignerKind;
  /** keyId (base64url) for Secp256r1, G-address for Ed25519, C-address for Policy. */
  value: string;
  store: SignerStore;
  limitsMode: LimitsMode;
  expiration?: number;
  label?: string;
  /** True when this is the connected passkey. */
  self?: boolean;
  /** 65-byte secp256r1 public key (base64url), needed to `update_signer`. */
  publicKey?: string;
}

/** Whether a signer is an unlimited "admin" signer. */
export function isAdmin(signer: { limitsMode: LimitsMode }): boolean {
  return signer.limitsMode === "unlimited";
}

/** Build the SDK {@link SignerKey} for a local signer (for remove/lookup). */
export function toSignerKey(signer: { kind: SignerKind; value: string }): SignerKey {
  switch (signer.kind) {
    case "Secp256r1":
      return SignerKey.Secp256r1(signer.value);
    case "Ed25519":
      return SignerKey.Ed25519(signer.value);
    case "Policy":
      return SignerKey.Policy(signer.value);
  }
}

/** Translate a UI {@link LimitsSpec} into the SDK's {@link SignerLimits}. */
export function buildSignerLimits(spec: LimitsSpec): SignerLimits {
  if (spec.mode === "unlimited") return undefined;

  const map = new Map<string, SignerKey[] | undefined>();
  if (spec.mode === "none") return map; // empty map = fail-closed (no permissions)

  for (const entry of spec.entries) {
    if (!entry.contract) continue;
    map.set(
      entry.contract,
      entry.keys.length ? entry.keys.map(toSignerKey) : undefined,
    );
  }
  return map;
}

/** Human summary of a limits spec for badges/log. */
export function describeLimits(spec: LimitsSpec): string {
  switch (spec.mode) {
    case "unlimited":
      return "unlimited (admin)";
    case "none":
      return "no permissions (fail-closed)";
    case "restricted":
      return `restricted · ${spec.entries.length} contract${spec.entries.length === 1 ? "" : "s"}`;
  }
}

/** Absolute UNIX-second expiration `days` from now (contract stores timestamps). */
export function expirationInDays(days: number): number {
  return Math.floor(Date.now() / 1000) + Math.round(days * 86_400);
}
