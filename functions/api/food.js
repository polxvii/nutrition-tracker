// Cloudflare Pages Function — GET /api/food
//   ?q=<text>   → { products: [...] }   (Open Food Facts Search-a-licious)
//   ?code=<ean> → { product: {...}|null } (OFF v2 product)
// Proxying server-side lets us set a User-Agent (OFF asks apps to identify),
// avoid browser CORS, and cache — fixing the flaky direct cgi/search.pl calls.

import { searchProducts, lookupProduct } from '../../server/foodSource.js'

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url)
  try {
    const code = url.searchParams.get('code')
    if (code) return json({ product: await lookupProduct(code) })
    return json({ products: await searchProducts(url.searchParams.get('q') || '') })
  } catch (e) {
    return json({ error: e.message || 'Food lookup failed' }, e.status || 502)
  }
}
