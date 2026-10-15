import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {
    // Sandboxed preload scripts cannot require() node_modules - bundle everything.
    build: { externalizeDeps: false },
  },
  renderer: {
    plugins: [react()],
    build: { minify: true },
  },
})
