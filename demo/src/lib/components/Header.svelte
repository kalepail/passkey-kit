<script lang="ts">
  import { network, relayer, indexer } from "../config";
  import { app } from "../state.svelte";
</script>

<header class="panel row spread" data-testid="header" style="align-items:center">
  <div class="row" style="gap:12px; align-items:center">
    <img src="/favicon.svg" alt="" width="32" height="32" />
    <div>
      <h1 style="font-size:20px">Passkey Kit</h1>
      <p class="hint">Stellar smart-wallet accounts with WebAuthn passkeys</p>
    </div>
  </div>

  <div class="row" style="gap:8px; align-items:center">
    <span class="badge">{network}</span>
    {#if app.busy}
      <span class="badge good" data-testid="busy">{app.busy}…</span>
    {:else if app.status === "connected"}
      <span class="badge good">connected</span>
    {:else}
      <span class="badge">{app.status}</span>
    {/if}
    {#if !relayer.configured}
      <span class="badge bad" title="Set VITE_relayerProxyUrl">no relayer proxy</span>
    {/if}
    {#if !indexer}
      <span class="badge" title="Mercury indexes testnet + mainnet only">no indexer</span>
    {/if}
  </div>
</header>
