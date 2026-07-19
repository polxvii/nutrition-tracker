import { Card, Field, Input } from './ui'
import { macroPercents } from '../lib/nutrition'

const KCAL = { protein_g: 4, carbs_g: 4, fat_g: 9 }

// Plain input styling (no w-full — width is controlled by the grid layout).
const cell =
  'min-w-0 rounded-lg border border-slate-700 bg-slate-800 px-2 py-2 text-white outline-none focus:border-green-500'

// One editable macro row: grams <-> % of calorie goal (kept in sync).
function MacroRow({ label, gramKey, color, targets, onChange }) {
  const cal = Number(targets.goal_calories) || 0
  const grams = Number(targets[gramKey]) || 0
  const pct = cal > 0 ? Math.round(((grams * KCAL[gramKey]) / cal) * 100) : 0

  const setGram = (e) => onChange({ ...targets, [gramKey]: e.target.value })
  const setPct = (e) => {
    const p = Number(e.target.value) || 0
    const g = cal > 0 ? Math.round(((p / 100) * cal) / KCAL[gramKey]) : 0
    onChange({ ...targets, [gramKey]: g })
  }

  return (
    <div className="grid grid-cols-[3.5rem_1fr_auto] items-center gap-2">
      <span className="text-sm font-medium" style={{ color }}>
        {label}
      </span>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="decimal"
          value={targets[gramKey]}
          onChange={setGram}
          className={`${cell} w-full`}
        />
        <span className="text-xs text-slate-500">g</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="number"
          inputMode="numeric"
          value={pct}
          onChange={setPct}
          className={`${cell} w-16 text-center`}
        />
        <span className="text-xs text-slate-500">%</span>
      </div>
    </div>
  )
}

// Editable calorie goal + macro split. P/C/F % must total ~100%.
export default function TargetsEditor({ targets, onChange, onReset, calc }) {
  if (!targets) return null
  const { sum } = macroPercents(targets)
  const ok = Math.abs(sum - 100) <= 1.5

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">Targets (editable)</span>
        {calc && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-green-400 hover:text-green-300"
          >
            Reset to calculated
          </button>
        )}
      </div>

      {calc && (
        <div className="flex gap-4 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-400">
          <span>
            BMR <b className="text-slate-200">{calc.bmr}</b>
          </span>
          <span>
            TDEE <b className="text-slate-200">{calc.tdee}</b> kcal
          </span>
        </div>
      )}

      <Field label="Calorie goal (kcal)">
        <Input
          type="number"
          inputMode="numeric"
          value={targets.goal_calories}
          onChange={(e) => onChange({ ...targets, goal_calories: e.target.value })}
        />
      </Field>

      <div className="space-y-2">
        <MacroRow label="Protein" gramKey="protein_g" color="#22c55e" targets={targets} onChange={onChange} />
        <MacroRow label="Carbs" gramKey="carbs_g" color="#3b82f6" targets={targets} onChange={onChange} />
        <MacroRow label="Fat" gramKey="fat_g" color="#f59e0b" targets={targets} onChange={onChange} />
      </div>

      <div className={`text-xs ${ok ? 'text-slate-400' : 'text-red-400'}`}>
        P/C/F total: {Math.round(sum)}% {ok ? '✓' : '— must be 100%'}
      </div>
    </Card>
  )
}
