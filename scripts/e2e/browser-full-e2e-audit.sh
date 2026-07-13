#!/usr/bin/env bash

# Full browser e2e audit for the passkey-kit demo.
#
# Drives the real Svelte demo through the passkey-kit flow and asserts REAL
# outputs (a C… contract id, 64-hex tx hashes, explicit failure patterns on every
# wait). Uses Svelte `data-testid` selectors — no React native-setter shims.
#
# Runs inside testnet-passkey-smoke.sh (a live agent-browser session with a
# virtual WebAuthn authenticator). Layers gate automatically: if the demo header
# shows "no relayer proxy" the on-chain layers are skipped (explicitly, never a
# silent pass); discovery is skipped when "no indexer" is shown (network with no
# hosted passkey-indexer).
#
# Distinct exit code per layer:
#   10 setup   20 create   21 reconnect   30 fund   31 transfer
#   40 add-secp 41 add-ed25519 42 add-policy 43 update 44 per-signer-transfer 45 remove
#   50 discover   51 reverse-lookup

set -euo pipefail

SESSION_NAME="${SESSION_NAME:?SESSION_NAME is required}"
DEMO_URL="${DEMO_URL:-http://127.0.0.1:5173}"
SKIP_ONCHAIN="${SKIP_ONCHAIN:-auto}"
# Destination for the primary transfer; falls back to the demo's own funding
# address (always exists) via the "use fund addr" control when unset.
RECIPIENT_ADDRESS="${RECIPIENT_ADDRESS:-}"

ab() { agent-browser --session "$SESSION_NAME" "$@"; }

CURRENT_LAYER="setup"
CURRENT_CODE=10
layer() {
  CURRENT_LAYER="$1"
  CURRENT_CODE="$2"
  echo "── [$CURRENT_CODE] $CURRENT_LAYER ────────────────────────────────"
}
fail() {
  echo "FAIL [$CURRENT_CODE] $CURRENT_LAYER: $1" >&2
  echo "---- log-box ----" >&2
  log_box >&2 || true
  exit "$CURRENT_CODE"
}

log_box() { ab get text '[data-testid="log-box"]' 2>/dev/null || true; }
header_text() { ab get text '[data-testid="header"]' 2>/dev/null || true; }
body_text() { ab get text body 2>/dev/null || true; }
contract_id() { ab get text '[data-testid="wallet-contract-id"]' 2>/dev/null | tr -d '[:space:]'; }
# querySelector returns the FIRST (newest, list is prepended) tx-hash → deterministic.
latest_hash() {
  ab eval 'document.querySelector("[data-testid=\"tx-hash\"]")?.dataset.hash ?? ""' 2>/dev/null | tr -d '[:space:]"'
}
log_line_count() { printf '%s\n' "$(log_box)" | wc -l | tr -d ' '; }

