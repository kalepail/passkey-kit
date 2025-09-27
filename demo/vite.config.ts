/*import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      '/mercury': {
        target: 'https://api.mercurydata.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mercury/, '')
      }
    }
  },
  optimizeDeps: {
    include: [
      'passkey-kit',
      'passkey-factory-sdk',
      'passkey-kit-sdk',
      'sac-sdk',
    ],
    // ⬇ allow TLA during dependency pre-bundling
    esbuildOptions: {
      target: 'es2022',
      supported: { 'top-level-await': true },
    },
  },
  // ⬇ allow TLA in your source too
  esbuild: {
    target: 'es2022',
    supported: { 'top-level-await': true },
  },
  build: {
    target: 'es2022',            // or 'esnext'
    modulePreload: { polyfill: false },
  },
})*/

import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  build: {
    target: "ESNext"
  },
});