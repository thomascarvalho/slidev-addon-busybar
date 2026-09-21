/* Loaded by Slidev from every addon root: plugs the relay into the dev
   server. The plugin is compiled to `dist/` (`npm run build`). */
import { defineConfig } from 'vite'
import { busybar } from './dist/plugin.js'

export default defineConfig({
  plugins: [busybar()],
})
