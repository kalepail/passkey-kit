<script lang="ts">
  import { indexer } from "../config";
  import { app } from "../state.svelte";
  import { discover, reverseLookup } from "../actions";
  import { shortId } from "../format";

  const busy = $derived(Boolean(app.busy));
</script>

<section class="panel col" data-testid="discovery-panel">
  <h2>Signer discovery</h2>

  {#if !indexer}
    <div class="pending" data-testid="discovery-pending">
      No hosted passkey-indexer for this network (Mercury covers testnet + mainnet).
    </div>
  {:else}
    <p class="hint">
      Via Mercury's hosted passkey-indexer — keyless, queried directly from the browser.
    </p>
  {/if}

  <div class="row">
    <button disabled={busy || !indexer} data-testid="discover" onclick={() => discover()}>
      Discover signers
    </button>
    <button class="ghost" disabled={busy || !indexer} data-testid="reverse-lookup" onclick={() => reverseLookup()}>
      Reverse lookup keyId
    </button>
  </div>

  {#if app.discovered.length}
    <ul class="list" data-testid="discovered-list">
      {#each app.discovered as row}
        <li class="signer">
          <div class="row spread">
            <span class="badge">{row.key.key}</span>
            <span
              class="badge"
              class:good={row.status === "live"}
              class:bad={row.status === "removed" || row.status === "expired" || row.status === "evicted"}
              >{row.status}</span
            >
          </div>
          <code class="big-id">{shortId(row.key.value, 12)}</code>
          <p class="hint">
            {row.storage}{row.expiration ? ` · expires ${new Date(row.expiration * 1000).toISOString().slice(0, 10)}` : ""}
          </p>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="hint">No discovery results yet.</p>
  {/if}
</section>
