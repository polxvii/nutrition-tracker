import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { analyzeForUser, addKeyForUser } from './server/byok.js'
import { searchProducts, lookupProduct } from './server/foodSource.js'

// Dev-only: serve the BYOK API locally, mirroring the Cloudflare Pages
// Functions in functions/api/*. Uses the same server/byok.js core, so dev and
// prod behave identically. Reads Supabase config + KEY_ENCRYPTION_SECRET from
// .env (no VITE_ prefix needed here — this runs server-side). Restart the dev
// server after editing .env.
function devByokApi(env) {
  // Wrap the request/response plumbing shared by both routes.
  const route = (handler) => async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('Method Not Allowed')
      return
    }
    try {
      const chunks = []
      for await (const c of req) chunks.push(c)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const authToken = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim()
      const result = await handler({ authToken, env, body })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(result))
    } catch (e) {
      res.statusCode = e.status || 500
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: e.message || 'Request failed', code: e.code }))
    }
  }
  return {
    name: 'dev-byok-api',
    configureServer(server) {
      server.middlewares.use(
        '/api/analyze',
        route(({ authToken, env, body }) => analyzeForUser({ authToken, env, body }))
      )
      server.middlewares.use(
        '/api/keys',
        route(({ authToken, env, body }) =>
          addKeyForUser({ authToken, env, key: body.key, label: body.label })
        )
      )
      // GET /api/food — proxied Open Food Facts search / barcode lookup.
      server.middlewares.use('/api/food', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }
        try {
          const u = new URL(req.originalUrl || req.url, 'http://localhost')
          const code = u.searchParams.get('code')
          const out = code
            ? { product: await lookupProduct(code) }
            : { products: await searchProducts(u.searchParams.get('q') || '') }
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(out))
        } catch (e) {
          res.statusCode = e.status || 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: e.message || 'Food lookup failed' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all env vars (no prefix filter) so the dev API can read the
  // non-VITE_ GEMINI_API_KEY. Client code still only sees VITE_* vars.
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
          // Don't precache the lazy barcode-scanner chunk (~455 KB) — it's
          // fetched on demand the first time the scanner opens instead.
          globIgnores: ['**/BarcodeScanner-*.js'],
          navigateFallbackDenylist: [/^\/api\//],
        },
        devOptions: { enabled: false },
      }),
      devByokApi(env),
    ],
  }
})
