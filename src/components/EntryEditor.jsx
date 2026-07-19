import { useState } from 'react'
import { Button, Field, Input, Select } from './ui'
import { MEALS, UNITS } from './AddFoodForm'
import { todayISODate } from '../lib/dateHelpers'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

// Edit / duplicate a single logged entry (food or exercise). Editing the
// amount scales the calories + macros proportionally. The date can be changed
// (moves the entry to another day). Returns a patch via onSave / onDuplicate.
export default function EntryEditor({ entry, onSave, onDuplicate, onDelete, onClose, busy }) {
  const isEx = entry.source === 'exercise'
  const [f, setF] = useState({
    food_name: entry.food_name ?? '',
    meal_type: entry.meal_type ?? 'lunch',
    grams: entry.grams ?? '',
    unit: entry.unit ?? 'g',
    calories: Math.round(num(entry.calories)),
    protein_g: Math.round(num(entry.protein_g)),
    carbs_g: Math.round(num(entry.carbs_g)),
    fat_g: Math.round(num(entry.fat_g)),
    date: todayISODate(new Date(entry.logged_at)),
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  // Changing the amount *number* scales calories + macros proportionally
  // (twice the amount = twice the food). Changing the unit is left as a plain
  // relabel — we have no per-unit data to convert g <-> serving/piece.
  function setGrams(e) {
    const value = e.target.value
    const oldG = num(f.grams)
    const newG = num(value)
    if (oldG > 0 && newG > 0) {
      const r = newG / oldG
      setF({
        ...f,
        grams: value,
        calories: Math.round(num(f.calories) * r),
        protein_g: Math.round(num(f.protein_g) * r),
        carbs_g: Math.round(num(f.carbs_g) * r),
        fat_g: Math.round(num(f.fat_g) * r),
      })
    } else {
      setF({ ...f, grams: value })
    }
  }

  function build() {
    const base = {
      food_name: f.food_name.trim() || (isEx ? 'Exercise' : 'Food'),
      calories: num(f.calories),
      date: f.date,
      source: entry.source,
    }
    if (isEx) {
      return { ...base, meal_type: null, grams: null, unit: null, protein_g: 0, carbs_g: 0, fat_g: 0 }
    }
    return {
      ...base,
      meal_type: f.meal_type,
      grams: f.grams === '' ? null : num(f.grams),
      unit: f.unit,
      protein_g: num(f.protein_g),
      carbs_g: num(f.carbs_g),
      fat_g: num(f.fat_g),
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-200">
        {isEx ? 'Edit exercise' : 'Edit entry'}
      </div>

      <Field label={isEx ? 'Exercise' : 'Food name'}>
        <Input value={f.food_name} onChange={set('food_name')} />
      </Field>

      {!isEx && (
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Field label="Meal">
            <Select value={f.meal_type} onChange={set('meal_type')}>
              {MEALS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount">
            <div className="grid grid-cols-[1fr_auto] gap-1">
              <Input
                type="number"
                inputMode="decimal"
                value={f.grams}
                onChange={setGrams}
                placeholder="opt."
              />
              <Select value={f.unit} onChange={set('unit')}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        </div>
      )}

      {isEx ? (
        <Field label="Calories burned (kcal)">
          <Input type="number" inputMode="decimal" value={f.calories} onChange={set('calories')} />
        </Field>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <Field label="kcal">
            <Input type="number" value={f.calories} onChange={set('calories')} className="px-1 text-center" />
          </Field>
          <Field label="P">
            <Input type="number" value={f.protein_g} onChange={set('protein_g')} className="px-1 text-center" />
          </Field>
          <Field label="C">
            <Input type="number" value={f.carbs_g} onChange={set('carbs_g')} className="px-1 text-center" />
          </Field>
          <Field label="F">
            <Input type="number" value={f.fat_g} onChange={set('fat_g')} className="px-1 text-center" />
          </Field>
        </div>
      )}

      <Field label="Date">
        <Input type="date" value={f.date} onChange={set('date')} />
      </Field>

      {!isEx && (
        <p className="text-xs text-slate-500">
          Changing the amount scales macros. Changing the unit only relabels —
          edit the values if needed.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" disabled={busy} onClick={() => onSave(build())}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => onDuplicate(build())}>
          Duplicate
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => onDelete(entry.id)}>
          Delete
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
