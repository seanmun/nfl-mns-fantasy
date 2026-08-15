import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // import.meta.dirname, not __dirname: Vite 8's native config loader
      // does not provide the CommonJS global, and warns that it will
      // become the default.
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // Only relevant under `npm run dev`, which cannot serve /api at all —
    // nothing listens on 3000. Use `vercel dev` for anything touching the
    // serverless functions.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
