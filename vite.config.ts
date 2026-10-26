import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // three.js is one large chunk (~150 kB gzipped).
    chunkSizeWarningLimit: 1200,
  },
})
