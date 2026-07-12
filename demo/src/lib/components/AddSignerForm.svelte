<script lang="ts">
  import { SignerStore } from "passkey-kit";
  import { config } from "../config";
  import { app } from "../state.svelte";
  import { addPasskeySigner, addEd25519Signer, addPolicySigner, ensureEd25519 } from "../actions";
  import { expirationInDays, type LimitsSpec, type SignerKind } from "../signers";
  import LimitsBuilder from "./LimitsBuilder.svelte";

  const kinds: SignerKind[] = ["Secp256r1", "Ed25519", "Policy"];

  let kind = $state<SignerKind>("Secp256r1");
  let name = $state("Session key");
  let store = $state<SignerStore>(SignerStore.Temporary);
  let limits = $state<LimitsSpec>({ mode: "restricted", entries: [] });
  let useExpiry = $state(true);
  let expiryDays = $state(30);

  const busy = $derived(Boolean(app.busy));

  function input() {
    return {
      store,
      limits,
      expiration: useExpiry ? expirationInDays(expiryDays) : undefined,
    };
  }

  async function add() {
    if (kind === "Secp256r1") await addPasskeySigner(name || "Session key", input());
    else if (kind === "Ed25519") await addEd25519Signer(input());
    else await addPolicySigner(input());
  }
</script>

<div class="col" data-testid="add-signer-form">
  <div class="seg">
    {#each kinds as k}
      <button
        type="button"
        class:active={kind === k}
        disabled={k === "Policy" && !config.samplePolicyId}
        title={k === "Policy" && !config.samplePolicyId ? "Set VITE_samplePolicyId to enable" : ""}
        data-testid={`add-kind-${k}`}
        onclick={() => (kind = k)}>{k}</button
      >
    {/each}
  </div>

  {#if kind === "Secp256r1"}
    <div class="field">
      <label for="signer-name">New passkey name</label>
      <input id="signer-name" bind:value={name} data-testid="add-signer-name" />
    </div>
  {:else if kind === "Ed25519"}
    <p class="hint">
      Uses the ephemeral Ed25519 key
      {#if app.ed25519Public}<code>{app.ed25519Public.slice(0, 10)}…</code>{:else}(generated on demand){/if}.
      <button type="button" class="sm ghost" onclick={() => ensureEd25519()}>generate</button>
    </p>
  {:else}
    <p class="hint">Policy contract <code>{config.samplePolicyId?.slice(0, 10)}…</code></p>
  {/if}

  <div class="row">
    <div class="seg" data-testid="add-store">
      {#each [SignerStore.Persistent, SignerStore.Temporary] as s}
        <button type="button" class:active={store === s} onclick={() => (store = s)}>{s}</button>
      {/each}
    </div>
    <label class="row" style="gap:6px">
      <input type="checkbox" bind:checked={useExpiry} />
      expires in
    </label>
    <input
      type="number"
      min="1"
      style="width:80px"
      bind:value={expiryDays}
      disabled={!useExpiry}
    />
    <span class="hint">days</span>
  </div>

  <LimitsBuilder bind:spec={limits} />

  <button class="primary" disabled={busy} data-testid="add-signer-submit" onclick={add}>
    Add {kind} signer
  </button>
</div>
