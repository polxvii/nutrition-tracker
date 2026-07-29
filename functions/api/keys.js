// Cloudflare Pages Function — POST /api/keys
// Validate + encrypt + store a user's own Gemini API key. The plaintext key is
// used only for the live validation call, then encrypted; it is never returned
// to the client, logged, or stored in plaintext. Listing / deleting keys is
// done client-side via Supabase (RLS) — those don't need the master key.

import { addKeyForUser, bearer } from '../../server/byok.js'

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    const { key, label } = await request.json()
    const result = await addKeyForUser({ authToken: bearer(request), env, key, label })
    return json(result, 200)
  } catch (e) {
    return json({ error: e.message || 'Could not add key', code: e.code }, e.status || 500)
  }
}
