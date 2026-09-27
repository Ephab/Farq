import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    watch: {
      // Hermes (HERMES_HOME=.hermes-runtime) unpacks its uv cache here while the dev server runs.
      // Watching it floods page reloads, and on Windows the watcher's open handles make uv's
      // cache renames fail ("Access is denied"), leaving Hermes half-updated.
      ignored: ['**/.hermes-runtime/**', '**/.venv/**'],
    },
    proxy: {
      // NVIDIA NIM sends no CORS headers, so browsers block direct calls.
      // Same-origin proxy keeps the prototype key-in-browser flow working
      // under `npm run dev`. Hermes backend will replace this later.
      '/api/nim': {
        target: 'https://integrate.api.nvidia.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/nim/, ''),
      },
      '/api': {
        target: process.env.FARQ_DEV_API_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
