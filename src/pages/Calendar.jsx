import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { todayISODate } from '../lib/dateHelpers'
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
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const start = new Date(cursor.y, cursor.m, 1)
    const end = new Date(cursor.y, cursor.m + 1, 1)
    const { data } = await supabase
      .from('food_logs')
      .select('logged_at,source,calories,protein_g,carbs_g,fat_g')
      .gte('logged_at', start.toISOString())
      .lt('logged_at', end.toISOString())
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

      {avg && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-300">Month average / day (net)</span>
            <span className="text-xs text-slate-500">
              {nLogged}/{daysInMonth} days logged
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'kcal', value: avg.cal },
              { label: 'P', value: `${avg.p}g` },
              { label: 'C', value: `${avg.c}g` },
              { label: 'F', value: `${avg.f}g` },
            ].map((s) => (
              <div key={s.label} className="rounded-lg bg-slate-800 py-2">
                <div className="text-base font-bold text-white">{s.value}</div>
                <div className="text-[10px] text-slate-500">{s.label}</div>
              </div>
            ))}
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
        </Card>
      )}
      {loading && <p className="text-center text-sm text-slate-500">Loading…</p>}
    </div>
  )
}