# Wait for a NEW log entry (newest-first) matching success/failure since a prior
# line count. Returns 0 success, 2 failure-pattern, 1 timeout.
wait_new_log() {
  local previous_count="$1" success="$2" failure="$3" attempts="${4:-60}"
  for _ in $(seq 1 "$attempts"); do
    local all total new_count slice
    all="$(log_box)"
    total="$(printf '%s\n' "$all" | wc -l | tr -d ' ')"
    new_count=$(( total - previous_count ))
    if (( new_count > 0 )); then
      slice="$(printf '%s\n' "$all" | head -n "$new_count")"
    else
      slice=""
    fi
    if [[ -n "$failure" ]] && printf '%s\n' "$slice" | grep -Eq "$failure"; then
      return 2
    fi
    if printf '%s\n' "$slice" | grep -Eq "$success"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# Click a testid; fail the layer if the element is missing.
click_tid() {
  ab click "[data-testid=\"$1\"]" >/dev/null 2>&1 || fail "missing/again unclickable: $1"
}
fill_tid() {
  ab fill "[data-testid=\"$1\"]" "$2" >/dev/null 2>&1 || fail "missing input: $1"
}
has_tid() { [[ "$(ab get count "[data-testid=\"$1\"]" 2>/dev/null | tr -d '[:space:]')" != "0" ]]; }

# Wait until a control is present AND enabled. Flows set `app.busy` for their
# whole duration (disabling action buttons), and `createWallet` keeps busy set
# through its trailing auto-fund AFTER the "Wallet created" log — so a layer that
# acts on the "created" log alone can click a still-disabled button (a no-op).
wait_enabled() {
  local tid="$1" attempts="${2:-90}"
  for _ in $(seq 1 "$attempts"); do
    if [[ "$(ab eval "document.querySelector('[data-testid=\"$tid\"]')?.disabled === false" 2>/dev/null | tr -d '[:space:]"')" == "true" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Best-effort "let the previous flow settle" gate. Every action button is
# `disabled={app.busy}`, and a flow can keep busy set for a moment AFTER its
# success log (e.g. a trailing balance refresh) — so the next layer, clicking
# immediately, would hit a still-disabled button (a silent no-op → timeout).
# Gates on the always-present `disconnect` button; a no-op while disconnected
# (button absent, e.g. the create layer). Never hard-fails — the action's own
# wait catches a genuine stall.
wait_idle() {
  for _ in $(seq 1 "${1:-90}"); do
    local s
    s="$(ab eval '(()=>{const b=document.querySelector("[data-testid=\"disconnect\"]");return b?(b.disabled?"busy":"idle"):"absent";})()' 2>/dev/null | tr -d '[:space:]"')"
    [[ "$s" == "idle" || "$s" == "absent" ]] && return 0
    sleep 1
  done
  return 0
}

# Run one write layer: capture the log count, run the click closure, wait.
expect_after() {
  local success="$1" failure="$2" attempts="${3:-90}"; shift 3
  wait_idle
  local before; before="$(log_line_count)"
  "$@"
  case "$(wait_new_log "$before" "$success" "$failure" "$attempts"; echo $?)" in
    0) echo "  ✓ $success" ;;
    2) fail "hit failure pattern ($failure)" ;;
    *) fail "timed out waiting for: $success" ;;
  esac
}

########################################################################
layer "setup" 10
echo "Opening $DEMO_URL"
ab open "$DEMO_URL" >/dev/null || fail "could not open demo"
sleep 2
# The demo must have mounted (header rendered). A blank body means the module
# crashed — usually a missing demo/.env.local (copy demo/.env.example).
if ! printf '%s\n' "$(body_text)" | grep -q "Passkey Kit"; then
  fail "demo did not render — configure demo/.env.local (copy demo/.env.example)"
fi
HEADER="$(header_text)"
echo "  header: $HEADER"

ONCHAIN=1
case "$SKIP_ONCHAIN" in
  1|true|yes) ONCHAIN=0 ;;
  0|false|no) ONCHAIN=1 ;;
  *) printf '%s\n' "$HEADER" | grep -q "no relayer proxy" && ONCHAIN=0 ;;
esac
INDEXER=1
printf '%s\n' "$HEADER" | grep -q "no indexer" && INDEXER=0

if (( ONCHAIN == 0 )); then
  echo
  echo "on-chain layers SKIPPED: relayer proxy not configured."
  echo "Set VITE_relayerProxyUrl in demo/.env.local (and start the relayer-proxy"
  echo "worker) to run create → transfer → signer → discovery live (F2)."
  # Still assert the disconnected UI is wired.
  has_tid "register" || fail "register control missing on disconnected UI"
  echo "Disconnected UI wired (register control present). Static UI audit passed."
  exit 0
fi

