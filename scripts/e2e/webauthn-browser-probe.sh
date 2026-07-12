#!/usr/bin/env bash

# Isolated WebAuthn sanity probe: in a live agent-browser session (with a virtual
# authenticator attached by agent-browser-webauthn-helper.mjs), run a full
# navigator.credentials.create -> get -> crypto.subtle.verify round-trip and print
# the credential id + raw P-256 public key + verification result as JSON.
#
# This proves the CDP virtual authenticator + secp256r1 WebAuthn stack works
# before the full demo audit blames a real failure on the browser layer.
#
# Ported from smart-account-kit (project 34); generic.

set -euo pipefail

SESSION_NAME="${SESSION_NAME:?SESSION_NAME is required}"
PROBE_URL="${PROBE_URL:-http://localhost:5173}"

agent-browser --session "$SESSION_NAME" open "$PROBE_URL" >/dev/null

PROBE_JS="$(cat <<'JS'
(() => {
  const toBase64Url = (bytes) => {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };

  const toHex = (bytes) =>
    Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

  document.body.innerHTML = '<button id="probe">Run Probe</button><pre id="result"></pre>';
  window.__probeResult = null;

  document.getElementById("probe").onclick = async () => {
    try {
      const registrationChallenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));
      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: registrationChallenge,
          rp: { id: location.hostname, name: "Probe" },
          user: {
            id: userId,
            name: `probe-${Date.now()}`,
            displayName: "Probe User",
          },
          pubKeyCredParams: [{ alg: -7, type: "public-key" }],
          authenticatorSelection: {
            residentKey: "preferred",
            userVerification: "preferred",
          },
          timeout: 60000,
        },
      });

      const spki = credential.response.getPublicKey();
      const publicKey = await crypto.subtle.importKey(
        "spki",
        spki,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"]
      );
      const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));

      const authChallenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: authChallenge,
          rpId: location.hostname,
          allowCredentials: [{ id: credential.rawId, type: "public-key" }],
          userVerification: "preferred",
          timeout: 60000,
        },
      });

      const authenticatorData = new Uint8Array(assertion.response.authenticatorData);
      const clientDataJSON = new Uint8Array(assertion.response.clientDataJSON);
      const signature = new Uint8Array(assertion.response.signature);
      const clientDataHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
      const signedMessage = new Uint8Array(authenticatorData.length + clientDataHash.length);
      signedMessage.set(authenticatorData);
      signedMessage.set(clientDataHash, authenticatorData.length);

      const verified = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        signature,
        signedMessage
      );

      window.__probeResult = {
        credentialId: toBase64Url(new Uint8Array(credential.rawId)),
        rawPublicKeyHex: toHex(rawPublicKey),
        verified,
      };
      document.getElementById("result").textContent = JSON.stringify(window.__probeResult, null, 2);
    } catch (error) {
      window.__probeResult = {
        error: error instanceof Error ? error.message : String(error),
      };
      document.getElementById("result").textContent = JSON.stringify(window.__probeResult, null, 2);
    }
  };

  return "ready";
})()
JS
)"

agent-browser --session "$SESSION_NAME" eval "$PROBE_JS" >/dev/null
agent-browser --session "$SESSION_NAME" click "#probe" >/dev/null

for _ in $(seq 1 60); do
  RESULT="$(agent-browser --session "$SESSION_NAME" eval "JSON.stringify(window.__probeResult)" | tr -d '\r')"
  if [[ "$RESULT" != "null" ]]; then
    printf '%s\n' "$RESULT"
    if printf '%s\n' "$RESULT" | grep -q '"verified":true'; then
      exit 0
    fi
    echo "Probe completed but verification did not pass" >&2
    exit 1
  fi
  sleep 1
done

echo "Probe timed out" >&2
exit 1
