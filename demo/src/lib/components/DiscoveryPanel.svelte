<script lang="ts">
  import { indexer } from "../config";
  import { app } from "../state.svelte";
  import { discover, reverseLookup } from "../actions";
  import { shortId } from "../format";
  import { INDEXER_BACKENDS, type IndexerBackend } from "../indexer-proxy";

  const busy = $derived(Boolean(app.busy));

  function setBackend(b: IndexerBackend) {
    app.discoverBackend = b;
  }
</script>

<section class="panel col" data-testid="discovery-panel">
  <h2>Signer discovery</h2>

  {#if !indexer.configured}
    <div class="pending" data-testid="discovery-pending">
      Indexer proxy not configured — set <code>VITE_indexerProxyUrl</code> to query Mercury / Stellar
      Indexer. (Both backends are verified live in the F2 e2e.)
    </div>
  {/if}

  <div>
    <span class="label">Backend</span>
    <div class="row" style="margin-top:4px">
      <div class="seg" data-testid="backend-toggle">
        {#each INDEXER_BACKENDS as b}
          <button
            type="button"
            class:active={app.discoverBackend === b.id}
            data-testid={`backend-${b.id}`}
            onclick={() => setBackend(b.id)}>{b.label}</button
          >
        {/each}
      </div>
    </div>
  </div>

  <div class="row">
    <button disabled={busy} data-testid="discover" onclick={() => discover(app.discoverBackend)}>
      Discover signers
    </button>
    <button class="ghost" disabled={busy} data-testid="reverse-lookup" onclick={() => reverseLookup(app.discoverBackend)}>
      Reverse lookup keyId
    </button>
  </div>

  {#if app.discovered.length}
    <ul class="list" data-testid="discovered-list">
      {#each app.discovered as row}
        <li class="signer">
          <div class="row spread">
            <span class="badge">{row.key.kind}</span>
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
