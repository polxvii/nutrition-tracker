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
// What you can export. Weight + measurements are keyed by logged_date (not a
// timestamp like food), so the same range presets apply by date.
const DATA_TYPES = [
  { key: 'food', label: 'Food log' },
  { key: 'weight', label: 'Weight' },
  { key: 'body', label: 'Measurements' },
]
const SITES = ['waist', 'chest', 'arms', 'thighs', 'hips'] // body_measurements keys

// CSV-escape a cell (quote if it has a comma / quote / newline).
const esc = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function ExportCard() {
  const today = todayISODate()
  const [dataType, setDataType] = useState('food') // food | weight | body
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

  // Each builder fetches its table for the window and returns CSV pieces:
  // { header:[...], lines:[...csv strings], count, slug } — or { error }.
  async function buildFood(f, t) {
    let query = supabase
      .from('food_logs')
      .select('logged_at,meal_type,food_name,grams,unit,calories,protein_g,carbs_g,fat_g,source,components')
      .order('logged_at', { ascending: true })
    if (f) query = query.gte('logged_at', f + 'T00:00:00')
    if (t) query = query.lte('logged_at', t + 'T23:59:59')
    const { data, error } = await query
    if (error) return { error: error.message }
    const header = ['date', 'time', 'meal', 'dish', 'food', 'grams', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'source']
    const lines = []
    for (const l of data || []) {
      const d = new Date(l.logged_at)
      const date = todayISODate(d)
      const time = d.toTimeString().slice(0, 5)
      const comps = Array.isArray(l.components) ? l.components : null
      // A dish carries its items in `components` — expand into one row each
      // (dish = the parent name) so the CSV matches the app's breakdown; their
      // kcal sum to the dish, so totals stay correct. Components are in grams.
      if (comps && comps.length && l.source !== 'exercise') {
        for (const c of comps) {
          lines.push(
            [date, time, l.meal_type || '', l.food_name || '', c.name || '', c.grams ?? '', 'g',
             c.calories ?? '', c.protein_g ?? '', c.carbs_g ?? '', c.fat_g ?? '', l.source || '']
              .map(esc)
              .join(',')
          )
        }
      } else {
        lines.push(
          [date, time, l.meal_type || '', '', l.food_name || '', l.grams ?? '', l.unit || '',
           l.calories ?? '', l.protein_g ?? '', l.carbs_g ?? '', l.fat_g ?? '', l.source || '']
            .map(esc)
            .join(',')
        )
      }
    }
    return { header, lines, count: lines.length, slug: 'log' }
  }

  async function buildWeight(f, t) {
    let query = supabase.from('weight_logs').select('logged_date,weight_kg').order('logged_date', { ascending: true })
    if (f) query = query.gte('logged_date', f)
    if (t) query = query.lte('logged_date', t)
    const { data, error } = await query
    if (error) return { error: error.message }
    const header = ['date', 'weight_kg']
    const lines = (data || []).map((l) => [l.logged_date, l.weight_kg ?? ''].map(esc).join(','))
    return { header, lines, count: lines.length, slug: 'weight' }
  }

  async function buildBody(f, t) {
    let query = supabase.from('body_measurements').select('logged_date,measurements').order('logged_date', { ascending: true })
    if (f) query = query.gte('logged_date', f)
    if (t) query = query.lte('logged_date', t)
    const { data, error } = await query
    if (error) return { error: error.message }
    const header = ['date', ...SITES]
    const lines = (data || []).map((l) =>
      [l.logged_date, ...SITES.map((k) => l.measurements?.[k] ?? '')].map(esc).join(',')
    )
    return { header, lines, count: lines.length, slug: 'measurements' }
  }

  async function exportNow() {
    const { from: f, to: t } = effective()
    setBusy(true)
    setResult(null)
    const build = dataType === 'weight' ? buildWeight : dataType === 'body' ? buildBody : buildFood
    const res = await build(f, t)
    if (res.error) {
      setBusy(false)
      setResult({ error: res.error })
      return
    }
    if (!res.count) {
      setBusy(false)
      setResult({ empty: true })
      return
    }
    // Stamp the file with when it was exported (local date + time).
    const now = new Date()
    const p2 = (n) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}`
    const rangeLabel = f ? `${f} to ${t || today}` : 'All time'
    // Range + export time at the TOP, a blank line, then the table.
    const lines = [`Range,${esc(rangeLabel)}`, `Exported,${stamp}`, '', res.header.join(','), ...res.lines]
    const filename = `nutrition-${res.slug}_exported-${stamp}.csv`
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
    setResult({ rows: res.count, from: f, to: t, filename })
  }

  return (
    <Collapsible title="📤 Export data" subtitle="Download your log, weight or measurements as CSV">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">1. What to export</div>
      <div className="flex flex-wrap gap-1.5">
        {DATA_TYPES.map((d) => (
          <button
            key={d.key}
            onClick={() => {
              setDataType(d.key)
              setResult(null)
            }}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              dataType === d.key ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>

      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">2. Pick a range</div>
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

      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">3. Export</div>
      <Button className="w-full" disabled={busy} onClick={exportNow}>
        {busy ? 'Exporting…' : 'Export CSV'}
      </Button>

      {result?.error && <p className="text-sm text-red-400">Export failed: {result.error}</p>}
      {result?.empty && <p className="text-sm text-amber-400">Nothing logged in that period — nothing to export.</p>}
      {result?.rows != null && (
        <div className="rounded-lg border border-green-600/30 bg-green-600/10 p-2.5 text-xs text-green-300">
          ✓ Exported <b>{result.rows}</b> row{result.rows > 1 ? 's' : ''}
          {result.from ? ` · ${result.from} → ${result.to}` : ' · all time'}.
          <div className="mt-0.5 text-green-300/80">
            Saved as <b>{result.filename}</b> — check your Downloads.
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        {dataType === 'food'
          ? 'One row per item — dishes expand into their parts (see the “dish” column).'
          : dataType === 'weight'
            ? 'One row per weigh-in (kg).'
            : 'One row per day; a column per site (cm).'}{' '}
        Opens in Excel / Sheets (UTF-8).
      </p>
    </Collapsible>
  )
}
