// Open Food Facts food lookup — free, keyless, CORS-enabled public API.
// Used for text search and barcode scanning. Nutrition is normalised to a
// per-100(g/ml) basis so callers can scale by whatever amount the user logs.

const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl'
const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product'
const FIELDS = 'code,product_name,product_name_en,brands,nutriments,serving_quantity,serving_size,quantity'

const numOr = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

// Pull kcal out of an OFF nutriments object (kJ fallback ÷ 4.184).
function kcalOf(n) {
  if (n['energy-kcal_100g'] != null) return numOr(n['energy-kcal_100g'])
  if (n['energy-kcal'] != null) return numOr(n['energy-kcal'])
  if (n['energy_100g'] != null) return numOr(n['energy_100g']) / 4.184
  return 0
}

// Turn a raw OFF product into our shape, or null if it has no usable data.
function normalize(p) {
  if (!p) return null
  const name = (p.product_name_en || p.product_name || '').trim()
  if (!name) return null
  const n = p.nutriments || {}
  const per100 = {
    calories: Math.round(kcalOf(n)),
    protein_g: Math.round(numOr(n.proteins_100g) * 10) / 10,
    carbs_g: Math.round(numOr(n.carbohydrates_100g) * 10) / 10,
    fat_g: Math.round(numOr(n.fat_100g) * 10) / 10,
  }
  // Skip empty entries (no calories and no macros = nothing to log).
  if (!per100.calories && !per100.protein_g && !per100.carbs_g && !per100.fat_g) return null
  // ml for drinks, else g.
  const isDrink = /\b(ml|l|litre|liter)\b/i.test(p.quantity || p.serving_size || '')
  return {
    code: p.code || null,
    name,
    brand: (p.brands || '').split(',')[0].trim() || null,
    unit: isDrink ? 'ml' : 'g',
    serving_g: numOr(p.serving_quantity) || null, // grams per serving, if known
    per100,
  }
}

// Scale a normalised product to a given amount (grams/ml), returning a
// ready-to-log entry (calories + macros rounded).
export function scaleFood(food, amount) {
  const f = numOr(amount) / 100
  return {
    calories: Math.round(food.per100.calories * f),
    protein_g: Math.round(food.per100.protein_g * f),
    carbs_g: Math.round(food.per100.carbs_g * f),
    fat_g: Math.round(food.per100.fat_g * f),
  }
}

export async function searchFoods(query, { signal } = {}) {
  const q = query.trim()
  if (!q) return []
  const url =
    `${SEARCH_URL}?search_terms=${encodeURIComponent(q)}` +
    `&search_simple=1&action=process&json=1&page_size=25&fields=${FIELDS}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const data = await res.json()
  return (data.products || []).map(normalize).filter(Boolean)
}

export async function lookupBarcode(code, { signal } = {}) {
  const c = String(code).trim()
  if (!c) return null
  const res = await fetch(`${PRODUCT_URL}/${encodeURIComponent(c)}.json?fields=${FIELDS}`, { signal })
  if (!res.ok) throw new Error(`Lookup failed (${res.status})`)
  const data = await res.json()
  if (data.status !== 1 && !data.product) return null
  return normalize(data.product)
}
