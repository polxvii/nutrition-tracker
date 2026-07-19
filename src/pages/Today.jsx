import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { dayRange, prettyDate } from '../lib/dateHelpers'
import ProgressRing from '../components/ProgressRing'
import MacroBar from '../components/MacroBar'
import AddFoodForm, { MEALS } from '../components/AddFoodForm'
import { Button, Card } from '../components/ui'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

const mealLabel = (v) => MEALS.find((m) => m.value === v)?.label ?? '-'

export default function Today() {
  const { user, profile } = useAuth()
  const [logs, setLogs] = useState([])
  const [frequents, setFrequents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { start, end } = dayRange()
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
        .limit(12),
    ])
    setLogs(logsRes.data ?? [])
    setFrequents(freqRes.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const totals = useMemo(
    () =>
      logs.reduce(
        (a, l) => ({
          calories: a.calories + num(l.calories),
          protein: a.protein + num(l.protein_g),
          carbs: a.carbs + num(l.carbs_g),
          fat: a.fat + num(l.fat_g),
          fiber: a.fiber + num(l.fiber_g),
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
      ),
    [logs]
  )

  const goalCal = profile?.goal_calories ?? 0
  const remaining = Math.round(goalCal - totals.calories)

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
      logged_at: new Date().toISOString(),
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

  async function quickAddFrequent(f) {
    const ins = supabase.from('food_logs').insert({
      user_id: user.id,
      logged_at: new Date().toISOString(),
      source: 'frequent',
      meal_type: null,
      food_name: f.food_name,
      grams: f.default_grams,
      calories: f.calories,
      protein_g: f.protein_g,
      carbs_g: f.carbs_g,
      fat_g: f.fat_g,
      fiber_g: 0,
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

  async function repeatYesterday() {
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const { start, end } = dayRange(y)
    const { data } = await supabase
      .from('food_logs')
      .select('*')
      .gte('logged_at', start)
      .lt('logged_at', end)
    if (!data || data.length === 0) {
      alert('No entries logged yesterday')
      return
    }
    const now = new Date().toISOString()
    const rows = data.map((l) => ({
      user_id: user.id,
      logged_at: now,
      meal_type: l.meal_type,
      food_name: l.food_name,
      source: l.source,
      grams: l.grams,
      calories: l.calories,
      protein_g: l.protein_g,
      carbs_g: l.carbs_g,
      fat_g: l.fat_g,
      fiber_g: l.fiber_g,
    }))
    const { error } = await supabase.from('food_logs').insert(rows)
    if (error) {
      alert(error.message)
      return
    }
    await load()
  }

  async function deleteLog(id) {
    setLogs((prev) => prev.filter((l) => l.id !== id)) // optimistic
    await supabase.from('food_logs').delete().eq('id', id)
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <header className="pt-4">
        <h1 className="text-xl font-bold text-white">Today</h1>
        <p className="text-xs text-slate-500">{prettyDate()}</p>
      </header>

      {/* Daily summary */}
      <Card className="space-y-4">
        <div className="flex items-center justify-around">
          <ProgressRing
            value={totals.calories}
            max={goalCal}
            color="#22c55e"
            label="Calories"
            unit="kcal"
          />
          <ProgressRing
            value={totals.protein}
            max={profile?.goal_protein_g ?? 0}
            color="#38bdf8"
            label="Protein"
            unit="g"
          />
        </div>
        <p className="text-center text-sm text-slate-400">
          {remaining >= 0 ? (
            <>
              <span className="font-semibold text-green-400">{remaining}</span> kcal
              left
            </>
          ) : (
            <>
              <span className="font-semibold text-red-400">{Math.abs(remaining)}</span>{' '}
              kcal over
            </>
          )}
        </p>
        <MacroBar
          protein={totals.protein}
          carbs={totals.carbs}
          fat={totals.fat}
          fiber={totals.fiber}
          goalProtein={profile?.goal_protein_g ?? 0}
          goalCarbs={profile?.goal_carbs_g ?? 0}
          goalFat={profile?.goal_fat_g ?? 0}
          goalFiber={profile?.goal_fiber_g ?? 0}
        />
      </Card>

      {/* Quick actions */}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setShowForm((s) => !s)}>
          ＋ Add food
        </Button>
        <Button variant="ghost" onClick={repeatYesterday}>
          🔁 Repeat yesterday
        </Button>
      </div>

      {showForm && (
        <Card>
          <AddFoodForm
            onSubmit={handleAdd}
            onCancel={() => setShowForm(false)}
            busy={busy}
          />
        </Card>
      )}

      {/* Frequent foods */}
      {frequents.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">Frequent foods</h2>
          <div className="flex flex-wrap gap-2">
            {frequents.map((f) => (
              <button
                key={f.id}
                onClick={() => quickAddFrequent(f)}
                className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:border-green-500"
              >
                {f.food_name}
                <span className="ml-1 text-xs text-slate-500">
                  {Math.round(f.calories)} kcal
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Today's log list */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">Today's log</h2>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : logs.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-slate-500">
              No entries yet — tap “＋ Add food” to start
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {logs.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{l.food_name}</div>
                  <div className="text-xs text-slate-500">
                    {mealLabel(l.meal_type)} · {Math.round(num(l.protein_g))}P ·{' '}
                    {Math.round(num(l.carbs_g))}C · {Math.round(num(l.fat_g))}F
                  </div>
                </div>
                <div className="ml-3 flex items-center gap-3">
                  <span className="whitespace-nowrap text-sm font-medium text-slate-200">
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
        )}
      </div>
    </div>
  )
}
