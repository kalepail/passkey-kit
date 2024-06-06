import { build } from 'esbuild'
import fs from 'fs'
// import { polyfillNode } from "esbuild-plugin-polyfill-node";

const result = await build({
  metafile: true,
  bundle: true,
  format: 'esm',
  charset: 'utf8',
  outdir: 'lib',
  entryPoints: ['src/index.ts'],
  minify: true,
  sourcemap: true,
  logLevel: 'silent',
  resolveExtensions: ['.tsx', '.ts', '.jsx', '.mjs', '.js', '.json'],
  platform: 'browser',
  // plugins: [polyfillNode()],
})

fs.writeFileSync('meta.json', JSON.stringify(result.metafile))