import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: [
      'ke-ming-fron.onrender.com',
      '.onrender.com', // 這會允許所有 onrender.com 子域名
    ],
  },
})
