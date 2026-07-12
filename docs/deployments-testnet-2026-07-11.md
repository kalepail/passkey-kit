# passkey-kit v1 contract build + testnet deployment — 2026-07-11

This manifest is THE canonical hash source for the passkey-kit v1 contract
set. The Makefile, SDK configuration, `verify:bindings` drift guard, and the
zephyr (Mercury) ingestion allowlist must all consume the hashes recorded
here — never a locally rebuilt hash.

> **Status: post-audit-gate (FINAL for testnet).** These are the reworked v1
> contracts AFTER the independent 3-way audit (Fable + gpt-5.6-sol + terra)
> and all seven confirmed-closed remediations (FIX-1..7 + FIX-3b). The hashes
> below supersede the interim pre-audit values (smart-wallet
> `9e7fad44…`, sample-policy `e6d00383…`). The audit gate's final static
> `/code-review` pass runs after this re-pin; a further contract change would
> re-pin this manifest again.

## Build provenance

- Repo commit: `0563520` (branch `overhaul/ground-up`); post-audit contract
  set spans commit range `067f807..0563520` (A1 rework → A2 tests → A4
  audit fixes → FIX-3b).
- Rust/Cargo: `1.94.0` (pinned in `contracts/rust-toolchain.toml`)
- `soroban-sdk`: `27.0.0` (`e5cb4b52c3da8e56fc48adfd7b85d85976c1a059`)
- Stellar CLI: `27.0.0` (`5a7c5fe76530bf4248477ac812fc757146b98cc4`)
- Build target: `wasm32v1-none`
- Build command: `stellar contract build --locked --package <package> --out-dir out`
  (optimization is on by default in CLI 27; `out/<package>.wasm` is the final artifact)
- Contract meta: `binver: 1.0.0`, `rsver: 1.94.0`, `rssdkver: 27.0.0`

Note: the wasm hash is sensitive to source line numbers (panic `Location`
data is embedded), so only builds from the exact commit above reproduce these
hashes. Reproducibility was verified by rebuilding from a clean `out/`.

| Component | Cargo package | Bytes | SHA-256 / network WASM hash |
|---|---|---:|---|
| Smart wallet | `smart-wallet` | 29,275 | `84924c53a413318df2ce753e30de53ec651404c916d30e861718ad155c94b319` |
| Sample policy | `sample-policy` | 13,064 | `e74af5355f933f2c3421845178ca789c9bcf3ea7612a7c9966b9b57f26e59aed` |
| Example contract | `example-contract` | 1,047 | `47a3326360bdce2ca360ed1b226ad636e14ac698f63efc11ab28e0d41f1f76aa` |

The smart wallet WASM is uploaded but never deployed as a singleton: every
user wallet deploys its own instance with a `Signer` constructor argument.
The sample policy demonstrates the v1 policy lifecycle
(`install`/`uninstall`/`policy__`) as a cumulative rolling-window spending
allowance. The example contract is a test fixture (deploy-path and
multi-transfer auth exercises); it is uploaded for completeness but nothing
depends on it. The example-contract WASM is byte-identical to the pre-audit
build (its source was untouched by the audit fixes), so its hash and upload
are unchanged.

## Testnet

Upload source: `passkey-kit-deployer`
(`GBUOCX45SICUYPFQG2YYQN2VTBDVG5EBS7Q4AFKAMMZIRR77CE6WHRF6`), funded via
friendbot. Network: Test SDF Network ; September 2015.

| Component | Upload transaction |
|---|---|
| Smart wallet | `ceb4ed26734d4e16344ddc713fe19f1a1c8cd814fcddca56d685f64fb0ae70ba` |
| Sample policy | `2f36077bc6faf9bc8df1c58bfc1ee4c55079c762844e998da92ee4fd75ab094c` |
| Example contract | `9d4da6b0992de465154ffea9dca3ea3e72948b0f706ec7e5a7f920dc4ddb2de7` (unchanged since A3) |

### Live smoke

A wallet instance was deployed from the FINAL smart-wallet WASM with an
Ed25519 constructor signer (tx
`4a9ff09bfad96cf5398bbac973714690b5d4915c332292dc67c173fd332ad95a`):

- Instance: `CCK7VZBYMIIL7VBSEIORYQ4BTBZCKDKPNHPTYKQCRW4JO7L2IFW3X6WA`
- `get_signer({"Ed25519": <deployer raw pubkey>})` returned
  `{"Ed25519":[[null],[null]]}` — the constructor-stored signer, unlimited,
  no expiration.

### Verification

Every uploaded WASM was fetched back by hash
(`stellar contract fetch --wasm-hash <hash> --network testnet`) and
re-hashed with `shasum -a 256`. All three fetched hashes matched the local
artifacts byte-for-byte.

## Mainnet

Not deployed. Mainnet upload is an orchestrator-gated endgame step and will
be recorded in a follow-up manifest after the audit gate passes.

## Deterministic wallet address derivation (NORMATIVE)

Every passkey-kit wallet address is derived from the WebAuthn credential id
(`keyId`) alone — both indexer backends and `connectWallet` reverse lookup
depend on this exact tuple. **None of these inputs may ever change:**

```text
contractId = sha256(XDR(HashIdPreimage::EnvelopeTypeContractId {
    networkId:  sha256(network passphrase),
    contractIdPreimage: ContractIdPreimageFromAddress {
        address: G-address of the canonical deployer keypair,
        salt:    sha256(keyId),
    },
}))
```

- Canonical deployer keypair: `Keypair.fromRawEd25519Seed(sha256(utf8("kalepail")))`
  → `GC2C7AWLS2FMFTQAHW3IBUB4ZXVP4E37XNLEF2IK7IVXBB6CMEPCSXFO`.
  The SDK exposes a `deploySource` override, but the default MUST remain this
  keypair or previously created wallets become unreachable by derivation.
- The WASM hash is deliberately NOT part of the preimage: contract upgrades
  do not move wallet addresses, and the same `keyId` derives the same address
  across contract versions.
- **Security consequence (audit F7)**: because the deployer is public and the
  executable is not bound by the preimage, anyone who learns a `keyId` can
  front-run the derived address with arbitrary code. Clients MUST verify
  ownership before trusting a derived or reverse-looked-up address:
  1. the `keyId` is an actual stored signer (`get_signer` returns a value), and
  2. (recommended) the instance executable hash is on the known-hash list
     from this manifest (or its legacy predecessor below).

## Legacy (pre-1.0) build

The pre-overhaul contract (soroban-sdk 23, `sw_v1` tuple events, errors 1-9,
ledger-sequence expirations) has canonical WASM hash:

```text
e45c42b944a767bd5f37f8c4a469b48917d28e23481dbfd550419c84cdacde92
```

Wallets deployed from it remain live on both networks and derive from the
SAME derivation tuple above (the tuple predates v1 and is unchanged). v1 is
forward-only: no compatibility shims exist, and legacy wallets interact only
with legacy tooling — but a legacy wallet can be upgraded in place to a v1
hash via its own auth (`update_contract_code` on legacy, `upgrade` from then
on), keeping its address.
