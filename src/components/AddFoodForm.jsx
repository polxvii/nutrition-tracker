import { useState } from 'react'
import { Button, Field, Input, Select } from './ui'

export const MEALS = [
  { value: 'breakfast', label: 'Breakfast' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'dinner', label: 'Dinner' },
  { value: 'snack', label: 'Snack' },
]

export const UNITS = ['g', 'ml', 'piece', 'serving', 'cup', 'glass', 'tbsp', 'tsp']

const empty = {
  food_name: '',
  meal_type: 'lunch',
  grams: '',
  unit: 'g',
  calories: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
}

export default function AddFoodForm({ onSubmit, onCancel, busy }) {
  const [f, setF] = useState(empty)
  const [asFrequent, setAsFrequent] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  function submit(e) {
    e.preventDefault()
    if (!f.food_name.trim()) return
    onSubmit(
      {
        food_name: f.food_name.trim(),
        meal_type: f.meal_type,
        grams: f.grams === '' ? null : Number(f.grams),
        unit: f.unit,
        calories: Number(f.calories) || 0,
        protein_g: Number(f.protein_g) || 0,
        carbs_g: Number(f.carbs_g) || 0,
        fat_g: Number(f.fat_g) || 0,
      },
      { asFrequent }
    )
    setF(empty)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Field label="Food name">
            <Input
              value={f.food_name}
              onChange={set('food_name')}
              placeholder="e.g. Grilled chicken breast 150g"
              autoFocus
            />
          </Field>
        </div>
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
          <div className="flex gap-1">
            <Input
              type="number"
              inputMode="decimal"
              value={f.grams}
              onChange={set('grams')}
              placeholder="opt."
              className="flex-1"
            />
            <Select value={f.unit} onChange={set('unit')} className="w-20">
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Field label="Calories">
          <Input type="number" inputMode="decimal" value={f.calories} onChange={set('calories')} />
        </Field>
        <Field label="P (g)">
          <Input type="number" inputMode="decimal" value={f.protein_g} onChange={set('protein_g')} />
        </Field>
        <Field label="C (g)">
          <Input type="number" inputMode="decimal" value={f.carbs_g} onChange={set('carbs_g')} />
        </Field>
        <Field label="F (g)">
          <Input type="number" inputMode="decimal" value={f.fat_g} onChange={set('fat_g')} />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={asFrequent}
          onChange={(e) => setAsFrequent(e.target.checked)}
          className="h-4 w-4 accent-green-500"
        />
        ⭐ Save as a frequent food
      </label>

      <div className="flex gap-2">
        <Button type="submit" className="flex-1" disabled={busy}>
          {busy ? 'Saving…' : 'Add to today'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
