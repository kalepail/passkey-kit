# passkey-kit ground-up overhaul — mission prompt

Do a full and comprehensive audit and then a complete, forward-only rework of this entire repository — contracts, SDK, bindings, indexing, demo, and docs. This is the passkey-kit equivalent of the smart-account-kit v0.4.0 OZ-parity overhaul we ran on 2026-07-10 (Solo project 34; transcripts in `~/.claude/projects/-Users-kalepail-Desktop-Web-Soroban-OpenZeppelin-smart-account-kit/`). Use that repo and that session's playbook as inspiration and guidance — but this repo has its OWN smart account contract, which raises the bar on contract correctness (see the audit gate below).

Treat nothing as precious. Absolutely NO backwards compatibility. All work is forward-only, ground-up redesign as/if needed. Every line of code must earn its keep.

## Reference material

- Sibling repo (inspiration, not a dependency): `/Users/kalepail/Desktop/Web/Soroban/OpenZeppelin/smart-account-kit` — study its typed error model (ContractError registry, discriminated TransactionResult), signer abstractions (PasskeySigner/Ed25519Signer/DelegatedSigner), typed policy clients, client-side limit validation, bindings verify pipeline (`verify:bindings`), e2e scripts (`scripts/browser-full-e2e-audit.sh`, `scripts/testnet-passkey-smoke.sh`, `scripts/agent-browser-webauthn-helper.mjs`), `docs/migration-v0.4.0.md`, and CHANGELOG discipline.
- Live passkey testing: the agent-browser CLI + the agent-browser-webauthn skill — https://github.com/kalepail/skills/blob/main/skills/agent-browser-webauthn/SKILL.md
- OZ Relayer docs: https://docs.openzeppelin.com/relayer/1.5.x/guides/stellar-channels-guide, https://docs.openzeppelin.com/relayer/stellar, https://docs.openzeppelin.com/relayer/1.5.x/guides/stellar-sponsored-transactions-guide
- Stellar Indexer: https://stellarindexer.com/ — API at `https://api.stellarindexer.com` (OpenAPI: `/openapi-doc`), JS SDK `@stellar-indexer/stellar-indexer-sdk` (JSR, Creit Tech). One live endpoint: `POST /v1/contract-data/` (1–25 contract IDs per call, key/val JSON predicates, temporary + persistent durability, tombstoned `deleted_at` entries, Bearer JWT auth).
- Use perplexity MCP and parallel MCP/CLI for research as needed while you work.

## Service architecture (get this right from the start)

These are distinct concerns — do not conflate them:

