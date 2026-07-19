export default function ProgressRing({
  value = 0,
  max = 0,
  size = 130,
  stroke = 11,
  color = '#22c55e',
  label,
  unit = '',
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct)
  const over = max > 0 && value > max

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="#1e293b"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={over ? '#ef4444' : color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.4s ease, stroke 0.3s' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl font-bold text-white">{Math.round(value)}</span>
        <span className="text-[11px] text-slate-400">
          / {Math.round(max)} {unit}
        </span>
        {label && (
          <span className="mt-0.5 text-[11px] font-medium text-slate-300">
            {label}
          </span>
        )}
      </div>
    </div>
  )
}
