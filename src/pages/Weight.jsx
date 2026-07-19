import { useCallback, useEffect, useState } from 'react'
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
import { Button, Card, Field, Input } from '../components/ui'

export default function Weight() {
  const { user } = useAuth()
  const [logs, setLogs] = useState([])
  const [date, setDate] = useState(todayISODate())
  const [weight, setWeight] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('weight_logs')
      .select('*')
      .order('logged_date', { ascending: false })
      .limit(60)
    setLogs(data ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save(e) {
    e.preventDefault()
    const w = Number(weight)
    if (!(w > 0)) return
    setBusy(true)
    const { error } = await supabase.from('weight_logs').upsert(
      { user_id: user.id, logged_date: date, weight_kg: w },
      { onConflict: 'user_id,logged_date' }
    )
    setBusy(false)
    if (error) {
      alert(error.message)
      return
    }
    setWeight('')
    await load()
  }

  async function deleteLog(id) {
    setLogs((prev) => prev.filter((l) => l.id !== id))
    await supabase.from('weight_logs').delete().eq('id', id)
  }

  // Oldest → newest for the chart.
  const chartData = [...logs]
    .reverse()
    .map((l) => ({ date: l.logged_date.slice(5), weight: Number(l.weight_kg) }))

  return (
    <div className="mx-auto max-w-md space-y-4 p-4">
      <header className="pt-4">
        <h1 className="text-xl font-bold text-white">Weight ⚖️</h1>
        <p className="text-xs text-slate-500">Log your weight regularly (morning is best)</p>
      </header>

      <Card>
        <form onSubmit={save} className="flex items-end gap-2">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

      {chartData.length >= 2 && (
        <Card>
          <h2 className="mb-2 text-sm font-medium text-slate-300">Weight trend</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  domain={['dataMin - 1', 'dataMax + 1']}
                />
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
                  dataKey="weight"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-slate-300">History</h2>
        {logs.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-slate-500">No weight data yet</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {logs.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between rounded-xl bg-slate-900 px-3 py-2.5"
              >
                <span className="text-sm text-slate-300">{l.logged_date}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-white">
                    {Number(l.weight_kg).toFixed(1)} kg
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
