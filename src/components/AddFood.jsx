import { lazy, Suspense, useEffect, useState } from 'react'
import { searchFoods, lookupBarcode, scaleFood, unitsFor } from '../lib/foodSearch'
import { Button, Field, Input, Select } from './ui'
import { MEALS } from './AddFoodForm'
import AddFoodForm from './AddFoodForm'
import PhotoLogger from './PhotoLogger'

// Barcode scanner pulls in @zxing (~450 KB) — load it only when the scanner
// actually opens, so it isn't in the initial bundle / PWA precache.
const BarcodeScanner = lazy(() => import('./BarcodeScanner'))

const r = (n) => Math.round(Number(n) || 0)

// Grams/amount label for a stored template (recent log or saved food).
const amtOf = (t) => {
  const g = t.grams ?? t.default_grams
  return g ? `${r(g)}${t.unit || 'g'}` : ''
}

// One-line food row with a big ＋; saved rows also get a ✕ to remove.
function FoodRow({ item, onAdd, onDelete }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2">
      <button onClick={() => onAdd(item)} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm text-white">{item.food_name}</div>
        <div className="truncate text-xs text-slate-500">
          {r(item.calories)} kcal · {r(item.protein_g)}P {r(item.carbs_g)}C {r(item.fat_g)}F
          {amtOf(item) ? ` · ${amtOf(item)}` : ''}
          {item.components?.length ? ` · 🍱 ${item.components.length}` : ''}
        </div>
      </button>
      <button
        onClick={() => onAdd(item)}
        className="rounded-lg bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-500"
        aria-label="Add"
      >
        ＋
      </button>
      {onDelete && (
        <button
          onClick={() => onDelete(item)}
          className="px-1 text-slate-500 hover:text-red-400"
          aria-label="Remove from saved"
        >
          ✕
        </button>
      )}
    </div>
  )
}