########################################################################
layer "create" 20
USER_NAME="audit$(date +%s)"
echo "Creating wallet for $USER_NAME"
fill_tid "register-name" "$USER_NAME"
expect_after "Wallet created" "Create wallet failed|Deploy wallet failed" 150 click_tid "register"
CONTRACT_ID="$(contract_id)"
printf '%s\n' "$CONTRACT_ID" | grep -Eq '^C[A-Z2-7]{55}$' || fail "no valid contract id (got: '$CONTRACT_ID')"
echo "  contract: $CONTRACT_ID"
CREATE_HASH="$(latest_hash)"
printf '%s\n' "$CREATE_HASH" | grep -Eq '^[0-9a-f]{64}$' || fail "no valid deploy tx hash (got: '$CREATE_HASH')"
echo "  deploy tx: $CREATE_HASH"

########################################################################
layer "reconnect" 21
echo "Disconnect + reconnect via discoverable passkey"
# createWallet stays busy through its auto-fund; wait for that to settle so the
# disconnect button is actually enabled before we click it.
wait_enabled "disconnect" 90 || fail "disconnect never became enabled (create auto-fund still running?)"
click_tid "disconnect"
sleep 1
has_tid "signin" || fail "signin control missing after disconnect"
expect_after "Connected — ownership verified" "Connect wallet failed" 120 click_tid "signin"
RECONNECT_ID="$(contract_id)"
[[ "$RECONNECT_ID" == "$CONTRACT_ID" ]] || fail "reconnected to a different wallet ($RECONNECT_ID != $CONTRACT_ID)"
echo "  reconnected to $RECONNECT_ID (ownership verified)"

########################################################################
layer "fund" 30
echo "Funding wallet"
expect_after "Fund wallet ✓" "Fund wallet failed|Create wallet failed" 150 click_tid "fund-wallet"

########################################################################
layer "transfer" 31
echo "Primary transfer (signed by passkey)"
click_tid "use-fund-addr"
sleep 1
[[ -n "$RECIPIENT_ADDRESS" ]] && fill_tid "transfer-to" "$RECIPIENT_ADDRESS"
fill_tid "transfer-amount" "1"
expect_after "Transfer \(passkey\) ✓" "Transfer \(passkey\) failed" 150 click_tid "transfer-send"
TRANSFER_HASH="$(latest_hash)"
printf '%s\n' "$TRANSFER_HASH" | grep -Eq '^[0-9a-f]{64}$' || fail "no valid transfer tx hash"
echo "  transfer tx: $TRANSFER_HASH"

########################################################################
layer "add-secp" 40
echo "Add secp256r1 passkey signer"
click_tid "add-kind-Secp256r1"
fill_tid "add-signer-name" "session-$(date +%s)"
expect_after "Add passkey signer ✓" "Add passkey signer failed" 150 click_tid "add-signer-submit"

########################################################################
layer "add-ed25519" 41
echo "Add Ed25519 signer"
click_tid "add-kind-Ed25519"
expect_after "Add Ed25519 signer ✓" "Add Ed25519 signer failed" 150 click_tid "add-signer-submit"

########################################################################
layer "add-policy" 42
POLICY_ENABLED="$(ab eval 'document.querySelector("[data-testid=\"add-kind-Policy\"]")?.disabled === false' 2>/dev/null | tr -d '[:space:]')"
if [[ "$POLICY_ENABLED" == "true" ]]; then
  echo "Add policy signer"
  click_tid "add-kind-Policy"
  expect_after "Add policy signer ✓" "Add policy signer failed" 150 click_tid "add-signer-submit"
else
  echo "  SKIP: no VITE_samplePolicyId configured (policy-signer controls disabled)"
fi

########################################################################
layer "update" 43
echo "Update the Ed25519 signer (limits/store)"
ED_ROW='[data-testid="signer-row"][data-kind="Ed25519"]'
if [[ "$(ab get count "$ED_ROW" 2>/dev/null | tr -d '[:space:]')" != "0" ]]; then
  wait_idle
  ab click "$ED_ROW [data-testid=\"signer-update\"]" >/dev/null 2>&1 || fail "update control missing"
  sleep 1
  before="$(log_line_count)"
  ab click "$ED_ROW [data-testid=\"signer-update-save\"]" >/dev/null 2>&1 || fail "update-save missing"
  case "$(wait_new_log "$before" "Update Ed25519 signer ✓" "Update Ed25519 signer failed" 150; echo $?)" in
    0) echo "  ✓ Update Ed25519 signer ✓" ;;
    2) fail "update hit failure pattern" ;;
    *) fail "update timed out" ;;
  esac
