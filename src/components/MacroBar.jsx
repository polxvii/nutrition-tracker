function Bar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">
          {Math.round(value)} / {Math.round(max)} g
        </span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

export default function MacroBar({
  protein = 0,
  carbs = 0,
  fat = 0,
  fiber = 0,
  goalProtein = 0,
  goalCarbs = 0,
  goalFat = 0,
  goalFiber = 0,
}) {
  return (
    <div className="space-y-3">
      <Bar label="Protein" value={protein} max={goalProtein} color="#22c55e" />
      <Bar label="Carbs" value={carbs} max={goalCarbs} color="#3b82f6" />
      <Bar label="Fat" value={fat} max={goalFat} color="#f59e0b" />
      <Bar label="Fiber" value={fiber} max={goalFiber} color="#a78bfa" />
    </div>
  )
}
