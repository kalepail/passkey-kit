#!/usr/bin/env node

/**
 * Attach a virtual WebAuthn authenticator (CDP `WebAuthn.addVirtualAuthenticator`)
 * to a live agent-browser session, keep the CDP attachment open while a child
 * command runs, and tear the authenticator down in a `finally` — so passkey
 * ceremonies resolve headlessly and nothing leaks between runs.
 *
 * Ported from smart-account-kit (project 34); generic — no passkey-kit specifics.
 *
 * Usage:
 *   node scripts/e2e/agent-browser-webauthn-helper.mjs run --session <name> -- <command> [args...]
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_AUTHENTICATOR_OPTIONS = {
  protocol: "ctap2",
  transport: "internal",
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
};

function printUsage() {
  console.error(`
Usage:
  node scripts/e2e/agent-browser-webauthn-helper.mjs run [options] -- <command> [args...]

Description:
  Attaches a virtual WebAuthn authenticator to a live agent-browser session, keeps
  the CDP attachment open while your command runs, and cleans it up afterward.

Options:
  --session <name>           Existing agent-browser session name
  --cdp-url <ws-url>         Explicit CDP WebSocket URL (overrides --session lookup)
  --url <page-url>           Page URL to bind within the browser session
  --transport <type>         internal | usb | nfc | ble | cable
  --protocol <type>          ctap2 | u2f
  --resident-key <bool>      true | false
  --user-verification <bool> true | false
  --verified <bool>          true | false
  --presence <bool>          true | false

Example:
  agent-browser --session demo open http://127.0.0.1:5173
  node scripts/e2e/agent-browser-webauthn-helper.mjs run --session demo -- \\
    bash scripts/e2e/browser-full-e2e-audit.sh
`);
}

function parseArgs(argv) {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const command = normalized[0];
  if (!command) {
    printUsage();
    process.exit(1);
  }

  const separator = normalized.indexOf("--");
  const optionTokens =
    separator === -1 ? normalized.slice(1) : normalized.slice(1, separator);
  const childCommand = separator === -1 ? [] : normalized.slice(separator + 1);

  const args = { _: [] };
  for (let i = 0; i < optionTokens.length; i += 1) {
    const token = optionTokens[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = optionTokens[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i += 1;
  }

  return { command, args, childCommand };
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`Expected a boolean value, received "${value}"`);
}

async function runAgentBrowser(args) {
  const { stdout } = await execFileAsync("agent-browser", args, {
    encoding: "utf8",
  });
  return stdout.trim();
}

function getLastNonEmptyLine(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}

async function resolveCDPUrl(args) {
  if (args["cdp-url"] && args["cdp-url"] !== true) return args["cdp-url"];

  const session = args.session;
  if (!session || session === true) {
    throw new Error("Provide --session or --cdp-url");
  }

  const output = await runAgentBrowser(["--session", session, "get", "cdp-url"]);
  const cdpUrl = getLastNonEmptyLine(output);
  if (!cdpUrl) {
    throw new Error(`Unable to resolve CDP URL for session "${session}"`);
  }
  return cdpUrl;
}

async function resolveCurrentUrl(args) {
  if (args.url && args.url !== true) return args.url;

  const session = args.session;
  if (!session || session === true) return null;

  const output = await runAgentBrowser(["--session", session, "get", "url"]);
  return getLastNonEmptyLine(output) ?? null;
}

function createCDPConnection(browserWsUrl) {
  const socket = new WebSocket(browserWsUrl);
  let nextId = 0;
  const pending = new Map();

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    }
  };

  const ready = new Promise((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = (event) =>
      reject(new Error(`WebSocket error: ${event.type}`));
  });

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket.send(JSON.stringify(payload));
    });

  const close = () => {
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
  };

  return { ready, send, close };
}

async function attachToPage(send, preferredUrl) {
  const { targetInfos } = await send("Target.getTargets");
  const pages = targetInfos.filter((target) => target.type === "page");

  const pageTarget =
    (preferredUrl
      ? pages.find((target) => target.url === preferredUrl)
      : null) ??
    pages.find((target) => target.url && target.url !== "about:blank") ??
    pages.at(-1);

  if (!pageTarget) {
    throw new Error("Unable to find a page target in the remote browser");
  }

  const { sessionId } = await send("Target.attachToTarget", {
    targetId: pageTarget.targetId,
    flatten: true,
  });

  return { sessionId, pageUrl: pageTarget.url, targetId: pageTarget.targetId };
}

async function runChildCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`Child command exited via signal ${signal}`));
        return;
      }
      resolve(code ?? 0);
    });
  });
}

async function commandRun(args, childCommand) {
  if (childCommand.length === 0) {
    throw new Error("run requires a child command after --");
  }

  const cdpUrl = await resolveCDPUrl(args);
  const preferredUrl = await resolveCurrentUrl(args);
  const connection = createCDPConnection(cdpUrl);
  await connection.ready;

  const { sessionId, pageUrl } = await attachToPage(
    connection.send,
    preferredUrl,
  );
  const authenticatorOptions = {
    protocol: args.protocol || DEFAULT_AUTHENTICATOR_OPTIONS.protocol,
    transport: args.transport || DEFAULT_AUTHENTICATOR_OPTIONS.transport,
    hasResidentKey: parseBoolean(
      args["resident-key"],
      DEFAULT_AUTHENTICATOR_OPTIONS.hasResidentKey,
    ),
    hasUserVerification: parseBoolean(
      args["user-verification"],
      DEFAULT_AUTHENTICATOR_OPTIONS.hasUserVerification,
    ),
    isUserVerified: parseBoolean(
      args.verified,
      DEFAULT_AUTHENTICATOR_OPTIONS.isUserVerified,
    ),
    automaticPresenceSimulation: parseBoolean(
      args.presence,
      DEFAULT_AUTHENTICATOR_OPTIONS.automaticPresenceSimulation,
    ),
  };

  await connection.send("WebAuthn.enable", {}, sessionId);
  const { authenticatorId } = await connection.send(
    "WebAuthn.addVirtualAuthenticator",
    { options: authenticatorOptions },
    sessionId,
  );

  console.error(
    JSON.stringify(
      {
        session: typeof args.session === "string" ? args.session : null,
        cdpUrl,
        pageUrl,
        authenticatorId,
        options: authenticatorOptions,
      },
      null,
      2,
    ),
  );

  let exitCode = 0;
  try {
    exitCode = await runChildCommand(childCommand[0], childCommand.slice(1));
  } finally {
    try {
      await connection.send(
        "WebAuthn.removeVirtualAuthenticator",
        { authenticatorId },
        sessionId,
      );
    } catch (error) {
      console.error(
        `Cleanup warning: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      await connection.send("WebAuthn.disable", {}, sessionId);
    } catch (error) {
      console.error(
        `Cleanup warning: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    connection.close();
  }

  process.exitCode = exitCode;
}

const { command, args, childCommand } = parseArgs(process.argv.slice(2));

try {
  switch (command) {
    case "run":
      await commandRun(args, childCommand);
      break;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      throw new Error(`Unknown command "${command}"`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
