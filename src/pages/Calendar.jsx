import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { todayISODate } from '../lib/dateHelpers'

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
      .select('logged_at,calories,protein_g,carbs_g,fat_g')
      .gte('logged_at', start.toISOString())
      .lt('logged_at', end.toISOString())
    const map = {}
    for (const l of data ?? []) {
      const key = todayISODate(new Date(l.logged_at)) // local day
      const b = map[key] || (map[key] = { cal: 0, p: 0, c: 0, f: 0 })
      b.cal += num(l.calories)
      b.p += num(l.protein_g)
      b.c += num(l.carbs_g)
      b.f += num(l.fat_g)
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
          const over = goalCal > 0 && b && b.cal > goalCal
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
                  {Math.round(b.cal)}
                </span>
              )}
              {b && (
                <span className="text-[8px] leading-tight text-slate-500">
                  {Math.round(b.p)}·{Math.round(b.c)}·{Math.round(b.f)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <p className="text-center text-[11px] text-slate-500">
        kcal · P·C·F (g) — tap a day to view / log
      </p>
      {loading && <p className="text-center text-sm text-slate-500">Loading…</p>}
    </div>
  )
}
