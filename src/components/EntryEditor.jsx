import { useState } from 'react'
import { Button, Field, Input, Select } from './ui'
import { MEALS, UNITS } from './AddFoodForm'
import { todayISODate } from '../lib/dateHelpers'
import AddFood from './AddFood'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
const MACRO_KEYS = ['grams', 'calories', 'protein_g', 'carbs_g', 'fat_g']

// Edit / duplicate a single logged entry (food or exercise). Editing the
// amount scales the calories + macros proportionally. The date can be changed
// (moves the entry to another day). Returns a patch via onSave / onDuplicate.
//
// If the entry carries an AI `components` breakdown (a "dish" logged as one
// row), it shows a drill-down editor instead: edit each component and the
// dish totals recompute from their sum.
export default function EntryEditor({
  entry,
  onSave,
  onDuplicate,
  onDelete,
  onClose,
  busy,
  recent = [],
  saved = [],
  meals = [],
  onSaveFrequent,
}) {
  const isEx = entry.source === 'exercise'
  const hasComps = Array.isArray(entry.components) && entry.components.length > 0
  const [addingItem, setAddingItem] = useState(false)
  const [savedFreq, setSavedFreq] = useState(false)
  // Dish serving multiplier. Restored from the saved entry so the stepper stays
  // anchored on re-open (was resetting to ×1 while the stored components already
  // held the scaled amounts, which made further steps compound wrongly).
  const [serv, setServ] = useState(() => num(entry.servings) || 1)
  const [servText, setServText] = useState(() => String(num(entry.servings) || 1))

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

  // Drill-down breakdown state (only used when the entry has components).
  const [comps, setComps] = useState(() =>
    hasComps
      ? entry.components.map((c) => {
          const v = {
            name: c.name ?? '',
            grams: Math.round(num(c.grams)),
            calories: Math.round(num(c.calories)),
            protein_g: Math.round(num(c.protein_g)),
            carbs_g: Math.round(num(c.carbs_g)),
            fat_g: Math.round(num(c.fat_g)),
          }
          return { ...v, _base: v } // fixed base so grams edits scale correctly
        })
      : []
  )

  // Same edit rules as the AI logger: grams scales a component from its base;
  // editing a macro recomputes that component's kcal from 4/4/9.
  function updateComp(i, key, value) {
    setComps((prev) =>
      prev.map((it, idx) => {
        if (idx !== i) return it
        if (key === 'grams') {
          const base = it._base || it
          const baseG = num(base.grams)
          const newG = num(value)
          if (baseG > 0 && newG > 0) {
            const r = newG / baseG
            return {
              ...it,
              grams: value,
              calories: Math.round(num(base.calories) * r),
              protein_g: Math.round(num(base.protein_g) * r),
              carbs_g: Math.round(num(base.carbs_g) * r),
              fat_g: Math.round(num(base.fat_g) * r),
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
  const removeComp = (i) => setComps((prev) => prev.filter((_, idx) => idx !== i))

  // Serving control at the dish level: scale every component (its current value
  // AND its grams-scaling base) so one control resizes the whole dish instead of
  // editing each sub-item. Composes with per-item edits and add/remove. Applied
  // as a single ratio per commit (button click or typed value on blur/Enter) so
  // free-typing can't compound rounding or divide by an in-progress empty value.
  function applyServ(next) {
    if (!(next > 0)) return
    const r = next / serv
    if (r !== 1) {
      const s = (n) => Math.round(num(n) * r)
      setComps((prev) =>
        prev.map((it) => {
          const base = it._base || it
          return {
            ...it,
            grams: s(it.grams),
            calories: s(it.calories),
            protein_g: s(it.protein_g),
            carbs_g: s(it.carbs_g),
            fat_g: s(it.fat_g),
            _base: {
              ...base,
              grams: s(base.grams),
              calories: s(base.calories),
              protein_g: s(base.protein_g),
              carbs_g: s(base.carbs_g),
              fat_g: s(base.fat_g),
            },
          }
        })
      )
    }
    setServ(next)
    setServText(String(next))
  }
  const stepServ = (delta) => {
    const next = Math.round((serv + delta) * 10) / 10
    if (next >= 0.5) applyServ(next)
  }
  const commitServ = () => {
    const n = num(servText)
    if (n > 0) applyServ(Math.round(n * 100) / 100)
    else setServText(String(serv)) // revert empty / invalid
  }

  // Append food(s) chosen via the full Add-food picker (search / barcode / AI /
  // recent / saved) as new components of this dish.
  function appendComps(entries) {
    const mapped = (entries || []).map((e) => {
      const v = {
        name: (e.food_name || '').trim() || 'Item',
        grams: Math.round(num(e.grams)),
        calories: Math.round(num(e.calories)),
        protein_g: Math.round(num(e.protein_g)),
        carbs_g: Math.round(num(e.carbs_g)),
        fat_g: Math.round(num(e.fat_g)),
      }
      return { ...v, _base: v }
    })
    if (mapped.length) setComps((prev) => [...prev, ...mapped])
    setAddingItem(false)
  }

  const compTotals = comps.reduce(
    (a, it) => ({
      grams: a.grams + num(it.grams),
      calories: a.calories + num(it.calories),
      protein_g: a.protein_g + num(it.protein_g),
      carbs_g: a.carbs_g + num(it.carbs_g),
      fat_g: a.fat_g + num(it.fat_g),
    }),
    { grams: 0, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  )

  // Editing a macro recomputes kcal from 4/4/9 (protein 4, carbs 4, fat 9),
  // so calories reflect the adjusted P/C/F. Editing kcal directly still works.
  const setMacro = (k) => (e) => {
    const next = { ...f, [k]: e.target.value }
    next.calories = Math.round(4 * num(next.protein_g) + 4 * num(next.carbs_g) + 9 * num(next.fat_g))
    setF(next)
  }

  // Changing the amount *number* scales calories + macros proportionally
  // (twice the amount = twice the food). Always scale from the ORIGINAL entry
  // (fixed base) rather than the current value — so deleting to empty and
  // retyping, or editing digit-by-digit, still lands on the right numbers.
  // Changing the unit is left as a plain relabel (no per-unit data to convert).
  function setGrams(e) {
    const value = e.target.value
    const baseG = num(entry.grams)
    const newG = num(value)
    if (baseG > 0 && newG > 0) {
      const r = newG / baseG
      setF({
        ...f,
        grams: value,
        calories: Math.round(num(entry.calories) * r),
        protein_g: Math.round(num(entry.protein_g) * r),
        carbs_g: Math.round(num(entry.carbs_g) * r),
        fat_g: Math.round(num(entry.fat_g) * r),
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
    // Dish with a breakdown → totals come from the components' sum.
    if (hasComps) {
      return {
        ...base,
        meal_type: f.meal_type,
        servings: serv, // remembered so the stepper re-opens anchored, not at ×1
        grams: Math.round(compTotals.grams) || null,
        unit: f.unit,
        calories: Math.round(compTotals.calories),
        protein_g: Math.round(compTotals.protein_g),
        carbs_g: Math.round(compTotals.carbs_g),
        fat_g: Math.round(compTotals.fat_g),
        components: comps.map((c) => ({
          name: (c.name || '').trim() || 'Item',
          grams: num(c.grams),
          calories: num(c.calories),
          protein_g: num(c.protein_g),
          carbs_g: num(c.carbs_g),
          fat_g: num(c.fat_g),
        })),
      }
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

  // Add-item picker (reuses the full Add-food flow: search / barcode / AI /
  // recent / saved). Picked foods are appended as components, not logged.
  if (addingItem) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-200">Add item to dish</span>
          <button
            className="text-sm text-slate-400 hover:text-white"
            onClick={() => setAddingItem(false)}
          >
            ‹ Back
          </button>
        </div>
        <AddFood
          defaultMeal={f.meal_type}
          recent={recent}
          saved={saved}
          meals={meals}
          onLog={(e) => appendComps([e])}
          onLogMany={(entries) => appendComps(entries)}
          onLogMeal={(entries) => appendComps(entries)}
          onDeleteSaved={() => {}}
          onDeleteMeal={() => {}}
          onCancel={() => setAddingItem(false)}
          busy={false}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-slate-200">
        {isEx ? 'Edit exercise' : hasComps ? 'Edit dish' : 'Edit entry'}
      </div>

      <Field label={isEx ? 'Exercise' : hasComps ? 'Dish name' : 'Food name'}>
        <Input value={f.food_name} onChange={set('food_name')} />
      </Field>

      {!isEx && (
        <div className={hasComps ? '' : 'grid grid-cols-[auto_1fr] gap-3'}>
          <Field label="Meal">
            <Select value={f.meal_type} onChange={set('meal_type')}>
              {MEALS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {!hasComps && (
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
          )}
        </div>
      )}

      {isEx ? (
        <Field label="Calories burned (kcal)">
          <Input type="number" inputMode="decimal" value={f.calories} onChange={set('calories')} />
        </Field>
      ) : hasComps ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between rounded-xl bg-slate-800 p-2">
            <div>
              <div className="text-sm font-medium text-slate-200">Servings</div>
              <div className="text-[11px] text-slate-500">scales the whole dish</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => stepServ(-0.5)}
                disabled={serv <= 0.5}
                className="h-8 w-8 shrink-0 rounded-lg bg-slate-700 text-xl leading-none text-white active:scale-95 disabled:opacity-40"
                aria-label="Fewer servings"
              >
                −
              </button>
              <div className="flex items-center">
                <span className="text-slate-400">×</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={servText}
                  onChange={(e) => setServText(e.target.value)}
                  onBlur={commitServ}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  className="w-14 px-1 text-center text-base font-bold tabular-nums"
                  aria-label="Servings"
                />
              </div>
              <button
                onClick={() => stepServ(0.5)}
                className="h-8 w-8 shrink-0 rounded-lg bg-slate-700 text-xl leading-none text-white active:scale-95"
                aria-label="More servings"
              >
                ＋
              </button>
            </div>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Breakdown — edit any part
          </div>
          {comps.map((it, i) => (
            <div key={i} className="space-y-2 rounded-xl bg-slate-800 p-2">
              <div className="flex items-center gap-2">
                <Input
                  value={it.name}
                  onChange={(e) => updateComp(i, 'name', e.target.value)}
                  className="min-w-0 flex-1"
                />
                <button
                  onClick={() => removeComp(i)}
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
                    onChange={(e) => updateComp(i, k, e.target.value)}
                    className="min-w-0 px-1 text-center"
                  />
                ))}
              </div>
            </div>
          ))}
          <button
            onClick={() => setAddingItem(true)}
            className="w-full rounded-lg border border-dashed border-slate-600 py-1.5 text-xs text-slate-400 hover:border-green-500 hover:text-green-400"
          >
            ＋ add item (search / scan / AI)
          </button>
          <div className="text-center text-sm text-slate-300">
            Total: <b className="text-white">{Math.round(compTotals.calories)}</b> kcal ·{' '}
            {Math.round(compTotals.protein_g)}P · {Math.round(compTotals.carbs_g)}C ·{' '}
            {Math.round(compTotals.fat_g)}F
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2">
          <Field label="kcal">
            <Input type="number" value={f.calories} onChange={set('calories')} className="px-1 text-center" />
          </Field>
          <Field label="P">
            <Input type="number" value={f.protein_g} onChange={setMacro('protein_g')} className="px-1 text-center" />
          </Field>
          <Field label="C">
            <Input type="number" value={f.carbs_g} onChange={setMacro('carbs_g')} className="px-1 text-center" />
          </Field>
          <Field label="F">
            <Input type="number" value={f.fat_g} onChange={setMacro('fat_g')} className="px-1 text-center" />
          </Field>
        </div>
      )}

      <Field label="Date">
        <Input type="date" value={f.date} onChange={set('date')} />
      </Field>

      {!isEx && !hasComps && (
        <p className="text-xs text-slate-500">
          Changing the amount scales macros. Changing the unit only relabels —
          edit the values if needed.
        </p>
      )}

      {!isEx &&
        onSaveFrequent &&
        (savedFreq ? (
          <p className="text-center text-sm text-green-400">⭐ Saved to your foods</p>
        ) : (
          <Button
            variant="ghost"
            className="w-full text-sm"
            disabled={busy}
            onClick={async () => {
              await onSaveFrequent(build())
              setSavedFreq(true)
            }}
          >
            ⭐ Save to Saved foods
          </Button>
        ))}

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
