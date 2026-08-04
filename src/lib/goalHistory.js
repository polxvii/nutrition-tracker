import { supabase } from './supabase'
import { todayISODate } from './dateHelpers'

// Goal history lets each logged day be judged against the goal that was in
// effect *that* day, so changing your goal later doesn't recolour the past.

// Record the goal that takes effect today. Upsert on (user, date) so changing
// the goal twice in one day just overwrites — one snapshot per day.
export async function recordGoalHistory(userId, g) {
  if (!userId) return
  const round = (v) => (v == null || v === '' ? null : Math.round(Number(v)))
  await supabase.from('goal_history').upsert(
    {
      user_id: userId,
      effective_from: todayISODate(),
      goal_calories: round(g.goal_calories),
      goal_protein_g: round(g.goal_protein_g),
      goal_carbs_g: round(g.goal_carbs_g),
      goal_fat_g: round(g.goal_fat_g),
      tdee: round(g.tdee),
    },
    { onConflict: 'user_id,effective_from' }
  )
}

// A user's goal history, oldest first (RLS already scopes to the user).
export async function loadGoalHistory() {
  const { data } = await supabase
    .from('goal_history')
    .select('effective_from,goal_calories,goal_protein_g,goal_carbs_g,goal_fat_g,tdee')
    .order('effective_from', { ascending: true })
  return data ?? []
}

// The goal row in effect on `date` (YYYY-MM-DD). `history` must be ascending by
// effective_from. Dates before the first row fall back to the earliest goal, so
// a freshly seeded/first goal still colours older logs.
export function goalForDate(history, date) {
  if (!history?.length) return null
  let g = history[0]
  for (const h of history) {
    if (h.effective_from <= date) g = h
    else break
  }
  return g
}
