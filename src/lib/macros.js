// Macro → calorie math, shared so every editor recomputes kcal the same way.
// Alcohol is 7 kcal/g — the reason a drink's kcal never matched 4P+4C+9F.
export const ALCOHOL_KCAL_PER_G = 7

export function kcalFromMacros(protein, carbs, fat, alcohol = 0) {
  const n = (v) => Number(v) || 0
  return Math.round(4 * n(protein) + 4 * n(carbs) + 9 * n(fat) + ALCOHOL_KCAL_PER_G * n(alcohol))
}
