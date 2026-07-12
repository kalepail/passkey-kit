<script lang="ts">
  import { app } from "../state.svelte";
  import { rotateAdmin } from "../actions";
  import AddSignerForm from "./AddSignerForm.svelte";
  import SignerRow from "./SignerRow.svelte";

  let rotateName = $state("Rotated admin");
  const busy = $derived(Boolean(app.busy));
</script>

<section class="panel col" data-testid="signers-panel">
  <h2>Signers</h2>

  <ul class="list" data-testid="signer-list">
    {#each app.signers as signer (signer.kind + signer.value)}
      <SignerRow {signer} />
    {:else}
      <li class="hint">No signers tracked yet.</li>
    {/each}
  </ul>

  <hr class="divider" />
  <h2>Add signer</h2>
  <AddSignerForm />

  <hr class="divider" />
  <h2>Admin rotation</h2>
  <p class="hint">Add a fresh unlimited passkey and make it the active signer.</p>
  <div class="row">
    <input bind:value={rotateName} style="flex:1" />
    <button class="ghost" disabled={busy} data-testid="rotate-admin" onclick={() => rotateAdmin(rotateName)}>
      Rotate admin
    </button>
  </div>
</section>
