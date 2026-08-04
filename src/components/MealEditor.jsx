import { useState } from 'react'
import { Button, Field, Input } from './ui'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
const MACRO_KEYS = ['grams', 'calories', 'protein_g', 'carbs_g', 'fat_g']

// Edit a saved meal (combo): rename, tweak each item's amount/macros, add or
// remove items. Editing grams scales that item from its base; editing a macro
// recomputes its kcal from 4/4/9.
export default function MealEditor({ meal, onSave, onDelete, onCancel, busy }) {
  const [name, setName] = useState(meal.name || '')
  const [items, setItems] = useState(() =>
    (meal.items || []).map((it) => {
      const v = {
        food_name: it.food_name ?? '',
        grams: Math.round(num(it.grams)),
        unit: it.unit ?? 'g',
        calories: Math.round(num(it.calories)),
        protein_g: Math.round(num(it.protein_g)),
        carbs_g: Math.round(num(it.carbs_g)),
        fat_g: Math.round(num(it.fat_g)),
      }
      return { ...v, _base: v }
    })
  )

  function update(i, key, value) {
    setItems((prev) =>
      prev.map((it, idx) => {
        if (idx !== i) return it
        if (key === 'grams') {
          const base = it._base || it
          const baseG = num(base.grams)
          const newG = num(value)
          if (baseG > 0 && newG > 0) {
            const f = newG / baseG
            return {
              ...it,
              grams: value,
              calories: Math.round(num(base.calories) * f),
              protein_g: Math.round(num(base.protein_g) * f),
              carbs_g: Math.round(num(base.carbs_g) * f),
              fat_g: Math.round(num(base.fat_g) * f),
            }
          }
          return { ...it, grams: value }
        }
        if (key === 'protein_g' || key === 'carbs_g' || key === 'fat_g') {
          const it2 = { ...it, [key]: value }
          it2.calories = Math.round(
            4 * num(it2.protein_g) + 4 * num(it2.carbs_g) + 9 * num(it2.fat_g)
          )
          return it2
        }
        return { ...it, [key]: value }
      })
    )
  }
  const remove = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i))
  const add = () =>
    setItems((prev) => [
      ...prev,
      { food_name: '', grams: 0, unit: 'g', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, _base: {} },
    ])

  const totals = items.reduce(
    (a, it) => ({
      calories: a.calories + num(it.calories),
      protein: a.protein + num(it.protein_g),
      carbs: a.carbs + num(it.carbs_g),
      fat: a.fat + num(it.fat_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  )

  function save() {
    const cleanItems = items
      .filter((it) => (it.food_name || '').trim() || num(it.calories) || num(it.grams))
      .map((it) => ({
        food_name: (it.food_name || '').trim() || 'Item',
        grams: num(it.grams) || null,
        unit: it.unit || 'g',
        calories: num(it.calories),
        protein_g: num(it.protein_g),
        carbs_g: num(it.carbs_g),
        fat_g: num(it.fat_g),
      }))
    onSave({ name: name.trim() || 'Meal', items: cleanItems })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">Edit meal</span>
        <button className="text-sm text-slate-400 hover:text-white" onClick={onCancel}>
          ‹ Back
        </button>
      </div>

      <Field label="Meal name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Meal name" />
      </Field>

      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="space-y-2 rounded-xl bg-slate-800 p-2">
            <div className="flex items-center gap-2">
              <Input
                value={it.food_name}
                onChange={(e) => update(i, 'food_name', e.target.value)}
                className="min-w-0 flex-1"
              />
              <button
                onClick={() => remove(i)}
                className="px-1 text-slate-500 hover:text-red-400"
                aria-label="Remove item"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-5 gap-1 text-center text-[10px] text-slate-500">
              <span>grams</span>
              <span>kcal</span>
              <span>P</span>
              <span>C</span>
              <span>F</span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {MACRO_KEYS.map((k) => (
                <Input
                  key={k}
                  type="number"
                  inputMode="decimal"
                  value={it[k]}
                  onChange={(e) => update(i, k, e.target.value)}
                  className="min-w-0 px-1 text-center"
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={add}
        className="w-full rounded-lg border border-dashed border-slate-600 py-1.5 text-xs text-slate-400 hover:border-green-500 hover:text-green-400"
      >
        ＋ add item
      </button>

      <div className="text-center text-sm text-slate-300">
        Total: <b className="text-white">{Math.round(totals.calories)}</b> kcal ·{' '}
        {Math.round(totals.protein)}P · {Math.round(totals.carbs)}C · {Math.round(totals.fat)}F
      </div>

      <div className="flex flex-wrap gap-2">
        <Button className="flex-1" onClick={save} disabled={busy || items.length === 0}>
          {busy ? 'Saving…' : 'Save meal'}
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
