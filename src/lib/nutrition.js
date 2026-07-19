// =====================================================================
//  Nutrition math — BMR, TDEE, goal calories, macro split.
//  Formulas follow blueprint §7.
// =====================================================================

export const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export const ACTIVITY_LABELS = {
  sedentary: 'Sedentary — little / no exercise',
  light: 'Light — exercise 1–3 days/week',
  moderate: 'Moderate — 3–5 days/week',
  active: 'Active — 6–7 days/week',
  very_active: 'Very active — hard training / physical job',
}

export const GOAL_LABELS = {
  recomp: 'Recomp — build muscle + lose fat',
  cut: 'Cut — lose fat',
  bulk: 'Bulk — gain muscle',
  maintain: 'Maintain weight',
}

export const RATE_LABELS = { slow: 'Slow', medium: 'Medium', fast: 'Fast' }

// Percentage adjustment per goal + rate (for UI hints and calc).
export const CUT_PCT = { slow: 0.15, medium: 0.2, fast: 0.25 }
export const BULK_PCT = { slow: 0.05, medium: 0.1, fast: 0.15 }

function hasBodyFat(bodyFatPct) {
  return (
    bodyFatPct != null &&
    bodyFatPct !== '' &&
    !Number.isNaN(Number(bodyFatPct)) &&
    Number(bodyFatPct) > 0
  )
}

// ---- Step 1: BMR ----------------------------------------------------
export function calcBMR({ weightKg, heightCm, age, sex, bodyFatPct }) {
  if (hasBodyFat(bodyFatPct)) {
    // Katch-McArdle (more accurate when body fat is known)
    const lbm = weightKg * (1 - Number(bodyFatPct) / 100)
    return 370 + 21.6 * lbm
  }
  // Mifflin-St Jeor
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  return sex === 'female' ? base - 161 : base + 5
}

// ---- Step 2: TDEE ---------------------------------------------------
export function calcTDEE(bmr, activityLevel) {
  const factor = ACTIVITY_FACTORS[activityLevel] ?? 1.2
  return bmr * factor
}

// ---- Step 3: goal calories (never below BMR) ------------------------
// adjustPct = optional manual fine-tune applied on top of the formula
// (e.g. +5 or -5). Applied before the BMR floor.
export function calcGoalCalories({ tdee, bmr, goalType, goalRate, adjustPct = 0 }) {
  let cal
  switch (goalType) {
    case 'recomp':
      cal = tdee - 200
      break
    case 'cut':
      cal = tdee * (1 - (CUT_PCT[goalRate] ?? CUT_PCT.medium))
      break
    case 'bulk':
      cal = tdee * (1 + (BULK_PCT[goalRate] ?? BULK_PCT.medium))
      break
    case 'maintain':
    default:
      cal = tdee
  }
  cal = cal * (1 + (Number(adjustPct) || 0) / 100) // manual adjustment
  return Math.max(cal, bmr) // guard: never eat below BMR
}

// ---- Step 4: macro split -------------------------------------------
export function calcMacros({ calories, weightKg, goalType }) {
  // Protein (g/kg bodyweight)
  let proteinPerKg
  if (goalType === 'recomp' || goalType === 'cut') proteinPerKg = 2.2
  else if (goalType === 'bulk') proteinPerKg = 1.8
  else proteinPerKg = 1.7 // maintain
  const proteinG = proteinPerKg * weightKg
  const proteinCal = proteinG * 4

  // Fat: weightKg * 0.8 g, but never below 25% of calories (hormone floor)
  const fatCalByWeight = weightKg * 0.8 * 9
  const fatCalFloor = 0.25 * calories
  const fatCal = Math.max(fatCalByWeight, fatCalFloor)
  const fatG = fatCal / 9

  // Carbs: whatever calories remain
  const carbsCal = Math.max(calories - proteinCal - fatCal, 0)
  const carbsG = carbsCal / 4

  // Fiber: 14 g per 1000 kcal
  const fiberG = (calories / 1000) * 14

  return {
    protein_g: Math.round(proteinG),
    fat_g: Math.round(fatG),
    carbs_g: Math.round(carbsG),
    fiber_g: Math.round(fiberG),
  }
}

// ---- Full pipeline: raw inputs → stored target values ---------------
export function computeTargets(input) {
  const bmr = calcBMR(input)
  const tdee = calcTDEE(bmr, input.activityLevel)
  const goalCalories = calcGoalCalories({
    tdee,
    bmr,
    goalType: input.goalType,
    goalRate: input.goalRate,
    adjustPct: input.adjustPct,
  })
  const macros = calcMacros({
    calories: goalCalories,
    weightKg: input.weightKg,
    goalType: input.goalType,
  })
  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    goal_calories: Math.round(goalCalories),
    ...macros,
  }
}

// ---- Form <-> compute helpers --------------------------------------

// Build a fresh form object from a profile row (or defaults).
export function profileToForm(p) {
  return {
    age: p?.age ?? '',
    weight_kg: p?.weight_kg ?? '',
    height_cm: p?.height_cm ?? '',
    sex: p?.sex ?? 'male',
    body_fat_pct: p?.body_fat_pct ?? '',
    activity_level: p?.activity_level ?? 'moderate',
    goal_type: p?.goal_type ?? 'recomp',
    goal_rate: p?.goal_rate ?? 'medium',
    calorie_adjust_pct: p?.calorie_adjust_pct ?? 0,
  }
}

export function isFormValid(v) {
  return (
    Number(v.age) > 0 &&
    Number(v.weight_kg) > 0 &&
    Number(v.height_cm) > 0 &&
    !!v.sex &&
    !!v.activity_level &&
    !!v.goal_type
  )
}

// Compute targets from a form-shaped object.
export function targetsFromForm(v) {
  return computeTargets({
    weightKg: Number(v.weight_kg),
    heightCm: Number(v.height_cm),
    age: Number(v.age),
    sex: v.sex,
    bodyFatPct:
      v.body_fat_pct === '' || v.body_fat_pct == null ? null : Number(v.body_fat_pct),
    activityLevel: v.activity_level,
    goalType: v.goal_type,
    goalRate: v.goal_rate,
    adjustPct:
      v.calorie_adjust_pct === '' || v.calorie_adjust_pct == null
        ? 0
        : Number(v.calorie_adjust_pct),
  })
}

// Build the profiles row to upsert (used by Onboarding + Settings).
export function buildProfilePayload(userId, email, v, targets) {
  return {
    id: userId,
    email,
    age: Number(v.age),
    weight_kg: Number(v.weight_kg),
    height_cm: Number(v.height_cm),
    sex: v.sex,
    body_fat_pct:
      v.body_fat_pct === '' || v.body_fat_pct == null ? null : Number(v.body_fat_pct),
    activity_level: v.activity_level,
    goal_type: v.goal_type,
    goal_rate: v.goal_rate,
    calorie_adjust_pct:
      v.calorie_adjust_pct === '' || v.calorie_adjust_pct == null
        ? 0
        : Number(v.calorie_adjust_pct),
    bmr: targets.bmr,
    tdee: targets.tdee,
    goal_calories: targets.goal_calories,
    goal_protein_g: targets.protein_g,
    goal_carbs_g: targets.carbs_g,
    goal_fat_g: targets.fat_g,
    goal_fiber_g: targets.fiber_g,
    updated_at: new Date().toISOString(),
  }
}
