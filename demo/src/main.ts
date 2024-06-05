import './app.css'
import App from './App.svelte'
import { publickey, rpc } from './lib/common'

(async () => {
  try {
    await rpc.requestAirdrop(publickey)
  } catch {}
})()

const app = new App({
  target: document.getElementById('app')!,
})

export default app
