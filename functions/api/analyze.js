// Cloudflare Pages Function — POST /api/analyze
// BYOK: analyses run on the *signed-in user's* own Gemini key (encrypted at
// rest, decrypted server-side only). The client sends its Supabase access
// token in the Authorization header — never a key.

import { analyzeForUser, bearer } from '../../server/byok.js'

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
    const result = await analyzeForUser({ authToken: bearer(request), env, body })
    return json(result, 200)
  } catch (e) {
    return json({ error: e.message || 'Analyze failed', code: e.code }, e.status || 500)
  }
}
