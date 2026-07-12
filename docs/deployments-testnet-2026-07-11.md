# passkey-kit v1 contract build + testnet deployment — 2026-07-11

This manifest is THE canonical hash source for the passkey-kit v1 contract
set. The Makefile, SDK configuration, `verify:bindings` drift guard, and the
zephyr (Mercury) ingestion allowlist must all consume the hashes recorded
here — never a locally rebuilt hash.

> **Status: pre-audit-gate.** These artifacts were built after the A1/A2
> contract rework and test suite, but before the independent 3-way audit
> (Fable + gpt-5.6-sol + terra adversarial review). Any audit-driven contract
> change re-pins this manifest; the table below is superseded by a newer
> `docs/deployments-*.md` if one exists.

## Build provenance

- Repo commit: `ff7bd227a30db8c0613a46ccebccc8d81f94ef04` (branch `overhaul/ground-up`)
- Rust/Cargo: `1.94.0` (pinned in `contracts/rust-toolchain.toml`)
- `soroban-sdk`: `27.0.0` (`e5cb4b52c3da8e56fc48adfd7b85d85976c1a059`)
- Stellar CLI: `27.0.0` (`5a7c5fe76530bf4248477ac812fc757146b98cc4`)
- Build target: `wasm32v1-none`
- Build command: `stellar contract build --locked --package <package> --out-dir out`
  (optimization is on by default in CLI 27; `out/<package>.wasm` is the final artifact)
- Contract meta: `binver: 1.0.0`

Note: the wasm hash is sensitive to source line numbers (panic `Location`
data is embedded), so only builds from the exact commit above reproduce these
hashes. Reproducibility was verified by rebuilding from a clean `out/`.

| Component | Cargo package | Bytes | SHA-256 / network WASM hash |
|---|---|---:|---|
| Smart wallet | `smart-wallet` | 29,183 | `9e7fad441d6560b31eafbf3b627dbc196cf19df4dcdb91e0aededaf6590d6fbe` |
| Sample policy | `sample-policy` | 10,144 | `e6d0038301764191467ff245de4f95645cbd626d36f0598317f734ad73c164f6` |
| Example contract | `example-contract` | 1,047 | `47a3326360bdce2ca360ed1b226ad636e14ac698f63efc11ab28e0d41f1f76aa` |

The smart wallet WASM is uploaded but never deployed as a singleton: every
user wallet deploys its own instance with a `Signer` constructor argument.
The sample policy demonstrates the v1 policy lifecycle
(`install`/`uninstall`/`policy__`). The example contract is a test fixture
(deploy-path and multi-transfer auth exercises); it is uploaded for
completeness but nothing depends on it.

## Testnet

Upload source: `passkey-kit-deployer`
(`GBUOCX45SICUYPFQG2YYQN2VTBDVG5EBS7Q4AFKAMMZIRR77CE6WHRF6`), funded via
friendbot. Network: Test SDF Network ; September 2015.

| Component | Upload transaction |
|---|---|
| Smart wallet | `f0ef240c4ce44d9271318abe367b3ebea9578966df0370d338b2d557d0efd916` |
| Sample policy | `2a1ebc27b98eef868d7415ce281f930d94ac535a8df4957e6146cf6e06a27fa4` |
| Example contract | `9d4da6b0992de465154ffea9dca3ea3e72948b0f706ec7e5a7f920dc4ddb2de7` |

### Live smoke

A wallet instance was deployed from the uploaded WASM with an Ed25519
constructor signer (tx
`5f4ef8114835f64c3b2e2125034190109ab29c6375435f12ceaedc8cb4808670`):

- Instance: `CCHSQWC5BDRAPL4JGGKHUNHNY2QD2JZCDV6QNC34HIBACQAYKRB6IX4N`
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
