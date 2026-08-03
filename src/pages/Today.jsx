import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { dayRange, prettyDate, todayISODate } from '../lib/dateHelpers'
import { useSwipe } from '../lib/useSwipe'
import { mealForNow } from '../lib/mealWindows'
import ProgressRing from '../components/ProgressRing'
import { MEALS } from '../components/AddFoodForm'
import AddFood from '../components/AddFood'
import ExerciseForm from '../components/ExerciseForm'
import EntryEditor from '../components/EntryEditor'
import { Button, Card, Input, Skeleton } from '../components/ui'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

// Log sections in display order. 'other' catches food with no meal set;
// 'exercise' holds burned-calorie entries (source === 'exercise').
const GROUP_ORDER = ['breakfast', 'lunch', 'dinner', 'night', 'snack', 'other', 'exercise']
const GROUP_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  night: 'Night',
  snack: 'Snack',
  other: 'Other',
  exercise: 'Exercise',
}
const MEAL_VALUES = MEALS.map((m) => m.value)

const dateObj = (dateStr) => new Date(dateStr + 'T00:00:00')
// timestamp inside the selected local day (noon dodges timezone edges)
const timestampFor = (dateStr) => new Date(dateStr + 'T12:00:00').toISOString()
const shiftDate = (dateStr, days) => {
  const d = dateObj(dateStr)
  d.setDate(d.getDate() + days)
  return todayISODate(d)
}

