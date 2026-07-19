import { useEffect, useRef, useState } from 'react'
import { searchFoods, lookupBarcode, scaleFood } from '../lib/foodSearch'
import { Button, Field, Input, Select } from './ui'
import { MEALS, UNITS } from './AddFoodForm'
import BarcodeScanner from './BarcodeScanner'

const r = (n) => Math.round(Number(n) || 0)

// Search Open Food Facts by text or barcode, pick a product, set the amount
// (macros scale from the per-100 basis) and add it to the log.
export default function FoodSearch({ onSubmit, onCancel, busy }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)

  const [picked, setPicked] = useState(null) // normalised product
  const [grams, setGrams] = useState('')
  const [meal, setMeal] = useState('lunch')
  const [unit, setUnit] = useState('g')
  const [asFrequent, setAsFrequent] = useState(false)

  // Debounced text search.
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    setError(null)
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        setResults(await searchFoods(query, { signal: ctrl.signal }))
      } catch (e) {
        if (e.name !== 'AbortError') setError(e.message)
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  function pick(food) {
    setPicked(food)
    setUnit(food.unit || 'g')
    setGrams(String(food.serving_g || 100))
  }

  async function onScan(code) {
    setScanning(false)
    setSearching(true)
    setError(null)
    try {
      const food = await lookupBarcode(code)
      if (!food) setError(`No product found for barcode ${code}.`)
      else pick(food)
    } catch (e) {
      setError(e.message)
    } finally {
      setSearching(false)
    }
  }

  const scaled = picked ? scaleFood(picked, grams) : null

  function add() {
    if (!picked) return
    onSubmit(
      {
        food_name: picked.brand ? `${picked.name} — ${picked.brand}` : picked.name,
        meal_type: meal,
        grams: Number(grams) || null,
        unit,
        source: picked.code ? 'barcode' : 'search',
        ...scaled,
      },
      { asFrequent }
    )
  }

  if (scanning) {
    return <BarcodeScanner onDetected={onScan} onCancel={() => setScanning(false)} />
  }

  // Amount / meal / confirm panel once a product is chosen.
  if (picked) {
    return (
      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium text-white">{picked.name}</div>
          {picked.brand && <div className="text-xs text-slate-500">{picked.brand}</div>}
          <div className="mt-0.5 text-xs text-slate-500">
            per 100{picked.unit}: {r(picked.per100.calories)} kcal · {r(picked.per100.protein_g)}P{' '}
            {r(picked.per100.carbs_g)}C {r(picked.per100.fat_g)}F
          </div>
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Field label="Meal">
            <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
              {MEALS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount">
            <div className="grid grid-cols-[1fr_auto] gap-1">
              <Input
                type="number"
                inputMode="decimal"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
              />
              <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </div>

        <div className="text-center text-sm text-slate-300">
          <b className="text-white">{r(scaled.calories)}</b> kcal · {r(scaled.protein_g)}P ·{' '}
          {r(scaled.carbs_g)}C · {r(scaled.fat_g)}F
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={asFrequent}
            onChange={(e) => setAsFrequent(e.target.checked)}
            className="h-4 w-4 accent-green-500"
          />
          ⭐ Save as a frequent food
        </label>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={add} disabled={busy}>
            {busy ? 'Adding…' : 'Add to log'}
          </Button>
          <Button variant="ghost" onClick={() => setPicked(null)}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  // Search box + barcode button + results.
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search foods (e.g. greek yogurt)…"
          autoFocus
        />
        <Button variant="ghost" onClick={() => setScanning(true)} aria-label="Scan barcode">
          📷
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {searching && <p className="py-2 text-sm text-slate-500">Searching…</p>}

      {!searching && q.trim().length >= 2 && results.length === 0 && !error && (
        <p className="py-2 text-sm text-slate-500">No results. Try a different term or scan a barcode.</p>
      )}

      {results.length > 0 && (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {results.map((f, i) => (
            <button
              key={f.code || i}
              onClick={() => pick(f)}
              className="block w-full rounded-lg bg-slate-800 px-3 py-2 text-left hover:bg-slate-700"
            >
              <div className="truncate text-sm text-white">{f.name}</div>
              <div className="truncate text-xs text-slate-500">
                {f.brand ? `${f.brand} · ` : ''}
                {r(f.per100.calories)} kcal · {r(f.per100.protein_g)}P {r(f.per100.carbs_g)}C{' '}
                {r(f.per100.fat_g)}F / 100{f.unit}
              </div>
            </button>
          ))}
        </div>
      )}

      <Button variant="ghost" className="w-full" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
