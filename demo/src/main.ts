import { Buffer } from "buffer";
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

// stellar-sdk / passkey-kit use Node's `Buffer` for XDR + base64url work; the
// browser has no global for it. Polyfill before anything else loads.
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
