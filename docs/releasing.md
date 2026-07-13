# Releasing the npm packages

The repository publishes three packages. Release them in this order so each can resolve its workspace dependency to a version that already exists on npm:

1. `passkey-kit-sdk` (generated smart-wallet bindings)
2. `sac-sdk` (generated SEP-41 bindings)
3. `passkey-kit` (the SDK — depends on both via `workspace:*`)

The two binding packages are independent; publish them in either order, but both **before** `passkey-kit`. `passkey-kit`'s `dependencies` pin them as `workspace:*`, which pnpm rewrites to the concrete workspace version at pack time — that version must already be on npm for consumers to install.

The versions checked into each `package.json` are authoritative; `npm view` is the source of truth for what is already published. Confirm both before publishing.

| Package | Checked-in version |
|---|---|
| `passkey-kit-sdk` | `0.7.3` |
| `sac-sdk` | `0.4.3` |
| `passkey-kit` | `0.13.1` (v1 release + live Mercury discovery — see [CHANGELOG](../CHANGELOG.md)) |

> [!IMPORTANT]
> Publishing is an **outward-facing, user-gated** step. Bump the versions intentionally, and have the person with npm access run the publish commands (they hold the credentials and the OTP device).

## Prerequisites

- Node.js 22 or newer
- pnpm 10 or newer
- Stellar CLI 27 or newer (only when regenerating bindings)
- npm publish access to all three packages
- A clean tracked Git worktree

## 1. Authenticate & check the registry

```bash
npm login
npm whoami
npm view passkey-kit-sdk version
npm view sac-sdk version
npm view passkey-kit version
```

## 2. Regenerate & verify bindings

Regenerate the bindings whenever the smart-wallet or SAC contract interface changes. Generation goes through `scripts/bindings/build.sh`; it regenerates directly into `packages/` from the canonical WASM and applies the post-generation patch pass (package README, `package.json` peer-demotion, `tsconfig`).

```bash
pnpm run bindings:regen     # regenerate packages/*/src from the canonical WASM
```

Then prove the committed bindings match the canonical on-chain WASM:

```bash
pnpm run verify:bindings
```

`verify:bindings` (`scripts/bindings/verify.sh`) fetches the smart-wallet WASM by the pinned canonical hash recorded in [`deployments-testnet-2026-07-11.md`](./deployments-testnet-2026-07-11.md), regenerates to a temp dir, and diffs the ContractSpec base64 (the wasm-determined semantic content, ignoring CLI formatting). It exits nonzero on drift.

> [!WARNING]
> **Never hand-edit the generated bindings** to resolve drift. Fix it on the contract side, rebuild, re-pin the canonical hash in the deployments manifest, and regenerate. Hand-edits re-introduce drift that `verify:bindings` will flag.

## 3. Validate

```bash
pnpm install --frozen-lockfile
pnpm test --run
pnpm run verify:bindings
pnpm run build            # build:bindings → tsc → verify-esm
pnpm run build:demo       # ensure the demo still builds against the SDK
git diff --check
git status --short
```

`pnpm run build` runs `build:bindings`, compiles the SDK to `dist/`, and runs the Node-ESM import smoke test (`verify-esm.mjs`). Commit any intended changes before continuing — publish from a clean tree.

## 4. Authenticated dry run

A dry run verifies npm authentication and shows the tarball contents and the versions that would publish, without uploading. Run it for each package from its directory:

```bash
pnpm --filter passkey-kit-sdk publish --dry-run --no-git-checks
pnpm --filter sac-sdk publish --dry-run --no-git-checks
pnpm publish --dry-run --no-git-checks   # from the repo root: passkey-kit
```

Confirm the `files` whitelist (`dist`, `README.md`, `LICENCE`) is what ships, and that `passkey-kit`'s dry run resolved the `workspace:*` deps to the concrete binding versions.

## 5. Publish

Publish the bindings first, then the SDK. `prepublishOnly` on `passkey-kit` re-runs `verify:bindings` and `build` as a final gate.

```bash
# 1) bindings
pnpm --filter passkey-kit-sdk publish --no-git-checks
npm view passkey-kit-sdk version

pnpm --filter sac-sdk publish --no-git-checks
npm view sac-sdk version

# 2) the SDK
pnpm publish --no-git-checks             # from the repo root
npm view passkey-kit version
npm view passkey-kit dependencies        # confirm the binding versions resolved
```

If npm requires a one-time password, append `--otp <fresh-code>` to each `pnpm … publish` command:

```bash
pnpm --filter passkey-kit-sdk publish --no-git-checks --otp 123456
```

Use a **fresh** OTP for each publish (codes expire in ~30s). npm package versions are immutable — a re-run after a successful publish fails; check `npm view` before retrying.

## Contract & indexer deploys (separate concerns)

Publishing the npm packages does **not** deploy contracts, the indexer, or the workers. Those are separate, gated steps:

- **Contract WASM** (smart-wallet upload, sample-policy deploy) and the canonical hashes: [`deployments-testnet-2026-07-11.md`](./deployments-testnet-2026-07-11.md). Every user wallet deploys its own instance via the SDK; the smart-wallet WASM is uploaded, never run as a singleton.
- **Mercury passkey-indexer** — hosted and **keyless**; nothing to deploy. The SDK's `MercuryIndexer` queries `https://{testnet,mainnet}.mercurydata.app/rest/passkey-indexer` (both networks, full history). Mercury ingests the canonical v1 WASM hash from the [deployments manifest](./deployments-testnet-2026-07-11.md).
- **Relayer-proxy worker** (Cloudflare): [`relayer-proxy/README.md`](../relayer-proxy/README.md) (`pnpm deploy` / `pnpm deploy:production`).
- **Demo** (Cloudflare Pages): root `wrangler.toml`, `pnpm run deploy:demo` / `deploy:demo:prod`.
