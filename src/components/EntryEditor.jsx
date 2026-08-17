import { useState } from 'react'
import { Button, Field, Input, Select } from './ui'
import { MEALS, UNITS } from './AddFoodForm'
import { todayISODate } from '../lib/dateHelpers'
import AddFood from './AddFood'
import SwipeRow from './SwipeRow'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
// Macros keep 1 decimal (F 1.5 stays 1.5, not rounded up to 2) so scaling and
// day totals don't accumulate rounding bias. kcal + grams stay whole.
const round1 = (v) => Math.round(num(v) * 10) / 10
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
  onSaveMeal,
  onCopyComponent,
  dupMode = false, // "copy" flow: confirm date / meal / details, then add a copy
}) {
  const isEx = entry.source === 'exercise'
  const hasComps = Array.isArray(entry.components) && entry.components.length > 0
  // Serving-based food (barcode/search with a declared serving size): grams per
  // 1 serving, so the edit screen can offer synced servings ⇄ grams. 0 = plain.
  const servingG = !isEx && !hasComps ? num(entry.serving_g) : 0
  const origServ =
    servingG > 0 ? num(entry.servings) || num(entry.grams) / servingG || 1 : 1
  const [addingItem, setAddingItem] = useState(false)
  const [savedFreq, setSavedFreq] = useState(false)
  const [savedComps, setSavedComps] = useState(() => new Set()) // components saved to foods
  const [mealSaved, setMealSaved] = useState(false)
  // Dish serving multiplier. Restored from the saved entry so the stepper stays
  // anchored on re-open (was resetting to ×1 while the stored components already
  // held the scaled amounts, which made further steps compound wrongly).
  const [serv, setServ] = useState(() => num(entry.servings) || 1)
  const [servText, setServText] = useState(() => String(num(entry.servings) || 1))
  // Quantity control for a simple (non-breakdown) food. For a serving-based
  // food this is the real servings COUNT (1 serving = servingG grams); for a
  // plain food it's an abstract ×multiplier from the entry's current amount.
  const initQty = servingG > 0 ? Math.round(origServ * 100) / 100 : 1
  const [qty, setQty] = useState(initQty)
  const [qtyText, setQtyText] = useState(String(initQty))

  const [f, setF] = useState({
    food_name: entry.food_name ?? '',
    meal_type: entry.meal_type ?? 'lunch',
    grams: entry.grams ?? '',
    unit: entry.unit ?? 'g',
    calories: Math.round(num(entry.calories)),
    protein_g: round1(entry.protein_g),
    carbs_g: round1(entry.carbs_g),
    fat_g: round1(entry.fat_g),
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
            protein_g: round1(c.protein_g),
            carbs_g: round1(c.carbs_g),
            fat_g: round1(c.fat_g),
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
              protein_g: round1(num(base.protein_g) * r),
              carbs_g: round1(num(base.carbs_g) * r),
              fat_g: round1(num(base.fat_g) * r),
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
  const removeComp = (i) => {
    setSavedComps(new Set())
    setComps((prev) => prev.filter((_, idx) => idx !== i))
  }
  // Log a sub-item as its OWN separate diary entry: opens the copy confirm
  // sheet (like the diary Copy) prefilled with this component, so you can tweak
  // date / meal / amount before adding. The component stays in the dish.
  function copyComp(i) {
    const c = comps[i]
    onCopyComponent?.({
      source: 'manual',
      food_name: (c.name || '').trim() || 'Item',
      meal_type: f.meal_type,
      grams: num(c.grams) || null,
      unit: 'g',
      calories: num(c.calories),
      protein_g: num(c.protein_g),
      carbs_g: num(c.carbs_g),
      fat_g: num(c.fat_g),
    })
  }
  // Save a sub-item as its own Saved food.
  async function saveComp(i) {
    const c = comps[i]
    await onSaveFrequent?.({
      food_name: (c.name || '').trim() || 'Item',
      grams: num(c.grams) || null,
      unit: 'g',
      calories: num(c.calories),
      protein_g: num(c.protein_g),
      carbs_g: num(c.carbs_g),
      fat_g: num(c.fat_g),
    })
    setSavedComps((prev) => new Set(prev).add(i))
  }
  // Save this whole dish as a reusable meal (combo) from its components.
  function saveAsMeal() {
    const items = comps.map((c) => ({
      food_name: (c.name || '').trim() || 'Item',
      grams: num(c.grams) || null,
      unit: 'g',
      calories: num(c.calories),
      protein_g: num(c.protein_g),
      carbs_g: num(c.carbs_g),
      fat_g: num(c.fat_g),
    }))
    onSaveMeal?.({ name: (f.food_name || '').trim() || 'Meal', items })
    setMealSaved(true)
  }

  // Serving control at the dish level: scale every component (its current value
  // AND its grams-scaling base) so one control resizes the whole dish instead of
  // editing each sub-item. Composes with per-item edits and add/remove. Applied
  // as a single ratio per commit (button click or typed value on blur/Enter) so
  // free-typing can't compound rounding or divide by an in-progress empty value.
  function applyServ(next) {
    if (!(next > 0)) return
    const r = next / serv
    if (r !== 1) {
      const s = (n) => Math.round(num(n) * r) // grams / kcal → whole
      const sm = (n) => round1(num(n) * r) // macros → 1 decimal
      setComps((prev) =>
        prev.map((it) => {
          const base = it._base || it
          return {
            ...it,
            grams: s(it.grams),
            calories: s(it.calories),
            protein_g: sm(it.protein_g),
            carbs_g: sm(it.carbs_g),
            fat_g: sm(it.fat_g),
            _base: {
              ...base,
              grams: s(base.grams),
              calories: s(base.calories),
              protein_g: sm(base.protein_g),
              carbs_g: sm(base.carbs_g),
              fat_g: sm(base.fat_g),
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
        protein_g: round1(e.protein_g),
        carbs_g: round1(e.carbs_g),
        fat_g: round1(e.fat_g),
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
        protein_g: round1(num(entry.protein_g) * r),
        carbs_g: round1(num(entry.carbs_g) * r),
        fat_g: round1(num(entry.fat_g) * r),
      })
      // Keep the servings field in step with a grams edit. For a serving-based
      // food that's the real count (grams ÷ serving size); otherwise the ratio.
      const q = servingG > 0 ? Math.round((newG / servingG) * 100) / 100 : Math.round(r * 100) / 100
      setQty(q)
      setQtyText(String(q))
    } else {
      setF({ ...f, grams: value })
    }
  }

  // Quantity control for a simple food. `next` is a servings COUNT when the
  // food is serving-based (grams = servingG × count), else an abstract
  // ×multiplier of the entry's amount. Either way kcal + macros scale from the
  // ORIGINAL entry so it's stable however the number is typed. Always available
  // — the one control that works even for a food logged without a gram amount.
  function applyQty(next) {
    if (!(next > 0)) return
    const baseG = num(entry.grams)
    const m = servingG > 0 ? next / origServ : next // multiplier vs the original
    setF((prev) => ({
      ...prev,
      calories: Math.round(num(entry.calories) * m),
      protein_g: round1(num(entry.protein_g) * m),
      carbs_g: round1(num(entry.carbs_g) * m),
      fat_g: round1(num(entry.fat_g) * m),
      grams:
        servingG > 0
          ? String(Math.round(servingG * next))
          : baseG > 0
            ? String(Math.round(baseG * next))
            : prev.grams,
    }))
    setQty(next)
    setQtyText(String(next))
  }
  const stepQty = (delta) => {
    const next = Math.round((qty + delta) * 10) / 10
    if (next >= 0.5) applyQty(next)
  }
  const commitQty = () => {
    const n = num(qtyText)
    if (n > 0) applyQty(Math.round(n * 100) / 100)
    else setQtyText(String(qty))
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
        protein_g: round1(compTotals.protein_g),
        carbs_g: round1(compTotals.carbs_g),
        fat_g: round1(compTotals.fat_g),
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
      // Preserve the serving size + count so the serving view survives an edit.
      ...(servingG > 0 ? { serving_g: servingG, servings: Math.round(num(qtyText) * 100) / 100 || origServ } : {}),
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
          onLogMeal={(dish) =>
            appendComps(
              (dish.components || []).map((c) => ({
                food_name: c.name,
                grams: c.grams,
                calories: c.calories,
                protein_g: c.protein_g,
                carbs_g: c.carbs_g,
                fat_g: c.fat_g,
              }))
            )
          }
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
        {dupMode ? 'Copy entry' : isEx ? 'Edit exercise' : hasComps ? 'Edit dish' : 'Edit entry'}
      </div>
      {dupMode && (
        <p className="text-xs text-slate-500">
          Adjust the date / meal / details, then add a copy. The original stays as is.
        </p>
      )}

      <Field label={isEx ? 'Exercise' : hasComps ? 'Dish name' : 'Food name'}>
        <Input value={f.food_name} onChange={set('food_name')} />
      </Field>

      {!isEx && (
        <div className={hasComps || servingG > 0 ? '' : 'grid grid-cols-[auto_1fr] gap-3'}>
          <Field label="Meal">
            <Select value={f.meal_type} onChange={set('meal_type')}>
              {MEALS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          {/* Serving-based foods edit grams in the synced pair below, so no
              standalone Amount field here. */}
          {!hasComps && servingG === 0 && (
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
            Breakdown — edit · swipe a row for ⭐ / log solo / delete
          </div>
          {comps.map((it, i) => (
            <SwipeRow
              key={i}
              actions={[
                ...(onSaveFrequent
                  ? [{ label: '⭐ Save', onClick: () => saveComp(i), className: 'bg-green-700 active:bg-green-600' }]
                  : []),
                ...(onCopyComponent
                  ? [{ label: 'Log solo', onClick: () => copyComp(i), className: 'bg-slate-600 active:bg-slate-500' }]
                  : []),
                { label: 'Delete', onClick: () => removeComp(i), className: 'bg-red-600 active:bg-red-700' },
              ]}
            >
              <div className="space-y-2 bg-slate-800 p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={it.name}
                    onChange={(e) => updateComp(i, 'name', e.target.value)}
                    className="min-w-0 flex-1"
                  />
                  {savedComps.has(i) && <span className="shrink-0 text-xs text-green-400">⭐ saved</span>}
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
            </SwipeRow>
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
          {onSaveMeal &&
            (mealSaved ? (
              <p className="text-center text-sm text-green-400">🍱 Saved as a meal</p>
            ) : (
              <Button variant="ghost" className="w-full text-sm" onClick={saveAsMeal}>
                🍱 Save as meal
              </Button>
            ))}
        </div>
      ) : (
        <div className="space-y-2">
          {servingG > 0 ? (
            // Serving-based food: servings + grams, both editable and synced
            // (1 serving = {servingG} {unit}). Edit either; the other follows.
            <div className="grid grid-cols-2 gap-3">
              <Field label="Servings">
                <Input
                  type="number"
                  inputMode="decimal"
                  value={qtyText}
                  onChange={(e) => setQtyText(e.target.value)}
                  onBlur={commitQty}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                />
              </Field>
              <Field label={`Amount (${f.unit})`}>
                <Input type="number" inputMode="decimal" value={f.grams} onChange={setGrams} />
              </Field>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl bg-slate-800 p-2">
              <div>
                <div className="text-sm font-medium text-slate-200">Servings</div>
                <div className="text-[11px] text-slate-500">scales kcal + macros</div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => stepQty(-0.5)}
                  disabled={qty <= 0.5}
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
                    value={qtyText}
                    onChange={(e) => setQtyText(e.target.value)}
                    onBlur={commitQty}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    className="w-14 px-1 text-center text-base font-bold tabular-nums"
                    aria-label="Servings"
                  />
                </div>
                <button
                  onClick={() => stepQty(0.5)}
                  className="h-8 w-8 shrink-0 rounded-lg bg-slate-700 text-xl leading-none text-white active:scale-95"
                  aria-label="More servings"
                >
                  ＋
                </button>
              </div>
            </div>
          )}
          {servingG > 0 && (
            <p className="text-[11px] text-slate-500">1 serving = {round1(servingG)}{f.unit}</p>
          )}
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
        !dupMode &&
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

      {dupMode ? (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => onDuplicate(build())}>
            {busy ? 'Adding…' : 'Add copy'}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      ) : (
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
      )}
    </div>
  )
}
