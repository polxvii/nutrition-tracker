import { useEffect, useState } from 'react'
import { fileToAnalyzableImage } from '../lib/image'
import { analyzePhoto } from '../lib/analyzeApi'
import { kcalFromMacros, alcoholGramsFromAbv } from '../lib/macros'
import { Button, Field, Input, Select } from './ui'
import { MEALS } from './AddFoodForm'

const num = (v) => {
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}
// Macros keep 1 decimal (F 1.5 stays 1.5) so scaling + day totals don't
// accumulate rounding bias. kcal + grams stay whole.
const round1 = (v) => Math.round(num(v) * 10) / 10
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
  barcode = null,
}) {
  const [images, setImages] = useState([]) // [{ base64, mediaType, previewUrl }]
  const [note, setNote] = useState(initialNote)
  const [meal, setMeal] = useState(defaultMeal)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState(null)
  const [items, setItems] = useState(null)
  const [confidence, setConfidence] = useState(null)
  const [asFrequent, setAsFrequent] = useState(false)
  const [dish, setDish] = useState('') // combined dish name (editable)
  const [combine, setCombine] = useState(true) // log as one dish vs N items
  const [serv, setServ] = useState(1) // serving multiplier — scales all items at once
  const [servText, setServText] = useState('1')

  const MAX_IMAGES = 6

  async function pickFiles(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = '' // allow re-picking the same file later
    if (!files.length) return
    setError(null)
    setItems(null)
    try {
      const added = []
      for (const file of files) {
        const img = await fileToAnalyzableImage(file)
        added.push({ base64: img.base64, mediaType: img.mediaType, previewUrl: img.previewUrl })
      }
      setImages((prev) => [...prev, ...added].slice(0, MAX_IMAGES))
    } catch {
      setError('Could not read that image.')
    }
  }
  const removeImage = (i) => setImages((prev) => prev.filter((_, idx) => idx !== i))

  async function analyze() {
    if (!images.length && !note.trim()) return
    setAnalyzing(true)
    setError(null)
    try {
      const res = await analyzePhoto({
        images: images.map(({ base64, mediaType }) => ({ base64, mediaType })),
        note,
      })
      setItems(
        (res.items || []).map((it) => {
          const grams = Math.round(num(it.grams))
          // A drink (abv > 0): grams is the volume in ml. Compute alcohol from
          // volume × ABV deterministically (don't trust the model's arithmetic),
          // then reconcile kcal to 4/4/9 + 7×alcohol.
          const abv = num(it.abv)
          const isDrink = abv > 0 && grams > 0
          const alcohol_g = isDrink ? round1(alcoholGramsFromAbv(grams, abv)) : round1(it.alcohol_g)
          const v = {
            grams,
            calories: isDrink
              ? kcalFromMacros(it.protein_g, it.carbs_g, it.fat_g, alcohol_g)
              : Math.round(num(it.calories)),
            protein_g: round1(it.protein_g),
            carbs_g: round1(it.carbs_g),
            fat_g: round1(it.fat_g),
            alcohol_g,
          }
          // Keep the estimate as a fixed base so amount edits scale from it.
          // unit ('g'/'ml') + abv ride alongside — they don't scale, just label.
          const unit = isDrink || it.unit === 'ml' ? 'ml' : 'g'
          return { name: it.name ?? '', unit, abv, ...v, _base: v }
        })
      )
      setConfidence(res.confidence)
      setServ(1) // fresh estimate starts at ×1
      setServText('1')
      // Seed the combined-dish name: AI's dish name → the note → joined items.
      const joined = (res.items || []).slice(0, 2).map((it) => it.name).filter(Boolean).join(' + ')
      setDish((res.dish || '').trim() || note.trim() || joined)
    } catch (err) {
      setError(
        err.code === 'no_key'
          ? 'No Gemini key yet. Add your own key in Settings → “AI — your Gemini key” to use analysis.'
          : err.message
      )
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
              protein_g: round1(num(base.protein_g) * f),
              carbs_g: round1(num(base.carbs_g) * f),
              fat_g: round1(num(base.fat_g) * f),
              alcohol_g: round1(num(base.alcohol_g) * f),
            }
          }
          return { ...it, grams: value }
        }
        // Editing a macro recomputes kcal from 4/4/9 (+7/g alcohol).
        if (key === 'protein_g' || key === 'carbs_g' || key === 'fat_g') {
          const it2 = { ...it, [key]: value }
          it2.calories = kcalFromMacros(it2.protein_g, it2.carbs_g, it2.fat_g, it2.alcohol_g)
          return it2
        }
        return { ...it, [key]: value }
      })
    )
  }

  const removeItem = (i) => setItems((prev) => prev.filter((_, idx) => idx !== i))

  // Serving multiplier for the whole estimate: scale every item (and its
  // grams-scaling base) by a ratio, so you resize the meal once instead of
  // editing each item. Applied per commit (button or typed value on blur).
  function applyServ(next) {
    if (!(next > 0)) return
    const r = next / serv
    if (r !== 1) {
      const s = (n) => Math.round(num(n) * r) // grams / kcal → whole
      const sm = (n) => round1(num(n) * r) // macros → 1 decimal
      setItems((prev) =>
        (prev || []).map((it) => {
          const base = it._base || it
          return {
            ...it,
            grams: s(it.grams),
            calories: s(it.calories),
            protein_g: sm(it.protein_g),
            carbs_g: sm(it.carbs_g),
            fat_g: sm(it.fat_g),
            alcohol_g: sm(it.alcohol_g),
            _base: {
              ...base,
              grams: s(base.grams),
              calories: s(base.calories),
              protein_g: sm(base.protein_g),
              carbs_g: sm(base.carbs_g),
              fat_g: sm(base.fat_g),
              alcohol_g: sm(base.alcohol_g),
            },
          }
        })
      )
    }
    setServ(next)
    setServText(String(next))
  }
  const stepServ = (d) => {
    const n = Math.round((serv + d) * 10) / 10
    if (n >= 0.5) applyServ(n)
  }
  const commitServ = () => {
    const n = Number(servText)
    if (n > 0) applyServ(Math.round(n * 100) / 100)
    else setServText(String(serv))
  }

  const totals = (items ?? []).reduce(
    (a, it) => ({
      calories: a.calories + num(it.calories),
      protein: a.protein + num(it.protein_g),
      carbs: a.carbs + num(it.carbs_g),
      fat: a.fat + num(it.fat_g),
      alcohol: a.alcohol + num(it.alcohol_g),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, alcohol: 0 }
  )

  function submit() {
    if (!items || items.length === 0) return
    const meta = { note: note.trim() || null, confidence, asFrequent }
    // Combine into one diary entry (keeps the log/Recent clean), or log each
    // component separately for granular tracking — the breakdown above always
    // drives the numbers either way.
    // A whole meal is 'ml' only when every part is a liquid; otherwise 'g'.
    const dishUnit = items.length && items.every((it) => it.unit === 'ml') ? 'ml' : 'g'
    if (combine) {
      const totalG = items.reduce((s, it) => s + num(it.grams), 0)
      // If this AI run resolved a scanned barcode, cache the result (per-100
      // basis) so a re-scan is instant next time.
      if (barcode && totalG > 0) {
        const k = 100 / totalG
        meta.cache = {
          barcode: String(barcode),
          name: (dish || '').trim() || note.trim() || 'Product',
          unit: dishUnit,
          per100: {
            calories: Math.round(totals.calories * k),
            protein_g: Math.round(totals.protein * k * 10) / 10,
            carbs_g: Math.round(totals.carbs * k * 10) / 10,
            fat_g: Math.round(totals.fat * k * 10) / 10,
            alcohol_g: Math.round(totals.alcohol * k * 10) / 10,
          },
        }
      }
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
              ...(num(it.alcohol_g) ? { alcohol_g: num(it.alcohol_g) } : {}),
            }))
          : null
      onSubmit(
        [
          {
            food_name: (dish || '').trim() || note.trim() || 'Meal',
            meal_type: meal,
            grams: Math.round(totalG) || null,
            unit: dishUnit,
            calories: Math.round(totals.calories),
            protein_g: round1(totals.protein),
            carbs_g: round1(totals.carbs),
            fat_g: round1(totals.fat),
            ...(totals.alcohol > 0 ? { alcohol_g: round1(totals.alcohol) } : {}),
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
        unit: it.unit === 'ml' ? 'ml' : 'g',
        calories: num(it.calories),
        protein_g: num(it.protein_g),
        carbs_g: num(it.carbs_g),
        fat_g: num(it.fat_g),
        ...(num(it.alcohol_g) ? { alcohol_g: num(it.alcohol_g) } : {}),
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

      <div className="space-y-2">
        <div className="text-xs text-slate-400">
          Add photos (optional — more angles / dishes = better accuracy)
        </div>
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {images.map((im, i) => (
              <div key={i} className="relative">
                <img
                  src={im.previewUrl}
                  alt={`photo ${i + 1}`}
                  className="h-24 w-full rounded-lg object-cover"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs leading-5 text-white"
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {images.length < MAX_IMAGES && (
          <div className="grid grid-cols-2 gap-2">
            {/* Take photo — capture hints the camera on mobile (one at a time) */}
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-800 py-4 text-slate-300 hover:border-green-500">
              <span className="text-2xl">📷</span>
              <span className="mt-1 text-sm">{images.length ? 'Add photo' : 'Take photo'}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={pickFiles}
              />
            </label>
            {/* Upload — multiple, opens the gallery / file picker */}
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-800 py-4 text-slate-300 hover:border-green-500">
              <span className="text-2xl">🖼️</span>
              <span className="mt-1 text-sm">Upload</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={pickFiles} />
            </label>
          </div>
        )}
      </div>

      {!items && (
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={analyze}
            disabled={(!images.length && !note.trim()) || analyzing}
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
                {num(it.alcohol_g) > 0 && (
                  <div className="text-[11px] text-fuchsia-300">
                    🍷 {num(it.abv) > 0 ? `${round1(it.abv)}% ABV · ` : ''}
                    {round1(it.alcohol_g)} g alcohol ({Math.round(num(it.alcohol_g) * 7)} kcal)
                  </div>
                )}
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-slate-800 p-2">
              <div>
                <div className="text-sm font-medium text-slate-200">Servings</div>
                <div className="text-[11px] text-slate-500">scales all items at once</div>
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
          )}

          <div className="text-center text-sm text-slate-300">
            Total: <b className="text-white">{Math.round(totals.calories)}</b> kcal ·{' '}
            {Math.round(totals.protein)}P · {Math.round(totals.carbs)}C ·{' '}
            {Math.round(totals.fat)}F
            {totals.alcohol > 0 && (
              <span className="text-fuchsia-300"> · 🍷 {round1(totals.alcohol)}g</span>
            )}
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
