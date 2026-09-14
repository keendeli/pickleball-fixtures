import { mount } from 'svelte'
import { registerSW } from 'virtual:pwa-register'
import { listenForInstall } from './lib/install.svelte'
import './app.css'
import App from './App.svelte'

// Capture Chrome's beforeinstallprompt before any component mounts.
listenForInstall()

registerSW({ immediate: true })

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
