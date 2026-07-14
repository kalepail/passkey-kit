# passkey-kit v1 contract build + testnet deployment — 2026-07-11 (re-pinned 2026-07-13)

This manifest is THE canonical hash source for the passkey-kit v1 contract
set. The Makefile, SDK configuration, `verify:bindings` drift guard, and
Mercury's hosted passkey-indexer ingestion allowlist must all consume the
hashes recorded here — never a locally rebuilt hash.

> **Status: re-pinned 2026-07-13 (FINAL for testnet).** These are the v1
> contracts including the follow-up hardening pass (last-admin guard +
> error 103; durable last-signer guard + error 104 — a Persistent,
> non-expiring signer always exists, enforced at construction, removal,
> and demotion; policy-invocation ordering; policy self-removal handling;
> authenticatorData size cap + error 126). The hashes below supersede the
> 2026-07-11 values (smart-wallet `84924c53…`, sample-policy `e74af535…`),
> which in turn superseded the earlier interim values (smart-wallet
> `9e7fad44…`, sample-policy `e6d00383…`). A further contract change would
> re-pin this manifest again.

## Build provenance

- Repo commit: the v1 hardening integration commit (stamped at commit
  time; working-tree build verified reproducible — two clean builds →
  identical hashes). Previous pin: `0563520` (branch `overhaul/ground-up`,
  contract set `067f807..0563520`).
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
| Smart wallet | `smart-wallet` | 34,105 | `fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0` |
| Sample policy | `sample-policy` | 13,844 | `801b68fabf9f8746b10bfbc6d3da1b41462db0a38364ab8139d32dec3676ef39` |
| Example contract | `example-contract` | 1,047 | `47a3326360bdce2ca360ed1b226ad636e14ac698f63efc11ab28e0d41f1f76aa` |

The smart wallet WASM is uploaded but never deployed as a singleton: every
user wallet deploys its own instance with a `Signer` constructor argument.
The sample policy demonstrates the v1 policy lifecycle
(`install`/`uninstall`/`policy__`) as a cumulative rolling-window spending
allowance. The example contract is a test fixture (deploy-path and
multi-transfer auth exercises); it is uploaded for completeness but nothing
depends on it. The example-contract WASM is byte-identical to the previous
build (its source was untouched), so its hash and upload are unchanged.

## Testnet

Upload source (2026-07-13 re-pin): `rich`
(`GD2GA2JF6OJURU36COZQWJLPEJ7XC3GB25TBD7U4ALCGKOG27262RICH`).
Network: Test SDF Network ; September 2015.

| Component | Upload transaction |
|---|---|
| Smart wallet | `3507c407bc3c6f7b6d5fc303f09228a4539a7737bad004fee9a2981b7cbb65af` |
| Sample policy | `6e33f0d7c8ce8b0b1dd1c08fbb9809ded1ac839dc1c7ac3ce5d1147bffe6d123` |
| Example contract | `9d4da6b0992de465154ffea9dca3ea3e72948b0f706ec7e5a7f920dc4ddb2de7` (byte-identical, unchanged since A3) |

### Live smoke

A wallet instance was deployed from the re-pinned smart-wallet WASM with an
Ed25519 constructor signer (`rich`'s raw public key, unlimited/persistent):

- Instance: `CCYQXFQIXV6FOLAA4ITLFTBSWZCKC5IZC2BJWCWN2MZGF5ZPACSMZSUS`
- Live `get_signer` returned the constructor-stored signer, unlimited,
  no expiration.
- Live negative check: deploying with a Temporary first signer fails
  on-chain with `Error(Contract, #104)` (durable-first-signer constructor
  guard).

Previous smoke instances remain live on superseded executables:
`CCK7VZBYMIIL7VBSEIORYQ4BTBZCKDKPNHPTYKQCRW4JO7L2IFW3X6WA` (2026-07-11,
`84924c53…`), `CBN64UHGLAKHA4KMW3ISKVZCSGTM6WVCO6XWWC2774UUWE3WFT2WWDEH`
(interim build `163028ad…`),
`CB5MG5YXWPJ7UB7FZWDRSFQAT6J67NNS2KJDVAFUX6GP4OM7JRQRU3ZX` (interim
post-review respin `fe806979…`), and
`CAS6FA6KZNLO5HGGVQC4LHRUCDLTPG23QOPWNRE7FX2GRZT5DR2AFOSO` (interim
terminal-backstop build `ebbac41f…`). All interim builds were superseded
same-day — never pin those hashes.

### Verification

Every uploaded WASM was fetched back by hash
(`stellar contract fetch --wasm-hash <hash> --network testnet`) and
re-hashed with `shasum -a 256`. All three fetched hashes matched the local
artifacts byte-for-byte.

## Mainnet

Not deployed. A mainnet upload will be recorded in a follow-up manifest.

## Deterministic wallet address derivation (NORMATIVE)

Every passkey-kit wallet address is derived from the WebAuthn credential id
(`keyId`) alone — the Mercury indexer and `connectWallet` reverse lookup
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
- **Security consequence**: because the deployer is public and the
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
