export default function ProgressRing({
  value = 0,
  max = 0,
  size = 130,
  stroke = 11,
  color = '#22c55e',
  overColor, // optional: stroke when value > max (e.g. over-budget red)
  underColor, // optional: stroke while value < max (e.g. protein not-yet-hit amber)
  glow = false, // soft outer glow tinted to the stroke (hero ring only)
  centerTop, // override the big center value (e.g. remaining "kcal left")
  centerBottom, // override the center sub-label
  label,
  unit = '',
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct)
  const strokeColor =
    overColor && max > 0 && value > max
      ? overColor
      : underColor && max > 0 && value < max
        ? underColor
        : color

  return (
    <div className="flex flex-col items-center gap-1">
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
            stroke={strokeColor}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dashoffset 0.7s cubic-bezier(0.2,0.7,0.2,1), stroke 0.3s',
              filter: glow ? `drop-shadow(0 0 7px ${strokeColor}99)` : undefined,
            }}
          />
        </svg>
        <div className="absolute flex flex-col items-center leading-none">
          {centerTop != null ? (
            <>
              <span
                className="font-bold tabular-nums text-white"
                style={{ fontSize: Math.round(size * 0.26), letterSpacing: '-0.03em' }}
              >
                {centerTop}
              </span>
              <span
                className="mt-1 text-slate-400"
                style={{ fontSize: Math.max(10, Math.round(size * 0.095)) }}
              >
                {centerBottom}
              </span>
            </>
          ) : (
            <>
              <span
                className="font-bold tabular-nums text-white"
                style={{ fontSize: Math.round(size * 0.22), letterSpacing: '-0.02em' }}
              >
                {Math.round(value)}
              </span>
              <span
                className="text-slate-400"
                style={{ fontSize: Math.max(9, Math.round(size * 0.1)) }}
              >
                /{Math.round(max)}
                {unit ? ' ' + unit : ''}
              </span>
            </>
          )}
        </div>
      </div>
      {label && <span className="text-xs font-medium text-slate-300">{label}</span>}
    </div>
  )
}
