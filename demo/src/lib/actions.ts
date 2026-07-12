/**
 * Application flows: every user action that touches the SDK lives here, so
 * components stay thin (markup + an `onclick` that calls an action). Each flow
 * mutates the reactive {@link app} store and surfaces typed errors + real
 * tx hashes through the activity log.
 */

import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";
import base64url from "base64url";
import {
  Ed25519Signer,
  PasskeySigner,
  PolicySigner,
  SignerStore,
  type Signer,
  type TransactionResult,
} from "passkey-kit";
import {
  account,
  config,
  fundKeypair,
  fundSigner,
  indexer,
  sac,
  storage,
} from "./config";
import { submit } from "./submit";
import { app, isConnected, pushLog } from "./state.svelte";
import { describeError } from "./format";
import type { IndexerBackend } from "./indexer-proxy";
import {
  buildSignerLimits,
  describeLimits,
  toSignerKey,
  UNLIMITED,
  type LimitsSpec,
  type LocalSigner,
  type SignerKind,
} from "./signers";

/** The AssembledTransaction the kit's add/update/remove builders return. */
type WalletWriteTx = Awaited<ReturnType<typeof account.addSecp256r1>>;

// -- Small internals ----------------------------------------------------------

/** Run a flow with busy state + typed error surfacing. Returns undefined on error. */
async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (app.busy) {
    pushLog("error", `Busy — "${app.busy}" is still running`);
    return undefined;
  }
  app.busy = label;
  try {
    return await fn();
  } catch (err) {
    const d = describeError(err);
    pushLog("error", `${label} failed: ${d.message}`, { detail: errorDetail(d) });
    return undefined;
  } finally {
    app.busy = null;
  }
}

function errorDetail(d: ReturnType<typeof describeError>): string {
  const parts = [d.name];
  if (d.code !== undefined) parts.push(`[${d.code}]`);
  if (d.contract) parts.push(`· ${d.contract}`);
  return parts.join(" ");
}

/** Log a submission {@link TransactionResult}. Returns success. */
function reportResult(label: string, res: TransactionResult): boolean {
  if (res.success) {
    pushLog("success", `${label} ✓`, {
      hash: res.hash,
      detail: res.ledger ? `ledger ${res.ledger}` : undefined,
    });
    return true;
  }
  const d = describeError(res.error);
  pushLog("error", `${label} failed: ${d.message}`, {
    hash: res.hash,
    detail: errorDetail(d),
  });
  return false;
}

/** The Signer object used to authorize wallet writes (the active admin passkey). */
function adminSigner(): Signer {
  return new PasskeySigner(app.activeKeyId ?? app.keyId);
}

function upsertSigner(signer: LocalSigner): void {
  const i = app.signers.findIndex(
    (s) => s.kind === signer.kind && s.value === signer.value,
  );
  if (i >= 0) app.signers[i] = signer;
  else app.signers.push(signer);
}

function removeFromRegistry(kind: SignerKind, value: string): void {
  app.signers = app.signers.filter((s) => !(s.kind === kind && s.value === value));
}

function localToken(): ReturnType<typeof sac.getSACClient> {
  return sac.getSACClient(app.selectedToken || config.nativeContractId);
}

// -- Boot ---------------------------------------------------------------------

/** Refresh the list of passkeys held by the storage adapter. */
export async function refreshKnown(): Promise<void> {
  app.knownPasskeys = await storage.getAll().catch(() => []);
}

/** On load, offer the most recently-used stored passkey for a one-tap reconnect. */
export async function boot(): Promise<void> {
  app.selectedToken = config.nativeContractId;
  try {
    const known = await storage.getAll();
    app.knownPasskeys = known;
    if (known.length) {
      const latest = [...known].sort(
        (a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt),
      )[0]!;
      pushLog("info", `Found stored passkey ${latest.keyId.slice(0, 10)}… — reconnecting`);
      await connect(latest.keyId);
    }
  } catch (err) {
    pushLog("info", `No stored passkey (${describeError(err).message})`);
  } finally {
    app.ready = true;
  }
}

