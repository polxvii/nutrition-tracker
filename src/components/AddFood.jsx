import { lazy, Suspense, useEffect, useState } from 'react'
import { searchFoods, lookupBarcode, scaleFood } from '../lib/foodSearch'
import { supabase } from '../lib/supabase'
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
  onSaveFrequent,
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
  const [savedGramsText, setSavedGramsText] = useState('') // synced to savedServ via per-serving grams
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [historyHits, setHistoryHits] = useState([]) // matches across ALL your logs
  const [subItemHits, setSubItemHits] = useState([]) // matches inside dish components
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(null)

  const [picked, setPicked] = useState(null)
  const [grams, setGrams] = useState('') // real grams/ml (canonical amount)
  const [servText, setServText] = useState('') // servings count, synced to grams
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
      serving_g: Number(f.serving_g) || null,
      per100: {
        calories: Math.round(Number(f.calories || 0) * k),
        protein_g: Math.round(Number(f.protein_g || 0) * k * 10) / 10,
        carbs_g: Math.round(Number(f.carbs_g || 0) * k * 10) / 10,
        fat_g: Math.round(Number(f.fat_g || 0) * k * 10) / 10,
        alcohol_g: Math.round(Number(f.alcohol_g || 0) * k * 10) / 10,
      },
    }
  }

  // Debounced Open Food Facts search.
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setResults([])
      setHistoryHits([])
      setSubItemHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    setError(null)
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      // Search your ENTIRE logged history by name (not just the recent 25),
      // de-duped by name — so anything you've ever logged is findable.
      supabase
        .from('food_logs')
        .select('id,food_name,calories,protein_g,carbs_g,fat_g,grams,unit,components,serving_g,servings,alcohol_g')
        .neq('source', 'exercise')
        .ilike('food_name', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(60)
        .then(({ data }) => {
          const seen = new Set()
          const out = []
          for (const l of data || []) {
            const k = (l.food_name || '').toLowerCase()
            if (!k || seen.has(k)) continue
            seen.add(k)
            out.push(l)
            if (out.length >= 15) break
          }
          setHistoryHits(out)
        })
      // Also match names INSIDE dish breakdowns, surfacing the sub-item itself
      // as a loggable food (so searching "egg" finds the egg inside a past dish).
      const ql2 = query.toLowerCase()
      supabase
        .from('food_logs')
        .select('components')
        .not('components', 'is', null)
        .order('created_at', { ascending: false })
        .limit(150)
        .then(({ data }) => {
          const seen = new Set()
          const out = []
          for (const row of data || []) {
            for (const c of row.components || []) {
              const nm = (c.name || '').toLowerCase()
              if (!nm || !nm.includes(ql2) || seen.has(nm)) continue
              seen.add(nm)
              out.push({
                food_name: c.name,
                grams: c.grams ?? null,
                unit: 'g',
                calories: c.calories,
                protein_g: c.protein_g,
                carbs_g: c.carbs_g,
                fat_g: c.fat_g,
              })
              if (out.length >= 15) break
            }
            if (out.length >= 15) break
          }
          setSubItemHits(out)
        })
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
      // Default to 1 serving, but hold the amount in real grams so both the
      // servings and grams fields stay meaningful and in sync.
      setGrams(String(Math.round(food.serving_g)))
      setServText('1')
    } else {
      setGrams('100')
      setServText('')
    }
  }
  // Servings ⇄ grams: editing one keeps the other in step via serving_g.
  const onGramsChange = (v) => {
    setGrams(v)
    if (picked?.serving_g) setServText(String(Math.round((Number(v) / picked.serving_g) * 100) / 100))
  }
  const onServChange = (v) => {
    setServText(v)
    if (picked?.serving_g && Number(v) > 0) setGrams(String(Math.round(picked.serving_g * Number(v))))
  }

  async function onScan(code) {
    setView('home')
    setError(null)
    // 1) Personal cache — have we resolved this barcode before? Instant, offline.
    const cached = (saved || []).find((f) => f.barcode && String(f.barcode) === String(code))
    if (cached) {
      const food = cachedToFood(cached)
      // Older cache rows predate serving_g — re-fetch once to recover the
      // serving size so the servings field shows; fall back to the cache if the
      // lookup is unavailable (offline).
      if (food.serving_g) {
        pick(food)
        return
      }
      setSearching(true)
      try {
        const fresh = await lookupBarcode(code)
        pick(fresh?.serving_g ? fresh : food)
      } catch {
        pick(food)
      } finally {
        setSearching(false)
      }
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

  // grams always holds the real amount in the base unit now, so scale by grams.
  const scaled = picked ? scaleFood(picked, picked.unit || 'g', grams) : null

  function addPicked() {
    const name = picked.brand ? `${picked.name} — ${picked.brand}` : picked.name
    const g = Number(grams) || 0
    const servingG = picked.serving_g || null
    onLog(
      {
        food_name: name,
        meal_type: meal,
        // Always the real grams + base unit. serving_g (+ servings count) is
        // only attached for serving-based foods so the diary can show
        // "1 serving" and the edit screen can offer synced servings ⇄ grams —
        // plain gram/ml foods send no serving fields, so nothing changes for
        // them (and they still log fine before the serving_g column exists).
        grams: g || null,
        unit: picked.unit || 'g',
        source: picked.code ? 'barcode' : 'search',
        ...(servingG ? { serving_g: servingG, servings: Math.round((g / servingG) * 100) / 100 } : {}),
        ...scaled,
      },
      {
        asFrequent,
        // Cache barcode products (per-100 basis) so a re-scan is instant.
        cache: picked.code
          ? {
              barcode: String(picked.code),
              name,
              unit: picked.unit || 'g',
              per100: picked.per100,
              serving_g: picked.serving_g || null,
            }
          : null,
      }
    )
  }

  // Log a saved meal as ONE dish row whose items become its components (like an
  // AI dish), so the diary shows a single entry you can drill into — not N loose
  // rows. Totals are the sum of the items.
  function logMeal(m) {
    const items = m.items || []
    if (!items.length) return
    const tot = items.reduce(
      (a, it) => ({
        grams: a.grams + (Number(it.grams) || 0),
        calories: a.calories + (Number(it.calories) || 0),
        protein_g: a.protein_g + (Number(it.protein_g) || 0),
        carbs_g: a.carbs_g + (Number(it.carbs_g) || 0),
        fat_g: a.fat_g + (Number(it.fat_g) || 0),
        alcohol_g: a.alcohol_g + (Number(it.alcohol_g) || 0),
      }),
      { grams: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, alcohol_g: 0 }
    )
    onLogMeal({
      food_name: m.name,
      meal_type: meal,
      source: 'meal',
      grams: tot.grams || null,
      unit: 'g',
      calories: Math.round(tot.calories),
      protein_g: r1(tot.protein_g),
      carbs_g: r1(tot.carbs_g),
      fat_g: r1(tot.fat_g),
      ...(tot.alcohol_g > 0 ? { alcohol_g: r1(tot.alcohol_g) } : {}),
      components: items.map((it) => ({
        name: it.food_name || 'Item',
        grams: Number(it.grams) || null,
        calories: Number(it.calories) || 0,
        protein_g: Number(it.protein_g) || 0,
        carbs_g: Number(it.carbs_g) || 0,
        fat_g: Number(it.fat_g) || 0,
        ...(Number(it.alcohol_g) ? { alcohol_g: Number(it.alcohol_g) } : {}),
      })),
    })
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
        ...(Number(t.alcohol_g) ? { alcohol_g: Number(t.alcohol_g) } : {}),
        // Re-adding a logged dish carries its breakdown along, so you can still
        // drill in and edit the parts.
        ...(t.components?.length ? { components: t.components } : {}),
        // Carry serving info so a re-added serving-food keeps its serving view.
        ...(t.serving_g ? { serving_g: t.serving_g, servings: t.servings ?? null } : {}),
      },
      { asFrequent: false }
    )
  }

  // Per-serving grams of the saved food being picked (0 if it has no amount).
  const savedBaseG = () => Number(savedPick?.default_grams ?? savedPick?.grams) || 0
  // Open the serving picker for a saved food (always starts at ×1). Servings and
  // grams stay in sync — 1 serving = the saved food's own amount.
  function openSavedPick(f) {
    setSavedPick(f)
    setSavedServ(1)
    setSavedServText('1')
    const g = Number(f.default_grams ?? f.grams) || 0
    setSavedGramsText(g > 0 ? String(Math.round(g)) : '')
  }
  function applySavedServ(n) {
    setSavedServ(n)
    setSavedServText(String(n))
    const b = savedBaseG()
    if (b > 0) setSavedGramsText(String(Math.round(b * n)))
  }
  const stepSaved = (d) => {
    const n = Math.round((savedServ + d) * 10) / 10
    if (n >= 0.5) applySavedServ(n)
  }
  const commitSavedServ = () => {
    const n = Number(savedServText)
    if (n > 0) applySavedServ(Math.round(n * 100) / 100)
    else setSavedServText(String(savedServ))
  }
  // Editing grams sets the servings count from it (grams ÷ per-serving grams).
  const commitSavedGrams = () => {
    const b = savedBaseG()
    const gv = Number(savedGramsText)
    if (b > 0 && gv > 0) {
      const n = Math.round((gv / b) * 100) / 100
      setSavedServ(n)
      setSavedServText(String(n))
      setSavedGramsText(String(Math.round(gv)))
    } else {
      setSavedGramsText(b > 0 ? String(Math.round(b * savedServ)) : savedGramsText)
    }
  }
  // Log the picked template (saved food OR recent item) scaled by the chosen
  // servings. The source template is left untouched; only this log entry gets
  // the multiplied amounts. A recent dish carries its component breakdown along
  // (scaled too), so the drill-down still works.
  function addSaved() {
    const N = savedServ
    const t = savedPick
    const g = t.default_grams ?? t.grams
    const perServ = Number(g) || 0
    const entry = {
      food_name: t.food_name,
      meal_type: meal,
      grams: g != null ? r1(Number(g) * N) : null,
      unit: t.unit ?? 'g',
      source: t.source || 'frequent',
      calories: Math.round(Number(t.calories || 0) * N),
      protein_g: r1(Number(t.protein_g || 0) * N),
      carbs_g: r1(Number(t.carbs_g || 0) * N),
      fat_g: r1(Number(t.fat_g || 0) * N),
      ...(Number(t.alcohol_g) ? { alcohol_g: r1(Number(t.alcohol_g) * N) } : {}),
      // Remember it was logged as N servings (1 serving = perServ grams), so the
      // edit screen reopens at N — not a stray ×1 — and grams stay editable.
      ...(perServ > 0 ? { serving_g: r1(perServ), servings: N } : {}),
    }
    if (t.components?.length) {
      entry.components = t.components.map((c) => ({
        name: c.name,
        grams: c.grams != null ? r1(Number(c.grams) * N) : null,
        calories: Math.round(Number(c.calories || 0) * N),
        protein_g: r1(Number(c.protein_g || 0) * N),
        carbs_g: r1(Number(c.carbs_g || 0) * N),
        fat_g: r1(Number(c.fat_g || 0) * N),
        ...(Number(c.alcohol_g) ? { alcohol_g: r1(Number(c.alcohol_g) * N) } : {}),
      }))
    }
    onLog(entry, { asFrequent: false })
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

        <Field label="Meal">
          <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
            {MEALS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>

        {picked.serving_g ? (
          // Serving-based product: servings + grams, both editable and synced.
          <div className="grid grid-cols-2 gap-3">
            <Field label="Servings">
              <Input
                type="number"
                inputMode="decimal"
                value={servText}
                onChange={(e) => onServChange(e.target.value)}
              />
            </Field>
            <Field label={`Amount (${picked.unit})`}>
              <Input
                type="number"
                inputMode="decimal"
                value={grams}
                onChange={(e) => onGramsChange(e.target.value)}
              />
            </Field>
          </div>
        ) : (
          <Field label={`Amount (${picked.unit})`}>
            <Input
              type="number"
              inputMode="decimal"
              value={grams}
              onChange={(e) => setGrams(e.target.value)}
            />
          </Field>
        )}

        <div className="text-center text-sm text-slate-300">
          <b className="text-white">{r(scaled.calories)}</b> kcal · {r(scaled.protein_g)}P ·{' '}
          {r(scaled.carbs_g)}C · {r(scaled.fat_g)}F
          {scaled.alcohol_g > 0 && <span className="text-fuchsia-300"> · 🍷 {r1(scaled.alcohol_g)}g</span>}
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
    const baseG = Number(savedPick.default_grams ?? savedPick.grams) || 0
    const pickUnit = savedPick.unit || 'g'
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
          {baseG ? ` · ${r(baseG)}${pickUnit}` : ''}
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

        {baseG > 0 && (
          <Field label={`Amount (${pickUnit})`}>
            <Input
              type="number"
              inputMode="decimal"
              value={savedGramsText}
              onChange={(e) => setSavedGramsText(e.target.value)}
              onBlur={commitSavedGrams}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </Field>
        )}

        <div className="text-center text-sm text-slate-300">
          <b className="text-white">{Math.round(Number(savedPick.calories || 0) * N)}</b> kcal ·{' '}
          {r1(Number(savedPick.protein_g || 0) * N)}P · {r1(Number(savedPick.carbs_g || 0) * N)}C ·{' '}
          {r1(Number(savedPick.fat_g || 0) * N)}F
          {baseG ? ` · ${Math.round(baseG * N)}${pickUnit}` : ''}
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
          <div className="space-y-1">
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
          <div className="space-y-1">
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
  // Your foods = saved + recent (in-memory) + full-history + sub-item matches.
  const localHits = ql
    ? [...matchLocal(savedFoods), ...matchLocal(recent), ...historyHits, ...subItemHits]
    : []
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
                <FoodRow key={f.id || `l${i}`} item={f} onAdd={quickAdd} onOpen={openSavedPick} />
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
              <div className="space-y-1">
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
            <>
            <p className="text-[11px] text-slate-500">
              Tap a name to set servings · ＋ adds 1{onSaveFrequent ? ' · swipe to ⭐ save' : ''}
            </p>
            <div className="space-y-1">
              {recent.map((f, i) => {
                const row = <FoodRow item={f} onAdd={quickAdd} onOpen={openSavedPick} />
                return onSaveFrequent ? (
                  <SwipeRow
                    key={f.id || `r${i}`}
                    actions={[
                      { label: '⭐ Save', onClick: () => onSaveFrequent(f), className: 'bg-green-700 active:bg-green-600' },
                    ]}
                  >
                    {row}
                  </SwipeRow>
                ) : (
                  <div key={f.id || `r${i}`}>{row}</div>
                )
              })}
            </div>
            </>
          )}
        </div>
      )}

      <Button variant="ghost" className="w-full" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
