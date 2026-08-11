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
const PRESETS = [
  { label: '1d', days: 1 },
  { label: '7d', days: 7 },
  { label: '15d', days: 15 },
  { label: '30d', days: 30 },
  { label: 'All time', days: null },
]

// CSV-escape a cell (quote if it has a comma / quote / newline).
const esc = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function ExportCard() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [from, setFrom] = useState(isoDaysAgo(7))
  const [to, setTo] = useState(todayISODate())

  async function download({ from, to, tag }) {
    setBusy(true)
    setMsg('')
    let q = supabase
      .from('food_logs')
      .select('logged_at,meal_type,food_name,grams,unit,calories,protein_g,carbs_g,fat_g,source')
      .order('logged_at', { ascending: true })
    if (from) q = q.gte('logged_at', from + 'T00:00:00')
    if (to) q = q.lte('logged_at', to + 'T23:59:59')
    const { data, error } = await q
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    const rows = data || []
    if (!rows.length) {
      setMsg('No logs in that period.')
      return
    }
    const header = ['date', 'time', 'meal', 'food', 'grams', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'source']
    const lines = [header.join(',')]
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
    // BOM so Excel opens UTF-8 (Thai names) correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `nutrition-log-${tag || `${from || 'start'}_${to || 'now'}`}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    setMsg(`Exported ${rows.length} row${rows.length > 1 ? 's' : ''}.`)
  }

  return (
    <Collapsible title="📤 Export data" subtitle="Download your food log as a CSV">
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            variant="ghost"
            className="text-sm"
            disabled={busy}
            onClick={() =>
              download({ from: p.days ? isoDaysAgo(p.days) : null, to: p.days ? todayISODate() : null, tag: p.label.replace(' ', '') })
            }
          >
            {p.label}
          </Button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <Field label="From">
          <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} min={from} max={todayISODate()} onChange={(e) => e.target.value && setTo(e.target.value)} />
        </Field>
        <Button className="shrink-0" disabled={busy} onClick={() => download({ from, to })}>
          {busy ? '…' : 'Export'}
        </Button>
      </div>

      {msg && <p className="text-xs text-slate-400">{msg}</p>}
      <p className="text-[11px] text-slate-500">
        Opens in Excel / Sheets. One row per logged item (a dish’s totals; its sub-items are inside
        the app only).
      </p>
    </Collapsible>
  )
}