// -- Wallet lifecycle ---------------------------------------------------------

export async function register(name: string): Promise<void> {
  await run("Create wallet", async () => {
    const { keyIdBase64, contractId, signedTx, keyId } = await account.createWallet(
      "Passkey Kit Demo",
      name,
    );
    const ok = reportResult("Deploy wallet", await submit(signedTx));
    if (!ok) throw new Error("Wallet deploy was not accepted by the relayer");

    setConnected(keyIdBase64, contractId);
    // The constructor signer is unlimited (admin).
    const passkey = await storage.get(keyIdBase64);
    upsertSigner({
      kind: "Secp256r1",
      value: keyIdBase64,
      store: SignerStore.Persistent,
      limitsMode: "unlimited",
      self: true,
      label: name,
      publicKey: passkey ? base64url(Buffer.from(passkey.publicKey)) : undefined,
    });
    pushLog("success", `Wallet created`, { detail: `keyId ${keyIdBase64.slice(0, 10)}… · ${bytesLabel(keyId)}` });
    await refreshKnown();

    await refreshBalance();
    // Auto-fund the fresh wallet. Call the UNWRAPPED helper: `app.busy` is
    // already set by this `run("Create wallet")` block, so `fundWallet` (which
    // wraps in its own `run`) would hit the busy-guard and silently no-op. A
    // fund failure must not fail wallet creation (the wallet is already live).
    try {
      await fundWalletInner(100);
    } catch (err) {
      pushLog("error", `Auto-fund failed: ${describeError(err).message}`);
    }
  });
}

export async function connect(keyId?: string): Promise<void> {
  await run("Connect wallet", async () => {
    app.status = "connecting";
    const { keyIdBase64, contractId } = await account.connectWallet({
      keyId,
      getContractId: (kid) =>
        indexer
          .findWallets({ kind: "Secp256r1", value: kid }, app.discoverBackend)
          .then((ids) => ids[0])
          .catch(() => undefined),
    });

    setConnected(keyIdBase64, contractId);
    await storage.update(keyIdBase64, { lastUsedAt: Date.now() }).catch(() => {});
    const passkey = await storage.get(keyIdBase64);
    upsertSigner({
      kind: "Secp256r1",
      value: keyIdBase64,
      store: SignerStore.Persistent,
      limitsMode: "unlimited",
      self: true,
      label: passkey?.nickname ?? "This passkey",
      publicKey: passkey ? base64url(Buffer.from(passkey.publicKey)) : undefined,
    });
    pushLog("success", `Connected — ownership verified`, {
      detail: `wallet ${contractId.slice(0, 8)}…`,
    });
    await refreshKnown();
    await refreshBalance();
  });
}

function setConnected(keyId: string, contractId: string): void {
  app.keyId = keyId;
  app.activeKeyId = keyId;
  app.contractId = contractId;
  app.status = "connected";
}

export function disconnect(): void {
  account.disconnect();
  app.status = "disconnected";
  app.keyId = undefined;
  app.contractId = undefined;
  app.activeKeyId = undefined;
  app.signers = [];
  app.balances = {};
  app.discovered = [];
  pushLog("info", "Disconnected");
}

export async function forgetAll(): Promise<void> {
  await run("Forget stored passkeys", async () => {
    await storage.clear();
    disconnect();
    app.knownPasskeys = [];
    pushLog("info", "Cleared passkey storage");
  });
}

// -- Signer management --------------------------------------------------------

export interface AddSignerInput {
  store: SignerStore;
  limits: LimitsSpec;
  expiration?: number;
}

