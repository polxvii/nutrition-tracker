import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { dayRange, prettyDate, todayISODate } from '../lib/dateHelpers'
import ProgressRing from '../components/ProgressRing'
import AddFoodForm, { MEALS } from '../components/AddFoodForm'
import PhotoLogger from '../components/PhotoLogger'
import FrequentPicker from '../components/FrequentPicker'
import ExerciseForm from '../components/ExerciseForm'
import { Button, Card } from '../components/ui'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

// Log sections in display order. 'other' catches food with no meal set;
// 'exercise' holds burned-calorie entries (source === 'exercise').
const GROUP_ORDER = ['breakfast', 'lunch', 'dinner', 'snack', 'other', 'exercise']
const GROUP_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  other: 'Other',
  exercise: 'Exercise',
}
const MEAL_VALUES = MEALS.map((m) => m.value)

// Default meal for a quick-add, based on the current time of day.
function mealForNow() {
  const h = new Date().getHours()
  if (h < 11) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

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
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
  const [showFrequent, setShowFrequent] = useState(false)
  const [showExercise, setShowExercise] = useState(false)
  const [repeatOpen, setRepeatOpen] = useState(false)
  const [repeatFrom, setRepeatFrom] = useState('')
  const [busy, setBusy] = useState(false)

  const closePanels = () => {
    setShowForm(false)
    setShowPhoto(false)
    setShowFrequent(false)
    setShowExercise(false)
    setRepeatOpen(false)
  }
  const togglePanel = (isOpen, open) => () => {
    const next = !isOpen
    closePanels()
    open(next)
  }

  const setDate = (d) =>
    setParams(d === todayISODate() ? {} : { date: d }, { replace: true })

  const load = useCallback(async () => {
    setLoading(true)
    const { start, end } = dayRange(dateObj(selectedDate))
    const [logsRes, freqRes] = await Promise.all([
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
    ])
    setLogs(logsRes.data ?? [])
    setFrequents(freqRes.data ?? [])
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
    const g = { breakfast: [], lunch: [], dinner: [], snack: [], other: [], exercise: [] }
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
        calories: entry.calories,
        protein_g: entry.protein_g,
        carbs_g: entry.carbs_g,
        fat_g: entry.fat_g,
        times_used: 1,
      })
    }
  }

  async function handleAdd(entry, { asFrequent }) {
    setBusy(true)
    const { error } = await supabase.from('food_logs').insert({
      user_id: user.id,
      logged_at: timestampFor(selectedDate),
      source: 'manual',
      ...entry,
    })
    if (error) {
      alert(error.message)
      setBusy(false)
      return
    }
    if (asFrequent) await upsertFrequent(entry)
    setShowForm(false)
    setBusy(false)
    await load()
  }

  async function handlePhotoLog(entries, { note, confidence, asFrequent }) {
    setBusy(true)
    const ts = timestampFor(selectedDate)
    const rows = entries.map((e) => ({
      user_id: user.id,
      logged_at: ts,
      source: 'ai',
      meal_type: e.meal_type,
      food_name: e.food_name,
      grams: e.grams,
      calories: e.calories,
      protein_g: e.protein_g,
      carbs_g: e.carbs_g,
      fat_g: e.fat_g,
      user_note: note,
      ai_confidence: confidence,
    }))
    const { error } = await supabase.from('food_logs').insert(rows)
    if (error) {
      alert(error.message)
      setBusy(false)
      return
    }
    if (asFrequent) {
      for (const e of entries) await upsertFrequent(e)
    }
    setShowPhoto(false)
    setBusy(false)
    await load()
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

  async function quickAddFrequent(f) {
    const ins = supabase.from('food_logs').insert({
      user_id: user.id,
      logged_at: timestampFor(selectedDate),
      source: 'frequent',
      meal_type: mealForNow(),
      food_name: f.food_name,
      grams: f.default_grams,
      calories: f.calories,
      protein_g: f.protein_g,
      carbs_g: f.carbs_g,
      fat_g: f.fat_g,
    })
    const upd = supabase
      .from('frequent_foods')
      .update({ times_used: f.times_used + 1 })
      .eq('id', f.id)
    const [{ error }] = await Promise.all([ins, upd])
    if (error) {
      alert(error.message)
      return
    }
    await load()
  }

  async function deleteFrequent(id) {
    if (!window.confirm('Remove this frequent food?')) return
    setFrequents((prev) => prev.filter((f) => f.id !== id))
    await supabase.from('frequent_foods').delete().eq('id', id)
  }

  function toggleRepeat() {
    const next = !repeatOpen
    closePanels()
    if (next) {
      setRepeatFrom(shiftDate(selectedDate, -1))
      setRepeatOpen(true)
    }
  }

  async function copyFromDay() {
    if (!repeatFrom) return
    if (repeatFrom === selectedDate) {
      alert('Pick a different day')
      return
    }
    setBusy(true)
    const { start, end } = dayRange(dateObj(repeatFrom))
    const { data } = await supabase
      .from('food_logs')
      .select('*')
      .gte('logged_at', start)
      .lt('logged_at', end)
    if (!data || data.length === 0) {
      setBusy(false)
      alert('No entries on that day')
      return
    }
    const ts = timestampFor(selectedDate)
    const rows = data.map((l) => ({
      user_id: user.id,
      logged_at: ts,
      meal_type: l.meal_type,
      food_name: l.food_name,
      source: l.source,
      grams: l.grams,
      calories: l.calories,
      protein_g: l.protein_g,
      carbs_g: l.carbs_g,
      fat_g: l.fat_g,
    }))
    const { error } = await supabase.from('food_logs').insert(rows)
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    setRepeatOpen(false)
    await load()
  }

  async function deleteLog(id) {
    setLogs((prev) => prev.filter((l) => l.id !== id))
    await supabase.from('food_logs').delete().eq('id', id)
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      {/* Date navigation */}
      <header className="flex items-center justify-between pt-4">
        <button
          onClick={() => setDate(shiftDate(selectedDate, -1))}
          className="px-2 text-xl text-slate-400 hover:text-white"
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
            max={todayISODate()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="mt-0.5 bg-transparent text-xs text-slate-500 outline-none"
          />
        </div>
        <button
          onClick={() => setDate(shiftDate(selectedDate, 1))}
          disabled={isToday}
          className="px-2 text-xl text-slate-400 hover:text-white disabled:opacity-30"
          aria-label="Next day"
        >
          ›
        </button>
      </header>

      {/* Daily summary */}
      <Card className="space-y-4">
        <div className="flex justify-center">
          <ProgressRing
            value={totals.calories}
            max={goalCal}
            size={140}
            stroke={12}
            color="#22c55e"
            label="Calories"
            unit="kcal"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <ProgressRing
            value={totals.protein}
            max={profile?.goal_protein_g ?? 0}
            size={92}
            stroke={8}
            color="#22c55e"
            label="Protein"
            unit="g"
          />
          <ProgressRing
            value={totals.carbs}
            max={profile?.goal_carbs_g ?? 0}
            size={92}
            stroke={8}
            color="#3b82f6"
            label="Carbs"
            unit="g"
          />
          <ProgressRing
            value={totals.fat}
            max={profile?.goal_fat_g ?? 0}
            size={92}
            stroke={8}
            color="#f59e0b"
            label="Fat"
            unit="g"
          />
        </div>
        <p className="text-center text-sm text-slate-400">
          {remaining >= 0 ? (
            <>
              <span className="font-semibold text-green-400">{remaining}</span> kcal left
            </>
          ) : (
            <>
              <span className="font-semibold text-red-400">{Math.abs(remaining)}</span> kcal
              over
            </>
          )}
          {totals.burned > 0 && (
            <span className="text-slate-500"> · 🔥 {Math.round(totals.burned)} burned</span>
          )}
        </p>
      </Card>

      {/* Quick actions */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <Button onClick={togglePanel(showForm, setShowForm)}>＋ Add</Button>
          <Button onClick={togglePanel(showPhoto, setShowPhoto)}>✨ AI</Button>
          <Button variant="ghost" onClick={togglePanel(showFrequent, setShowFrequent)}>
            ⭐ Saved
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={togglePanel(showExercise, setShowExercise)}>
            🏃 Exercise
          </Button>
          <Button variant="ghost" onClick={toggleRepeat}>
            🔁 Repeat day
          </Button>
        </div>
      </div>

      {showFrequent && (
        <Card>
          <FrequentPicker
            items={frequents}
            onAdd={quickAddFrequent}
            onDelete={(f) => deleteFrequent(f.id)}
            onClose={() => setShowFrequent(false)}
          />
        </Card>
      )}

      {showExercise && (
        <Card>
          <ExerciseForm
            onSubmit={handleAddExercise}
            onCancel={() => setShowExercise(false)}
            busy={busy}
          />
        </Card>
      )}

      {showPhoto && (
        <Card>
          <PhotoLogger
            onSubmit={handlePhotoLog}
            onCancel={() => setShowPhoto(false)}
            busy={busy}
          />
        </Card>
      )}

      {repeatOpen && (
        <Card className="space-y-2">
          <p className="text-sm text-slate-300">
            Copy all meals from a day into {isToday ? 'today' : selectedDate}:
          </p>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={repeatFrom}
              max={todayISODate()}
              onChange={(e) => setRepeatFrom(e.target.value)}
              className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-white outline-none focus:border-green-500"
            />
            <Button onClick={copyFromDay} disabled={busy || !repeatFrom}>
              {busy ? '…' : 'Copy'}
            </Button>
          </div>
        </Card>
      )}

      {showForm && (
        <Card>
          <AddFoodForm
            onSubmit={handleAdd}
            onCancel={() => setShowForm(false)}
            busy={busy}
          />
        </Card>
      )}

      {/* Log list */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">
          {isToday ? "Today's log" : 'Log'}
        </h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : logs.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-slate-500">
              No entries — tap “＋ Add food”.
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
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {GROUP_LABELS[key]}
                    </span>
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
                        <div className="min-w-0">
                          <div className="truncate text-sm text-white">
                            {isEx ? '🏃 ' : ''}
                            {l.food_name}
                          </div>
                          {!isEx && (
                            <div className="text-xs text-slate-500">
                              {Math.round(num(l.protein_g))}P · {Math.round(num(l.carbs_g))}C ·{' '}
                              {Math.round(num(l.fat_g))}F
                              {l.grams ? ` · ${Math.round(num(l.grams))}g` : ''}
                            </div>
                          )}
                        </div>
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
    </div>
  )
}
