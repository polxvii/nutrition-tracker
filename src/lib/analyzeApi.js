// Client helper — sends the downscaled photo to the /api/analyze serverless
// function and returns { items, confidence, totals }.
export async function analyzePhoto({ base64, mediaType, note }) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ image: base64, mediaType, note }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Analyze failed (${res.status})`)
  return data
}
