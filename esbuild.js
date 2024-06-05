import { build } from 'esbuild'
// import { polyfillNode } from "esbuild-plugin-polyfill-node";
import fs from 'fs'

const result = await build({
  metafile: true,
  bundle: true,
  format: 'esm',
  charset: 'utf8',
  // outfile: 'demo/src/passkey-kit/index.js',
  outdir: 'demo/src/passkey-kit',
  entryPoints: ['index.ts'],
  minify: true,
  sourcemap: true,
  logLevel: 'silent',
  resolveExtensions: ['.tsx', '.ts', '.jsx', '.mjs', '.js', '.json'],
  // mainFields: ['worker', 'browser', 'module', 'jsnext', 'main'],
  // conditions: ['worker', 'browser', 'import', 'production'],
  // platform: 'neutral',
  platform: 'browser',
  // plugins: [polyfillNode()],
})

fs.writeFileSync('meta.json', JSON.stringify(result.metafile))