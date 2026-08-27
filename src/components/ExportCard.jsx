import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { todayISODate } from '../lib/dateHelpers'
import { Button, Collapsible, Field, Input } from './ui'

// Last N days *including today* (1d = today only).
const isoDaysAgo = (n) => {
  const d = new Date()
  d.setDate(d.getDate() - (n - 1))
  return todayISODate(d)
}
const yesterdayISO = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return todayISODate(d)
}
const PRESETS = [
  { key: '1d', label: 'Today', days: 1 },
  { key: 'yesterday', label: 'Yesterday' }, // single day; handled in effective()
  { key: '7d', label: '7 days', days: 7 },
  { key: '15d', label: '15 days', days: 15 },
  { key: '30d', label: '30 days', days: 30 },
  { key: 'all', label: 'All time', days: null },
  { key: 'custom', label: 'Custom', days: undefined },
]

// CSV-escape a cell (quote if it has a comma / quote / newline).
const esc = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function ExportCard() {
  const today = todayISODate()
  const [rangeKey, setRangeKey] = useState('7d')
  const [from, setFrom] = useState(isoDaysAgo(7))
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // {rows,from,to,filename} | {empty} | {error}

  // The effective date window for the chosen range (null = open-ended).
  function effective() {
    if (rangeKey === 'custom') return { from, to }
    if (rangeKey === 'yesterday') {
      const y = yesterdayISO()
      return { from: y, to: y }
    }
    const p = PRESETS.find((x) => x.key === rangeKey)
    if (p.days == null) return { from: null, to: null } // all time
    return { from: isoDaysAgo(p.days), to: today }
  }
  const eff = effective()

  const chooseRange = (key) => {
    setRangeKey(key)
    setResult(null) // clear the previous result when the range changes
  }

  async function exportNow() {
    const { from: f, to: t } = effective()
    setBusy(true)
    setResult(null)
    let query = supabase
      .from('food_logs')
      .select('logged_at,meal_type,food_name,grams,unit,calories,protein_g,carbs_g,fat_g,source')
      .order('logged_at', { ascending: true })
    if (f) query = query.gte('logged_at', f + 'T00:00:00')
    if (t) query = query.lte('logged_at', t + 'T23:59:59')
    const { data, error } = await query
    if (error) {
      setBusy(false)
      setResult({ error: error.message })
      return
    }
    const rows = data || []
    if (!rows.length) {
      setBusy(false)
      setResult({ empty: true })
      return
    }
    // Stamp the file with when it was exported (local date + time).
    const now = new Date()
    const p2 = (n) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}`
    const rangeLabel = f ? `${f} to ${t || today}` : 'All time'
    const header = ['date', 'time', 'meal', 'food', 'grams', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'source']
    // Range + export time go at the TOP of the file (not the filename), then a
    // blank line, then the table.
    const lines = [`Range,${esc(rangeLabel)}`, `Exported,${stamp}`, '', header.join(',')]
    for (const l of rows) {
      const d = new Date(l.logged_at)
      lines.push(
        [
          todayISODate(d),
          d.toTimeString().slice(0, 5),
          l.meal_type || '',
          l.food_name || '',
          l.grams ?? '',
          l.unit || '',
          l.calories ?? '',
          l.protein_g ?? '',
          l.carbs_g ?? '',
          l.fat_g ?? '',
          l.source || '',
        ]
          .map(esc)
          .join(',')
      )
    }
    const filename = `nutrition-log_exported-${stamp}.csv`
    // BOM so Excel opens UTF-8 (Thai names) correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setBusy(false)
    setResult({ rows: rows.length, from: f, to: t, filename })
  }

  return (
    <Collapsible title="📤 Export data" subtitle="Download your food log as a CSV">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">1. Pick a range</div>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => chooseRange(p.key)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              rangeKey === p.key ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {rangeKey === 'custom' && (
        <div className="flex items-end gap-2">
          <Field label="From">
            <Input
              type="date"
              value={from}
              max={to}
              onChange={(e) => {
                if (e.target.value) setFrom(e.target.value)
                setResult(null)
              }}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={to}
              min={from}
              max={today}
              onChange={(e) => {
                if (e.target.value) setTo(e.target.value)
                setResult(null)
              }}
            />
          </Field>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        {rangeKey === 'all' ? 'Everything you’ve logged.' : `${eff.from} → ${eff.to}`}
      </p>

      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">2. Export</div>
      <Button className="w-full" disabled={busy} onClick={exportNow}>
        {busy ? 'Exporting…' : 'Export CSV'}
      </Button>

      {result?.error && <p className="text-sm text-red-400">Export failed: {result.error}</p>}
      {result?.empty && <p className="text-sm text-amber-400">No logs in that period — nothing to export.</p>}
      {result?.rows != null && (
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 p-2.5 text-xs text-green-300">
          ✓ Exported <b>{result.rows}</b> row{result.rows > 1 ? 's' : ''}
          {result.from ? ` · ${result.from} → ${result.to}` : ' · all time'}.
          <div className="mt-0.5 text-green-300/80">
            Saved as <b>{result.filename}</b> — check your Downloads.
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-500">One row per logged item; opens in Excel / Sheets (UTF-8).</p>
    </Collapsible>
  )
}
