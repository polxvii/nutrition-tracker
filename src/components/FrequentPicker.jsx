import { useState } from 'react'
import { Button, Input } from './ui'

const r = (n) => Math.round(Number(n) || 0)

// A searchable list of the user's frequent foods. Tap a row (or ＋) to add it
// to the day; ✕ removes it from the saved list. Stays open so several can be
// added in a row.
export default function FrequentPicker({ items, onAdd, onDelete, onClose }) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const filtered = query
    ? items.filter((f) => f.food_name.toLowerCase().includes(query))
    : items

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search saved foods…"
        />
      )}

      {items.length === 0 ? (
        <p className="py-2 text-sm text-slate-500">
          No saved foods yet. Tick “⭐ Save frequent” when adding a food (manual
          or photo) and it shows up here.
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-2 text-sm text-slate-500">No match.</p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {filtered.map((f) => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg bg-slate-800 px-2 py-2">
              <button onClick={() => onAdd(f)} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm text-white">{f.food_name}</div>
                <div className="text-xs text-slate-500">
                  {r(f.calories)} kcal · {r(f.protein_g)}P {r(f.carbs_g)}C {r(f.fat_g)}F ·
                  used {f.times_used}×
                </div>
              </button>
              <button
                onClick={() => onAdd(f)}
                className="rounded-lg bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-500"
                aria-label="Add"
              >
                ＋
              </button>
              <button
                onClick={() => onDelete(f)}
                className="px-1 text-slate-500 hover:text-red-400"
                aria-label="Remove from saved"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <Button variant="ghost" className="w-full" onClick={onClose}>
        Done
      </Button>
    </div>
  )
}
