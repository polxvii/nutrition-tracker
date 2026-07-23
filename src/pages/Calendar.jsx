import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { todayISODate } from '../lib/dateHelpers'
import { Card, Skeleton } from '../components/ui'

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
  const onTarget = goalCal > 0 ? logged.filter((b) => netOf(b) <= goalCal).length : null

  // Predicted weight impact: (net eaten − maintenance TDEE) / 7700 kcal-per-kg.
  const tdee = profile?.tdee ?? 0
  const totalNet = logged.reduce((s, b) => s + netOf(b), 0)
  const predictedKg =
    tdee > 0 && nLogged > 0
      ? Math.round(((totalNet - tdee * nLogged) / 7700) * 100) / 100
      : null

  const prev = () =>
    setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
  const next = () =>
    setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))
  const keyFor = (d) => `${cursor.y}-${pad(cursor.m + 1)}-${pad(d)}`

  return (
    <div className="mx-auto max-w-md space-y-3 p-4">
      <header className="flex items-center justify-between pt-4">
        <button onClick={prev} className="px-2 text-xl text-slate-400 hover:text-white">
          ‹
        </button>
        <h1 className="text-lg font-bold text-white">{monthName}</h1>
        <button onClick={next} className="px-2 text-xl text-slate-400 hover:text-white">
          ›
        </button>
      </header>

      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />
          const k = keyFor(d)
          const b = byDate[k]
          const isToday = k === today
          const net = b ? Math.round(b.cal - b.burned) : null // eaten − exercise
          const over = goalCal > 0 && net != null && net > goalCal
          return (
            <button
              key={i}
              onClick={() => navigate(`/?date=${k}`)}
              className={`flex min-h-[54px] flex-col items-center rounded-lg border p-1 text-center ${
                isToday ? 'border-green-500' : 'border-slate-800'
              } ${b ? 'bg-slate-900' : 'bg-slate-900/40'}`}
            >
              <span className="text-[11px] text-slate-400">{d}</span>
              {b && (
                <span
                  className={`text-[11px] font-semibold ${over ? 'text-red-400' : 'text-green-400'}`}
                >
                  {net}
                </span>
              )}
              {b && b.cal > 0 && (
                <span className="text-[8px] leading-tight text-slate-500">
                  {Math.round(b.p)}·{Math.round(b.c)}·{Math.round(b.f)}
                  {b.burned > 0 && <span className="text-amber-500"> 🔥</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-center text-[11px] text-slate-500">
        net kcal (food − 🔥exercise) · P·C·F (g) — tap a day to view / log
      </p>

      {(avg || streak > 0 || monthWeight) && (
        <Card className="space-y-2">
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
                  // Colour the average vs its goal. Fewer calories/carbs/fat than
                  // goal reads "green" (under); protein is the opposite — hitting
                  // or exceeding it is good.
                  const good =
                    s.goal > 0
                      ? s.label === 'P'
                        ? s.value >= s.goal * 0.9
                        : s.value <= s.goal
                      : null
                  return (
                    <div key={s.label} className="rounded-lg bg-slate-800 py-2">
                      <div
                        className={`text-base font-bold ${
                          good == null ? 'text-white' : good ? 'text-green-400' : 'text-amber-400'
                        }`}
                      >
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
                  {onTarget}/{nLogged} days at or under goal ({goalCal} kcal)
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
      {loading && <Skeleton className="h-28 w-full" />}
    </div>
  )
}