export async function addPasskeySigner(name: string, input: AddSignerInput): Promise<void> {
  if (!requireConnected()) return;
  await run("Add passkey signer", async () => {
    const created = await account.createKey("Passkey Kit Demo", name);
    const limits = buildSignerLimits(input.limits);
    const at = await account.addSecp256r1(
      created.keyId,
      created.publicKey,
      limits,
      input.store,
      input.expiration,
    );
    if (!(await signAndSubmit("Add passkey signer", at))) return;

    // Persist so it is reconnectable + has a retrievable public key.
    await storage
      .save({
        keyId: created.keyId,
        publicKey: created.publicKey,
        contractId: app.contractId!,
        nickname: name,
        createdAt: Date.now(),
      })
      .catch(() => {});
    upsertSigner({
      kind: "Secp256r1",
      value: created.keyId,
      store: input.store,
      limitsMode: input.limits.mode,
      expiration: input.expiration,
      label: name,
      publicKey: base64url(Buffer.from(created.publicKey)),
    });
    await refreshKnown();
    pushLog("info", `Passkey signer added · ${describeLimits(input.limits)}`);
  });
}

export async function addEd25519Signer(input: AddSignerInput): Promise<void> {
  if (!requireConnected()) return;
  const pub = ensureEd25519().publicKey();
  await run("Add Ed25519 signer", async () => {
    const at = await account.addEd25519(
      pub,
      buildSignerLimits(input.limits),
      input.store,
      input.expiration,
    );
    if (!(await signAndSubmit("Add Ed25519 signer", at))) return;
    upsertSigner({
      kind: "Ed25519",
      value: pub,
      store: input.store,
      limitsMode: input.limits.mode,
      expiration: input.expiration,
      label: "Ed25519 key",
    });
    pushLog("info", `Ed25519 signer added · ${describeLimits(input.limits)}`);
  });
}

export async function addPolicySigner(input: AddSignerInput): Promise<void> {
  if (!requireConnected()) return;
  if (!config.samplePolicyId) {
    pushLog("error", "No sample policy configured (set VITE_samplePolicyId)");
    return;
  }
  const policy = config.samplePolicyId;
  await run("Add policy signer", async () => {
    const at = await account.addPolicy(
      policy,
      buildSignerLimits(input.limits),
      input.store,
      input.expiration,
    );
    if (!(await signAndSubmit("Add policy signer", at))) return;
    upsertSigner({
      kind: "Policy",
      value: policy,
      store: input.store,
      limitsMode: input.limits.mode,
      expiration: input.expiration,
      label: "Policy",
    });
    pushLog("info", `Policy signer added · ${describeLimits(input.limits)}`);
  });
}

export async function updateSigner(
  signer: LocalSigner,
  input: AddSignerInput,
): Promise<void> {
  if (!requireConnected()) return;
  await run(`Update ${signer.kind} signer`, async () => {
    const limits = buildSignerLimits(input.limits);
    let at: WalletWriteTx;
    switch (signer.kind) {
      case "Secp256r1": {
        const publicKey = await resolvePublicKey(signer);
        if (!publicKey) throw new Error("Missing public key for this passkey (cannot update)");
        at = await account.updateSecp256r1(signer.value, publicKey, limits, input.store, input.expiration);
        break;
      }
      case "Ed25519":
        at = await account.updateEd25519(signer.value, limits, input.store, input.expiration);
        break;
      case "Policy":
        at = await account.updatePolicy(signer.value, limits, input.store, input.expiration);
        break;
    }
    if (!(await signAndSubmit(`Update ${signer.kind} signer`, at))) return;
    upsertSigner({
      ...signer,
      store: input.store,
      limitsMode: input.limits.mode,
      expiration: input.expiration,
    });
    pushLog("info", `Signer updated · ${describeLimits(input.limits)}`);
  });
}

export async function removeSigner(signer: LocalSigner): Promise<void> {
  if (!requireConnected()) return;
  await run(`Remove ${signer.kind} signer`, async () => {
    const at = await account.remove(toSignerKey(signer));
    if (!(await signAndSubmit(`Remove ${signer.kind} signer`, at))) return;
    removeFromRegistry(signer.kind, signer.value);
    if (signer.kind === "Secp256r1") {
      await storage.delete(signer.value).catch(() => {});
      await refreshKnown();
    }
    pushLog("info", `Signer removed`);
  });
}

