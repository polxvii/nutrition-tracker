import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Button, Card, Collapsible, Field, Input } from '../components/ui'
import BodyMeasurements from '../components/BodyMeasurements'
import { loadGoalHistory, goalForDate, recordGoalHistory } from '../lib/goalHistory'

const RANGES = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
]
const MEAL_SLOTS = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
  ['night', 'Night'],
  ['snack', 'Snack'],
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

// Least-squares slope (kg/day) over dated weight points → kg/week. Requires the
// points to span at least minSpanDays, so a weekly rate isn't extrapolated from
// a couple of weigh-ins a day apart (which produces wild numbers).
function weeklyRate(points, minSpanDays = 0) {
  if (points.length < 2) return null
  const t0 = new Date(points[0].fullDate).getTime()
  const xs = points.map((p) => (new Date(p.fullDate).getTime() - t0) / 86400000)
  if (xs[xs.length - 1] - xs[0] < minSpanDays) return null
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

// Rich tooltip for the daily-calories bars: full date, net kcal vs goal +
// maintenance, and macros. Colour tiers: green ≤ goal, amber over goal, red
// over maintenance.
function BarTooltip({ active, payload, goalCal, maint }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const g = d.dayGoal || goalCal // that day's goal / maintenance (history-aware)
  const m = d.dayMaint || maint
  const overGoal = g > 0 && d.kcal > g
  const overMaint = m > 0 && d.kcal > m
  const cls = overMaint ? 'text-red-400' : overGoal ? 'text-amber-400' : 'text-green-400'
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs">
      <div className="text-slate-300">{d.date}</div>
      <div className={cls}>
        <b>{Math.round(d.kcal)}</b> kcal
        {overMaint ? ' · over maintenance' : overGoal ? ' · over goal' : ' · on target'}
      </div>
      <div className="text-slate-500">
        goal {g || '–'}
        {m > 0 ? ` · maint ${m}` : ''}
      </div>
      <div className="text-slate-400">
        {Math.round(d.protein)}P · {Math.round(d.carbs)}C · {Math.round(d.fat)}F
        {d.burned > 0 ? ` · 🔥${Math.round(d.burned)}` : ''}
      </div>
    </div>
  )
}

