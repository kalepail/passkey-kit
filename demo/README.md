# Passkey Kit demo

A Svelte 5 + Vite app that exercises the full `passkey-kit` client API against
Stellar testnet smart wallets: passkey create / reconnect, add / update / remove
signers (secp256r1 passkeys, Ed25519 keys, policy signers), Persistent and
Temporary storage, per-signer `SignerLimits`, admin rotation, multisig and
per-signer transfers, non-native SAC support, relayer-sponsored submission, and
signer discovery via Mercury's hosted passkey-indexer.

## Zero secrets in the bundle

Nothing here holds a secret. The client builds and **signs** transactions, then:

- **submits** them through a server-side **relayer-proxy worker**
  (`VITE_relayerProxyUrl`) that holds the relayer key (keyless per-IP minting),
  and
- **discovers** signers by calling Mercury's hosted **passkey-indexer** directly
  — it's keyless, so no proxy and no token (the SDK's `MercuryIndexer`, resolved
  per network).

`passkey-kit/server` is never imported. Passkey → wallet records are persisted
with the SDK's `LocalStorageAdapter`, not hand-rolled `localStorage`.

## Configure

```sh
cp .env.example .env.local
# fill in the public values; leave VITE_relayerProxyUrl unset to run the core
# flows without a live worker (submission then shows "no relayer proxy").
```

Every `.env` value is public — see `.env.example`. Set `VITE_samplePolicyId` to a
deployed v1 `sample-policy` instance to enable the policy-signer controls, and
`VITE_extraTokenIds` (`label:C…,…`) to add non-native SAC tokens to the picker.

## Run

```sh
pnpm --ignore-workspace install
pnpm dev        # http://localhost:5173
pnpm build      # svelte-check + production build
```

The demo consumes the **compiled** `passkey-kit` from the repo root via
`link:..`, so build the SDK there first (`pnpm build` in the repo root) if `dist/`
is missing.

## Architecture

- `src/lib/config.ts` — public config + singletons (`PasskeyKit`, `SACClient`,
  storage adapter, relayer/indexer proxy clients).
- `src/lib/actions.ts` — every flow that touches the SDK (thin components call in).
- `src/lib/state.svelte.ts` — the reactive store (Svelte 5 runes).
- `src/lib/{relayer-proxy,indexer-proxy,submit}.ts` — the browser↔worker seams.
- `src/lib/components/` — one panel per concern.

Live end-to-end verification (real `C…` ids, tx hashes, both indexer backends)
runs through the e2e harness in the repo `scripts/` (todo 956).
