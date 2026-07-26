import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: 'web',
  plugins: [svelte()],
  // The romanization engine is shared with the server and the build tools, so the app
  // imports the same module rather than owning a second copy that can drift.
  resolve: { alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    // Everything the app talks to lives on the API server during development.
    proxy: {
      '/api': 'http://localhost:8790',
      '/auth': 'http://localhost:8790',
    },
  },
})
