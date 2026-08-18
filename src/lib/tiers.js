// Shared calorie/macro colour tiers so Today, Calendar, and Progress all judge
// intake the same way.
//
// A single DAY gets a tolerance band — a few kcal / grams over goal is still
// "on target", so 7 over doesn't look as bad as 200 over. AVERAGES (and the
// rolling line) compare straight to goal with no band.
//
//   value  — the eaten amount (kcal or grams)
//   goal   — that day's goal (or the averaged goal)
//   maint  — maintenance kcal (only used for mode 'kcal'; pass 0 otherwise)
//   mode   — 'kcal' | 'protein' | 'budget'   (budget = carbs/fat: over is bad)
//   daily  — true for one day (apply band), false for an average/rolling value
//
// Returns 'green' | 'amber' | 'red' | 'none' (none = no goal set).

export function tolBand(goal, mode, daily) {
  if (!daily || !(goal > 0)) return 0
  // 5% of goal; macros never dip below a 5 g floor (5% of a small goal is tiny).
  return mode === 'kcal' ? goal * 0.05 : Math.max(goal * 0.05, 5)
}

// Macros have no maintenance to map red to, so a second % threshold flags a big
// miss: carbs/fat >25% OVER goal, protein >25% UNDER goal (muscle risk).
const MACRO_RED_OVER = 1.25
const PROTEIN_RED_UNDER = 0.75

export function tierName(value, goal, maint, mode, daily) {
  const g = Number(goal) || 0
  if (!(g > 0)) return 'none'
  const v = Number(value) || 0
  const band = tolBand(g, mode, daily)
  // Protein: over is always fine; low beyond the band warns; far below → red.
  if (mode === 'protein') {
    if (v < g * PROTEIN_RED_UNDER) return 'red'
    return v >= g - band ? 'green' : 'amber'
  }
  if (mode === 'kcal') {
    const m = Number(maint) || 0
    if (m > 0 && v > m + band) return 'red'
    return v > g + band ? 'amber' : 'green'
  }
  // budget (carbs/fat): amber once over goal, red once well over.
  if (v > g * MACRO_RED_OVER) return 'red'
  return v > g + band ? 'amber' : 'green'
}

const TEXT = { green: 'text-green-400', amber: 'text-amber-400', red: 'text-red-400', none: 'text-white' }
const BG = { green: 'bg-green-500', amber: 'bg-amber-500', red: 'bg-red-500', none: 'bg-slate-500' }
const HEX = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', none: '#64748b' }

export const tierText = (value, goal, maint, mode, daily) => TEXT[tierName(value, goal, maint, mode, daily)]
export const tierBg = (value, goal, maint, mode, daily) => BG[tierName(value, goal, maint, mode, daily)]
export const tierHex = (value, goal, maint, mode, daily) => HEX[tierName(value, goal, maint, mode, daily)]
