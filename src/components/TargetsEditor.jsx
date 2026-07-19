import { Card, Field, Input } from './ui'
import { macroPercents } from '../lib/nutrition'

const KCAL = { protein_g: 4, carbs_g: 4, fat_g: 9 }

// One editable macro row: grams <-> % of calorie goal (kept in sync).
function MacroRow({ label, gramKey, color, targets, onChange }) {
  const cal = Number(targets.goal_calories) || 0
  const grams = Number(targets[gramKey]) || 0
  const pct = cal > 0 ? Math.round(((grams * KCAL[gramKey]) / cal) * 100) : 0

  const setGram = (e) => onChange({ ...targets, [gramKey]: e.target.value })
  const setPct = (e) => {
    const p = Number(e.target.value) || 0
    const g = cal > 0 ? Math.round((p / 100) * cal / KCAL[gramKey]) : 0
    onChange({ ...targets, [gramKey]: g })
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 text-sm font-medium" style={{ color }}>
        {label}
      </span>
      <Input
        type="number"
        inputMode="decimal"
        value={targets[gramKey]}
        onChange={setGram}
        className="flex-1"
      />
      <span className="text-xs text-slate-500">g</span>
      <Input
        type="number"
        inputMode="numeric"
        value={pct}
        onChange={setPct}
        className="w-14"
      />
      <span className="text-xs text-slate-500">%</span>
    </div>
  )
}

// Editable calorie goal + macro split. P/C/F % must total ~100%; fiber is a
// separate gram target. `calc` (auto-calculated) enables the reset button.
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

      <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
        <span className="w-14 text-sm font-medium text-violet-400">Fiber</span>
        <Input
          type="number"
          inputMode="decimal"
          value={targets.fiber_g}
          onChange={(e) => onChange({ ...targets, fiber_g: e.target.value })}
          className="flex-1"
        />
        <span className="text-xs text-slate-500">g</span>
      </div>
    </Card>
  )
}
