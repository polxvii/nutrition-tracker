import { useState } from 'react'
import { Button, Field, Input, Select } from './ui'
import { UNITS } from './AddFoodForm'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

// Edit a saved (frequent) food: rename, change its default amount/unit, tweak
// macros. Editing grams scales macros from the saved base; editing a macro
// recomputes kcal from 4/4/9. Mirrors the per-item rules used elsewhere.
export default function FrequentEditor({ food, onSave, onDelete, onCancel, busy }) {
  const [f, setF] = useState(() => {
    const v = {
      food_name: food.food_name ?? '',
      grams: food.default_grams != null ? Math.round(num(food.default_grams)) : '',
      unit: food.unit ?? 'g',
      calories: Math.round(num(food.calories)),
      protein_g: Math.round(num(food.protein_g)),
      carbs_g: Math.round(num(food.carbs_g)),
      fat_g: Math.round(num(food.fat_g)),
    }
    return { ...v, _base: v } // fixed base so grams edits scale correctly
  })

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  function setGrams(e) {
    const value = e.target.value
    setF((p) => {
      const base = p._base || p
      const baseG = num(base.grams)
      const newG = num(value)
      if (baseG > 0 && newG > 0) {
        const rt = newG / baseG
        return {
          ...p,
          grams: value,
          calories: Math.round(num(base.calories) * rt),
          protein_g: Math.round(num(base.protein_g) * rt),
          carbs_g: Math.round(num(base.carbs_g) * rt),
          fat_g: Math.round(num(base.fat_g) * rt),
        }
      }
      return { ...p, grams: value }
    })
  }

  const setMacro = (k) => (e) => {
    setF((p) => {
      const next = { ...p, [k]: e.target.value }
      next.calories = Math.round(4 * num(next.protein_g) + 4 * num(next.carbs_g) + 9 * num(next.fat_g))
      return next
    })
  }

  function save() {
    onSave({
      food_name: (f.food_name || '').trim() || 'Food',
      default_grams: f.grams === '' ? null : num(f.grams),
      unit: f.unit || 'g',
      calories: num(f.calories),
      protein_g: num(f.protein_g),
      carbs_g: num(f.carbs_g),
      fat_g: num(f.fat_g),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">Edit saved food</span>
        <button className="text-sm text-slate-400 hover:text-white" onClick={onCancel}>
          ‹ Back
        </button>
      </div>

      <Field label="Name">
        <Input value={f.food_name} onChange={set('food_name')} placeholder="Food name" />
      </Field>

      <Field label="Default amount">
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

      <div className="grid grid-cols-4 gap-2 text-center text-[10px] text-slate-500">
        <span>kcal</span>
        <span>P</span>
        <span>C</span>
        <span>F</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Input type="number" inputMode="decimal" value={f.calories} onChange={set('calories')} className="px-1 text-center" />
        <Input type="number" inputMode="decimal" value={f.protein_g} onChange={setMacro('protein_g')} className="px-1 text-center" />
        <Input type="number" inputMode="decimal" value={f.carbs_g} onChange={setMacro('carbs_g')} className="px-1 text-center" />
        <Input type="number" inputMode="decimal" value={f.fat_g} onChange={setMacro('fat_g')} className="px-1 text-center" />
      </div>

      <p className="text-xs text-slate-500">
        Changing the amount scales macros. Editing a macro recomputes kcal.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save food'}
        </Button>
        <Button variant="danger" disabled={busy} onClick={onDelete}>
          Delete
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
