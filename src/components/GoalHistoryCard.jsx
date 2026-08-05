import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { todayISODate } from '../lib/dateHelpers'
import {
  loadGoalHistory,
  saveGoalPeriod,
  deleteGoalPeriod,
} from '../lib/goalHistory'
import { Button, Collapsible, Field, Input } from './ui'

// Local, TZ-safe date math (no UTC drift).
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  const p = (x) => String(x).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`
}

const EMPTY = {
  id: null,
  effective_from: todayISODate(),
  goal_calories: '',
  goal_protein_g: '',
  goal_carbs_g: '',
  goal_fat_g: '',
  tdee: '',
}

// Manage the goal timeline: each row is a goal that takes effect on its date and
// runs until the next one. Add / backdate / edit / delete periods so days are
// coloured against the goal that really applied then.
export default function GoalHistoryCard() {
  const { user } = useAuth()
  const [rows, setRows] = useState([]) // ascending by date
  const [draft, setDraft] = useState(null) // editing/adding row, or null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function refresh() {
    setRows(await loadGoalHistory())
  }
  useEffect(() => {
    refresh()
  }, [])

  function startAdd() {
    setError(null)
    setDraft({ ...EMPTY })
  }
  function startEdit(r) {
    setError(null)
    setDraft({
      id: r.id,
      effective_from: r.effective_from,
      goal_calories: r.goal_calories ?? '',
      goal_protein_g: r.goal_protein_g ?? '',
      goal_carbs_g: r.goal_carbs_g ?? '',
      goal_fat_g: r.goal_fat_g ?? '',
      tdee: r.tdee ?? '',
    })
  }

  async function save() {
    if (!draft.effective_from) return setError('Pick a start date.')
    if (!(Number(draft.goal_calories) > 0)) return setError('Goal calories must be greater than 0.')
    setBusy(true)
    setError(null)
    const { error } = await saveGoalPeriod(user.id, draft)
    setBusy(false)
    if (error) {
      setError(
        error.code === '23505'
          ? 'A period already starts on that date — edit that one instead.'
          : error.message
      )
      return
    }
    setDraft(null)
    await refresh()
  }

  async function remove(r) {
    if (!window.confirm(`Delete the goal period starting ${r.effective_from}?`)) return
    setBusy(true)
    await deleteGoalPeriod(r.id)
    setBusy(false)
    await refresh()
  }

  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  const view = [...rows].reverse() // newest first for display

  return (
    <Collapsible
      title="🎯 Goal history"
      subtitle="Set which goal applied when — colours the past accordingly"
    >
      {view.length === 0 && !draft && (
        <p className="text-xs text-slate-500">No goal periods yet.</p>
      )}

      <div className="space-y-2">
        {view.map((r, i) => {
          // "until" = day before the next (chronologically later) period; the
          // most recent one runs to "now". view is reversed, so the later period
          // is the previous item (i-1).
          const until = i === 0 ? 'now' : addDays(view[i - 1].effective_from, -1)
          return (
            <div key={r.id} className="rounded-xl bg-slate-800 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-white">
                    {r.effective_from} → {until}
                  </div>
                  <div className="text-xs text-slate-400">
                    <b className="text-slate-200">{r.goal_calories ?? '–'}</b> kcal ·{' '}
                    {r.goal_protein_g ?? 0}P · {r.goal_carbs_g ?? 0}C · {r.goal_fat_g ?? 0}F
                    {r.tdee ? ` · maint ${r.tdee}` : ''}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={() => startEdit(r)}
                    className="text-slate-400 hover:text-white"
                    aria-label="Edit"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => remove(r)}
                    className="text-slate-500 hover:text-red-400"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {draft ? (
        <div className="space-y-2 rounded-xl border border-slate-700 p-2.5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {draft.id ? 'Edit period' : 'New period'}
          </div>
          <Field label="Effective from">
            <Input type="date" value={draft.effective_from} max={todayISODate()} onChange={set('effective_from')} />
          </Field>
          <div className="grid grid-cols-5 gap-1 text-center text-[10px] text-slate-500">
            <span>kcal</span>
            <span>P</span>
            <span>C</span>
            <span>F</span>
            <span>maint</span>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {['goal_calories', 'goal_protein_g', 'goal_carbs_g', 'goal_fat_g', 'tdee'].map((k) => (
              <Input
                key={k}
                type="number"
                inputMode="decimal"
                value={draft[k]}
                onChange={set(k)}
                className="min-w-0 px-1 text-center"
              />
            ))}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save period'}
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={startAdd}
          className="w-full rounded-lg border border-dashed border-slate-600 py-1.5 text-xs text-slate-400 hover:border-green-500 hover:text-green-400"
        >
          ＋ add / backdate a goal period
        </button>
      )}
    </Collapsible>
  )
}
