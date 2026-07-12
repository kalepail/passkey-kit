<script lang="ts">
  import { explorerContract } from "../config";
  import { app } from "../state.svelte";
  import { shortId } from "../format";
  import { connect, disconnect, forgetAll, register } from "../actions";

  let name = $state("Peach");
  const busy = $derived(Boolean(app.busy));
  const connected = $derived(app.status === "connected" && Boolean(app.contractId));
</script>

<section class="panel col" data-testid="wallet-panel">
  <h2>Wallet</h2>

  {#if connected}
    <div class="col">
      <span class="label">Smart wallet</span>
      <a
        class="big-id"
        href={explorerContract(app.contractId!)}
        target="_blank"
        rel="noreferrer"
        data-testid="wallet-contract-id">{app.contractId}</a
      >
      <p class="hint">
        active signer: <code>{shortId(app.activeKeyId, 10)}</code>
      </p>
    </div>
    <div class="row">
      <button disabled={busy} data-testid="disconnect" onclick={disconnect}>Disconnect</button>
      <button class="ghost danger" disabled={busy} data-testid="reset" onclick={forgetAll}>
        Forget stored passkeys
      </button>
    </div>
  {:else}
    <div class="field">
      <label for="wallet-name">New wallet name</label>
      <div class="row">
        <input id="wallet-name" bind:value={name} style="flex:1" data-testid="register-name" />
        <button class="primary" disabled={busy} data-testid="register" onclick={() => register(name)}>
          Create
        </button>
      </div>
    </div>
    <div class="row">
      <button disabled={busy} data-testid="signin" onclick={() => connect()}>Sign in (passkey)</button>
    </div>
  {/if}

  {#if app.knownPasskeys.length}
    <hr class="divider" />
    <span class="label">Known passkeys ({app.knownPasskeys.length})</span>
    <ul class="list" data-testid="known-passkeys">
      {#each app.knownPasskeys as pk (pk.keyId)}
        <li class="row spread signer">
          <div class="col" style="gap:2px">
            <code>{shortId(pk.keyId, 8)}</code>
            <span class="hint">{pk.nickname ?? "passkey"} → {shortId(pk.contractId, 6)}</span>
          </div>
          <button
            class="sm"
            disabled={busy || pk.keyId === app.keyId}
            onclick={() => connect(pk.keyId)}>{pk.keyId === app.keyId ? "connected" : "reconnect"}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</section>
