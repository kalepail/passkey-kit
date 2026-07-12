#!/usr/bin/env bash
#
# Bindings drift guard.
#
# Proves the committed passkey-kit-sdk bindings match the canonical smart-wallet
# WASM: fetch the WASM by its pinned hash, regenerate to a temp dir, and diff the
# ContractSpec base64 array (the semantic content — CLI formatting/comments are
# ignored) against the committed bindings. Fails the build/release on drift.
#
# Usage: bash scripts/bindings/verify.sh
set -euo pipefail

CANONICAL_HASH="9e7fad441d6560b31eafbf3b627dbc196cf19df4dcdb91e0aededaf6590d6fbe"
NETWORK="testnet"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG_SRC="$ROOT/packages/passkey-kit-sdk/src/index.ts"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "verify:bindings — canonical WASM ${CANONICAL_HASH} (${NETWORK})"

stellar contract fetch --wasm-hash "$CANONICAL_HASH" --network "$NETWORK" \
  --out-file "$TMP/smart-wallet.wasm"

ACTUAL="$(shasum -a 256 "$TMP/smart-wallet.wasm" | awk '{print $1}')"
if [ "$ACTUAL" != "$CANONICAL_HASH" ]; then
  echo "✗ Fetched WASM hash ($ACTUAL) != canonical ($CANONICAL_HASH)" >&2
  exit 1
fi

stellar contract bindings typescript --wasm "$TMP/smart-wallet.wasm" \
  --overwrite --output-dir "$TMP/gen" >/dev/null

# Extract the ContractSpec base64 string literals (>= 16 chars, base64 charset),
# in order. This is the wasm-determined spec, independent of CLI TS formatting.
extract_spec() {
  grep -oE '"[A-Za-z0-9+/]{16,}={0,2}"' "$1"
}

if diff -u \
  <(extract_spec "$PKG_SRC") \
  <(extract_spec "$TMP/gen/src/index.ts"); then
  echo "✓ Committed bindings match canonical WASM ${CANONICAL_HASH}"
else
  echo "" >&2
  echo "✗ Bindings DRIFT from the canonical WASM." >&2
  echo "  Regenerate with: bash scripts/bindings/build.sh" >&2
  echo "  (then rebuild + review the diff before committing)" >&2
  exit 1
fi