export default function Today() {
  const { user, profile } = useAuth()
  const [params, setParams] = useSearchParams()
  const selectedDate = params.get('date') || todayISODate()
  const isToday = selectedDate === todayISODate()

  const [logs, setLogs] = useState([])
  const [frequents, setFrequents] = useState([])
  const [recent, setRecent] = useState([])
  const [savedMeals, setSavedMeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showExercise, setShowExercise] = useState(false)
  const [editingEntry, setEditingEntry] = useState(null)
  const [mealPicker, setMealPicker] = useState(null) // { groupKey }
  const [mealSel, setMealSel] = useState(() => new Set()) // selected log ids
  const [mealName, setMealName] = useState('')
  const [recentExercises, setRecentExercises] = useState([]) // quick-pick chips
  const [busy, setBusy] = useState(false)

  const closePanels = () => {
    setShowAdd(false)
    setShowExercise(false)
  }
  const togglePanel = (isOpen, open) => () => {
    const next = !isOpen
    closePanels()
    open(next)
  }

  const setDate = (d) =>
    setParams(d === todayISODate() ? {} : { date: d }, { replace: true })

  // Swipe the diary left/right to move a day (disabled while a panel/modal is
  // open, so a swipe there doesn't change the day underneath).
  const daySwipe = useSwipe({
    onLeft: () => setDate(shiftDate(selectedDate, 1)),
    onRight: () => setDate(shiftDate(selectedDate, -1)),
  })

  const load = useCallback(async () => {
    setLoading(true)
    const { start, end } = dayRange(dateObj(selectedDate))
    const [logsRes, freqRes, recentRes, mealsRes, exRes] = await Promise.all([
      supabase
        .from('food_logs')
        .select('*')
        .gte('logged_at', start)
        .lt('logged_at', end)
        .order('logged_at', { ascending: true }),
      supabase
        .from('frequent_foods')
        .select('*')
        .order('times_used', { ascending: false })
        .limit(100),
      supabase
        .from('food_logs')
        .select('*')
        .neq('source', 'exercise')
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('saved_meals')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('food_logs')
        .select('food_name,calories,created_at')
        .eq('source', 'exercise')
        .order('created_at', { ascending: false })
        .limit(60),
    ])
    setLogs(logsRes.data ?? [])
    setFrequents(freqRes.data ?? [])
    setSavedMeals(mealsRes.data ?? [])
    // Most-recent-first, de-duped by food name → quick "Recent" list.
    const seen = new Set()
    const recentFoods = []
    for (const l of recentRes.data ?? []) {
      const k = (l.food_name || '').toLowerCase()
      if (!k || seen.has(k)) continue
      seen.add(k)
      recentFoods.push(l)
      if (recentFoods.length >= 25) break
    }
    setRecent(recentFoods)
    // Recent exercises, de-duped by name (keeps the most recent kcal).
    const exSeen = new Set()
    const exList = []
    for (const l of exRes.data ?? []) {
      const k = (l.food_name || '').toLowerCase()
      if (!k || exSeen.has(k)) continue
      exSeen.add(k)
      exList.push({ name: l.food_name, calories: Math.round(num(l.calories)) })
      if (exList.length >= 8) break
    }
    setRecentExercises(exList)
    setLoading(false)
  }, [selectedDate])

  useEffect(() => {
    load()
  }, [load])

  const totals = useMemo(
    () =>
      logs.reduce(
        (a, l) => {
          if (l.source === 'exercise') {
            a.burned += num(l.calories)
            return a
          }
          a.calories += num(l.calories)
          a.protein += num(l.protein_g)
          a.carbs += num(l.carbs_g)
          a.fat += num(l.fat_g)
          return a
        },
        { calories: 0, burned: 0, protein: 0, carbs: 0, fat: 0 }
      ),
    [logs]
  )

  // Group logs into meal sections (+ exercise) for the diary view.
  const groups = useMemo(() => {
    const g = { breakfast: [], lunch: [], dinner: [], night: [], snack: [], other: [], exercise: [] }
    for (const l of logs) {
      if (l.source === 'exercise') g.exercise.push(l)
      else if (MEAL_VALUES.includes(l.meal_type)) g[l.meal_type].push(l)
      else g.other.push(l)
    }
    return g
  }, [logs])

  const goalCal = profile?.goal_calories ?? 0
  // Remaining = goal − eaten + burned (exercise gives calories back).
  const remaining = Math.round(goalCal - totals.calories + totals.burned)
  // Net kcal tiered like Progress/Calendar (green ≤ goal · amber over goal ·
  // red over maintenance) — colours the calorie ring and the "over" number.
  const netCal = totals.calories - totals.burned
  const maint = profile?.tdee ?? 0
  const calColor =
    maint > 0 && netCal > maint
      ? '#ef4444'
      : goalCal > 0 && netCal > goalCal
        ? '#f59e0b'
        : '#22c55e'

  // ---- actions ----
  async function upsertFrequent(entry) {
    const { data: existing } = await supabase
      .from('frequent_foods')
      .select('id, times_used')
      .eq('food_name', entry.food_name)
      .maybeSingle()
    if (existing) {
      await supabase
        .from('frequent_foods')
        .update({
          times_used: existing.times_used + 1,
          default_grams: entry.grams,
          unit: entry.unit ?? 'g',
          calories: entry.calories,
          protein_g: entry.protein_g,
          carbs_g: entry.carbs_g,
          fat_g: entry.fat_g,
        })
        .eq('id', existing.id)
    } else {
      await supabase.from('frequent_foods').insert({
        user_id: user.id,
        food_name: entry.food_name,
        default_grams: entry.grams,
        unit: entry.unit ?? 'g',
        calories: entry.calories,
        protein_g: entry.protein_g,
        carbs_g: entry.carbs_g,
        fat_g: entry.fat_g,
        times_used: 1,
      })
    }
  }

  // Cache a resolved barcode → product (stored per-100 basis) so the next scan
  // of the same product is instant, with no OFF/AI round-trip. Keyed by barcode.
  async function cacheBarcode(cache) {
    if (!cache?.barcode || !cache.per100) return
    const { data: existing } = await supabase
      .from('frequent_foods')
      .select('id')
      .eq('barcode', String(cache.barcode))
      .maybeSingle()
    const row = {
      food_name: cache.name || 'Product',
      barcode: String(cache.barcode),
      default_grams: 100,
      unit: cache.unit || 'g',
      calories: Math.round(num(cache.per100.calories)),
      protein_g: num(cache.per100.protein_g),
      carbs_g: num(cache.per100.carbs_g),
      fat_g: num(cache.per100.fat_g),
    }
    if (existing) await supabase.from('frequent_foods').update(row).eq('id', existing.id)
    else await supabase.from('frequent_foods').insert({ user_id: user.id, times_used: 1, ...row })
  }

  // Single food added from any path (recent/saved/search/barcode/manual).
  async function handleLog(entry, { asFrequent, cache } = {}) {
    setBusy(true)
    const { error } = await supabase.from('food_logs').insert({
      user_id: user.id,
      logged_at: timestampFor(selectedDate),
      source: entry.source || 'manual',
      ...entry,
    })
    if (error) {
      alert(error.message)
      setBusy(false)
      return
    }
    if (asFrequent) await upsertFrequent(entry)
    if (cache) await cacheBarcode(cache)
    setShowAdd(false)
    setBusy(false)
    await load()
  }

  async function handlePhotoLog(entries, { note, confidence, asFrequent, cache } = {}) {
    setBusy(true)
    const ts = timestampFor(selectedDate)
    const rows = entries.map((e) => {
      const row = {
        user_id: user.id,
        logged_at: ts,
        source: 'ai',
        meal_type: e.meal_type,
        food_name: e.food_name,
        grams: e.grams,
        unit: 'g',
        calories: e.calories,
        protein_g: e.protein_g,
        carbs_g: e.carbs_g,
        fat_g: e.fat_g,
        user_note: note,
        ai_confidence: confidence,
      }
      // Only reference the components column for a real breakdown (a dish).
      if (e.components) row.components = e.components
      return row
    })
    const { error } = await supabase.from('food_logs').insert(rows)
    if (error) {
      alert(error.message)
      setBusy(false)
      return
    }
    if (asFrequent) {
      for (const e of entries) await upsertFrequent(e)
    }
    if (cache) await cacheBarcode(cache)
    setShowAdd(false)
    setBusy(false)
    await load()
  }

  // Log every item of a saved meal at once.
  async function handleLogMeal(entries) {
    setBusy(true)
    const ts = timestampFor(selectedDate)
    const rows = entries.map((e) => ({
      user_id: user.id,
      logged_at: ts,
      source: e.source || 'meal',
      meal_type: e.meal_type,
      food_name: e.food_name,
      grams: e.grams,
      unit: e.unit ?? 'g',
      calories: e.calories,
      protein_g: e.protein_g,
      carbs_g: e.carbs_g,
      fat_g: e.fat_g,
    }))
    const { error } = await supabase.from('food_logs').insert(rows)
    if (error) {
      alert(error.message)
      setBusy(false)
      return
    }
    setShowAdd(false)
    setBusy(false)
    await load()
  }

  // Open the "save as meal" picker for a diary section — all items pre-selected;
  // the user can uncheck any they don't want in the combo.
  function openMealPicker(key, items) {
    setMealPicker({ groupKey: key })
    setMealSel(new Set(items.map((l) => l.id)))
    setMealName(`My ${GROUP_LABELS[key]}`)
  }

  const toggleMealSel = (id) =>
    setMealSel((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  // Save the selected items of a diary section as a reusable meal (combo).
  async function confirmSaveMeal() {
    const items = (groups[mealPicker.groupKey] || []).filter((l) => mealSel.has(l.id))
    if (!items.length) {
      alert('Pick at least one item')
      return
    }
    const name = mealName.trim()
    if (!name) {
      alert('Name the meal')
      return
    }
    const mealItems = items.map((l) => ({
      food_name: l.food_name,
      grams: l.grams,
      unit: l.unit ?? 'g',
      calories: num(l.calories),
      protein_g: num(l.protein_g),
      carbs_g: num(l.carbs_g),
      fat_g: num(l.fat_g),
    }))
    setBusy(true)
    const { error } = await supabase
      .from('saved_meals')
      .insert({ user_id: user.id, name, items: mealItems })
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    setMealPicker(null)
    await load()
  }

  async function deleteMeal(id) {
    if (!window.confirm('Delete this saved meal?')) return
    setSavedMeals((prev) => prev.filter((m) => m.id !== id))
    await supabase.from('saved_meals').delete().eq('id', id)
  }

  async function handleAddExercise({ name, calories }) {
    setBusy(true)
    const { error } = await supabase.from('food_logs').insert({
      user_id: user.id,
      logged_at: timestampFor(selectedDate),
      source: 'exercise',
      meal_type: null,
      food_name: name,
      calories,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    })
    if (error) {
      alert(error.message)
      setBusy(false)
      return
    }
    setShowExercise(false)
    setBusy(false)
    await load()
  }

  async function deleteFrequent(id) {
    if (!window.confirm('Remove this frequent food?')) return
    setFrequents((prev) => prev.filter((f) => f.id !== id))
    await supabase.from('frequent_foods').delete().eq('id', id)
  }

  async function deleteLog(id) {
    setLogs((prev) => prev.filter((l) => l.id !== id))
    await supabase.from('food_logs').delete().eq('id', id)
  }

  async function saveEntry(patch) {
    const { date, ...fields } = patch
    fields.logged_at = timestampFor(date)
    setBusy(true)
    const { error } = await supabase.from('food_logs').update(fields).eq('id', editingEntry.id)
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    setEditingEntry(null)
    await load()
  }

  async function duplicateEntry(patch) {
    const { date, ...fields } = patch
    setBusy(true)
    const { error } = await supabase.from('food_logs').insert({
      user_id: user.id,
      logged_at: timestampFor(date),
      ...fields,
    })
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    setEditingEntry(null)
    await load()
  }

  const swipeEnabled = !(showAdd || showExercise || editingEntry || mealPicker)

  return (
    <div className="mx-auto max-w-md space-y-4 p-4" {...(swipeEnabled ? daySwipe : {})}>
      {/* Date navigation */}
      <header className="flex items-center justify-between">
        <button
          onClick={() => setDate(shiftDate(selectedDate, -1))}
          className="rounded-xl px-4 py-2 text-3xl leading-none text-slate-300 hover:text-white active:bg-slate-800"
          aria-label="Previous day"
        >
          ‹
        </button>
        <div className="flex flex-col items-center">
          <span className="text-base font-bold text-white">
            {isToday ? 'Today' : prettyDate(dateObj(selectedDate))}
          </span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="mt-0.5 bg-transparent text-xs text-slate-500 outline-none"
          />
        </div>
        <button
          onClick={() => setDate(shiftDate(selectedDate, 1))}
          className="rounded-xl px-4 py-2 text-3xl leading-none text-slate-300 hover:text-white active:bg-slate-800"
          aria-label="Next day"
        >
          ›
        </button>
      </header>

      {/* Daily summary */}
      <Card className="space-y-4">
        <div className="flex items-center justify-center gap-5">
          <ProgressRing
            value={totals.calories}
            max={goalCal}
            size={120}
            stroke={11}
            color={calColor}
            label="Calories"
            unit="kcal"
          />
          <div className="text-center">
            <div className="text-4xl font-bold" style={{ color: calColor }}>
              {Math.abs(remaining)}
            </div>
            <div className="text-sm text-slate-400">kcal {remaining >= 0 ? 'left' : 'over'}</div>
            {totals.burned > 0 && (
              <div className="mt-1 text-sm text-slate-400">🔥 {Math.round(totals.burned)} burned</div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ProgressRing
            value={totals.protein}
            max={profile?.goal_protein_g ?? 0}
            size={92}
            stroke={8}
            color="#22c55e"
            underColor="#f59e0b"
            label="Protein"
            unit="g"
          />
          <ProgressRing
            value={totals.carbs}
            max={profile?.goal_carbs_g ?? 0}
            size={92}
            stroke={8}
            color="#3b82f6"
            overColor="#ef4444"
            label="Carbs"
            unit="g"
          />
          <ProgressRing
            value={totals.fat}
            max={profile?.goal_fat_g ?? 0}
            size={92}
            stroke={8}
            color="#94a3b8"
            overColor="#ef4444"
            label="Fat"
            unit="g"
          />
        </div>
      </Card>

      {/* Quick actions */}
      <div className="space-y-2">
        <Button className="w-full py-3.5 text-base" onClick={togglePanel(showAdd, setShowAdd)}>
          ＋ Add food
        </Button>
        <Button
          variant="ghost"
          className="w-full text-sm"
          onClick={togglePanel(showExercise, setShowExercise)}
        >
          🏃 Exercise
        </Button>
      </div>

      {showAdd && (
        <Card>
          <AddFood
            defaultMeal={mealForNow(profile?.meal_windows)}
            recent={recent}
            saved={frequents}
            meals={savedMeals}
            onLog={handleLog}
            onLogMany={handlePhotoLog}
            onLogMeal={handleLogMeal}
            onDeleteSaved={(f) => deleteFrequent(f.id)}
            onDeleteMeal={(m) => deleteMeal(m.id)}
            onCancel={() => setShowAdd(false)}
            busy={busy}
          />
        </Card>
      )}

      {showExercise && (
        <Card>
          <ExerciseForm
            onSubmit={handleAddExercise}
            onCancel={() => setShowExercise(false)}
            busy={busy}
            recent={recentExercises}
          />
        </Card>
      )}

      {/* Log list */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">
          {isToday ? "Today's log" : 'Log'}
        </h2>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <Card>
            <p className="py-4 text-center text-sm text-slate-500">
              <span className="mb-1 block text-3xl">🍽️</span>
              Nothing logged yet — tap <b className="text-slate-300">＋ Add food</b> to start.
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {GROUP_ORDER.map((key) => {
              const g = groups[key]
              if (!g.length) return null
              const isEx = key === 'exercise'
              const sub = g.reduce((s, l) => s + num(l.calories), 0)
              return (
                <div key={key}>
                  <div className="mb-1 flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {GROUP_LABELS[key]}
                      </span>
                      {!isEx && g.length > 0 && (
                        <button
                          onClick={() => openMealPicker(key, g)}
                          className="text-xs text-slate-500 hover:text-green-400"
                        >
                          ＋ meal
                        </button>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">
                      {isEx ? '−' : ''}
                      {Math.round(sub)} kcal
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {g.map((l) => (
                      <div
                        key={l.id}
                        className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2.5"
                      >
                        <button
                          onClick={() => setEditingEntry(l)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="truncate text-sm text-white">
                            {isEx ? '🏃 ' : ''}
                            {l.food_name}
                          </div>
                          {!isEx && (
                            <div className="text-xs text-slate-500">
                              {Math.round(num(l.protein_g))}P · {Math.round(num(l.carbs_g))}C ·{' '}
                              {Math.round(num(l.fat_g))}F
                              {l.grams ? ` · ${Math.round(num(l.grams))}${l.unit || 'g'}` : ''}
                              {l.components?.length ? ` · 🍱 ${l.components.length} items` : ''}
                            </div>
                          )}
                        </button>
                        <div className="ml-3 flex items-center gap-3">
                          <span
                            className={`whitespace-nowrap text-sm font-medium ${
                              isEx ? 'text-green-400' : 'text-slate-200'
                            }`}
                          >
                            {isEx ? '−' : ''}
                            {Math.round(num(l.calories))} kcal
                          </span>
                          <button
                            onClick={() => deleteLog(l.id)}
                            className="text-slate-500 hover:text-red-400"
                            aria-label="Delete"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editingEntry && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 p-3"
          onClick={() => setEditingEntry(null)}
        >
          <div
            className="mb-2 w-full max-w-md overflow-y-auto overflow-x-hidden rounded-2xl bg-slate-900 p-4"
            style={{ maxHeight: '85vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <EntryEditor
              entry={editingEntry}
              onSave={saveEntry}
              onDuplicate={duplicateEntry}
              onDelete={(id) => {
                deleteLog(id)
                setEditingEntry(null)
              }}
              onClose={() => setEditingEntry(null)}
              busy={busy}
              recent={recent}
              saved={frequents}
              meals={savedMeals}
              onSaveFrequent={upsertFrequent}
            />
          </div>
        </div>
      )}

      {mealPicker && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 p-3"
          onClick={() => setMealPicker(null)}
        >
          <div
            className="mb-2 w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-slate-900 p-4"
            style={{ maxHeight: '85vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="text-base font-bold text-white">Save as meal</div>
              <p className="text-xs text-slate-500">Pick the items to include in this combo.</p>
            </div>

            <div className="space-y-1.5">
              {(groups[mealPicker.groupKey] || []).map((l) => {
                const on = mealSel.has(l.id)
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleMealSel(l.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                      on ? 'bg-slate-800' : 'bg-slate-900 opacity-50'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${
                        on ? 'border-green-500 bg-green-600 text-white' : 'border-slate-600 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{l.food_name}</span>
                      <span className="text-xs text-slate-500">
                        {Math.round(num(l.calories))} kcal · {Math.round(num(l.protein_g))}P{' '}
                        {Math.round(num(l.carbs_g))}C {Math.round(num(l.fat_g))}F
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="text-center text-xs text-slate-400">
              {mealSel.size} item{mealSel.size === 1 ? '' : 's'} ·{' '}
              {Math.round(
                (groups[mealPicker.groupKey] || [])
                  .filter((l) => mealSel.has(l.id))
                  .reduce((s, l) => s + num(l.calories), 0)
              )}{' '}
              kcal
            </div>

            <Input
              value={mealName}
              onChange={(e) => setMealName(e.target.value)}
              placeholder="Meal name"
            />

            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={confirmSaveMeal}
                disabled={busy || mealSel.size === 0}
              >
                {busy ? 'Saving…' : 'Save meal'}
              </Button>
              <Button variant="ghost" onClick={() => setMealPicker(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
