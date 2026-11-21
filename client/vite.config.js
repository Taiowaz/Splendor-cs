import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendUrl = process.env.DEV_BACKEND_URL || 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backendUrl,
      '/ws': {
        target: backendUrl.replace(/^http/, 'ws'),
        ws: true
      }
    }
  }
})
