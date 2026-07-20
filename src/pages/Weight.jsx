import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { todayISODate } from '../lib/dateHelpers'
import { Button, Card, Field, Input } from '../components/ui'

const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
]
const KCAL_PER_KG = 7700
// Daily kcal offset from measured maintenance, per goal + rate.
const RATE_KCAL = {
  cut: { slow: -275, medium: -550, fast: -825 },
  bulk: { slow: 110, medium: 220, fast: 385 },
  recomp: { slow: -150, medium: -200, fast: -300 },
  maintain: { slow: 0, medium: 0, fast: 0 },
}
const r1 = (n) => Math.round(n * 10) / 10
const isoDaysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return todayISODate(d)
}

// Least-squares slope (kg/day) over dated weight points → kg/week.
function weeklyRate(points) {
  if (points.length < 2) return null
  const t0 = new Date(points[0].fullDate).getTime()
  const xs = points.map((p) => (new Date(p.fullDate).getTime() - t0) / 86400000)
  const ys = points.map((p) => p.weight)
  const n = xs.length
  const sx = xs.reduce((a, b) => a + b, 0)
  const sy = ys.reduce((a, b) => a + b, 0)
  const sxx = xs.reduce((a, b) => a + b * b, 0)
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  return ((n * sxy - sx * sy) / denom) * 7
}

// Recomp-aware read on the weight trend for the current goal.
function trendVerdict(rate, goalType) {
  if (rate == null) return null
  const wk = `${rate > 0 ? '+' : ''}${r1(rate)} kg/wk`
  if (goalType === 'cut') {
    if (rate > -0.05) return { tone: 'warn', text: `Weight not dropping (${wk}) — tighten the deficit a little.` }
    if (rate < -1) return { tone: 'warn', text: `Dropping fast (${wk}) — ease up to protect muscle.` }
    return { tone: 'good', text: `On track for a cut (${wk}).` }
  }
  if (goalType === 'bulk') {
    if (rate < 0.05) return { tone: 'warn', text: `Not gaining (${wk}) — add a few calories.` }
    if (rate > 0.5) return { tone: 'warn', text: `Gaining fast (${wk}) — likely adding fat; trim the surplus.` }
    return { tone: 'good', text: `Lean bulk on track (${wk}).` }
  }
  // recomp / maintain — aim near-stable
  if (Math.abs(rate) <= 0.2) return { tone: 'good', text: `Weight steady (${wk}) — ideal for recomp.` }
  return { tone: 'warn', text: `Weight moving (${wk}) — keep it near-stable for recomp.` }
}

