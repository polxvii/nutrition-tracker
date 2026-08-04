import { Fragment, useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { todayISODate } from '../lib/dateHelpers'
import { useSwipe } from '../lib/useSwipe'
import { loadGoalHistory, goalForDate } from '../lib/goalHistory'
import { Card } from '../components/ui'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
const pad = (n) => String(n).padStart(2, '0')

export default function Calendar() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const now = new Date()
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [byDate, setByDate] = useState({})
  const [monthWeight, setMonthWeight] = useState(null)
  const [streak, setStreak] = useState(0)
  const [goalHist, setGoalHist] = useState([]) // goal snapshots (ascending by date)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const start = new Date(cursor.y, cursor.m, 1)
    const end = new Date(cursor.y, cursor.m + 1, 1)
    const startYMD = `${cursor.y}-${pad(cursor.m + 1)}-01`
    const endMonth = cursor.m === 11 ? { y: cursor.y + 1, m: 0 } : { y: cursor.y, m: cursor.m + 1 }
    const endYMD = `${endMonth.y}-${pad(endMonth.m + 1)}-01`
    const [foodRes, wRes] = await Promise.all([
      supabase
        .from('food_logs')
        .select('logged_at,source,calories,protein_g,carbs_g,fat_g')
        .gte('logged_at', start.toISOString())
        .lt('logged_at', end.toISOString()),
      supabase
        .from('weight_logs')
        .select('logged_date,weight_kg')
        .gte('logged_date', startYMD)
        .lt('logged_date', endYMD)
        .order('logged_date', { ascending: true }),
    ])
    const data = foodRes.data
    const w = wRes.data ?? []
    if (w.length) {
      const first = Number(w[0].weight_kg)
      const last = Number(w[w.length - 1].weight_kg)
      setMonthWeight({ first, last, delta: w.length >= 2 ? Math.round((last - first) * 10) / 10 : null })
    } else {
      setMonthWeight(null)
    }
    const map = {}
    for (const l of data ?? []) {
      const key = todayISODate(new Date(l.logged_at)) // local day
      const b = map[key] || (map[key] = { cal: 0, p: 0, c: 0, f: 0, burned: 0 })
      if (l.source === 'exercise') {
        b.burned += num(l.calories) // exercise = calories back (net = eaten − burned)
      } else {
        b.cal += num(l.calories)
        b.p += num(l.protein_g)
        b.c += num(l.carbs_g)
        b.f += num(l.fat_g)
      }
    }
    setByDate(map)
    setLoading(false)
  }, [cursor])

  useEffect(() => {
    load()
  }, [load])

  // Current logging streak — consecutive days with food, ending today (or
  // yesterday if today isn't logged yet). Independent of the viewed month.
  useEffect(() => {
    ;(async () => {
      const since = new Date()
      since.setDate(since.getDate() - 90)
      const { data } = await supabase
        .from('food_logs')
        .select('logged_at')
        .neq('source', 'exercise')
        .gte('logged_at', since.toISOString())
      const days = new Set((data ?? []).map((l) => todayISODate(new Date(l.logged_at))))
      const d = new Date()
      if (!days.has(todayISODate(d))) d.setDate(d.getDate() - 1)
      let s = 0
      while (days.has(todayISODate(d))) {
        s++
        d.setDate(d.getDate() - 1)
      }
      setStreak(s)
    })()
    // Streak is global (not tied to the viewed month); compute once per mount.
  }, [])

  useEffect(() => {
    loadGoalHistory().then(setGoalHist)
  }, [])

  const goalCal = profile?.goal_calories ?? 0
  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })
  const firstWeekday = new Date(cursor.y, cursor.m, 1).getDay() // 0 = Sun
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const today = todayISODate()

  const cells = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null) // pad tail to full weeks
  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // net calories for a day = eaten − exercise burned.
  const netOf = (b) => b.cal - b.burned
  // Month summary over days with food logged.
  const logged = Object.values(byDate).filter((b) => b.cal > 0)
  const nLogged = logged.length
  const avg = nLogged
    ? {
        cal: Math.round(logged.reduce((s, b) => s + netOf(b), 0) / nLogged),
        p: Math.round(logged.reduce((s, b) => s + b.p, 0) / nLogged),
        c: Math.round(logged.reduce((s, b) => s + b.c, 0) / nLogged),
        f: Math.round(logged.reduce((s, b) => s + b.f, 0) / nLogged),
      }
    : null
  // Days at or under the goal that was in effect on each day (history-aware, so
  // it doesn't shift when you change your goal). Needs the date key, so iterate
  // entries rather than the value-only `logged` array.
  const goalOn = (k) => goalForDate(goalHist, k)?.goal_calories ?? goalCal
  const maintOn = (k) => goalForDate(goalHist, k)?.tdee ?? tdee
  const loggedEntries = Object.entries(byDate).filter(([, b]) => b.cal > 0)
  const onTarget =
    goalCal > 0 || goalHist.length
      ? loggedEntries.filter(([k, b]) => goalOn(k) > 0 && netOf(b) <= goalOn(k)).length
      : null

  // Predicted weight impact: (net eaten − maintenance TDEE) / 7700 kcal-per-kg.
  const tdee = profile?.tdee ?? 0
  const totalNet = logged.reduce((s, b) => s + netOf(b), 0)
  const predictedKg =
    tdee > 0 && nLogged > 0
      ? Math.round(((totalNet - tdee * nLogged) / 7700) * 100) / 100
      : null

  // Net-kcal colour tier, matching the Progress adherence chart:
  // green ≤ goal · amber over goal · red over maintenance.
  // 3-tier text colour for a value against a given goal / maintenance:
  // green ≤ goal · amber over goal · red over maintenance.
  const tierText = (v, g, m) =>
    m > 0 && v > m ? 'text-red-400' : g > 0 && v > g ? 'text-amber-400' : 'text-green-400'
  // Aggregate helper (month tile) uses the current goal.
  const kcalTier = (v) => tierText(v, goalCal, tdee)

  // Heatmap tint for a day cell — same 3-tier scale as the text colour, but as a
  // faint background so the whole month reads at a glance. Each day is judged
  // against the goal in effect *that* day. Days with no food fall back to
  // neutral: exercise-only, future (dimmer), or past-unlogged.
  const cellStyle = (b, k) => {
    if (b && b.cal > 0) {
      const net = netOf(b)
      const g = goalOn(k)
      const m = maintOn(k)
      if (m > 0 && net > m) return 'border-red-500/40 bg-red-500/10'
      if (g > 0 && net > g) return 'border-amber-500/40 bg-amber-500/10'
      return 'border-green-500/40 bg-green-500/10'
    }
    if (b && b.burned > 0) return 'border-slate-700 bg-slate-900' // exercise only
    if (k > today) return 'border-slate-800/40 bg-slate-900/20' // future
    return 'border-slate-800 bg-slate-900/40' // past / today, unlogged
  }

  const prev = () =>
    setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
  const next = () =>
    setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))
  const keyFor = (d) => `${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}`

  // Swipe left/right to move a month.
  const monthSwipe = useSwipe({ onLeft: next, onRight: prev })

  return (
    <div className="mx-auto max-w-md space-y-3 p-4" {...monthSwipe}>
      <header className="flex items-center justify-between pt-4">
        <button onClick={prev} className="px-2 text-xl text-slate-400 hover:text-white">
          ‹
        </button>
        <h1 className="text-lg font-bold text-white">{monthName}</h1>
        <button onClick={next} className="px-2 text-xl text-slate-400 hover:text-white">
          ›
        </button>
      </header>

      <div className="grid grid-cols-8 gap-1 text-center text-[10px] text-slate-500">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
        <div className="font-semibold text-slate-300">avg</div>
      </div>

      <div className={`grid grid-cols-8 gap-1 transition-opacity ${loading ? 'opacity-40' : ''}`}>
        {weeks.map((week, wi) => {
          // week average (net) over days that have food, for the trailing column.
          const bs = week
            .filter((d) => d && byDate[keyFor(d)]?.cal > 0)
            .map((d) => byDate[keyFor(d)])
          const wAvg = bs.length
            ? Math.round(bs.reduce((s, b) => s + netOf(b), 0) / bs.length)
            : null
          // colour the week avg against the goal at the week's last in-month day
          const lastDay = [...week].reverse().find((d) => d != null)
          const wKey = lastDay ? keyFor(lastDay) : today
          return (
            <Fragment key={wi}>
              {week.map((d, di) => {
                if (d === null) return <div key={di} />
                const k = keyFor(d)
                const b = byDate[k]
                const isToday = k === today
                const hasFood = b && b.cal > 0
                const net = b ? Math.round(netOf(b)) : null
                const missed = !b && k < today
                let cls = cellStyle(b, k)
                if (isToday) cls = cls.replace(/border-\S+/, 'border-green-500')
                return (
                  <button
                    key={di}
                    onClick={() => navigate(`/?date=${k}`)}
                    className={`flex min-h-[54px] flex-col items-center rounded-lg border p-1 text-center ${cls}`}
                  >
                    <span className="text-[11px] text-slate-400">{d}</span>
                    {hasFood ? (
                      <>
                        <span
                          className={`text-[11px] font-semibold ${tierText(net, goalOn(k), maintOn(k))}`}
                        >
                          {net}
                        </span>
                        <span className="text-[8px] leading-tight text-slate-500">
                          {Math.round(b.p)}·{Math.round(b.c)}·{Math.round(b.f)}
                          {b.burned > 0 && <span className="text-amber-500"> 🔥</span>}
                        </span>
                      </>
                    ) : b && b.burned > 0 ? (
                      <span className="mt-0.5 text-[9px] text-amber-500">
                        🔥{Math.round(b.burned)}
                      </span>
                    ) : missed ? (
                      <span className="mt-1.5 h-1 w-1 rounded-full bg-slate-700" />
                    ) : null}
                  </button>
                )
              })}
              <div className="ml-0.5 flex min-h-[54px] flex-col items-center justify-center gap-0.5 rounded-lg bg-slate-700/50 ring-1 ring-inset ring-slate-500/40">
                <span className="text-[7px] font-semibold uppercase tracking-wider text-slate-300">
                  wk
                </span>
                {wAvg != null ? (
                  <>
                    <span
                      className={`text-[12px] font-bold tabular-nums ${tierText(wAvg, goalOn(wKey), maintOn(wKey))}`}
                    >
                      {wAvg}
                    </span>
                    <span className="text-[7px] text-slate-400">{bs.length}d avg</span>
                  </>
                ) : (
                  <span className="text-[11px] text-slate-500">–</span>
                )}
              </div>
            </Fragment>
          )
        })}
      </div>

      <p className="text-center text-[11px] text-slate-500">
        net kcal (food − 🔥exercise) · P·C·F (g) — tap a day to view / log
      </p>
      <div className="flex justify-center gap-3 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-green-500/70" /> ≤ goal
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-amber-500/70" /> &gt; goal
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-red-500/70" /> &gt; maint
        </span>
      </div>

      {(avg || streak > 0 || monthWeight) && (
        <Card className={`space-y-2 transition-opacity ${loading ? 'opacity-40' : ''}`}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-300">Month summary</span>
            <span className="text-xs text-slate-500">
              {nLogged}/{daysInMonth} days logged
            </span>
          </div>

          {avg && (
            <>
              <div className="text-center text-[10px] uppercase tracking-wide text-slate-500">
                avg / logged day (net)
              </div>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[
                  { label: 'kcal', value: avg.cal, unit: '', goal: profile?.goal_calories },
                  { label: 'P', value: avg.p, unit: 'g', goal: profile?.goal_protein_g },
                  { label: 'C', value: avg.c, unit: 'g', goal: profile?.goal_carbs_g },
                  { label: 'F', value: avg.f, unit: 'g', goal: profile?.goal_fat_g },
                ].map((s) => {
                  // kcal uses the 3-tier scale (green ≤ goal · amber over goal ·
                  // red over maintenance), matching the Progress chart. Macros
                  // colour vs their goal (protein: higher is good; carbs/fat: lower).
                  const cls =
                    s.label === 'kcal'
                      ? kcalTier(s.value)
                      : s.goal > 0
                        ? (s.label === 'P' ? s.value >= s.goal * 0.9 : s.value <= s.goal)
                          ? 'text-green-400'
                          : 'text-amber-400'
                        : 'text-white'
                  return (
                    <div key={s.label} className="rounded-lg bg-slate-800 py-2">
                      <div className={`text-base font-bold ${cls}`}>
                        {s.value}
                        {s.unit}
                      </div>
                      <div className="text-[10px] text-slate-500">{s.label}</div>
                      {s.goal > 0 && (
                        <div className="text-[9px] text-slate-500">
                          goal {s.goal}
                          {s.unit}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {onTarget != null && (
                <p className="text-center text-xs text-slate-500">
                  {onTarget}/{nLogged} days at or under goal
                </p>
              )}
              {predictedKg != null && (
                <p className="text-center text-xs text-slate-400">
                  Est. impact on these {nLogged} days:{' '}
                  <b className={predictedKg < 0 ? 'text-green-400' : predictedKg > 0 ? 'text-amber-400' : 'text-slate-200'}>
                    {predictedKg > 0 ? '+' : ''}
                    {predictedKg} kg
                  </b>
                  <span className="text-slate-500"> · vs ~{tdee} maintenance</span>
                </p>
              )}
            </>
          )}

          <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
            <span className="text-slate-400">
              🔥 Streak <b className="text-white">{streak}</b> day{streak === 1 ? '' : 's'}
            </span>
            {monthWeight && (
              <span className="text-slate-400">
                ⚖️ {monthWeight.first}
                {monthWeight.delta != null ? (
                  <>
                    →{monthWeight.last}{' '}
                    <span
                      className={
                        monthWeight.delta < 0
                          ? 'text-green-400'
                          : monthWeight.delta > 0
                            ? 'text-amber-400'
                            : ''
                      }
                    >
                      ({monthWeight.delta > 0 ? '+' : ''}
                      {monthWeight.delta}kg)
                    </span>
                  </>
                ) : (
                  ' kg'
                )}
              </span>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
