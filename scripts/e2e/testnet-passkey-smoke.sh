#!/usr/bin/env bash

# Testnet smoke orchestration for the passkey-kit demo.
#
# - Starts the demo's Vite server (idempotently — an lsof guard skips the start
#   and the kill if something is already listening on the port).
# - Opens a fresh agent-browser session and attaches a virtual WebAuthn
#   authenticator (via agent-browser-webauthn-helper.mjs) for the child run.
# - EXIT trap kills ONLY the server this script started and closes ONLY this
#   script's agent-browser session — no orphaned Chrome-for-Testing.
#
# MODE selects the child: `audit` (default, full e2e) or `probe` (backend-free
# WebAuthn sanity). Demo config comes from demo/.env.local (copy .env.example).
# Ported from smart-account-kit (project 34); adapted to the single passkey-kit demo.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO_DIR="$ROOT_DIR/demo"

DEV_HOST="${DEV_HOST:-127.0.0.1}"
DEMO_PORT="${DEMO_PORT:-5173}"
DEMO_URL="${DEMO_URL:-http://${DEV_HOST}:${DEMO_PORT}}"
SESSION_NAME="${SESSION_NAME:-passkey-kit-smoke-$(date +%s)}"
MODE="${MODE:-audit}"
case "$MODE" in
  probe) E2E_CHILD="${E2E_CHILD:-$ROOT_DIR/scripts/e2e/webauthn-browser-probe.sh}" ;;
  audit) E2E_CHILD="${E2E_CHILD:-$ROOT_DIR/scripts/e2e/browser-full-e2e-audit.sh}" ;;
  *) E2E_CHILD="${E2E_CHILD:?unknown MODE (use probe|audit) and no E2E_CHILD override}" ;;
esac

DEMO_SERVER_PID=""

wait_for_url() {
  local url="$1"
  local attempts="${2:-60}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

start_demo_if_needed() {
  local log_path="/tmp/passkey-kit-demo-smoke.log"

  if lsof -nP -iTCP:"$DEMO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Demo already running on port $DEMO_PORT (leaving it running)"
    return 0
  fi

  echo "Starting demo on ${DEV_HOST}:${DEMO_PORT}"
  (
    cd "$DEMO_DIR"
    pnpm --ignore-workspace exec vite --host "$DEV_HOST" --port "$DEMO_PORT" --strictPort
  ) >"$log_path" 2>&1 &
  DEMO_SERVER_PID=$!
  wait_for_url "$DEMO_URL" || {
    echo "Demo did not come up; last log lines:" >&2
    tail -n 20 "$log_path" >&2 || true
    return 1
  }
}

cleanup() {
  local exit_code=$?
  if [[ -n "$DEMO_SERVER_PID" ]]; then
    kill "$DEMO_SERVER_PID" >/dev/null 2>&1 || true
  fi
  agent-browser --session "$SESSION_NAME" close >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT

start_demo_if_needed

# Fresh session + first navigation, so the helper can resolve the CDP url and
# attach the authenticator to a live page.
agent-browser --session "$SESSION_NAME" open "$DEMO_URL" >/dev/null

echo "Running child under a virtual WebAuthn authenticator: $E2E_CHILD"
node "$ROOT_DIR/scripts/e2e/agent-browser-webauthn-helper.mjs" run \
  --session "$SESSION_NAME" --url "$DEMO_URL" -- \
  env \
    SESSION_NAME="$SESSION_NAME" \
    DEMO_URL="$DEMO_URL" \
    PROBE_URL="$DEMO_URL" \
    RELAYER_PROXY_URL="${RELAYER_PROXY_URL:-}" \
    INDEXER_PROXY_URL="${INDEXER_PROXY_URL:-}" \
    RECIPIENT_ADDRESS="${RECIPIENT_ADDRESS:-}" \
    SKIP_ONCHAIN="${SKIP_ONCHAIN:-auto}" \
    bash "$E2E_CHILD"
