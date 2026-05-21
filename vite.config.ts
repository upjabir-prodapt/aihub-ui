import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/v1': {
        target: 'https://translation-api-service-297743845367.europe-west1.run.app',
        changeOrigin: true,
        secure: false,
      },
      '/sales-api': {
        target: 'https://sales-research-application-297743845367.europe-west1.run.app',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/sales-api/, ''),
      },
    },
  },
})