else
  echo "  SKIP: no Ed25519 row present"
fi

########################################################################
layer "per-signer-transfer" 44
echo "Per-signer transfer via the Ed25519 signer row"
if [[ "$(ab get count "$ED_ROW" 2>/dev/null | tr -d '[:space:]')" != "0" ]]; then
  wait_idle
  before="$(log_line_count)"
  ab click "$ED_ROW [data-testid=\"signer-transfer\"]" >/dev/null 2>&1 || fail "per-signer transfer control missing"
  case "$(wait_new_log "$before" "Transfer via Ed25519 ✓" "Transfer via Ed25519 failed" 150; echo $?)" in
    0) echo "  ✓ Transfer via Ed25519 ✓" ;;
    2) fail "per-signer transfer hit failure pattern" ;;
    *) fail "per-signer transfer timed out" ;;
  esac
else
  echo "  SKIP: no Ed25519 row present"
fi

########################################################################
layer "remove" 45
echo "Remove the Ed25519 signer"
if [[ "$(ab get count "$ED_ROW" 2>/dev/null | tr -d '[:space:]')" != "0" ]]; then
  wait_idle
  before="$(log_line_count)"
  ab click "$ED_ROW [data-testid=\"signer-remove\"]" >/dev/null 2>&1 || fail "remove control missing"
  case "$(wait_new_log "$before" "Remove Ed25519 signer ✓" "Remove Ed25519 signer failed" 150; echo $?)" in
    0) echo "  ✓ Remove Ed25519 signer ✓" ;;
    2) fail "remove hit failure pattern" ;;
    *) fail "remove timed out" ;;
  esac
else
  echo "  SKIP: no Ed25519 row present"
fi

########################################################################
if (( INDEXER == 0 )); then
  echo
  echo "discovery layers SKIPPED: no hosted passkey-indexer for this network"
  echo "(Mercury covers testnet + mainnet; discovery is keyless — no proxy)."
  echo
  echo "On-chain audit passed for contract $CONTRACT_ID"
  exit 0
fi

# lookupWithRetry: the indexer lags the ledger, so poll until a signer shows up.
layer "discover" 50
echo "Discover signers via Mercury"
discover_ok=""
for _ in $(seq 1 20); do
  before="$(log_line_count)"
  ab click '[data-testid="discover"]' >/dev/null 2>&1 || fail "discover control missing"
  if wait_new_log "$before" "Discovered [1-9][0-9]* signer\(s\) via Mercury" "Discover failed" 6; then
    discover_ok=1
    break
  fi
  sleep 3
done
[[ -n "$discover_ok" ]] || fail "no signers discovered after retries"
[[ "$(ab get count '[data-testid="discovered-list"] .signer' 2>/dev/null | tr -d '[:space:]')" != "0" ]] \
  || fail "discovered list empty"
echo "  ✓ discovery returned signers"

layer "reverse-lookup" 51
echo "Reverse lookup keyId → wallet(s)"
before="$(log_line_count)"
click_tid "reverse-lookup"
case "$(wait_new_log "$before" "matches connected ✓|keyId → [1-9][0-9]* wallet" "Reverse lookup .* failed" 60; echo $?)" in
  0) echo "  ✓ reverse lookup resolved the wallet" ;;
  2) fail "reverse lookup hit failure pattern" ;;
  *) fail "reverse lookup timed out" ;;
esac

echo
echo "FULL e2e audit passed for contract $CONTRACT_ID"
echo "  deploy tx:   $CREATE_HASH"
echo "  transfer tx: $TRANSFER_HASH"
