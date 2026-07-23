import { useEffect, useState } from 'react'
import { fileToAnalyzableImage } from '../lib/image'
import { analyzePhoto } from '../lib/analyzeApi'
import { Button, Field, Input, Select } from './ui'
import { MEALS } from './AddFoodForm'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
const CONF_COLOR = { low: 'text-red-400', medium: 'text-amber-400', high: 'text-green-400' }
const MACRO_KEYS = ['grams', 'calories', 'protein_g', 'carbs_g', 'fat_g']

export default function PhotoLogger({
  onSubmit,
  onCancel,
  busy,
  initialNote = '',
  autoAnalyze = false,
  hint = '',
  defaultMeal = 'lunch',
}) {
  const [preview, setPreview] = useState(null)
  const [image, setImage] = useState(null) // { base64, mediaType }
  const [note, setNote] = useState(initialNote)
  const [meal, setMeal] = useState(defaultMeal)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [items, setItems] = useState(null)
  const [confidence, setConfidence] = useState(null)
  const [asFrequent, setAsFrequent] = useState(false)
  const [dish, setDish] = useState('') // combined dish name (editable)
  const [combine, setCombine] = useState(true) // log as one dish vs N items

  async function pickFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setItems(null)
    try {
      const img = await fileToAnalyzableImage(file)
      setPreview(img.previewUrl)
      setImage({ base64: img.base64, mediaType: img.mediaType })
    } catch {
      setError('Could not read that image.')
    }
  }

  async function analyze() {
    if (!image && !note.trim()) return
    setAnalyzing(true)
    setError(null)
    try {
      const res = await analyzePhoto({
        base64: image?.base64 || null,
        mediaType: image?.mediaType,
        note,
      })
      setItems(
        (res.items || []).map((it) => {
          const v = {
            grams: Math.round(num(it.grams)),
            calories: Math.round(num(it.calories)),
            protein_g: Math.round(num(it.protein_g)),
            carbs_g: Math.round(num(it.carbs_g)),
            fat_g: Math.round(num(it.fat_g)),
          }
          // Keep the estimate as a fixed base so amount edits scale from it.
          return { name: it.name ?? '', ...v, _base: v }
        })
      )
      setConfidence(res.confidence)
      // Seed the combined-dish name: AI's dish name → the note → joined items.
      const joined = (res.items || []).slice(0, 2).map((it) => it.name).filter(Boolean).join(' + ')
      setDish((res.dish || '').trim() || note.trim() || joined)
    } catch (err) {
      setError(err.message)
    } finally {
      setAnalyzing(false)
    }
  }

  // When launched from the search box (text pre-filled), analyze immediately.
  useEffect(() => {
    if (autoAnalyze && initialNote.trim()) analyze()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Editing grams scales the macros proportionally; other fields edit directly.
  function updateItem(i, key, value) {
    setItems((prev) =>
      prev.map((it, idx) => {
        if (idx !== i) return it
        if (key === 'grams') {
          // Scale from the fixed base estimate, not the current value, so
          // deleting/retyping the amount stays correct.
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
        // Editing a macro recomputes kcal from 4/4/9 so calories track P/C/F.
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

  const removeItem = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i))

  const totals = (items ?? []).reduce(
    (a, it) => ({
      calories: a.calories + num(it.calories),
      protein: a.protein + num(it.protein_g),
      carbs: a.carbs + num(it.carbs_g),
      fat: a.fat + num(it.fat_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  )

  function submit() {
    if (!items || items.length === 0) return
    const meta = { note: note.trim() || null, confidence, asFrequent }
    // Combine into one diary entry (keeps the log/Recent clean), or log each
    // component separately for granular tracking — the breakdown above always
    // drives the numbers either way.
    if (combine) {
      const totalG = items.reduce((s, it) => s + num(it.grams), 0)
      // Keep the breakdown on the entry so you can drill in and edit it later.
      const components =
        items.length > 1
          ? items.map((it) => ({
              name: (it.name || '').trim(),
              grams: num(it.grams),
              calories: num(it.calories),
              protein_g: num(it.protein_g),
              carbs_g: num(it.carbs_g),
              fat_g: num(it.fat_g),
            }))
          : null
      onSubmit(
        [
          {
            food_name: (dish || '').trim() || note.trim() || 'Meal',
            meal_type: meal,
            grams: Math.round(totalG) || null,
            calories: Math.round(totals.calories),
            protein_g: Math.round(totals.protein),
            carbs_g: Math.round(totals.carbs),
            fat_g: Math.round(totals.fat),
            components,
          },
        ],
        meta
      )
      return
    }
    onSubmit(
      items.map((it) => ({
        food_name: (it.name || '').trim() || 'Food',
        meal_type: meal,
        grams: num(it.grams) || null,
        calories: num(it.calories),
        protein_g: num(it.protein_g),
        carbs_g: num(it.carbs_g),
        fat_g: num(it.fat_g),
      })),
      meta
    )
  }

  return (
    <div className="space-y-3">
      {hint && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{hint}</p>
      )}
      <Field label="Describe the meal">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. grilled chicken 150g + 1 scoop rice + fried egg"
        />
      </Field>

      <div className="space-y-1">
        <div className="text-xs text-slate-400">Add a photo (optional — improves accuracy)</div>
        {!preview ? (
          <div className="grid grid-cols-2 gap-2">
            {/* Take photo — capture hints the camera on mobile */}
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-800 py-6 text-slate-300 hover:border-green-500">
              <span className="text-3xl">📷</span>
              <span className="mt-1 text-sm">Take photo</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={pickFile}
              />
            </label>
            {/* Upload — no capture, opens the gallery / file picker */}
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-800 py-6 text-slate-300 hover:border-green-500">
              <span className="text-3xl">🖼️</span>
              <span className="mt-1 text-sm">Upload</span>
              <input type="file" accept="image/*" className="hidden" onChange={pickFile} />
            </label>
          </div>
        ) : (
          <div className="space-y-1">
            <img src={preview} alt="meal" className="max-h-56 w-full rounded-xl object-cover" />
            <div className="flex gap-4">
              <label className="inline-block cursor-pointer text-xs text-green-400 hover:text-green-300">
                📷 retake
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={pickFile}
                />
              </label>
              <label className="inline-block cursor-pointer text-xs text-green-400 hover:text-green-300">
                🖼️ upload
                <input type="file" accept="image/*" className="hidden" onChange={pickFile} />
              </label>
            </div>
          </div>
        )}
      </div>

      {!items && (
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={analyze}
            disabled={(!image && !note.trim()) || analyzing}
          >
            {analyzing ? 'Analyzing…' : '✨ Analyze'}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {items && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-300">Estimate — edit anything</span>
            <span className="text-slate-400">
              confidence:{' '}
              <span className={CONF_COLOR[confidence] || 'text-slate-400'}>{confidence}</span>
            </span>
          </div>
          <Button
            variant="ghost"
            className="w-full text-sm"
            onClick={analyze}
            disabled={analyzing}
          >
            {analyzing ? 'Analyzing…' : '🔄 Re-analyze (after editing the note / photo above)'}
          </Button>
          {confidence === 'low' && (
            <p className="text-xs text-amber-400">
              Low confidence — double-check the amounts below.
            </p>
          )}

          {items.length === 0 && (
            <p className="text-sm text-slate-500">No food detected. Try another photo.</p>
          )}

          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="space-y-2 rounded-xl bg-slate-800 p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={it.name}
                    onChange={(e) => updateItem(i, 'name', e.target.value)}
                    className="min-w-0 flex-1"
                  />
                  <button
                    onClick={() => removeItem(i)}
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
                      onChange={(e) => updateItem(i, k, e.target.value)}
                      className="min-w-0 px-1 text-center"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="text-center text-sm text-slate-300">
            Total: <b className="text-white">{Math.round(totals.calories)}</b> kcal ·{' '}
            {Math.round(totals.protein)}P · {Math.round(totals.carbs)}C ·{' '}
            {Math.round(totals.fat)}F
          </div>

          {items.length > 1 && (
            <div className="space-y-2 rounded-xl bg-slate-800/50 p-2">
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={combine}
                  onChange={(e) => setCombine(e.target.checked)}
                  className="h-4 w-4 accent-green-500"
                />
                Log as one dish
              </label>
              {combine ? (
                <Field label="Dish name">
                  <Input
                    value={dish}
                    onChange={(e) => setDish(e.target.value)}
                    placeholder="e.g. ก๋วยเตี๋ยวน้ำตกเนื้อ"
                  />
                </Field>
              ) : (
                <p className="text-xs text-slate-500">
                  Logs each of the {items.length} items above as a separate entry.
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label="Meal">
              <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
                {MEALS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={asFrequent}
                onChange={(e) => setAsFrequent(e.target.checked)}
                className="h-4 w-4 accent-green-500"
              />
              ⭐ Save frequent
            </label>
          </div>

          <div className="flex gap-2">
            <Button className="flex-1" onClick={submit} disabled={busy || items.length === 0}>
              {busy
                ? 'Adding…'
                : combine && items.length > 1
                  ? 'Add dish to log'
                  : `Add ${items.length} item${items.length > 1 ? 's' : ''} to log`}
            </Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
