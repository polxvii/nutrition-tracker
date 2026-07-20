// Cloudflare Pages Function — POST /api/analyze
// Cloudflare auto-detects the functions/ directory; no extra config needed.
// The GEMINI_API_KEY is read from the Pages project env (never sent to the
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
      apiKey: env.GEMINI_API_KEY,
      apiKeys: env.GEMINI_API_KEYS,
      model: env.GEMINI_MODEL,
      models: env.GEMINI_MODELS,
      imageBase64: body.image,
      mediaType: body.mediaType,
      note: body.note,
    })
    return json(result, 200)
  } catch (e) {
    return json({ error: e.message || 'Analyze failed' }, e.status || 500)
  }
}
