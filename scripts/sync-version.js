#!/usr/bin/env node

/**
 * Syncs the version + name from package.json into src/version.ts.
 *
 * Runs automatically before `build` (prebuild), so the compiled package always
 * reports the version it was published as.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));

const contents = `/**
 * Package version — auto-generated from package.json.
 * @packageDocumentation
 */

// This file is auto-generated. Do not edit manually.
// Run \`pnpm run sync-version\` (or \`pnpm build\`) to update.

export const VERSION = "${pkg.version}";
export const NAME = "${pkg.name}";
`;

writeFileSync(join(rootDir, "src/version.ts"), contents);

console.log(`✓ Synced version to ${pkg.version}`);
