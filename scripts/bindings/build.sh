#!/usr/bin/env bash
#
# Regenerate the passkey-kit-sdk bindings from the canonical smart-wallet WASM.
#
# The canonical hash is THE source of truth (docs/deployments-testnet-*.md). The
# WASM is fetched by hash from testnet, bindings are generated to a temp dir with
# the pinned Stellar CLI, and only the generated `src/index.ts` (+ README) are
# copied into the package — the B1 packaging (package.json, tsconfig, dist build)
# is preserved. NEVER hand-edit the generated bindings; add post-gen steps here.
#
# Usage: bash scripts/bindings/build.sh
set -euo pipefail

# Canonical smart-wallet WASM hash — keep in sync with the deployments manifest
# (docs/deployments-testnet-2026-07-11.md). Pinned Stellar CLI: 27.0.0.
CANONICAL_HASH="fdefad64b96837147e1c333e51f537b696eab925e9f147e63d597c04e3c903f0"
NETWORK="testnet"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_SRC="$ROOT/packages/passkey-kit-sdk/src/index.ts"
PKG_README="$ROOT/packages/passkey-kit-sdk/README.md"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Fetching canonical WASM ${CANONICAL_HASH} from ${NETWORK}…"
stellar contract fetch --wasm-hash "$CANONICAL_HASH" --network "$NETWORK" \
  --out-file "$TMP/smart-wallet.wasm"

ACTUAL="$(shasum -a 256 "$TMP/smart-wallet.wasm" | awk '{print $1}')"
if [ "$ACTUAL" != "$CANONICAL_HASH" ]; then
  echo "✗ Fetched WASM hash ($ACTUAL) != canonical ($CANONICAL_HASH)" >&2
  exit 1
fi

echo "Generating TypeScript bindings…"
# The CLI derives the generated README's package name from the output-dir
# basename; keep it "pks-gen" so the released README name stays stable across
# regens (verify.sh compares only the name-independent spec base64).
stellar contract bindings typescript --wasm "$TMP/smart-wallet.wasm" \
  --overwrite --output-dir "$TMP/pks-gen" >/dev/null

echo "Applying post-gen patches (copy generated spec, preserve packaging)…"
cp "$TMP/pks-gen/src/index.ts" "$PKG_SRC"
cp "$TMP/pks-gen/README.md" "$PKG_README"

echo "✓ Regenerated passkey-kit-sdk from canonical WASM ${CANONICAL_HASH}"
echo "  Run 'pnpm --filter passkey-kit-sdk run build' to rebuild dist."
