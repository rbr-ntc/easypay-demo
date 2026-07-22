import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' — относительные пути: работает и за нашим Node-сервером, и на любом хостинге
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  }
})
