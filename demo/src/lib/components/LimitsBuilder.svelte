<script lang="ts">
  import type { LimitsSpec, LimitsMode, SignerKind } from "../signers";

  let { spec = $bindable() }: { spec: LimitsSpec } = $props();

  const modes: { id: LimitsMode; label: string; hint: string }[] = [
    { id: "unlimited", label: "Unlimited", hint: "Admin — can authorize anything" },
    { id: "none", label: "No permissions", hint: "Empty map — fail-closed" },
    { id: "restricted", label: "Restricted", hint: "Per-contract signer-key limits" },
  ];

  function setMode(mode: LimitsMode) {
    spec.mode = mode;
    if (mode === "restricted" && spec.entries.length === 0) addContract();
  }

  function addContract() {
    spec.entries.push({ contract: "", keys: [] });
  }
  function removeContract(i: number) {
    spec.entries.splice(i, 1);
  }
  function addKey(i: number) {
    spec.entries[i].keys.push({ kind: "Ed25519", value: "" });
  }
  function removeKey(i: number, j: number) {
    spec.entries[i].keys.splice(j, 1);
  }

  const kinds: SignerKind[] = ["Secp256r1", "Ed25519", "Policy"];
</script>

<div class="col" data-testid="limits-builder">
  <span class="label">Signer limits</span>
  <div class="seg" role="tablist">
    {#each modes as m}
      <button
        type="button"
        class:active={spec.mode === m.id}
        title={m.hint}
        data-testid={`limits-mode-${m.id}`}
        onclick={() => setMode(m.id)}>{m.label}</button
      >
    {/each}
  </div>
  <p class="hint">{modes.find((m) => m.id === spec.mode)?.hint}</p>

  {#if spec.mode === "restricted"}
    <div class="col">
      {#each spec.entries as entry, i}
        <div class="signer col">
          <div class="row spread">
            <span class="label">Contract {i + 1}</span>
            <button type="button" class="sm ghost danger" onclick={() => removeContract(i)}>remove</button>
          </div>
          <input
            placeholder="Contract id (C…)"
            bind:value={entry.contract}
            data-testid={`limits-contract-${i}`}
          />
          {#each entry.keys as key, j}
            <div class="row">
              <select bind:value={key.kind}>
                {#each kinds as k}<option value={k}>{k}</option>{/each}
              </select>
              <input placeholder="key value" bind:value={key.value} style="flex:1" />
              <button type="button" class="sm ghost danger" onclick={() => removeKey(i, j)}>×</button>
            </div>
          {/each}
          <button type="button" class="sm ghost" onclick={() => addKey(i)}>+ allowed signer key</button>
          {#if entry.keys.length === 0}
            <p class="hint">No keys ⇒ unrestricted on this contract.</p>
          {/if}
        </div>
      {/each}
      <button type="button" class="sm ghost" onclick={addContract}>+ contract</button>
    </div>
  {/if}
</div>
