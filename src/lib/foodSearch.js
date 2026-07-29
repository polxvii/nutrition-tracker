// Food search + barcode lookup via our own /api/food proxy (which talks to
// Open Food Facts server-side: reliable Search-a-licious text search + v2
// barcode, with a proper User-Agent and caching). Nutrition comes back
// normalised to a per-100(g/ml) basis so callers can scale by any amount.

const numOr = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

// Units we actually have data for: the base unit (g/ml, per-100 basis) and,
// when the product declares a serving size, "serving".
export function unitsFor(food) {
  const u = [food.unit]
  if (food.serving_g) u.push('serving')
  return u
}

// Grams that one "amount" of a given unit represents for this product.
// g/ml → the amount itself; serving → amount × grams-per-serving.
function gramsFor(food, unit, amount) {
  const a = numOr(amount)
  return unit === 'serving' && food.serving_g ? a * food.serving_g : a
}

// Scale a product to amount+unit using only the searched per-100 data,
// returning a ready-to-log entry (calories + macros rounded).
export function scaleFood(food, unit, amount) {
  const f = gramsFor(food, unit, amount) / 100
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
  const res = await fetch(`/api/food?q=${encodeURIComponent(q)}`, { signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`)
  return data.products || []
}

export async function lookupBarcode(code, { signal } = {}) {
  const c = String(code).trim()
  if (!c) return null
  const res = await fetch(`/api/food?code=${encodeURIComponent(c)}`, { signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Lookup failed (${res.status})`)
  return data.product || null
}