// Unified "add food" screen (MyFitnessPal-style): search your own foods
// (Thai works) + the Open Food Facts database, quick-add from Recent / Saved,
// or jump to AI / Barcode / Manual entry.
export default function AddFood({
  defaultMeal,
  recent = [],
  saved = [],
  meals = [],
  onLog,
  onLogMany,
  onLogMeal,
  onDeleteSaved,
  onDeleteMeal,
  onCancel,
  busy,
}) {
  const [meal, setMeal] = useState(defaultMeal || 'lunch')
  const [view, setView] = useState('home') // home | saved | ai | manual | scan
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  const [picked, setPicked] = useState(null)
  const [grams, setGrams] = useState('')
  const [unit, setUnit] = useState('g')
  const [asFrequent, setAsFrequent] = useState(false)
  const [aiNote, setAiNote] = useState('') // pre-fills the AI view's description
  const [aiHint, setAiHint] = useState('') // amber note shown atop the AI view
  const [aiAuto, setAiAuto] = useState(false) // run analyze immediately on open?

  // Open the AI view. By default we only pre-fill the note (no auto-analyze) so
  // the user can still attach a photo before hitting Analyze.
  const openAI = (note = '', hint = '', auto = false) => {
    setAiNote(note)
    setAiHint(hint)
    setAiAuto(auto)
    setView('ai')
  }

  // Debounced Open Food Facts search.
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

  const ql = q.trim().toLowerCase()
  const matchLocal = (list) =>
    ql ? list.filter((f) => (f.food_name || '').toLowerCase().includes(ql)) : list

  function pick(food) {
    setPicked(food)
    if (food.serving_g) {
      setUnit('serving')
      setGrams('1')
    } else {
      setUnit(food.unit || 'g')
      setGrams('100')
    }
  }
  function changeUnit(u) {
    setUnit(u)
    setGrams(u === 'serving' ? '1' : String(picked.serving_g ? Math.round(picked.serving_g) : 100))
  }

  async function onScan(code) {
    setView('home')
    setSearching(true)
    setError(null)
    try {
      const food = await lookupBarcode(code)
      if (food) pick(food)
      // Not in the database → hand off to AI (snap the label / describe it).
      else openAI('', `Barcode ${code} isn't in the database — snap the nutrition label or describe the product for AI.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setSearching(false)
    }
  }

  const scaled = picked ? scaleFood(picked, unit, grams) : null

  function addPicked() {
    onLog(
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

  // Log every item of a saved meal at once, into the chosen meal slot.
  function logMeal(m) {
    const entries = (m.items || []).map((it) => ({
      food_name: it.food_name,
      meal_type: meal,
      source: 'meal',
      grams: it.grams ?? null,
      unit: it.unit ?? 'g',
      calories: it.calories,
      protein_g: it.protein_g,
      carbs_g: it.carbs_g,
      fat_g: it.fat_g,
    }))
    if (entries.length) onLogMeal(entries)
  }

  // Quick-add a stored template (recent log / saved food) with the chosen meal.
  function quickAdd(t) {
    onLog(
      {
        food_name: t.food_name,
        meal_type: meal,
        grams: t.grams ?? t.default_grams ?? null,
        unit: t.unit ?? 'g',
        source: 'frequent',
        calories: t.calories,
        protein_g: t.protein_g,
        carbs_g: t.carbs_g,
        fat_g: t.fat_g,
        // Re-adding a logged dish carries its breakdown along, so you can still
        // drill in and edit the parts.
        ...(t.components?.length ? { components: t.components } : {}),
      },
      { asFrequent: false }
    )
  }

  // ---- sub-views -------------------------------------------------------
  if (view === 'scan') {
    return (
      <Suspense
        fallback={<p className="py-6 text-center text-sm text-slate-500">Loading scanner…</p>}
      >
        <BarcodeScanner onDetected={onScan} onCancel={() => setView('home')} />
      </Suspense>
    )
  }
  if (view === 'ai') {
    return (
      <PhotoLogger
        onSubmit={onLogMany}
        onCancel={() => setView('home')}
        busy={busy}
        initialNote={aiNote}
        autoAnalyze={aiAuto}
        hint={aiHint}
        defaultMeal={meal}
      />
    )
  }
  if (view === 'manual') {
    return <AddFoodForm onSubmit={onLog} onCancel={() => setView('home')} busy={busy} />
  }

  // Product amount panel (after picking an OFF result / scanned barcode).
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
          {picked.serving_g && (
            <div className="text-xs text-slate-500">
              1 serving = {r(picked.serving_g)}
              {picked.unit}
            </div>
          )}
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
              <Select value={unit} onChange={(e) => changeUnit(e.target.value)}>
                {unitsFor(picked).map((u) => (
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
          <Button className="flex-1" onClick={addPicked} disabled={busy}>
            {busy ? 'Adding…' : 'Add to log'}
          </Button>
          <Button variant="ghost" onClick={() => setPicked(null)}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  // Saved (frequent) foods list.
  if (view === 'saved') {
    const list = matchLocal(saved)
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-200">⭐ Saved foods</span>
          <button className="text-sm text-slate-400 hover:text-white" onClick={() => setView('home')}>
            ‹ Back
          </button>
        </div>
        <Field label="Add to meal">
          <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
            {MEALS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {saved.length > 0 && (
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter saved…" />
        )}
        {list.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            {saved.length === 0 ? 'No saved foods yet.' : 'No match.'}
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {list.map((f) => (
              <FoodRow key={f.id} item={f} onAdd={quickAdd} onDelete={onDeleteSaved} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Saved meals (combos) — one tap logs every item into the chosen meal slot.
  if (view === 'meals') {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-200">🍱 Saved meals</span>
          <button className="text-sm text-slate-400 hover:text-white" onClick={() => setView('home')}>
            ‹ Back
          </button>
        </div>
        <Field label="Add to meal">
          <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
            {MEALS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        {meals.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            No saved meals yet. On the Log page, tap “＋ meal” on a meal section to save its items as a combo.
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {meals.map((m) => {
              const kcal = (m.items || []).reduce((s, it) => s + (Number(it.calories) || 0), 0)
              return (
                <div key={m.id} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2">
                  <button onClick={() => logMeal(m)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm text-white">{m.name}</div>
                    <div className="text-xs text-slate-500">
                      {(m.items || []).length} items · {r(kcal)} kcal
                    </div>
                  </button>
                  <button
                    onClick={() => logMeal(m)}
                    className="rounded-lg bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-500"
                    aria-label="Add meal"
                  >
                    ＋
                  </button>
                  <button
                    onClick={() => onDeleteMeal(m)}
                    className="px-1 text-slate-500 hover:text-red-400"
                    aria-label="Delete meal"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ---- home ------------------------------------------------------------
  const localHits = ql ? [...matchLocal(saved), ...matchLocal(recent)] : []
  // De-dupe local hits by name (saved wins).
  const seen = new Set()
  const localUnique = localHits.filter((f) => {
    const k = (f.food_name || '').toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return (
    <div className="space-y-3">
      <Field label="Meal">
        <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
          {MEALS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search foods…"
      />

      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" className="text-sm" onClick={() => setView('saved')}>
          ⭐ Saved foods
        </Button>
        <Button variant="ghost" className="text-sm" onClick={() => setView('meals')}>
          🍱 Meals
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button className="text-sm" onClick={() => openAI()}>
          🤖 AI
        </Button>
        <Button variant="ghost" className="text-sm" onClick={() => setView('scan')}>
          📷 Barcode
        </Button>
        <Button variant="ghost" className="text-sm" onClick={() => setView('manual')}>
          ✎ Manual
        </Button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {ql ? (
        <div className="space-y-3">
          {/* Always offer to analyze the typed text with AI — best for Thai
              dishes and anything the database doesn't have. */}
          <button
            onClick={() => openAI(q.trim())}
            className="block w-full rounded-lg border border-green-600/40 bg-green-600/10 px-3 py-2 text-left hover:bg-green-600/20"
          >
            <span className="block text-sm text-green-300">
              🤖 Analyze “{q.trim()}” with AI
            </span>
            <span className="block text-xs text-green-300/60">
              Add a photo for a better estimate, then tap Analyze
            </span>
          </button>
          {localUnique.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Your foods
              </div>
              {localUnique.map((f, i) => (
                <FoodRow key={f.id || `l${i}`} item={f} onAdd={quickAdd} />
              ))}
            </div>
          )}
          <div className="space-y-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Database {searching && <span className="text-slate-500">· searching…</span>}
            </div>
            {!searching && results.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">
                No database match. Try the AI button for Thai dishes.
              </p>
            ) : (
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
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recent</div>
          {recent.length === 0 ? (
            <p className="py-1 text-sm text-slate-500">No history yet — add your first food.</p>
          ) : (
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {recent.map((f, i) => (
                <FoodRow key={f.id || `r${i}`} item={f} onAdd={quickAdd} />
              ))}
            </div>
          )}
        </div>
      )}

      <Button variant="ghost" className="w-full" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
