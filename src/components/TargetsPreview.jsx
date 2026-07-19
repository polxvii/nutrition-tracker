import { Card } from './ui'

function Stat({ label, value, unit, accent = 'text-white' }) {
  return (
    <div className="rounded-xl bg-slate-800 p-3 text-center">
      <div className={`text-lg font-bold ${accent}`}>
        {value}
        <span className="text-xs font-normal text-slate-400"> {unit}</span>
      </div>
      <div className="text-[11px] text-slate-400">{label}</div>
    </div>
  )
}

export default function TargetsPreview({ targets }) {
  if (!targets) return null
  return (
    <Card className="space-y-3">
      <div className="text-sm font-medium text-slate-200">
        Calculated targets
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Stat label="BMR" value={targets.bmr} unit="kcal" />
        <Stat label="TDEE" value={targets.tdee} unit="kcal" />
        <Stat
          label="Calorie goal"
          value={targets.goal_calories}
          unit="kcal"
          accent="text-green-400"
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Protein" value={targets.protein_g} unit="g" accent="text-green-400" />
        <Stat label="Carbs" value={targets.carbs_g} unit="g" accent="text-blue-400" />
        <Stat label="Fat" value={targets.fat_g} unit="g" accent="text-amber-400" />
        <Stat label="Fiber" value={targets.fiber_g} unit="g" accent="text-violet-400" />
      </div>
    </Card>
  )
}
