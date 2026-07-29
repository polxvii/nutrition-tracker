// Server-side food lookup behind the /api/food proxy. Runs in the Cloudflare
// Pages Function and the Vite dev middleware.
//
// Text search uses Open Food Facts' **Search-a-licious** endpoint
// (search.openfoodfacts.org) — it returns reliable JSON and has some Thai
// coverage, unlike the legacy cgi/search.pl which frequently 503s and returns
// an HTML error page (the old "search finds nothing" cause). Barcodes use the
// v2 product API. We set a User-Agent (OFF asks apps to identify themselves)
// and cache briefly to cut repeat calls.

const SAL_URL = 'https://search.openfoodfacts.org/search'
const LEGACY_URL = 'https://world.openfoodfacts.org/cgi/search.pl'
const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product'
// NB: adding product-level fields (serving_quantity/quantity) here makes SAL
// drop the nutriments projection entirely — keep the search field set minimal.
const SEARCH_FIELDS = 'code,product_name,product_name_en,brands,nutriments'
const PRODUCT_FIELDS =
  'code,product_name,product_name_en,brands,nutriments,serving_quantity,serving_size,quantity'
const UA = 'NutritionTracker/1.0 (personal nutrition PWA)'

const numOr = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

function kcalOf(n) {
  if (n['energy-kcal_100g'] != null) return numOr(n['energy-kcal_100g'])
  if (n['energy-kcal'] != null) return numOr(n['energy-kcal'])
  if (n['energy_100g'] != null) return numOr(n['energy_100g']) / 4.184
  return 0
}

// Raw OFF product → our shape, or null if there's nothing usable to log.
function normalize(p) {
  if (!p) return null
  const name = String(p.product_name || p.product_name_en || '').trim()
  if (!name) return null
  const n = p.nutriments || {}
  const per100 = {
    calories: Math.round(kcalOf(n)),
    protein_g: Math.round(numOr(n.proteins_100g) * 10) / 10,
    carbs_g: Math.round(numOr(n.carbohydrates_100g) * 10) / 10,
    fat_g: Math.round(numOr(n.fat_100g) * 10) / 10,
  }
  if (!per100.calories && !per100.protein_g && !per100.carbs_g && !per100.fat_g) return null
  // `brands` may be a string ("A,B") or an array (Search-a-licious) — handle both.
  const brand = (Array.isArray(p.brands) ? p.brands[0] : String(p.brands || '').split(',')[0]) || ''
  const isDrink = /\b(ml|l|litre|liter)\b/i.test(String(p.quantity || p.serving_size || ''))
  return {
    code: p.code || null,
    name,
    brand: brand.trim() || null,
    unit: isDrink ? 'ml' : 'g',
    serving_g: numOr(p.serving_quantity) || null,
    per100,
  }
}

// Normalise a list, dropping any item that throws (defensive against OFF's
// inconsistent field shapes) so one odd product can't blank the whole search.
function normalizeList(arr) {
  const out = []
  for (const p of arr || []) {
    try {
      const v = normalize(p)
      if (v) out.push(v)
    } catch {
      /* skip malformed */
    }
  }
  return out
}

// Tiny TTL cache (per warm isolate) — cuts repeat OFF calls for the same query.
const cache = new Map()
const TTL_MS = 10 * 60 * 1000
function cget(k) {
  const e = cache.get(k)
  if (e && e.exp > Date.now()) return e.v
  if (e) cache.delete(k)
  return undefined
}
function cset(k, v) {
  cache.set(k, { v, exp: Date.now() + TTL_MS })
}

// Fetch with a hard timeout so a slow/unreachable OFF host can't hang us.
async function offFetch(url, ms = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, {
      headers: { 'User-Agent': UA, accept: 'application/json' },
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

// Only treat a genuine JSON 2xx as data; HTML error pages (the 503 challenge
// that broke the old search) → null so we fall through.
async function jsonOrNull(r) {
  const ct = r.headers.get('content-type') || ''
  if (!r.ok || !ct.includes('json')) return null
  return r.json().catch(() => null)
}

async function viaSAL(query) {
  const url = `${SAL_URL}?page_size=25&fields=${encodeURIComponent(SEARCH_FIELDS)}&q=${encodeURIComponent(query)}`
  let r
  try {
    r = await offFetch(url)
  } catch {
    return null // timeout / network → let the caller fall back
  }
  const j = await jsonOrNull(r)
  return j ? normalizeList(j.hits) : null
}

async function viaLegacy(query) {
  const url =
    `${LEGACY_URL}?search_terms=${encodeURIComponent(query)}` +
    `&search_simple=1&action=process&json=1&page_size=25&fields=${encodeURIComponent(PRODUCT_FIELDS)}`
  let r
  try {
    r = await offFetch(url)
  } catch {
    return null
  }
  const j = await jsonOrNull(r)
  return j ? normalizeList(j.products) : null
}

export async function searchProducts(q) {
  const query = (q || '').trim()
  if (query.length < 2) return []
  const ck = 's:' + query.toLowerCase()
  const hit = cget(ck)
  if (hit) return hit
  // Prefer Search-a-licious.
  let out = await viaSAL(query)
  // Thai/unsegmented type-ahead: SAL matches whole word tokens, so a continuous
  // query that runs past a word boundary (e.g. "มาม่าต้ม") returns nothing even
  // though "มาม่าต้มยำกุ้ง" exists. Retry on shorter prefixes (down to the leading
  // token), then keep only names that still contain the full query.
  if ((!out || out.length === 0) && !/\s/.test(query) && query.length >= 4) {
    const ql = query.toLowerCase()
    const L = query.length
    const lens = [...new Set([L - 2, L - 3, 5, 4])]
      .filter((n) => n >= 2 && n < L)
      .sort((a, b) => b - a)
    for (const n of lens) {
      const wide = await viaSAL(query.slice(0, n))
      if (!wide || !wide.length) continue
      // Only surface products whose name actually contains the full query — no
      // unrelated noise. If none match, keep looking with a shorter prefix.
      const narrowed = wide.filter((p) => (p.name || '').toLowerCase().includes(ql))
      if (narrowed.length) {
        out = narrowed
        break
      }
    }
  }
  // Last resort: the legacy endpoint (flaky, but occasionally up when SAL isn't).
  if (!out || out.length === 0) {
    const legacy = await viaLegacy(query)
    if (legacy && legacy.length) out = legacy
  }
  out = out || []
  if (out.length) cset(ck, out) // don't cache empties (could be a transient miss)
  return out
}

export async function lookupProduct(code) {
  const c = String(code || '').trim()
  if (!c) return null
  const ck = 'b:' + c
  const hit = cget(ck)
  if (hit !== undefined) return hit
  const r = await offFetch(
    `${PRODUCT_URL}/${encodeURIComponent(c)}.json?fields=${encodeURIComponent(PRODUCT_FIELDS)}`
  )
  if (r.status === 404) {
    cset(ck, null)
    return null
  }
  if (!r.ok) {
    const e = new Error(`Lookup failed (${r.status}).`)
    e.status = r.status
    throw e
  }
  const j = await r.json().catch(() => ({}))
  const out = j.status !== 1 && !j.product ? null : normalizeList([j.product])[0] || null
  cset(ck, out)
  return out
}
