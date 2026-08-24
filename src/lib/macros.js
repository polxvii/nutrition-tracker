// Macro → calorie math, shared so every editor recomputes kcal the same way.
// Alcohol is 7 kcal/g — the reason a drink's kcal never matched 4P+4C+9F.
export const ALCOHOL_KCAL_PER_G = 7

export function kcalFromMacros(protein, carbs, fat, alcohol = 0) {
  const n = (v) => Number(v) || 0
  return Math.round(4 * n(protein) + 4 * n(carbs) + 9 * n(fat) + ALCOHOL_KCAL_PER_G * n(alcohol))
}

// Grams of pure ethanol from a drink's volume + strength.
// ethanol density = 0.789 g/ml, so 330 ml @ 5.8% ABV ≈ 15.1 g.
export const ETHANOL_DENSITY = 0.789
export function alcoholGramsFromAbv(ml, abvPct) {
  return (Number(ml) || 0) * ((Number(abvPct) || 0) / 100) * ETHANOL_DENSITY
}

// Does this food name look like an alcoholic drink? Used to auto-reveal the
// alcohol field. False positives are cheap (just shows an empty optional
// field), so the list is broad — beer, wine, spirits, cocktails, Thai terms.
// The non-alcoholic look-alikes (root beer, ginger ale, virgin, 0%) are excluded.
const ALC_WORDS =
  /\b(beers?|ales?|lagers?|stout|pilsner|ipa|apa|porter|saison|weizen|witbier|hefe\w*|bock|radler|shandy|wines?|sparkling|champagne|prosecco|cava|sherry|vermouth|moscato|riesling|merlot|cabernet|chardonnay|sauvignon|pinot|shiraz|syrah|malbec|sangria|vodka|whisk(?:y|ey)|bourbon|scotch|rum|gin|tequila|mezcal|brandy|cognac|absinthe|schnapps|sambuca|grappa|soju|sake|baijiu|liqueur|liquor|spirits?|aperol|campari|jager\w*|negroni|mojito|margarita|martini|daiquiri|cosmopolitan|colada|highball|spritz|caipirinha|cocktail|cider|seltzer|chuhai|alcopop|smirnoff|heineken|bacardi|absolut|chivas|jameson|hennessy|corona|asahi|sapporo|hoegaarden)\b/i
const ALC_TH =
  /(เบียร์|ไวน์|เหล้า|สุรา|วิสก|วอดก|บรั่นด|แชมเปญ|สปาร์ก|ไซเดอร์|ค็อกเทล|สาเก|โซจู|จิน|รัม|เตกีล|เมรัย|สาโท|กระแช่|ไฮบอล|ลาเกอร|สเตาท|สปาย|แสงโสม|หงส์ทอง|ไฮเนเก้น)/
const NON_ALC = /(root ?beer|ginger ?ale|non[-\s]?alcohol|alcohol[-\s]?free|mocktail|virgin|\b0\s?%)/i

export function isLikelyAlcohol(name) {
  const s = String(name || '')
  if (!s || NON_ALC.test(s)) return false
  return ALC_WORDS.test(s) || ALC_TH.test(s)
}
