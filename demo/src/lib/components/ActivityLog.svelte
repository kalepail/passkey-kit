<script lang="ts">
  import { explorerTx } from "../config";
  import { app } from "../state.svelte";
  import { shortId } from "../format";

  function time(at: number): string {
    return new Date(at).toLocaleTimeString();
  }
</script>

<section class="panel col" data-testid="activity-log">
  <div class="row spread">
    <h2>Activity</h2>
    <button class="ghost sm" onclick={() => (app.log = [])}>clear</button>
  </div>

  <div class="log" data-testid="log-box">
    {#each app.log as entry (entry.id)}
      <div class="log-entry {entry.level}">
        <div class="row spread">
          <span>{entry.message}</span>
          <span class="hint">{time(entry.at)}</span>
        </div>
        {#if entry.detail}<div class="log-detail">{entry.detail}</div>{/if}
        {#if entry.hash}
          <div class="log-detail">
            tx
            <a
              href={explorerTx(entry.hash)}
              target="_blank"
              rel="noreferrer"
              data-testid="tx-hash"
              data-hash={entry.hash}>{shortId(entry.hash, 8)}</a
            >
          </div>
        {/if}
      </div>
    {:else}
      <p class="hint">No activity yet.</p>
    {/each}
  </div>
</section>
