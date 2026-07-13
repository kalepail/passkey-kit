#!/usr/bin/env node
/**
 * Node native-ESM import smoke test.
 *
 * Regression gate for a real class of packaging bug: `tsc` under
 * `moduleResolution: "bundler"` emits extensionless relative imports
 * (`from "./kit"`) that Node's native ESM loader rejects
 * (`ERR_MODULE_NOT_FOUND` / `ERR_UNSUPPORTED_DIR_IMPORT`). Such a package imports
 * fine under a bundler (Vite/webpack) but crashes for any plain Node consumer —
 * a gap a Vite-only demo e2e never exercises.
 *
 * This imports the built package the way a Node consumer would — by name, via
 * package self-reference through `exports` — and asserts key exports resolve. It
 * runs as part of `pnpm build`, so a regression fails the build (and release).
 */
const failures = [];

async function check(specifier, expectedExports) {
  try {
    const mod = await import(specifier);
    for (const name of expectedExports) {
      if (!(name in mod)) {
        failures.push(`${specifier}: missing export "${name}"`);
      }
    }
    console.log(`  ok   ${specifier} (${expectedExports.join(", ")})`);
  } catch (err) {
    const detail = `${err.code ?? ""} ${String(err.message).split("\n")[0]}`;
    failures.push(`${specifier}: ${detail}`);
    console.log(`  FAIL ${specifier}: ${detail}`);
  }
}

console.log("Node ESM import smoke test:");
await check("passkey-kit", [
  "PasskeyKit",
  "PasskeyKitError",
  "PasskeyEventEmitter",
  "deriveContractAddress",
  "buildTokenTransferHostFunction",
  "MercuryIndexer",
]);
await check("passkey-kit/storage", [
  "MemoryStorage",
  "LocalStorageAdapter",
  "IndexedDBStorage",
]);
await check("passkey-kit/server", ["PasskeyServer", "RelayerClient"]);

if (failures.length) {
  console.error("\nESM import smoke test FAILED:");
  for (const f of failures) console.error("  - " + f);
  console.error(
    "\nThe built package cannot be imported by a Node ESM consumer. This usually\n" +
      "means a relative import is missing its explicit .js extension (NodeNext)."
  );
  process.exit(1);
}
console.log("\nESM import smoke test passed.");
