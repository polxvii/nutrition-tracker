// Per-user meal-time windows. Each value is the START time (HH:MM, local) of
// that meal; a meal runs until the next one begins, and "night" wraps past
// midnight until breakfast. Stored on profiles.meal_windows (jsonb); falls back
// to these defaults when unset. Snack has no window — it's picked manually.
export const DEFAULT_MEAL_WINDOWS = {
  breakfast: '04:00',
  lunch: '11:00',
  dinner: '16:00',
  night: '21:00',
}

export const MEAL_ORDER = [
  ['breakfast', 'Breakfast'],
  ['lunch', 'Lunch'],
  ['dinner', 'Dinner'],
  ['night', 'Night'],
]

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

// The default meal for the current time, given a user's windows.
export function mealForNow(windows, now = new Date()) {
  const w = { ...DEFAULT_MEAL_WINDOWS, ...(windows || {}) }
  const mins = now.getHours() * 60 + now.getMinutes()
  const starts = Object.entries(w)
    .map(([meal, t]) => [meal, toMin(t)])
    .sort((a, b) => a[1] - b[1])
  // Latest window whose start is ≤ now; before the earliest start it's the last
  // meal of the day (which wraps overnight).
  let pick = starts[starts.length - 1][0]
  for (const [meal, start] of starts) if (mins >= start) pick = meal
  return pick
}
