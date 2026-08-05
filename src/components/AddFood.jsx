import { lazy, Suspense, useEffect, useState } from 'react'
import { searchFoods, lookupBarcode, scaleFood, unitsFor } from '../lib/foodSearch'
import { Button, Field, Input, Select } from './ui'
import { MEALS } from './AddFoodForm'
import AddFoodForm from './AddFoodForm'
import PhotoLogger from './PhotoLogger'
import MealEditor from './MealEditor'
import FrequentEditor from './FrequentEditor'
import SwipeRow from './SwipeRow'
import ErrorBoundary from './ErrorBoundary'

// Barcode scanner pulls in @zxing (~450 KB) — load it only when the scanner
// actually opens, so it isn't in the initial bundle / PWA precache.
const BarcodeScanner = lazy(() => import('./BarcodeScanner'))

const r = (n) => Math.round(Number(n) || 0)
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10

// Grams/amount label for a stored template (recent log or saved food).
const amtOf = (t) => {
  const g = t.grams ?? t.default_grams
  return g ? `${r(g)}${t.unit || 'g'}` : ''
}

// One-line food row with a big ＋; saved rows also get a ✕ to remove.
function FoodRow({ item, onAdd, onOpen, onDelete, onEdit }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2">
      <button onClick={() => (onOpen || onAdd)(item)} className="min-w-0 flex-1 text-left">
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
      {onEdit && (
        <button
          onClick={() => onEdit(item)}
          className="px-1 text-slate-500 hover:text-white"
          aria-label="Edit saved food"
        >
          ✎
        </button>
      )}
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
  onUpdateMeal,
  onUpdateSaved,
  onCancel,
  busy,
}) {
  const [meal, setMeal] = useState(defaultMeal || 'lunch')
  const [view, setView] = useState('home') // home | saved | ai | manual | scan
  const [editingMeal, setEditingMeal] = useState(null)
  const [editingSaved, setEditingSaved] = useState(null)
  // Saved food being logged with a per-log serving multiplier (does NOT change
  // the saved record — reopening always starts back at ×1).
  const [savedPick, setSavedPick] = useState(null)
  const [savedServ, setSavedServ] = useState(1)
  const [savedServText, setSavedServText] = useState('1')
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
  const [aiBarcode, setAiBarcode] = useState(null) // cache the AI result to this barcode

  // Open the AI view. By default we only pre-fill the note (no auto-analyze) so
  // the user can still attach a photo before hitting Analyze. `barcode` (from a
  // scan miss) lets the AI result be cached against that product.
  const openAI = (note = '', hint = '', auto = false, barcode = null) => {
    setAiNote(note)
    setAiHint(hint)
    setAiAuto(auto)
    setAiBarcode(barcode)
    setView('ai')
  }

  // Rebuild a pickable food from a cached barcode row (stored per-100 basis).
  const cachedToFood = (f) => {
    const g = Number(f.default_grams) || 100
    const k = 100 / g
    return {
      code: f.barcode,
      name: f.food_name,
      brand: null,
      unit: f.unit === 'ml' ? 'ml' : 'g',
      serving_g: null,
      per100: {
        calories: Math.round(Number(f.calories || 0) * k),
        protein_g: Math.round(Number(f.protein_g || 0) * k * 10) / 10,
        carbs_g: Math.round(Number(f.carbs_g || 0) * k * 10) / 10,
        fat_g: Math.round(Number(f.fat_g || 0) * k * 10) / 10,
      },
    }
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
  // Saved-foods list excludes auto-cached barcode entries (they exist only so a
  // re-scan is instant — they shouldn't clutter your hand-saved foods).
  const savedFoods = saved.filter((f) => !f.barcode)

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
    setError(null)
    // 1) Personal cache — have we resolved this barcode before? Instant, offline.
    const cached = (saved || []).find((f) => f.barcode && String(f.barcode) === String(code))
    if (cached) {
      pick(cachedToFood(cached))
      return
    }
    setSearching(true)
    try {
      const food = await lookupBarcode(code)
      if (food) pick(food)
      // 3) Not in the database → hand off to AI, remembering the barcode so the
      //    label read gets cached for next time.
      else
        openAI(
          '',
          `Barcode ${code} isn't in the database — snap the nutrition label (or describe it) and tap Analyze. We'll remember it for next time.`,
          false,
          code
        )
    } catch (e) {
      setError(e.message)
    } finally {
      setSearching(false)
    }
  }

  const scaled = picked ? scaleFood(picked, unit, grams) : null

  function addPicked() {
    const name = picked.brand ? `${picked.name} — ${picked.brand}` : picked.name
    onLog(
      {
        food_name: name,
        meal_type: meal,
        grams: Number(grams) || null,
        unit,
        source: picked.code ? 'barcode' : 'search',
        ...scaled,
      },
      {
        asFrequent,
        // Cache barcode products (per-100 basis) so a re-scan is instant.
        cache: picked.code
          ? { barcode: String(picked.code), name, unit: picked.unit || 'g', per100: picked.per100 }
          : null,
      }
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

  // Open the serving picker for a saved food (always starts at ×1).
  function openSavedPick(f) {
    setSavedPick(f)
    setSavedServ(1)
    setSavedServText('1')
  }
  const stepSaved = (d) => {
    const n = Math.round((savedServ + d) * 10) / 10
    if (n >= 0.5) {
      setSavedServ(n)
      setSavedServText(String(n))
    }
  }
  const commitSavedServ = () => {
    const n = Number(savedServText)
    if (n > 0) {
      const v = Math.round(n * 100) / 100
      setSavedServ(v)
      setSavedServText(String(v))
    } else {
      setSavedServText(String(savedServ))
    }
  }
  // Log the saved food scaled by the chosen servings. The saved record is left
  // untouched; only this log entry gets the multiplied amounts.
  function addSaved() {
    const N = savedServ
    const t = savedPick
    onLog(
      {
        food_name: t.food_name,
        meal_type: meal,
        grams: t.default_grams != null ? r1(Number(t.default_grams) * N) : null,
        unit: t.unit ?? 'g',
        source: 'frequent',
        calories: Math.round(Number(t.calories || 0) * N),
        protein_g: r1(Number(t.protein_g || 0) * N),
        carbs_g: r1(Number(t.carbs_g || 0) * N),
        fat_g: r1(Number(t.fat_g || 0) * N),
      },
      { asFrequent: false }
    )
    setSavedPick(null)
  }

  // ---- sub-views -------------------------------------------------------
  if (view === 'scan') {
    return (
      <ErrorBoundary
        fallback={
          <div className="space-y-2 py-6 text-center text-sm text-slate-400">
            <p>Couldn't load the scanner — a new version may have just deployed.</p>
            <Button className="w-full" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setView('home')}>
              Back
            </Button>
          </div>
        }
      >
        <Suspense
          fallback={<p className="py-6 text-center text-sm text-slate-500">Loading scanner…</p>}
        >
          <BarcodeScanner onDetected={onScan} onCancel={() => setView('home')} />
        </Suspense>
      </ErrorBoundary>
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
        barcode={aiBarcode}
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

  // Serving picker for a saved food (before the list, so it swaps in on tap).
  if (savedPick) {
    const N = savedServ
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="min-w-0 truncate text-sm font-medium text-white">{savedPick.food_name}</span>
          <button className="text-sm text-slate-400 hover:text-white" onClick={() => setSavedPick(null)}>
            ‹ Back
          </button>
        </div>
        <div className="text-xs text-slate-500">
          per serving: {r(savedPick.calories)} kcal · {r(savedPick.protein_g)}P {r(savedPick.carbs_g)}C{' '}
          {r(savedPick.fat_g)}F
          {savedPick.default_grams ? ` · ${r(savedPick.default_grams)}${savedPick.unit || 'g'}` : ''}
        </div>

        <Field label="Meal">
          <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
            {MEALS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Servings">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => stepSaved(-0.5)}
              disabled={savedServ <= 0.5}
              className="h-9 w-9 shrink-0 rounded-lg bg-slate-700 text-xl leading-none text-white active:scale-95 disabled:opacity-40"
              aria-label="Fewer servings"
            >
              −
            </button>
            <div className="flex items-center">
              <span className="text-slate-400">×</span>
              <Input
                type="number"
                inputMode="decimal"
                value={savedServText}
                onChange={(e) => setSavedServText(e.target.value)}
                onBlur={commitSavedServ}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                className="w-16 px-1 text-center text-base font-bold tabular-nums"
                aria-label="Servings"
              />
            </div>
            <button
              onClick={() => stepSaved(0.5)}
              className="h-9 w-9 shrink-0 rounded-lg bg-slate-700 text-xl leading-none text-white active:scale-95"
              aria-label="More servings"
            >
              ＋
            </button>
          </div>
        </Field>

        <div className="text-center text-sm text-slate-300">
          <b className="text-white">{Math.round(Number(savedPick.calories || 0) * N)}</b> kcal ·{' '}
          {r1(Number(savedPick.protein_g || 0) * N)}P · {r1(Number(savedPick.carbs_g || 0) * N)}C ·{' '}
          {r1(Number(savedPick.fat_g || 0) * N)}F
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={addSaved} disabled={busy}>
            {busy ? 'Adding…' : 'Add to log'}
          </Button>
          <Button variant="ghost" onClick={() => setSavedPick(null)}>
            Back
          </Button>
        </div>
      </div>
    )
  }

  // Edit a saved (frequent) food. Checked BEFORE the saved-list view so opening
  // the editor from that list actually swaps to it (the list no longer wins).
  if (editingSaved) {
    return (
      <FrequentEditor
        food={editingSaved}
        busy={busy}
        onSave={(patch) => {
          onUpdateSaved?.(editingSaved.id, patch)
          setEditingSaved(null)
        }}
        onDelete={() => {
          onDeleteSaved?.(editingSaved)
          setEditingSaved(null)
        }}
        onCancel={() => setEditingSaved(null)}
      />
    )
  }

  // Saved (frequent) foods list.
  if (view === 'saved') {
    const list = matchLocal(savedFoods)
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
        {savedFoods.length > 0 && (
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter saved…" />
        )}
        {list.length > 0 && (
          <p className="text-[11px] text-slate-500">
            Tap a name to set servings · ＋ adds 1 · swipe a row to edit / delete
          </p>
        )}
        {list.length === 0 ? (
          <p className="py-2 text-sm text-slate-500">
            {savedFoods.length === 0 ? 'No saved foods yet.' : 'No match.'}
          </p>
        ) : (
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {list.map((f) => (
              <SwipeRow
                key={f.id}
                actions={[
                  ...(onUpdateSaved
                    ? [{ label: 'Edit', onClick: () => setEditingSaved(f), className: 'bg-slate-600 active:bg-slate-500' }]
                    : []),
                  { label: 'Delete', onClick: () => onDeleteSaved?.(f), className: 'bg-red-600 active:bg-red-700' },
                ]}
              >
                <FoodRow item={f} onAdd={quickAdd} onOpen={openSavedPick} />
              </SwipeRow>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Edit a saved meal.
  if (editingMeal) {
    return (
      <MealEditor
        meal={editingMeal}
        busy={busy}
        onSave={(patch) => {
          onUpdateMeal?.(editingMeal.id, patch)
          setEditingMeal(null)
        }}
        onDelete={() => {
          onDeleteMeal?.(editingMeal)
          setEditingMeal(null)
        }}
        onCancel={() => setEditingMeal(null)}
      />
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
          <>
          <p className="text-[11px] text-slate-500">Tap to add · swipe a row left to edit / delete</p>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {meals.map((m) => {
              const kcal = (m.items || []).reduce((s, it) => s + (Number(it.calories) || 0), 0)
              return (
                <SwipeRow
                  key={m.id}
                  actions={[
                    ...(onUpdateMeal
                      ? [{ label: 'Edit', onClick: () => setEditingMeal(m), className: 'bg-slate-600 active:bg-slate-500' }]
                      : []),
                    { label: 'Delete', onClick: () => onDeleteMeal(m), className: 'bg-red-600 active:bg-red-700' },
                  ]}
                >
                  <div className="flex items-center gap-2 bg-slate-800 px-3 py-2">
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
                  </div>
                </SwipeRow>
              )
            })}
          </div>
          </>
        )}
      </div>
    )
  }

  // ---- home ------------------------------------------------------------
  const localHits = ql ? [...matchLocal(savedFoods), ...matchLocal(recent)] : []
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
        <Button className="text-sm" onClick={() => openAI(q.trim())}>
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