export default function Weight() {
  const { user, profile, refreshProfile } = useAuth()
  const [weightLogs, setWeightLogs] = useState([])
  const [foodByDay, setFoodByDay] = useState([])
  const [goalHist, setGoalHist] = useState([]) // goal snapshots, ascending by date
  const [preset, setPreset] = useState('30d') // must match a RANGES label
  // Preset "Nd" = last N days *including today*, so it reads /N not /N+1.
  const [fromDate, setFromDate] = useState(isoDaysAgo(29))
  const [toDate, setToDate] = useState(todayISODate())
  const [date, setDate] = useState(todayISODate())
  const [weight, setWeight] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState(false)
  const formRef = useRef(null)

  // Tapping a history row loads that day into the form and scrolls to it, so
  // the edit target is obvious (the form sits above the list).
  const editWeighIn = (d) => {
    setDate(d)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const load = useCallback(async () => {
    // Fetch far enough back to cover the chosen period AND the 30-day window the
    // weekly check-in looks at. Filter to the period client-side.
    const win30 = isoDaysAgo(30)
    const start = fromDate < win30 ? fromDate : win30
    const [wRes, fRes] = await Promise.all([
      // Weigh-ins are few (one per day) — load ALL so history + editing aren't
      // limited to the selected period. Trend/check-in still scope client-side.
      supabase
        .from('weight_logs')
        .select('*')
        .order('logged_date', { ascending: true }),
      supabase
        .from('food_logs')
        .select('logged_at,calories,protein_g,carbs_g,fat_g,source,meal_type')
        .gte('logged_at', start + 'T00:00:00')
        .order('logged_at', { ascending: true }),
    ])
    setWeightLogs(wRes.data ?? [])
    // Per-day totals. Gross model: `kcal` is GROSS food intake (exercise is NOT
    // subtracted — goal/maintenance already include activity). `burned` is kept
    // for reference only. A day counts as "logged" only if it has food.
    const map = {}
    for (const l of fRes.data ?? []) {
      const day = todayISODate(new Date(l.logged_at)) // local day (matches Calendar)
      const b =
        map[day] || (map[day] = { date: day, eaten: 0, burned: 0, protein: 0, carbs: 0, fat: 0, meals: {} })
      if (l.source === 'exercise') {
        b.burned += Number(l.calories) || 0
      } else {
        const kcal = Number(l.calories) || 0
        b.eaten += kcal
        b.protein += Number(l.protein_g) || 0
        b.carbs += Number(l.carbs_g) || 0
        b.fat += Number(l.fat_g) || 0
        if (l.meal_type) b.meals[l.meal_type] = (b.meals[l.meal_type] || 0) + kcal
      }
    }
    const rows = Object.values(map)
      .filter((b) => b.eaten > 0)
      .map((b) => ({ ...b, kcal: b.eaten }))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
    setFoodByDay(rows)
  }, [fromDate])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadGoalHistory().then(setGoalHist)
  }, [])

  // Prefill the weight field with whatever is saved for the chosen date, so
  // tapping a history row (which sets the date) loads it for editing — same
  // pattern as Body measurements.
  useEffect(() => {
    const existing = weightLogs.find((l) => l.logged_date === date)
    setWeight(existing ? String(Number(existing.weight_kg)) : '')
  }, [date, weightLogs])

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
    await load() // the prefill effect re-syncs the field from the saved value
  }

  async function deleteLog(l) {
    if (!window.confirm(`Delete weigh-in ${Number(l.weight_kg).toFixed(1)} kg on ${l.logged_date}?`)) return
    setWeightLogs((prev) => prev.filter((x) => x.id !== l.id))
    await supabase.from('weight_logs').delete().eq('id', l.id)
  }

  const inPeriod = (d) => d >= fromDate && d <= toDate
  const periodDays = Math.max(1, Math.round((new Date(toDate) - new Date(fromDate)) / 86400000) + 1)

  // Weight points in range + an EWMA trend (alpha 0.1) that smooths daily
  // water-weight noise far better than raw weigh-ins. `ma` = the trend line.
  const weightData = useMemo(() => {
    const pts = weightLogs
      .filter((l) => inPeriod(l.logged_date))
      .map((l) => ({ fullDate: l.logged_date, date: l.logged_date.slice(5), weight: Number(l.weight_kg) }))
    let ema = null
    return pts.map((p) => {
      ema = ema == null ? p.weight : 0.1 * p.weight + 0.9 * ema
      return { ...p, ma: r1(ema) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weightLogs, fromDate, toDate])

  // Rate from the EWMA trend (not raw weight) — ≥5 days span to avoid noise.
  const rate = useMemo(
    () => weeklyRate(weightData.map((p) => ({ fullDate: p.fullDate, weight: p.ma })), 5),
    [weightData]
  )
  const verdict = trendVerdict(rate, profile?.goal_type)
  const curWeight = weightData.length ? weightData[weightData.length - 1].weight : null
  const delta = weightData.length >= 2 ? r1(curWeight - weightData[0].weight) : null

  // Goal-weight line on the trend chart. Extend the Y domain to include the
  // target so the line always shows, not just when it's inside the data range.
  const goalWkg = profile?.goal_weight_kg != null ? Number(profile.goal_weight_kg) : null
  const weightDomain = (() => {
    if (!weightData.length) return ['auto', 'auto']
    const ws = weightData.map((p) => p.weight)
    let lo = Math.min(...ws)
    let hi = Math.max(...ws)
    if (goalWkg != null) {
      lo = Math.min(lo, goalWkg)
      hi = Math.max(hi, goalWkg)
    }
    return [Math.floor(lo - 1), Math.ceil(hi + 1)]
  })()

  // Adherence over the range.
  const foodData = useMemo(
    () =>
      foodByDay.filter((d) => inPeriod(d.date)).map((d) => {
        // The goal + maintenance that were in effect on this specific day, so
        // each bar is coloured against its own target (not the current one).
        const g = goalForDate(goalHist, d.date)
        return { ...d, label: d.date.slice(5), dayGoal: g?.goal_calories ?? 0, dayMaint: g?.tdee ?? 0 }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [foodByDay, fromDate, toDate, goalHist]
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

  // Average kcal each meal slot contributes on a logged day (gross intake, not
  // net — exercise isn't a meal). Sum per slot over the period ÷ days logged.
  const mealAvg = useMemo(() => {
    if (!daysLogged) return []
    const totals = {}
    for (const d of foodData) {
      for (const [k, v] of Object.entries(d.meals || {})) totals[k] = (totals[k] || 0) + v
    }
    return MEAL_SLOTS.map(([key, label]) => ({
      key,
      label,
      avg: Math.round((totals[key] || 0) / daysLogged),
    })).filter((m) => m.avg > 0)
  }, [foodData, daysLogged])
  const mealMax = Math.max(1, ...mealAvg.map((m) => m.avg))

  // Adaptive check-in: estimate real maintenance (TDEE) from intake + weight
  // change over the last ~30 days, then suggest a goal for the user's plan.
  // actual TDEE = avg intake − (kg/day change × 7700). Intake is averaged over
  // the SAME span as the weight change (first↔last weigh-in) so the two describe
  // the same window. Days logging under half the goal are likely incomplete
  // (forgotten entries) and would skew the estimate — exclude them.
  const intakeFloor = goalCal > 0 ? goalCal * 0.5 : 500

  const checkIn = useMemo(() => {
    const winCut = isoDaysAgo(30)
    const wpts = weightLogs
      .filter((l) => l.logged_date >= winCut)
      .map((l) => ({ fullDate: l.logged_date, weight: Number(l.weight_kg) }))
    if (wpts.length < 2) return { ready: false }
    // Weight change + intake over the same span (first↔last weigh-in).
    const spanStart = wpts[0].fullDate
    const spanEnd = wpts[wpts.length - 1].fullDate
    const spanDays = Math.round((new Date(spanEnd) - new Date(spanStart)) / 86400000)
    // Rate from the EWMA trend (alpha 0.1) — cancels day-to-day water swings.
    let ema = null
    const smoothed = wpts.map((p) => {
      ema = ema == null ? p.weight : 0.1 * p.weight + 0.9 * ema
      return { fullDate: p.fullDate, weight: ema }
    })
    const rateWk = weeklyRate(smoothed)
    if (spanDays < 7 || rateWk == null) return { ready: false }
    // The estimate lives or dies by the weight trend. A rate from just a couple
    // of weigh-ins is mostly water-weight noise — a trustworthy number needs
    // regular weigh-ins (a regression over many points cancels the daily swings).
    const weighIns = wpts.length
    const weighPerWk = weighIns / Math.max(spanDays / 7, 1)
    if (weighIns < 4 || weighPerWk < 1.5) {
      return { ready: false, sparseWeights: true, weighIns, spanDays }
    }
    const allDays = foodByDay.filter((d) => d.date >= spanStart && d.date <= spanEnd)
    const fdays = allDays.filter((d) => d.eaten >= intakeFloor)
    const excluded = allDays.length - fdays.length
    // Unlogged days in the span are approximated by the logged-day average, so a
    // sparse span skews the estimate — require ≥5 logged days AND ≥half the span.
    if (fdays.length < 5 || fdays.length < Math.ceil(spanDays * 0.5)) {
      return { ready: false, lowLog: true, logged: fdays.length, spanDays }
    }
    const avgIntake = Math.round(fdays.reduce((s, d) => s + d.kcal, 0) / fdays.length)
    const tdee = Math.round(avgIntake - (rateWk / 7) * KCAL_PER_KG)
    // Sanity: a measured maintenance below BMR is physiologically impossible, and
    // one wildly off the profile estimate means the data is too noisy/incomplete
    // (missing food logs, water-weight swings, too few weigh-ins) to trust — so
    // don't show a garbage number or suggest a goal from it.
    const bmr = profile?.bmr || 1200
    const est = profile?.tdee || 0
    if (tdee < bmr || (est > 0 && (tdee < est * 0.6 || tdee > est * 1.6))) {
      return { ready: false, unreliable: true }
    }
    const gt = profile?.goal_type || 'recomp'
    const gr = profile?.goal_rate || 'medium'
    const offset = (RATE_KCAL[gt] || RATE_KCAL.recomp)[gr] ?? 0
    const suggested = Math.max(bmr, Math.round((tdee + offset) / 10) * 10)
    return {
      ready: true,
      tdee,
      avgIntake,
      rateWk,
      suggested,
      spanDays,
      logged: fdays.length,
      excluded,
      weighIns,
      weighPerWk,
    }
  }, [weightLogs, foodByDay, profile, intakeFloor])

  // Energy balance over the *selected period* (same window as Adherence, so the
  // whole page describes one range): net intake vs goal, and the predicted
  // weight impact vs maintenance. Maintenance is the profile TDEE (a stable
  // value the user set) — NOT the weekly check-in's measured estimate, which is
  // a separate suggestion you opt into via Apply. Incomplete days (very low
  // gross intake) are excluded.
  const periodRecap = useMemo(() => {
    const days = foodData.filter((d) => d.eaten >= intakeFloor)
    if (days.length === 0) return { ready: false }
    const n = days.length
    const totalNet = days.reduce((s, d) => s + d.kcal, 0) // net of exercise
    // Sum each day's own goal + maintenance (from history) so the recap is exact
    // across a period where the goal changed — not a flat current-goal × n.
    const curMaint = profile?.tdee || 0
    const totalGoal = days.reduce((s, d) => s + (d.dayGoal || goalCal), 0)
    const totalMaint = days.reduce((s, d) => s + (d.dayMaint || curMaint), 0)
    const vsGoal = totalGoal > 0 ? Math.round(totalNet - totalGoal) : null
    const vsMaint = totalMaint > 0 ? Math.round(totalNet - totalMaint) : null
    const predictedKg = vsMaint != null ? Math.round((vsMaint / KCAL_PER_KG) * 100) / 100 : null
    const maint = totalMaint > 0 ? Math.round(totalMaint / n) : curMaint // avg, for display
    return { ready: true, n, vsGoal, vsMaint, predictedKg, maint }
  }, [foodData, goalCal, intakeFloor, profile])

  // Human label for the selected range, shown on the energy-balance card.
  const rangeText =
    preset === 'custom' ? `${fromDate} → ${toDate}` : `last ${preset.replace('d', ' days')}`

  // Maintenance (profile TDEE — the stable value the user set) drawn on the
  // adherence chart, so you can tell a day that's over goal but still under
  // maintenance from one that's a real surplus.
  const maint = profile?.tdee || 0

  // Per-day (history-aware) averages so the summary matches the per-day bars,
  // and a flag for when the goal changed inside the range.
  const periodGoal = daysLogged
    ? Math.round(foodData.reduce((s, d) => s + (d.dayGoal || goalCal), 0) / daysLogged)
    : goalCal
  const periodMaint = daysLogged
    ? Math.round(foodData.reduce((s, d) => s + (d.dayMaint || maint), 0) / daysLogged)
    : maint
  const goalChangedInRange = new Set(foodData.map((d) => d.dayGoal || goalCal)).size > 1

  // Tier colour for the avg-kcal tile — against the day-specific goal averaged
  // over the range (green ≤ goal · amber over goal · red over maintenance).
  const avgKcalCls =
    periodGoal <= 0
      ? 'text-white'
      : periodMaint > 0 && avgKcal > periodMaint
        ? 'text-red-400'
        : avgKcal > periodGoal
          ? 'text-amber-400'
          : 'text-green-400'

  // Project the target-weight date from the steadiest rate we have.
  const projection = useMemo(() => {
    const targetW = profile?.goal_weight_kg != null ? Number(profile.goal_weight_kg) : null
    const rateWk = checkIn.ready ? checkIn.rateWk : rate
    if (targetW == null || curWeight == null || rateWk == null) return null
    const remaining = targetW - curWeight // <0 need to lose, >0 need to gain
    if (Math.abs(remaining) < 0.15) return { targetW, reached: true }
    const toward = remaining < 0 ? rateWk < -0.02 : rateWk > 0.02
    if (!toward) return { targetW, remaining: r1(remaining), stalled: true }
    const weeks = remaining / rateWk
    const dt = new Date()
    dt.setDate(dt.getDate() + Math.round(weeks * 7))
    return { targetW, remaining: r1(remaining), rateWk: r1(rateWk), weeks: Math.round(weeks * 10) / 10, date: dt }
  }, [profile?.goal_weight_kg, curWeight, checkIn, rate])

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
    // Snapshot the new goal so days from today on are judged against it.
    await recordGoalHistory(user.id, {
      goal_calories: newCal,
      goal_protein_g: protein,
      goal_carbs_g: carbs,
      goal_fat_g: fat,
      tdee: profile?.tdee,
    })
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
                  setFromDate(isoDaysAgo(rg.days - 1))
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

      {/* Energy balance over the selected period + predicted weight impact */}
      {periodRecap.ready && (
        <Card className="space-y-1">
          <h2 className="text-sm font-medium text-slate-300">Energy balance</h2>
          <p className="text-xs text-slate-500">
            Gross intake over {periodRecap.n} logged day{periodRecap.n > 1 ? 's' : ''} · {rangeText}.
          </p>
          {periodRecap.vsGoal != null && (
            <p className="text-sm text-slate-300">
              vs your goal:{' '}
              <b className={periodRecap.vsGoal <= 0 ? 'text-green-400' : 'text-amber-400'}>
                {periodRecap.vsGoal > 0 ? '+' : ''}
                {periodRecap.vsGoal} kcal
              </b>{' '}
              {periodRecap.vsGoal <= 0 ? 'under' : 'over'}
            </p>
          )}
          {periodRecap.vsMaint != null && (
            <p className="text-sm text-slate-300">
              vs maintenance:{' '}
              <b className={periodRecap.vsMaint <= 0 ? 'text-green-400' : 'text-amber-400'}>
                {periodRecap.vsMaint > 0 ? '+' : ''}
                {periodRecap.vsMaint} kcal
              </b>
              <span className="text-slate-500"> · ~{periodRecap.maint} maintenance</span>
            </p>
          )}
          {periodRecap.predictedKg != null && (
            <p className="text-sm text-slate-300">
              Predicted impact:{' '}
              <b className={periodRecap.predictedKg < 0 ? 'text-green-400' : 'text-slate-100'}>
                {periodRecap.predictedKg > 0 ? '+' : ''}
                {periodRecap.predictedKg} kg
              </b>
              <span className="text-slate-500"> · vs ~{periodRecap.maint} kcal maintenance</span>
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
              <div className={`text-lg font-bold ${avgKcalCls}`}>{avgKcal}</div>
              <div className="text-xs text-slate-500">
                avg kcal / day{periodGoal ? ` · goal ${periodGoal}${goalChangedInRange ? ' (avg)' : ''}` : ''}
              </div>
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
            {macroStats.map((m) => {
              // Protein is "higher is good" → green at ≥90% of goal, else amber.
              // Carbs/fat are budgets → green at or under goal, amber when over.
              const cls =
                m.goal > 0
                  ? m.key === 'p'
                    ? m.avg >= m.goal * 0.9
                      ? 'text-green-400'
                      : 'text-amber-400'
                    : m.avg <= m.goal
                      ? 'text-green-400'
                      : 'text-amber-400'
                  : 'text-white'
              return (
              <div key={m.key} className="rounded-lg bg-slate-800 py-2">
                <div className={`text-sm font-bold ${cls}`}>
                  {m.avg}
                  <span className="text-xs font-normal text-slate-500">g</span>
                </div>
                <div className="text-xs text-slate-500">
                  {m.label}
                  {m.goal ? ` · ${m.goal}g` : ''}
                </div>
              </div>
              )
            })}
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={foodData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={20} />
                <YAxis {...axis} />
                <Tooltip
                  content={<BarTooltip goalCal={goalCal} maint={maint} />}
                  cursor={{ fill: '#1e293b55' }}
                />
                {/* Line colours match the bar legend: amber = goal, red = maintenance. */}
                {goalCal > 0 && (
                  <ReferenceLine y={goalCal} stroke="#f59e0b" strokeDasharray="4 4" />
                )}
                {maint > 0 && maint !== goalCal && (
                  <ReferenceLine y={maint} stroke="#ef4444" strokeDasharray="4 4" />
                )}
                <Bar dataKey="kcal" name="kcal" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {foodData.map((d, i) => {
                    // colour against THIS day's goal/maintenance (history-aware)
                    const dg = d.dayGoal || goalCal
                    const dm = d.dayMaint || maint
                    return (
                      <Cell
                        key={i}
                        fill={
                          dm > 0 && d.kcal > dm
                            ? '#ef4444'
                            : dg > 0 && d.kcal > dg
                              ? '#f59e0b'
                              : '#22c55e'
                        }
                      />
                    )
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {goalCal > 0 && (
            <p className="mt-1 text-center text-[11px] text-slate-500">
              Daily kcal eaten · <span className="text-green-400">green</span> ≤ goal ·{' '}
              <span className="text-amber-400">amber</span> over goal ·{' '}
              <span className="text-red-400">red</span> over maintenance
            </p>
          )}
          {goalChangedInRange && (
            <p className="text-center text-[11px] text-amber-400/80">
              Your goal changed during this range — each bar is coloured against the goal that
              applied on its own day.
            </p>
          )}
        </Card>
      )}

      {/* Calories by meal — where the day's intake comes from */}
      {mealAvg.length > 0 && (
        <Card className="space-y-2">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-slate-300">Calories by meal</h2>
            <span className="text-xs text-slate-500">avg / logged day</span>
          </div>
          <div className="space-y-2">
            {mealAvg.map((m) => (
              <div key={m.key} className="space-y-1">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-400">{m.label}</span>
                  <span className="tabular-nums text-slate-200">
                    <b className="text-sm font-semibold text-white">{m.avg}</b> kcal
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-green-500"
                    style={{ width: `${(m.avg / mealMax) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Weekly check-in — measured TDEE + adaptive goal suggestion */}
      {checkIn.ready ? (
        <Card className="space-y-2">
          <h2 className="text-sm font-medium text-slate-300">Weekly check-in</h2>
          <p className="text-xs text-slate-500">
            Based on {checkIn.logged} logged day{checkIn.logged > 1 ? 's' : ''} and{' '}
            {checkIn.weighIns} weigh-ins over {checkIn.spanDays} days.
            {checkIn.excluded > 0 &&
              ` (${checkIn.excluded} under-logged day${checkIn.excluded > 1 ? 's' : ''} skipped)`}
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

          {/* Show the basis so the number isn't a black box. */}
          <p className="text-xs text-slate-400">
            From <b className="text-slate-200">{checkIn.avgIntake}</b> kcal avg gross intake and
            weight{' '}
            <b className="text-slate-200">
              {checkIn.rateWk > 0 ? '+' : ''}
              {r1(checkIn.rateWk)}
            </b>{' '}
            kg/wk over the span. This is your total maintenance (activity included).
          </p>
          {(() => {
            // Logging coverage — always shown; a low % biases the estimate low.
            const covPct = checkIn.spanDays ? Math.round((checkIn.logged / checkIn.spanDays) * 100) : 0
            return (
              <p className={`text-[11px] ${covPct < 80 ? 'text-amber-400' : 'text-slate-500'}`}>
                Logging coverage {covPct}% ({checkIn.logged}/{checkIn.spanDays} days)
                {covPct < 80 ? ' — under-logged days bias this LOW; trust it less.' : ''}
              </p>
            )
          })()}
          {(() => {
            // Confidence needs BOTH complete food logging AND frequent weigh-ins
            // (the trend drives the estimate).
            const cov = checkIn.spanDays ? checkIn.logged / checkIn.spanDays : 0
            const wk = checkIn.weighPerWk || 0
            const [label, cls] =
              cov >= 0.8 && wk >= 4
                ? ['High confidence', 'text-green-400']
                : cov >= 0.6 && wk >= 2.5
                  ? ['Medium confidence', 'text-amber-400']
                  : ['Low confidence — weigh in more often', 'text-slate-400']
            return <p className={`text-[11px] ${cls}`}>● {label}</p>
          })()}
          {profile?.tdee > 0 && Math.abs(checkIn.tdee - profile.tdee) >= 150 && (
            <p className="text-[11px] text-slate-500">
              Your profile estimate was {profile.tdee}. The measured number is{' '}
              {checkIn.tdee < profile.tdee ? 'lower' : 'higher'} — usually because the activity
              setting over/under-shot, or some food/drinks aren't logged. The measured trend beats
              the formula only if your logging is complete.
            </p>
          )}

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
          {checkIn.sparseWeights ? (
            <p className="text-xs text-slate-500">
              Only {checkIn.weighIns} weigh-ins over {checkIn.spanDays} days — too few to read a
              reliable trend (a rate from a couple of points is mostly water weight). Weigh in more
              often — a few times a week, ideally most mornings — and it'll unlock a maintenance
              estimate you can trust.
            </p>
          ) : checkIn.unreliable ? (
            <p className="text-xs text-slate-500">
              Your logged data gives an unrealistic maintenance estimate (below your BMR) — usually
              missing food logs or short-term water-weight swings. Keep logging food + weight
              consistently and it'll settle.
            </p>
          ) : checkIn.lowLog ? (
            <p className="text-xs text-slate-500">
              Only {checkIn.logged} of {checkIn.spanDays} days between your weigh-ins have food
              logged — too many gaps to trust the estimate (the missing days get guessed from the
              logged ones). Log food on more days and it'll unlock.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Unlocks with regular weigh-ins (a few times a week over ≥7 days) and food logged on
              ≥half the days between them. It reads your weight trend + intake to estimate your real
              maintenance calories.
            </p>
          )}
        </Card>
      )}

      {/* Weight — log / edit, trend, projection, history in one section */}
      <Collapsible
        title="⚖️ Weight"
        right={
          curWeight != null ? (
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
          ) : null
        }
      >
        {/* log / edit a weigh-in (the form prefills the selected date) */}
        <form ref={formRef} onSubmit={save} className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label="Date">
              <Input type="date" value={date} max={todayISODate()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
          <div className="min-w-0 flex-1">
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
          </div>
          <Button type="submit" className="shrink-0" disabled={busy}>
            {busy ? '…' : weightLogs.some((l) => l.logged_date === date) ? 'Update' : 'Save'}
          </Button>
        </form>

        {weightData.length >= 2 ? (
          <>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={weightData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" {...axis} />
                <YAxis {...axis} domain={weightDomain} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                {goalWkg != null && (
                  <ReferenceLine
                    y={goalWkg}
                    stroke="#38bdf8"
                    strokeDasharray="5 4"
                    label={{
                      value: `goal ${goalWkg}`,
                      position: 'insideTopRight',
                      fill: '#38bdf8',
                      fontSize: 10,
                    }}
                  />
                )}
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
            Grey = daily · <span className="text-green-400">green</span> = trend (EWMA)
            {goalWkg != null && (
              <>
                {' '}
                · <span className="text-sky-400">blue</span> = goal
              </>
            )}
          </p>
          </>
        ) : (
          <p className="text-center text-sm text-slate-500">Log at least 2 weigh-ins to see your trend.</p>
        )}

        {/* projection (target set in Settings → Targets) */}
        <div className="space-y-1 border-t border-slate-800 pt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Goal projection
          </div>
          {projection?.reached && <p className="text-sm text-green-400">🎉 You're at your goal weight!</p>}
          {projection?.stalled && (
            <p className="text-sm text-amber-400">
              Not trending toward {projection.targetW}kg right now ({projection.remaining > 0 ? '+' : ''}
              {projection.remaining}kg to go) — adjust intake to move.
            </p>
          )}
          {projection && !projection.reached && !projection.stalled && (
            <p className="text-sm text-slate-300">
              At <b className="text-white">{projection.rateWk > 0 ? '+' : ''}{projection.rateWk}</b> kg/wk →{' '}
              <b className="text-white">{projection.targetW}kg</b> around{' '}
              <b className="text-white">
                {projection.date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
              </b>{' '}
              <span className="text-slate-500">(~{Math.abs(projection.weeks)} wk)</span>
            </p>
          )}
          {!projection && (
            <p className="text-xs text-slate-500">
              {goalWkg == null
                ? 'Set a goal weight in Settings → Targets, then log a couple of weigh-ins to see your projected date.'
                : 'Log a couple of weigh-ins to see your projected date.'}
            </p>
          )}
        </div>

        {/* history · ALL weigh-ins (not just the period), tap a row to edit */}
        {weightLogs.length > 0 && (
          <div className="space-y-1 border-t border-slate-800 pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              History · tap to edit · all dates
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto pr-0.5">
              {weightLogs
                .slice()
                .reverse()
                .map((l) => (
                  <div key={l.id} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2">
                    <button
                      onClick={() => editWeighIn(l.logged_date)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="text-sm text-slate-300">{l.logged_date}</span>
                      {date === l.logged_date && (
                        <span className="text-xs text-green-400"> · editing ↑</span>
                      )}
                    </button>
                    <span className="text-sm font-medium text-white">
                      {Number(l.weight_kg).toFixed(1)} kg
                    </span>
                    <button
                      onClick={() => deleteLog(l)}
                      className="px-1 text-slate-500 hover:text-red-400"
                      aria-label="Delete"
                    >
                      ✕
                    </button>
                  </div>
                ))}
            </div>
          </div>
        )}
      </Collapsible>

      {/* Body measurements */}
      <BodyMeasurements fromDate={fromDate} toDate={toDate} />
    </div>
  )
}
