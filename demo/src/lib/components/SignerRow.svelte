<script lang="ts">
  import { SignerStore } from "passkey-kit";
  import { app } from "../state.svelte";
  import { shortId } from "../format";
  import {
    isAdmin,
    expirationInDays,
    type LimitsSpec,
    type LocalSigner,
  } from "../signers";
  import { quickTransferFrom, removeSigner, setActiveSigner, updateSigner } from "../actions";
  import LimitsBuilder from "./LimitsBuilder.svelte";

  let { signer }: { signer: LocalSigner } = $props();

  const active = $derived(signer.kind === "Secp256r1" && signer.value === app.activeKeyId);
  const busy = $derived(Boolean(app.busy));

  let editing = $state(false);
  let editStore = $state<SignerStore>(SignerStore.Temporary);
  let editLimits = $state<LimitsSpec>({ mode: "restricted", entries: [] });
  let editUseExpiry = $state(true);
  let editDays = $state(30);

  function startEdit() {
    editStore = signer.store;
    editLimits = { mode: signer.limitsMode, entries: [] };
    editUseExpiry = signer.expiration !== undefined;
    editing = true;
  }

  async function saveEdit() {
    await updateSigner(signer, {
      store: editStore,
      limits: editLimits,
      expiration: editUseExpiry ? expirationInDays(editDays) : undefined,
    });
    editing = false;
  }

  const expiryLabel = $derived(
    signer.expiration
      ? new Date(signer.expiration * 1000).toISOString().slice(0, 16).replace("T", " ")
      : "none",
  );
</script>

<li class="signer col" data-testid="signer-row" data-kind={signer.kind} data-value={signer.value}>
  <div class="row spread">
    <div class="row" style="gap:6px">
      <span class="badge">{signer.kind}</span>
      {#if isAdmin(signer)}<span class="badge admin">admin</span>{:else}<span class="badge">session</span>{/if}
      {#if signer.self}<span class="badge self">this passkey</span>{/if}
      {#if active}<span class="badge good">active signer</span>{/if}
      <span class="badge">{signer.store}</span>
    </div>
  </div>

  <code class="big-id">{shortId(signer.value, 12)}</code>
  <p class="hint">
    {signer.label ?? ""} · limits: {signer.limitsMode} · expires: {expiryLabel}
  </p>

  <div class="row">
    <button class="sm" disabled={busy} data-testid="signer-transfer" onclick={() => quickTransferFrom(signer)}>
      Transfer 1
    </button>
    {#if signer.kind === "Secp256r1" && isAdmin(signer) && !active}
      <button class="sm ghost" disabled={busy} onclick={() => setActiveSigner(signer.value)}>Set active</button>
    {/if}
    <button class="sm ghost" disabled={busy} onclick={startEdit}>Update</button>
    <button class="sm ghost danger" disabled={busy} data-testid="signer-remove" onclick={() => removeSigner(signer)}>
      Remove
    </button>
  </div>

  {#if editing}
    <hr class="divider" />
    <div class="col">
      <span class="label">Update signer</span>
      <div class="row">
        <div class="seg">
          {#each [SignerStore.Persistent, SignerStore.Temporary] as s}
            <button type="button" class:active={editStore === s} onclick={() => (editStore = s)}>{s}</button>
          {/each}
        </div>
        <label class="row" style="gap:6px">
          <input type="checkbox" bind:checked={editUseExpiry} /> expires in
        </label>
        <input type="number" min="1" style="width:80px" bind:value={editDays} disabled={!editUseExpiry} />
        <span class="hint">days</span>
      </div>
      <LimitsBuilder bind:spec={editLimits} />
      <div class="row">
        <button class="primary sm" disabled={busy} onclick={saveEdit}>Save update</button>
        <button class="ghost sm" onclick={() => (editing = false)}>Cancel</button>
      </div>
    </div>
  {/if}
</li>
