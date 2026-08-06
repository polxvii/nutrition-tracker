import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { todayISODate } from '../lib/dateHelpers'
import { Button, Collapsible, Input } from './ui'

const SITES = [
  { key: 'waist', label: 'Waist' },
  { key: 'chest', label: 'Chest' },
  { key: 'arms', label: 'Arms' },
  { key: 'thighs', label: 'Thighs' },
  { key: 'hips', label: 'Hips' },
]
const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
const r1 = (n) => Math.round(n * 10) / 10

// Body measurements (cm). Waist especially matters for recomp: the scale can
// stay flat while waist shrinks (fat down) — this makes that visible.
export default function BodyMeasurements({ fromDate, toDate }) {
  const { user } = useAuth()
  const [logs, setLogs] = useState([])
  const [date, setDate] = useState(todayISODate())
  const [form, setForm] = useState({})
  const [busy, setBusy] = useState(false)
  const [site, setSite] = useState('waist')
  const formRef = useRef(null)

  // Tapping a history row loads that day into the form and scrolls to it.
  const editEntry = (d) => {
    setDate(d)
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('body_measurements')
      .select('*')
      .order('logged_date', { ascending: true })
    setLogs(data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Prefill the form with whatever is already saved for the chosen date.
  useEffect(() => {
    const existing = logs.find((l) => l.logged_date === date)
    const m = existing?.measurements || {}
    setForm(Object.fromEntries(SITES.map((s) => [s.key, m[s.key] ?? ''])))
  }, [date, logs])

  async function save(e) {
    e.preventDefault()
    const entered = {}
    for (const s of SITES) {
      const v = num(form[s.key])
      if (v > 0) entered[s.key] = v
    }
    if (Object.keys(entered).length === 0) return
    // Merge over the day's existing values so sites not in the form aren't lost
    // (upsert replaces the whole jsonb).
    const existing = logs.find((l) => l.logged_date === date)?.measurements || {}
    const measurements = { ...existing, ...entered }
    setBusy(true)
    const { error } = await supabase
      .from('body_measurements')
      .upsert({ user_id: user.id, logged_date: date, measurements }, { onConflict: 'user_id,logged_date' })
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    await load()
  }

  async function deleteEntry(l) {
    if (!window.confirm(`Delete measurements for ${l.logged_date}?`)) return
    setBusy(true)
    await supabase.from('body_measurements').delete().eq('id', l.id)
    setBusy(false)
    // If the deleted day was loaded in the form, clear it.
    if (date === l.logged_date) setForm(Object.fromEntries(SITES.map((s) => [s.key, ''])))
    await load()
  }

  const inRange = (d) => d >= fromDate && d <= toDate

  // Per-site: current (latest in range) + change vs first in range.
  const stats = useMemo(() => {
    const rows = logs.filter((l) => inRange(l.logged_date))
    return SITES.map((s) => {
      const vals = rows
        .map((l) => ({ d: l.logged_date, v: Number(l.measurements?.[s.key]) }))
        .filter((x) => Number.isFinite(x.v) && x.v > 0)
      if (vals.length === 0) return { ...s, cur: null, delta: null }
      const cur = vals[vals.length - 1].v
      const delta = vals.length >= 2 ? r1(cur - vals[0].v) : null
      return { ...s, cur: r1(cur), delta }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, fromDate, toDate])

  const chartData = useMemo(
    () =>
      logs
        .filter((l) => inRange(l.logged_date) && Number(l.measurements?.[site]) > 0)
        .map((l) => ({ date: l.logged_date.slice(5), value: Number(l.measurements[site]) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [logs, site, fromDate, toDate]
  )

  const hasAny = stats.some((s) => s.cur != null)

  const history = logs.filter((l) => inRange(l.logged_date))

  return (
    <Collapsible title="📏 Body measurements (cm)">
      <form ref={formRef} onSubmit={save} className="space-y-2">
        <Input type="date" value={date} max={todayISODate()} onChange={(e) => setDate(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          {SITES.map((s) => (
            <label key={s.key} className="text-xs text-slate-400">
              {s.label}
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={form[s.key] ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, [s.key]: e.target.value }))}
                placeholder="–"
                className="mt-0.5"
              />
            </label>
          ))}
          <div className="flex items-end">
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? '…' : logs.some((l) => l.logged_date === date) ? 'Update' : 'Save'}
            </Button>
          </div>
        </div>
      </form>

      {hasAny && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            {stats
              .filter((s) => s.cur != null)
              .map((s) => (
                <div key={s.key} className="rounded-lg bg-slate-800 py-2">
                  <div className="text-sm font-bold text-white">{s.cur}</div>
                  <div className="text-xs text-slate-500">
                    {s.label}
                    {s.delta != null && s.delta !== 0 && (
                      <span
                        className={
                          s.key === 'waist'
                            ? s.delta < 0
                              ? ' text-green-400'
                              : ' text-amber-400'
                            : ' text-slate-400'
                        }
                      >
                        {' '}
                        {s.delta > 0 ? '+' : ''}
                        {s.delta}
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {stats
              .filter((s) => s.cur != null)
              .map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSite(s.key)}
                  className={`rounded-lg px-2 py-0.5 text-xs ${
                    site === s.key ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {s.label}
                </button>
              ))}
          </div>

          {chartData.length >= 2 && (
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} domain={['dataMin - 1', 'dataMax + 1']} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: 8,
                      color: '#e2e8f0',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {history.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            History · tap to edit
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {history
              .slice()
              .reverse()
              .map((l) => {
                const summary = SITES.filter((s) => Number(l.measurements?.[s.key]) > 0)
                  .map((s) => `${s.label[0]} ${r1(Number(l.measurements[s.key]))}`)
                  .join(' · ')
                return (
                  <div key={l.id} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2">
                    <button onClick={() => editEntry(l.logged_date)} className="min-w-0 flex-1 text-left">
                      <div className="text-sm text-white">
                        {l.logged_date}
                        {date === l.logged_date && <span className="text-green-400"> · editing ↑</span>}
                      </div>
                      <div className="truncate text-xs text-slate-500">{summary || '—'}</div>
                    </button>
                    <button
                      onClick={() => deleteEntry(l)}
                      className="px-1 text-slate-500 hover:text-red-400"
                      aria-label="Delete"
                    >
                      ✕
                    </button>
                  </div>
                )
              })}
          </div>
        </div>
      )}
    </Collapsible>
  )
}