export default function Weight() {
  const { user, profile, refreshProfile } = useAuth()
  const [weightLogs, setWeightLogs] = useState([])
  const [foodByDay, setFoodByDay] = useState([])
  const [preset, setPreset] = useState('30')
  const [fromDate, setFromDate] = useState(isoDaysAgo(30))
  const [toDate, setToDate] = useState(todayISODate())
  const [date, setDate] = useState(todayISODate())
  const [weight, setWeight] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    // Fetch far enough back to cover the chosen period AND the 14-day window the
    // weekly check-in always needs. Filter to the period client-side.
    const win14 = isoDaysAgo(14)
    const start = fromDate < win14 ? fromDate : win14
    const [wRes, fRes] = await Promise.all([
      supabase
        .from('weight_logs')
        .select('*')
        .gte('logged_date', start)
        .order('logged_date', { ascending: true }),
      supabase
        .from('food_logs')
        .select('logged_at,calories,protein_g,carbs_g,fat_g,source')
        .gte('logged_at', start + 'T00:00:00')
        .neq('source', 'exercise')
        .order('logged_at', { ascending: true }),
    ])
    setWeightLogs(wRes.data ?? [])
    const map = {}
    for (const l of fRes.data ?? []) {
      const day = String(l.logged_at).slice(0, 10)
      if (!map[day]) map[day] = { date: day, kcal: 0, protein: 0, carbs: 0, fat: 0 }
      map[day].kcal += Number(l.calories) || 0
      map[day].protein += Number(l.protein_g) || 0
      map[day].carbs += Number(l.carbs_g) || 0
      map[day].fat += Number(l.fat_g) || 0
    }
    setFoodByDay(Object.values(map).sort((a, b) => (a.date < b.date ? -1 : 1)))
  }, [fromDate])

  useEffect(() => {
    load()
  }, [load])

  async function save(e) {
    e.preventDefault()
    const w = Number(weight)
    if (!(w > 0)) return
    setBusy(true)
    const { error } = await supabase
      .from('weight_logs')
      .upsert({ user_id: user.id, logged_date: date, weight_kg: w }, { onConflict: 'user_id,logged_date' })
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    setWeight('')
    await load()
  }

  async function deleteLog(id) {
    setWeightLogs((prev) => prev.filter((l) => l.id !== id))
    await supabase.from('weight_logs').delete().eq('id', id)
  }

  const inPeriod = (d) => d >= fromDate && d <= toDate
  const periodDays = Math.max(1, Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1)

  // Weight points in range + a 7-point trailing moving average (smooths noise).
  const weightData = useMemo(() => {
    const pts = weightLogs
      .filter((l) => inPeriod(l.logged_date))
      .map((l) => ({ fullDate: l.logged_date, date: l.logged_date.slice(5), weight: Number(l.weight_kg) }))
    return pts.map((p, i, arr) => {
      const win = arr.slice(Math.max(0, i - 6), i + 1)
      return { ...p, ma: r1(win.reduce((s, x) => s + x.weight, 0) / win.length) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightLogs, fromDate, toDate])

  const rate = useMemo(() => weeklyRate(weightData), [weightData])
  const verdict = trendVerdict(rate, profile?.goal_type)
  const curWeight = weightData.length ? weightData[weightData.length - 1].weight : null
  const delta = weightData.length >= 2 ? r1(curWeight - weightData[0].weight) : null

  // Adherence over the range.
  const foodData = useMemo(
    () => foodByDay.filter((d) => inPeriod(d.date)).map((d) => ({ ...d, label: d.date.slice(5) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [foodByDay, fromDate, toDate]
  )
  const goalCal = profile?.goal_calories ?? 0
  const goalProtein = profile?.goal_protein_g ?? 0
  const daysLogged = foodData.length
  const avg = (key) =>
    daysLogged ? Math.round(foodData.reduce((s, d) => s + d[key], 0) / daysLogged) : 0
  const avgKcal = avg('kcal')
  const avgProtein = avg('protein')
  const avgCarbs = avg('carbs')
  const avgFat = avg('fat')
  const proteinPct = goalProtein ? Math.round((avgProtein / goalProtein) * 100) : null
  const macroStats = [
    { key: 'p', label: 'Protein', avg: avgProtein, goal: goalProtein },
    { key: 'c', label: 'Carbs', avg: avgCarbs, goal: profile?.goal_carbs_g ?? 0 },
    { key: 'f', label: 'Fat', avg: avgFat, goal: profile?.goal_fat_g ?? 0 },
  ]

  // Adaptive check-in: estimate real maintenance (TDEE) from the last ~14 days
  // of intake + weight change, then suggest a goal for the user's plan.
  // actual TDEE = avg intake − (kg/day change × 7700).
  // Days logging under half the goal are likely incomplete (forgotten entries)
  // and would skew the maintenance estimate — exclude them.
  const intakeFloor = goalCal > 0 ? goalCal * 0.5 : 500

  const checkIn = useMemo(() => {
    const winCut = isoDaysAgo(14)
    const wpts = weightLogs
      .filter((l) => l.logged_date >= winCut)
      .map((l) => ({ fullDate: l.logged_date, weight: Number(l.weight_kg) }))
    const allDays = foodByDay.filter((d) => d.date >= winCut)
    const fdays = allDays.filter((d) => d.kcal >= intakeFloor)
    const excluded = allDays.length - fdays.length
    if (wpts.length < 2 || fdays.length < 5) return { ready: false }
    const spanDays = (new Date(wpts[wpts.length - 1].fullDate) - new Date(wpts[0].fullDate)) / 86400000
    const rateWk = weeklyRate(wpts)
    if (spanDays < 7 || rateWk == null) return { ready: false }
    const avgIntake = Math.round(fdays.reduce((s, d) => s + d.kcal, 0) / fdays.length)
    const tdee = Math.round(avgIntake - (rateWk / 7) * KCAL_PER_KG)
    const gt = profile?.goal_type || 'recomp'
    const gr = profile?.goal_rate || 'medium'
    const offset = (RATE_KCAL[gt] || RATE_KCAL.recomp)[gr] ?? 0
    const floor = profile?.bmr || 1200
    const suggested = Math.max(floor, Math.round((tdee + offset) / 10) * 10)
    return { ready: true, tdee, avgIntake, rateWk, suggested, spanDays: Math.round(spanDays), excluded }
  }, [weightLogs, foodByDay, profile, intakeFloor])

  // This week's running energy balance vs goal, and the predicted weight
  // impact vs real maintenance (measured TDEE if available, else the estimate).
  const weeklyRecap = useMemo(() => {
    const cut7 = isoDaysAgo(7)
    const days = foodByDay.filter((d) => d.date >= cut7 && d.kcal >= intakeFloor)
    if (days.length === 0) return { ready: false }
    const n = days.length
    const totalEaten = days.reduce((s, d) => s + d.kcal, 0)
    const maint = (checkIn.ready ? checkIn.tdee : profile?.tdee || 0) || 0
    const vsGoal = goalCal > 0 ? Math.round(totalEaten - goalCal * n) : null
    const vsMaint = maint > 0 ? Math.round(totalEaten - maint * n) : null
    const predictedKg = vsMaint != null ? Math.round((vsMaint / KCAL_PER_KG) * 100) / 100 : null
    return { ready: true, n, vsGoal, predictedKg, maint }
  }, [foodByDay, goalCal, intakeFloor, checkIn, profile])

  async function applyGoal(newCal) {
    const protein = profile?.goal_protein_g || 0
    const fat = profile?.goal_fat_g || 0
    const carbs = Math.max(0, Math.round((newCal - protein * 4 - fat * 9) / 4))
    setApplying(true)
    const { error } = await supabase
      .from('profiles')
      .update({ goal_calories: newCal, goal_carbs_g: carbs })
      .eq('id', user.id)
    setApplying(false)
    if (error) {
      alert(error.message)
      return
    }
    await refreshProfile()
  }

  const axis = { stroke: '#64748b', fontSize: 11 }
  const tooltipStyle = {
    background: '#0f172a',
    border: '1px solid #334155',
    borderRadius: 8,
    color: '#e2e8f0',
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <header className="pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Progress 📈</h1>
            <p className="text-xs text-slate-500">Weight trend & how well you hit your targets</p>
          </div>
          <div className="flex gap-1">
            {RANGES.map((rg) => (
              <button
                key={rg.days}
                onClick={() => {
                  setPreset(rg.label)
                  setFromDate(isoDaysAgo(rg.days))
                  setToDate(todayISODate())
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                  preset === rg.label ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {rg.label}
              </button>
            ))}
            <button
              onClick={() => setPreset('custom')}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
                preset === 'custom' ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400'
              }`}
            >
              Custom
            </button>
          </div>
        </div>
        {preset === 'custom' && (
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e) => e.target.value && setFromDate(e.target.value)}
              className="flex-1"
            />
            <span className="text-slate-500">–</span>
            <Input
              type="date"
              value={toDate}
              min={fromDate}
              max={todayISODate()}
              onChange={(e) => e.target.value && setToDate(e.target.value)}
              className="flex-1"
            />
          </div>
        )}
      </header>

      {/* Insight */}
      {(verdict || proteinPct != null) && (
        <Card className="space-y-1">
          {verdict && (
            <p className={`text-sm ${verdict.tone === 'good' ? 'text-green-400' : 'text-amber-400'}`}>
              {verdict.tone === 'good' ? '✅ ' : '⚠️ '}
              {verdict.text}
            </p>
          )}
          {proteinPct != null && daysLogged > 0 && (
            <p className={`text-sm ${proteinPct >= 90 ? 'text-green-400' : 'text-amber-400'}`}>
              {proteinPct >= 90 ? '✅ ' : '⚠️ '}
              Protein averaging {avgProtein}g ({proteinPct}% of goal)
              {proteinPct >= 90 ? ' — great for keeping muscle.' : ' — aim higher to protect muscle.'}
            </p>
          )}
        </Card>
      )}

      {/* Weekly check-in — measured TDEE + adaptive goal suggestion */}
      {checkIn.ready ? (
        <Card className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">Weekly check-in</h2>
          <p className="text-xs text-slate-500">
            From your last {checkIn.spanDays} days of weight + food.
            {checkIn.excluded > 0 &&
              ` (${checkIn.excluded} under-logged day${checkIn.excluded > 1 ? 's' : ''} excluded)`}
          </p>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-slate-800 py-2">
              <div className="text-lg font-bold text-white">{checkIn.tdee}</div>
              <div className="text-xs text-slate-500">est. maintenance</div>
            </div>
            <div className="rounded-lg bg-slate-800 py-2">
              <div className="text-lg font-bold text-white">{goalCal || '—'}</div>
              <div className="text-xs text-slate-500">current goal</div>
            </div>
          </div>
          {goalCal > 0 && Math.abs(checkIn.suggested - goalCal) <= 30 ? (
            <p className="text-sm text-green-400">
              ✅ Your goal matches the data — no change needed.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-300">
                Suggested goal: <b className="text-white">{checkIn.suggested}</b> kcal
                {goalCal > 0 && (
                  <span className="text-slate-500">
                    {' '}
                    ({checkIn.suggested > goalCal ? '+' : ''}
                    {checkIn.suggested - goalCal})
                  </span>
                )}
              </p>
              <Button className="w-full" disabled={applying} onClick={() => applyGoal(checkIn.suggested)}>
                {applying ? 'Applying…' : `Apply ${checkIn.suggested} kcal`}
              </Button>
              <p className="text-[11px] text-slate-500">Protein &amp; fat kept; carbs adjusted to fit.</p>
            </>
          )}
        </Card>
      ) : (
        <Card>
          <h2 className="mb-1 text-sm font-medium text-slate-300">Weekly check-in</h2>
          <p className="text-xs text-slate-500">
            Unlocks after ~2 weeks of data — needs ≥2 weigh-ins over ≥7 days and ≥5 days of food
            logged. It estimates your real maintenance calories and suggests a goal.
          </p>
        </Card>
      )}

      {/* This week — running energy balance + predicted weight impact */}
      {weeklyRecap.ready && (
        <Card className="space-y-1">
          <h2 className="text-sm font-medium text-slate-300">This week</h2>
          <p className="text-xs text-slate-500">
            Totals over {weeklyRecap.n} logged day{weeklyRecap.n > 1 ? 's' : ''} (last 7).
          </p>
          {weeklyRecap.vsGoal != null && (
            <p className="text-sm text-slate-300">
              vs your goal:{' '}
              <b className={weeklyRecap.vsGoal <= 0 ? 'text-green-400' : 'text-amber-400'}>
                {weeklyRecap.vsGoal > 0 ? '+' : ''}
                {weeklyRecap.vsGoal} kcal
              </b>{' '}
              {weeklyRecap.vsGoal <= 0 ? 'under' : 'over'}
            </p>
          )}
          {weeklyRecap.predictedKg != null && (
            <p className="text-sm text-slate-300">
              Predicted impact:{' '}
              <b className={weeklyRecap.predictedKg < 0 ? 'text-green-400' : 'text-slate-100'}>
                {weeklyRecap.predictedKg > 0 ? '+' : ''}
                {weeklyRecap.predictedKg} kg
              </b>
              <span className="text-slate-500"> · vs ~{weeklyRecap.maint} kcal maintenance</span>
            </p>
          )}
        </Card>
      )}

      {/* Adherence — how well intake matched the targets */}
      {daysLogged > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-medium text-slate-300">Adherence</h2>
          <div className="mb-2 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-slate-800 py-2">
              <div className="text-lg font-bold text-white">{avgKcal}</div>
              <div className="text-xs text-slate-500">avg kcal / day{goalCal ? ` · goal ${goalCal}` : ''}</div>
            </div>
            <div className="rounded-lg bg-slate-800 py-2">
              <div className="text-lg font-bold text-white">
                {daysLogged}
                <span className="text-sm text-slate-500">/{periodDays}</span>
              </div>
              <div className="text-xs text-slate-500">days logged</div>
            </div>
          </div>
          <div className="mb-2 grid grid-cols-3 gap-2 text-center">
            {macroStats.map((m) => (
              <div key={m.key} className="rounded-lg bg-slate-800 py-2">
                <div className="text-sm font-bold text-white">
                  {m.avg}
                  <span className="text-xs font-normal text-slate-500">g</span>
                </div>
                <div className="text-xs text-slate-500">
                  {m.label}
                  {m.goal ? ` · ${m.goal}g` : ''}
                </div>
              </div>
            ))}
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={foodData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={20} />
                <YAxis {...axis} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#1e293b55' }} />
                {goalCal > 0 && <ReferenceLine y={goalCal} stroke="#ef4444" strokeDasharray="4 4" />}
                <Bar dataKey="kcal" name="kcal" fill="#22c55e" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {goalCal > 0 && (
            <p className="mt-1 text-center text-[11px] text-slate-500">
              Daily calories · red line = your goal
            </p>
          )}
        </Card>
      )}

      {/* Log weight */}
      <Card>
        <form onSubmit={save} className="flex items-end gap-2">
          <Field label="Date">
            <Input type="date" value={date} max={todayISODate()} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Weight (kg)">
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="70.5"
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? '…' : 'Save'}
          </Button>
        </form>
      </Card>

      {/* Weight trend + moving average */}
      {weightData.length >= 2 ? (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-300">Weight trend</h2>
            <span className="text-xs text-slate-400">
              {curWeight}kg
              {delta != null && (
                <span className={delta < 0 ? 'text-green-400' : delta > 0 ? 'text-amber-400' : ''}>
                  {' '}
                  ({delta > 0 ? '+' : ''}
                  {delta}kg)
                </span>
              )}
            </span>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weightData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" {...axis} />
                <YAxis {...axis} domain={['dataMin - 1', 'dataMax + 1']} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="weight"
                  name="weight"
                  stroke="#475569"
                  strokeWidth={1}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="ma"
                  name="avg"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-center text-[11px] text-slate-500">
            Grey = daily · Green = 7-point average (the real trend)
          </p>
        </Card>
      ) : (
        <Card>
          <p className="text-center text-sm text-slate-500">Log at least 2 weigh-ins to see your trend.</p>
        </Card>
      )}

      {/* Weigh-in history */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">Weigh-in history</h2>
        {weightLogs.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-slate-500">No weight data yet</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {[...weightLogs].reverse().map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2.5"
              >
                <span className="text-sm text-slate-300">{l.logged_date}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-white">{Number(l.weight_kg).toFixed(1)} kg</span>
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
