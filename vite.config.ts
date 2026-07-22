import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base = имя репозитория для GitHub Pages
export default defineConfig({
  base: '/easypay-demo/',
  plugins: [react()]
})
