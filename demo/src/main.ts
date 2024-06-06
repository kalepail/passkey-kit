import './app.css'
import App from './App.svelte'
import { fundPubkey, rpc } from './lib/common'

(async () => {
  try {
    await rpc.requestAirdrop(fundPubkey)
  } catch {}
})()

const app = new App({
  target: document.getElementById('app')!,
})

export default app
