import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The app is served by the router at /hako/, next to LuCI, and talks to it
// through ubus at /ubus with the session of LuCI. While developing, /ubus and
// LuCI go to the router named by HAKO_ROUTER (a test router, never one in use
// without asking), and LuCI sending the app back to /hako/ comes here.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'HAKO_')
  const router = env.HAKO_ROUTER || 'http://127.0.0.1:18081'

  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'hako-entry',
        apply: 'serve',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url !== '/hako/') return next()
            res.writeHead(302, { Location: '/' })
            res.end()
          })
        },
      },
    ],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      proxy: {
        '/ubus': { target: router, changeOrigin: true },
        // files uploaded, such as a sing-box package
        '/cgi-bin/cgi-upload': { target: router, changeOrigin: true },
        // LuCI, where the app logs in
        '/cgi-bin/luci': { target: router, changeOrigin: true },
        '/luci-static': { target: router, changeOrigin: true },
      },
    },
    // Installed from root/ rather than htdocs/: luci.mk runs jsmin and csstidy
    // on everything under htdocs/, and jsmin rewrites template literals.
    build: {
      outDir: '../luci-app-hako/root/www/hako',
      emptyOutDir: true,
      rolldownOptions: {
        output: {
          // React and the router and queries of every page in a chunk of
          // their own, which a new version of the app leaves cached
          codeSplitting: {
            groups: [
              {
                name: 'vendor',
                test: /node_modules[\\/](react|react-dom|scheduler|@tanstack[\\/](react-router|router-core|history|store|react-store|react-query|query-core))[\\/]/,
              },
            ],
          },
        },
      },
    },
  }
})