/** Admin rotation: add a fresh unlimited passkey and make it the active signer. */
export async function rotateAdmin(name: string): Promise<void> {
  if (!requireConnected()) return;
  await addPasskeySigner(name, { store: SignerStore.Persistent, limits: UNLIMITED });
  const added = app.signers.find((s) => s.kind === "Secp256r1" && s.label === name);
  if (added) {
    setActiveSigner(added.value);
    pushLog("success", `Admin rotated — new active signer ${added.value.slice(0, 10)}…`);
  }
}

export function setActiveSigner(keyId: string): void {
  app.activeKeyId = keyId;
  pushLog("info", `Active signer set to ${keyId.slice(0, 10)}…`);
}

// -- Transfers + balances -----------------------------------------------------

export type SignWith = "passkey" | "ed25519" | "policy" | "multisig";

export async function transfer(to: string, amount: bigint, signWith: SignWith): Promise<void> {
  if (!requireConnected()) return;
  await doTransfer(`Transfer (${signWith})`, to, amount, signersFor(signWith));
}

/** Quick 1-token transfer back to the funding account, signed by one signer. */
export async function quickTransferFrom(signer: LocalSigner): Promise<void> {
  if (!requireConnected()) return;
  const to = (await fundKeypair).publicKey();
  await doTransfer(`Transfer via ${signer.kind}`, to, 10_000_000n, signersForLocal(signer));
}

async function doTransfer(
  label: string,
  to: string,
  amount: bigint,
  signers: Signer[],
): Promise<void> {
  await run(label, async () => {
    const token = localToken();
    let at = await token.transfer({ from: app.contractId!, to, amount });
    for (const signer of signers) {
      at = await account.sign(at, signer);
    }
    if (!reportResult(label, await submit(at))) return;
    await refreshBalance();
  });
}

/** The signer object(s) for a specific registry row. */
function signersForLocal(signer: LocalSigner): Signer[] {
  switch (signer.kind) {
    case "Secp256r1":
      return [new PasskeySigner(signer.value)];
    case "Ed25519":
      return [Ed25519Signer.fromSecret(ensureEd25519().secret())];
    case "Policy":
      return [Ed25519Signer.fromSecret(ensureEd25519().secret()), new PolicySigner(signer.value)];
  }
}

function signersFor(signWith: SignWith): Signer[] {
  switch (signWith) {
    case "passkey":
      return [adminSigner()];
    case "ed25519":
      return [Ed25519Signer.fromSecret(ensureEd25519().secret())];
    case "policy":
      // Sample policy co-signs alongside its required Ed25519 co-signer.
      return [Ed25519Signer.fromSecret(ensureEd25519().secret()), new PolicySigner(requirePolicy())];
    case "multisig":
      return [
        adminSigner(),
        Ed25519Signer.fromSecret(ensureEd25519().secret()),
        ...(config.samplePolicyId ? [new PolicySigner(config.samplePolicyId)] : []),
      ];
  }
}

export async function fundWallet(amountXlm: number): Promise<void> {
  if (!requireConnected()) return;
  await run(`Fund wallet (${amountXlm} XLM)`, () => fundWalletInner(amountXlm));
}

/**
 * The fund body WITHOUT a `run()` wrapper, so it can be called from inside
 * another flow's `run()` block (e.g. `register`) without tripping the busy-guard
 * (which early-returns when `app.busy` is already set).
 */
