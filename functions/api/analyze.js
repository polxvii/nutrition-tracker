// Cloudflare Pages Function — POST /api/analyze
// Cloudflare auto-detects the functions/ directory; no extra config needed.
// The ANTHROPIC_API_KEY is read from the Pages project env (never sent to the
// browser). Set it in: Cloudflare → Workers & Pages → project → Settings →
// Environment variables (Production + Preview).

import { analyzeFood } from '../../server/analyzeFood.js'

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    const body = await request.json()
    const result = await analyzeFood({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      imageBase64: body.image,
      mediaType: body.mediaType,
      note: body.note,
    })
    return json(result, 200)
  } catch (e) {
    return json({ error: e.message || 'Analyze failed' }, e.status || 500)
  }
}
