import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // Essential for remote access
    port: 5173,
    watch: {
      usePolling: true, // Recommended for Docker/Network drives
    },
  },
})