import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  define: {
    // stellar-sdk / passkey-kit expect a Node-style `global`; map it to the
    // browser realm. `Buffer` itself is polyfilled at runtime in `main.ts`.
    global: "globalThis",
  },
  resolve: {
    // The demo links `passkey-kit` via `link:..`, so passkey-kit's compiled
    // `dist/` and the demo resolve `@stellar/stellar-sdk`/`buffer` from two
    // physical locations. Dedupe to a single instance so `xdr`/`Buffer`
    // `instanceof` checks hold across the boundary.
    dedupe: ["@stellar/stellar-sdk", "buffer"],
  },
  optimizeDeps: {
    include: ["@stellar/stellar-sdk", "buffer", "base64url"],
  },
  build: {
    target: "esnext",
  },
});
