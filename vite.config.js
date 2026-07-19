import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { analyzeFood } from './server/analyzeFood.js'

// Dev-only: serve POST /api/analyze locally (mirrors the Cloudflare Pages
// Function in functions/api/analyze.js). Reads ANTHROPIC_API_KEY from .env
// WITHOUT the VITE_ prefix, so the key stays server-side and is never bundled
// into the client. Needs a dev-server restart after you add the key.
function devAnalyzeApi(env) {
  return {
    name: 'dev-analyze-api',
    configureServer(server) {
      server.middlewares.use('/api/analyze', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        try {
          const chunks = []
          for await (const c of req) chunks.push(c)
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
          const result = await analyzeFood({
            apiKey: env.ANTHROPIC_API_KEY,
            model: env.ANTHROPIC_MODEL,
            imageBase64: body.image,
            mediaType: body.mediaType,
            note: body.note,
          })
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(result))
        } catch (e) {
          res.statusCode = e.status || 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: e.message || 'Analyze failed' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (no prefix filter) so the dev API can read the
  // non-VITE_ ANTHROPIC_API_KEY. Client code still only sees VITE_* vars.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'Nutrition Tracker',
          short_name: 'Nutrition',
          description: 'Body recomposition nutrition tracker — build muscle, lose fat',
          lang: 'en',
          theme_color: '#16a34a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          start_url: '/',
          scope: '/',
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallbackDenylist: [/^\/api\//],
        },
        devOptions: { enabled: false },
      }),
      devAnalyzeApi(env),
    ],
  }
})
