import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root:    '.',
  build: {
    outDir:        'dist-ui',
    rollupOptions: { input: './index.html' },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target:      'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