- **Relayer (OZ) = transaction submission** (fee sponsorship via the channels plugin, `@openzeppelin/relayer-plugin-channels`, already a dependency). Launchtube is fully legacy — purge every remaining reference. Actually VERIFY the Relayer works, on both testnet and mainnet — you can generate and use API keys for that service (see the OZ guides above). Do not claim relayer coverage from unit tests alone.
- **Mercury = indexer** (the `zephyr/` program is Mercury's Zephyr framework). JWTs are in the repo-root `.env` as `MERCURY_TESTNET_JWT` / `MERCURY_MAINNET_JWT`.
- **Stellar Indexer = second indexer backend** (generic contract-data indexer, closed beta). Access token in root `.env` as `STELLAR_INDEXER_ACCESS_TOKEN`.

Secrets rule: use the `.env` values via shell substitution only — NEVER print, log, commit, or paste token values into terminal output, todo comments, or scratchpads. If a token is missing, a service is down, or RPC breaks, ask the user and keep going on other work — don't guess or stall.

## Scope of the rework

**1. Contracts (`contracts/smart-wallet`, `smart-wallet-interface`, `sample-policy`, `example-contract`) — very careful.**
This is a wallet that holds real funds; correctness is non-negotiable. Update to current soroban-sdk / Protocol 27+, rework deliberately: storage layout, signer model (secp256r1 passkeys, ed25519, policy signers), auth/`__check_auth` semantics, WebAuthn verification (`verify.rs`, `base64_url.rs`), event schema designed hand-in-glove with the indexers (the `sw_v1` topic scheme is renegotiable — design events FOR indexing), upgradeability story made explicit, and the factory/deploy path (deterministic contract IDs derived from the passkey keyId — preserve that property; the indexer designs depend on it). Deployed legacy wallets are legacy: no compat shims, but record the canonical WASM hashes and deployment story in docs.

**2. SDK (`src/`: base.ts, kit.ts, sac.ts, server.ts, types.ts).**
Ground-up rework against `@stellar/stellar-sdk` v16 (move off the rc as stable allows). Pull the SDK in WELL: audit every place we hand-roll something the stellar-sdk already provides (preimage building, nonce generation, ScVal handling, assembled-transaction plumbing) and use the SDK instead — don't rewrite what it ships. Adopt the smart-account-kit patterns that earned their keep: typed errors + contract-error decoding, discriminated success/failure results, a unified signing pipeline, client-side validation of contract limits, clean separation of client (`PasskeyKit`) vs server (`PasskeyServer`) concerns. Kill the checked-in `types/` dir if the build should generate it. Evaluate whether `sac.ts`/`sac-sdk` still earn their keep.

**3. Bindings (`packages/passkey-kit-sdk`, `packages/sac-sdk`).**
Regenerate from the final canonical WASM builds; add a drift guard (a `verify:bindings`-style script) so published bindings provably match the deployed contract hash.

**4. Indexing — Mercury AND Stellar Indexer, both correct, both verified.**
Design one indexer abstraction in the SDK with two interchangeable backends:
- Mercury: rewrite the `zephyr/` program against the reworked contract's events/storage; ensure add/update/remove signer flows index correctly, including reverse lookup (keyId → wallet) and full signer enumeration.
- Stellar Indexer: implement a backend over `POST /v1/contract-data/` using key/val predicates against the wallet's storage entries (contract IDs are derivable from keyId, so the 25-contract-per-call cap is workable; note tombstoned entries let you see removed signers).
Verify BOTH end-to-end on testnet with live data — a signer added through the demo must be discoverable through each backend, asserted against real responses, before either is called done.

**5. Demo (`demo/`, Svelte).**
Rebuild on the new API so it exercises EVERY feature: passkey create/connect, ed25519 + policy signers, add/update/remove signers, transfers, SAC interactions, Relayer-sponsored submission for all transactions, and signer discovery via the indexer backends. Modernize the stack as warranted (Svelte 5 / current Vite). Deploy it live (`wrangler pages deploy` is already wired), and once live, add the demo URL to the GitHub repo description.

**6. Cleanup — evaluate carefully, then cut.**
Candidates: `cheatsheet.txt`, `PROPOSAL.md`, `.cursorrules`, `clone-js-sdk.sh`, `.wrangler/`, `.DS_Store`, checked-in `types/`, the numbered `bun_tests/` (fold what's valuable into a real test suite), stale Launchtube references, `contracts/out` artifacts. For each: carefully evaluate whether it's actually worth dropping before doing so — cruft dies, load-bearing stays. Delete this TOPROMPT.md at the end too.

**7. Tests and docs.**
Excellent, detailed tests for full coverage: Rust unit + integration tests for the contracts (auth test vectors for WebAuthn verification and signature payloads; fuzz/property tests where they pay), TypeScript tests for the SDK (a real runner replacing the ad-hoc bun scripts), e2e scripts for the live flows. Improve and maintain docs as you go: rewritten README verified against the ACTUAL final API (no aspirational docs), CHANGELOG, and a migration guide (old → new) with an explicit A/B gap analysis — anything the old version had that the new one doesn't but should? All good, clean, and fully featured?

## Methodology and model allocation

- Plan in Fable (this session orchestrates). Make the plan here, then execute with Solo subagents.
- Do most of the coding/work in Fable and Opus subagents (Solo `spawn_agent`; use `solo help` progressively and iteratively to manage the work).
- Reserve **gpt-5.6-sol and terra** for review, assurance, and independent adversarial review — especially the contract audit gate below. They review; they don't author.
- Solo protocol (proven last time): canonical specs + master plan in scratchpads (locked design decisions subagents must follow); todos tagged per wave with bodies as full specs; agents own explicit path scopes that never overlap; commits under a `git-ops` lock staging ONLY owned paths (never `git add -A`); tests+build green before every commit — never commit red; orchestrator check-in timers watching for idle/stalled agents; `/clear` + re-brief agents whose context balloons.
- Git: current branch is `codex/protocol-27-auth-prep` (uncommitted version-bump changes) with default branch `next` — reconcile that state first, then do the overhaul on one dedicated branch. Never push/publish/deploy from subagents; the orchestrator gates all outward-facing steps.

## Contract audit gate (hard requirement)

The reworked contracts do not ship until they pass independent audits by BOTH Fable and gpt-5.6-sol — full audits covering auth semantics, signature verification, storage/TTL handling, policy-signer limits, upgrade paths, and event correctness — plus adversarial review from terra. Each auditor works independently against the frozen contract source + spec scratchpad, files findings as todos, and every confirmed finding gets fixed and re-verified by the finder. Add the code-review skill at high effort over the full branch diff as the final static gate. Guarantee correctness; don't assert it.

## Verification (before anything ships)

1. Static: full test suite + all builds green (SDK, bindings, contracts, zephyr, demo).
2. Live browser passkey e2e on testnet using agent-browser + the WebAuthn skill: create → reconnect → add/remove signers → Relayer-sponsored transfer → indexer discovery through BOTH backends. Assert REAL outputs — `C...` contract IDs, tx hashes, explicit errors. Never treat a click as success. Fresh agent-browser sessions per run; close sessions when done — do not leave fleets of idle Chrome-for-Testing processes.
3. Verify against the CANONICAL contract build — pin and cross-check the WASM hash in every env/config so no stale-hash drift invalidates the evidence (this bit us last time).
4. Relayer verified live on testnet and mainnet; Mercury and Stellar Indexer verified live with keys from `.env`.

## Endgame (in order, orchestrator-led)

1. CHANGELOG + migration guide + README finalized; A/B gap analysis written up.
2. `/secret-scanning`, then `/security-review`; fix anything found.
3. Consolidate: all branches closed back to a single default branch, no worktrees, stashes, stale PRs, or leftover branches locally or remotely; close any GitHub issues the overhaul resolves.
4. Publish to npm — propose the version bump (0.13.0 vs 1.0.0) and ask for the OTP when ready. Never publish without it.
5. Deploy the demo live; add the live URL to the repo description.
6. Process hygiene: close idle subagents and browser sessions, archive completed Solo scratchpads/todos, delete TOPROMPT.md.

As or if you have any questions, ask. Otherwise: plan, brief me on the plan, and go.
