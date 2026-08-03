import { useState } from 'react'
import { Button, Field, Input } from './ui'

// Rough kcal starting points for first-timers with no history yet. These are
// just prefills — the user adjusts before adding.
const PRESETS = [
  { name: 'Running', calories: 300 },
  { name: 'Walking', calories: 120 },
  { name: 'Cycling', calories: 250 },
  { name: 'Gym / Weights', calories: 200 },
  { name: 'Swimming', calories: 300 },
  { name: 'Yoga', calories: 150 },
]

export default function ExerciseForm({ onSubmit, onCancel, busy, recent = [] }) {
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState('')

  function submit(e) {
    e.preventDefault()
    if (!name.trim() || !(Number(kcal) > 0)) return
    onSubmit({ name: name.trim(), calories: Number(kcal) })
    setName('')
    setKcal('')
  }

  // Your own exercises first (real kcal), then any presets you haven't done.
  const seen = new Set(recent.map((r) => (r.name || '').toLowerCase()))
  const chips = [...recent, ...PRESETS.filter((p) => !seen.has(p.name.toLowerCase()))].slice(0, 10)

  const pick = (c) => {
    setName(c.name)
    setKcal(c.calories ? String(Math.round(c.calories)) : '')
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {chips.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-slate-400">Quick pick — tap to fill, then adjust</div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => pick(c)}
                className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 active:bg-slate-600"
              >
                {c.name}
                {c.calories ? ` · ${Math.round(c.calories)}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <Field label="Exercise">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Running, Gym, Walk"
        />
      </Field>
      <Field label="Calories burned (kcal)">
        <Input
          type="number"
          inputMode="decimal"
          value={kcal}
          onChange={(e) => setKcal(e.target.value)}
          placeholder="250"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={busy}>
          {busy ? 'Adding…' : 'Add exercise'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
