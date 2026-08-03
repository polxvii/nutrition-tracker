import { useState } from 'react'
import { Button, Field, Input } from './ui'

// Common exercises for first-timers with no history yet.
const PRESETS = ['Running', 'Walking', 'Cycling', 'Gym / Weights', 'Swimming', 'Yoga']

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

  // Your own exercises first, then any presets you haven't done — names only;
  // tapping fills the name, you enter the kcal yourself (it varies each time).
  const recentNames = recent.map((r) => r.name).filter(Boolean)
  const seen = new Set(recentNames.map((n) => n.toLowerCase()))
  const chips = [...recentNames, ...PRESETS.filter((p) => !seen.has(p.toLowerCase()))].slice(0, 10)

  return (
    <form onSubmit={submit} className="space-y-3">
      {chips.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-slate-400">Quick pick</div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((c, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setName(c)}
                className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 active:bg-slate-600"
              >
                {c}
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
