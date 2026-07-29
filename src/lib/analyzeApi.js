// Client helpers for the BYOK backend proxy. All Gemini traffic goes through
// the server (functions/api/*); the browser only ever sends its Supabase
// access token — never an API key.
import { supabase } from './supabase'

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return {
    'content-type': 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

function asError(data, res) {
  const err = new Error(data.error || `Request failed (${res.status})`)
  err.status = res.status
  err.code = data.code // e.g. 'no_key' → prompt onboarding
  return err
}

// Analyse a meal (one or more photos and/or text) on the user's own key.
// `images` is an array of { base64, mediaType }.
export async function analyzePhoto({ images = [], note }) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ images, note }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw asError(data, res)
  return data
}

// Validate + encrypt + store the user's own Gemini key (server-side).
export async function addApiKey(key, label) {
  const res = await fetch('/api/keys', {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ key, label }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw asError(data, res)
  return data
}
