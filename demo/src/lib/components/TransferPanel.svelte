<script lang="ts">
  import { config, fundPubkey } from "../config";
  import { app } from "../state.svelte";
  import { fromStroops, toStroops, shortId } from "../format";
  import {
    fundWallet,
    refreshBalance,
    selectToken,
    transfer,
    ensureEd25519,
    type SignWith,
  } from "../actions";

  let to = $state("");
  let amount = $state("1");
  let signWith = $state<SignWith>("passkey");
  let fundAmount = $state(100);

  const busy = $derived(Boolean(app.busy));
  const balance = $derived(app.balances[app.selectedToken] ?? undefined);
  const token = $derived(
    config.tokens.find((t) => t.contractId === app.selectedToken) ?? config.tokens[0],
  );

  const signOptions: { id: SignWith; label: string; disabled?: boolean }[] = $derived([
    { id: "passkey", label: "Passkey" },
    { id: "ed25519", label: "Ed25519" },
    { id: "policy", label: "Policy", disabled: !config.samplePolicyId },
    { id: "multisig", label: "Multisig" },
  ]);

  async function useFundAddress() {
    to = await fundPubkey();
  }

  async function send() {
    if (!to) return;
    await transfer(to, toStroops(amount), signWith);
  }
</script>

<section class="panel col" data-testid="transfer-panel">
  <h2>Balance &amp; transfers</h2>

  <div class="field">
    <label for="token">Token (SAC / SEP-41)</label>
    <select id="token" data-testid="token-select" onchange={(e) => selectToken(e.currentTarget.value)}>
      {#each config.tokens as t}
        <option value={t.contractId} selected={t.contractId === app.selectedToken}>
          {t.label}{t.native ? "" : ` · ${shortId(t.contractId, 4)}`}
        </option>
      {/each}
    </select>
  </div>

  <div class="row spread">
    <div>
      <div class="balance" data-testid="balance">{balance ? fromStroops(balance) : "—"}</div>
      <div class="hint">{token?.label}</div>
    </div>
    <button class="ghost sm" disabled={busy} onclick={() => refreshBalance()}>Refresh</button>
  </div>

  <hr class="divider" />
  <div class="row">
    <input type="number" min="1" style="width:90px" bind:value={fundAmount} />
    <button disabled={busy} data-testid="fund-wallet" onclick={() => fundWallet(fundAmount)}>
      Fund from Friendbot source
    </button>
  </div>
  <p class="hint">Only XLM (native) can be funded; other tokens must be acquired separately.</p>

  <hr class="divider" />
  <div class="col">
    <div class="field">
      <label for="to">Destination</label>
      <div class="row">
        <input id="to" placeholder="G… or C…" bind:value={to} style="flex:1" data-testid="transfer-to" />
        <button class="ghost sm" onclick={useFundAddress}>use fund addr</button>
      </div>
    </div>
    <div class="field">
      <label for="amount">Amount</label>
      <input id="amount" type="number" min="0" step="0.0000001" bind:value={amount} data-testid="transfer-amount" />
    </div>
    <div>
      <span class="label">Sign with</span>
      <div class="row" style="margin-top:4px">
        <div class="seg" data-testid="sign-with">
          {#each signOptions as o}
            <button
              type="button"
              class:active={signWith === o.id}
              disabled={o.disabled}
              title={o.disabled ? "Set VITE_samplePolicyId to enable" : ""}
              onclick={() => (signWith = o.id)}>{o.label}</button
            >
          {/each}
        </div>
      </div>
    </div>
    {#if signWith === "ed25519" || signWith === "policy" || signWith === "multisig"}
      <p class="hint">
        Ephemeral Ed25519:
        {#if app.ed25519Public}<code>{shortId(app.ed25519Public, 6)}</code>{:else}<em>none</em>{/if}
        <button type="button" class="sm ghost" onclick={() => ensureEd25519()}>generate</button>
      </p>
    {/if}
    <button class="primary" disabled={busy || !to} data-testid="transfer-send" onclick={send}>
      Send {amount} {token?.native ? "XLM" : "tokens"} ({signWith})
    </button>
  </div>
</section>
