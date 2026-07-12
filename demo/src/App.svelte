<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./lib/state.svelte";
  import { boot } from "./lib/actions";
  import Header from "./lib/components/Header.svelte";
  import WalletPanel from "./lib/components/WalletPanel.svelte";
  import TransferPanel from "./lib/components/TransferPanel.svelte";
  import SignersPanel from "./lib/components/SignersPanel.svelte";
  import DiscoveryPanel from "./lib/components/DiscoveryPanel.svelte";
  import ActivityLog from "./lib/components/ActivityLog.svelte";

  const connected = $derived(app.status === "connected" && Boolean(app.contractId));

  onMount(() => {
    void boot();
  });
</script>

<main class="app col" style="gap:16px">
  <Header />

  <div class="grid">
    <WalletPanel />
    {#if connected}
      <TransferPanel />
      <SignersPanel />
      <DiscoveryPanel />
    {/if}
  </div>

  <ActivityLog />
</main>
