// Supabase (PostgREST) caps every response at 1000 rows — the project's default
// "max rows" — and silently drops the rest. Anything that can grow past that
// (all-time exports, 90-day food windows, years of weigh-ins) must page through
// with .range() until a short page comes back.
//
// `build` must return a FRESH query each call (a builder can't be reused once
// awaited), ordered on a unique key — add `id` as a tiebreaker after a
// timestamp — so pages never overlap or skip rows.
const PAGE = 1000

export async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return { data: rows, error: null }
  }
}

// Local-day bounds for timestamptz filters. A bare "YYYY-MM-DDT00:00:00" sent to
// Postgres is read as UTC (7 h off in Thailand); converting here keeps the range
// on the user's own calendar day. Use gte(dayStartISO(from)) + lt(dayEndISO(to)).
export const dayStartISO = (ymd) => new Date(ymd + 'T00:00:00').toISOString()
export const dayEndISO = (ymd) => {
  const d = new Date(ymd + 'T00:00:00')
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}
