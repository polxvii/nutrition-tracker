// Start/end ISO timestamps for a given local day — used to query food_logs.
export function dayRange(date = new Date()) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

// Local calendar date as YYYY-MM-DD (not UTC) — used for weight_logs.logged_date.
export function todayISODate(d = new Date()) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

// Friendly date, e.g. "Saturday, 19 July"
export function prettyDate(d = new Date()) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}
