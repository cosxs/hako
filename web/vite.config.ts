import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The app is served by the router at /hako/, next to LuCI, and talks to it
// through ubus at /ubus. While developing, /ubus goes to the router named by
// HAKO_ROUTER (a test router, never one in use without asking).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'HAKO_')
  const router = env.HAKO_ROUTER || 'http://127.0.0.1:18081'

  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      proxy: {
        '/ubus': { target: router, changeOrigin: true },
      },
    },
    build: {
      outDir: '../luci-app-hako/htdocs/hako',
      emptyOutDir: true,
    },
  }
})