async function fundWalletInner(amountXlm: number): Promise<void> {
  const fundKp = await fundKeypair;
  const signer = await fundSigner();
  const native = sac.getSACClient(config.nativeContractId);
  const at = await native.transfer({
    to: app.contractId!,
    from: fundKp.publicKey(),
    // `<input type=number>` allows fractional XLM; BigInt() throws on a
    // non-integer, so scale then round to whole stroops.
    amount: BigInt(Math.round(amountXlm * 10_000_000)),
  });
  await at.signAuthEntries({
    address: fundKp.publicKey(),
    signAuthEntry: signer.signAuthEntry,
  });
  if (!reportResult(`Fund wallet`, await submit(at))) return;
  await refreshBalance();
}

export async function refreshBalance(): Promise<void> {
  if (!app.contractId) return;
  try {
    const token = localToken();
    const { result } = await token.balance({ id: app.contractId });
    app.balances[app.selectedToken || config.nativeContractId] = result.toString();
  } catch (err) {
    pushLog("error", `Balance read failed: ${describeError(err).message}`);
  }
}

export async function selectToken(contractId: string): Promise<void> {
  app.selectedToken = contractId;
  await refreshBalance();
}

// -- Discovery (both indexer backends) ----------------------------------------

export async function discover(backend: IndexerBackend): Promise<void> {
  if (!app.contractId) return;
  app.discoverBackend = backend;
  if (!indexer.configured) {
    pushLog("info", `Discovery pending: set VITE_indexerProxyUrl to query ${backend}`);
    return;
  }
  await run(`Discover via ${backend}`, async () => {
    const rows = await indexer.getSigners(app.contractId!, backend);
    app.discovered = rows;
    pushLog("success", `Discovered ${rows.length} signer(s) via ${backend}`, {
      detail: rows.map((r) => `${r.key.kind}:${r.status}`).join(", ") || "none",
    });
  });
}

export async function reverseLookup(backend: IndexerBackend): Promise<void> {
  if (!app.keyId) return;
  if (!indexer.configured) {
    pushLog("info", `Reverse lookup pending: set VITE_indexerProxyUrl`);
    return;
  }
  await run(`Reverse lookup via ${backend}`, async () => {
    const ids = await indexer.findWallets(
      { kind: "Secp256r1", value: app.keyId! },
      backend,
    );
    const match = ids.includes(app.contractId ?? "");
    pushLog(match ? "success" : "info", `keyId → ${ids.length} wallet(s) via ${backend}`, {
      detail: ids.length
        ? `${ids.map((i) => i.slice(0, 8) + "…").join(", ")}${match ? " · matches connected ✓" : ""}`
        : "none",
    });
  });
}

// -- Ed25519 demo key ---------------------------------------------------------

/** Generate (once) an ephemeral Ed25519 keypair for the Ed25519/policy demos. */
export function ensureEd25519(): Keypair {
  if (app.ed25519Secret) return Keypair.fromSecret(app.ed25519Secret);
  const kp = Keypair.random();
  app.ed25519Secret = kp.secret();
  app.ed25519Public = kp.publicKey();
  pushLog("info", `Generated ephemeral Ed25519 key ${kp.publicKey().slice(0, 8)}…`);
  return kp;
}

// -- Helpers ------------------------------------------------------------------

async function signAndSubmit(label: string, at: WalletWriteTx): Promise<boolean> {
  const signed = await account.sign(at, adminSigner());
  return reportResult(label, await submit(signed));
}

async function resolvePublicKey(signer: LocalSigner): Promise<Uint8Array | undefined> {
  if (signer.publicKey) return base64url.toBuffer(signer.publicKey);
  const stored = await storage.get(signer.value).catch(() => null);
  return stored?.publicKey;
}

function requireConnected(): boolean {
  if (!isConnected()) {
    pushLog("error", "Connect a wallet first");
    return false;
  }
  return true;
}

function requirePolicy(): string {
  if (!config.samplePolicyId) throw new Error("No sample policy configured (VITE_samplePolicyId)");
  return config.samplePolicyId;
}

function bytesLabel(bytes: Uint8Array): string {
  return `${bytes.length}-byte credential`;
}
