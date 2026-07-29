// BYOK backend core — shared by the Cloudflare Pages Functions
// (functions/api/*) and the Vite dev middleware. Each user's own Gemini key
// (encrypted at rest) powers their AI calls; the plaintext key exists only
// transiently here, never reaches the client, and is never logged.

import { analyzeFood } from './analyzeFood.js'
import { encryptSecret, decryptSecret } from './crypto.js'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
// Fast sanity check only — Google is changing key formats, so this is NOT
// authoritative. The live test call decides. (spec §6)
const ACCEPTED_KEY_PREFIXES = ['AIza', 'AQ.Ab']

function httpError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

function readConfig(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const anonKey = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  const masterKey = env.KEY_ENCRYPTION_SECRET
  const models = env.GEMINI_MODELS // optional override; analyzeFood has defaults
  if (!url || !anonKey) throw httpError('Server is missing the Supabase config.', 500)
  if (!masterKey) throw httpError('Server is missing KEY_ENCRYPTION_SECRET.', 500)
  return { url, anonKey, masterKey, models }
}

const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()

// --- Supabase REST (uses the caller's JWT so RLS scopes everything) ----------
async function getUser(token, { url, anonKey }) {
  if (!token) throw httpError('Sign in to use AI.', 401)
  const r = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
  })
  if (!r.ok) throw httpError('Your session expired — sign in again.', 401)
  const u = await r.json().catch(() => null)
  if (!u?.id) throw httpError('Could not verify your session.', 401)
  return u
}

async function sbRest(path, { url, anonKey, token, method = 'GET', body, prefer }) {
  const headers = { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  if (prefer) headers.prefer = prefer
  const r = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON */
  }
  if (!r.ok) {
    const e = httpError((data && (data.message || data.error)) || `Database error (${r.status}).`, r.status)
    e.pg = data
    throw e
  }
  return data
}

// --- Best-effort per-user rate limit (per warm isolate; §5) ------------------
const hits = new Map()
const RL_WINDOW_MS = 60_000
const RL_MAX = 15
function rateLimit(uid) {
  const now = Date.now()
  const arr = (hits.get(uid) || []).filter((t) => now - t < RL_WINDOW_MS)
  if (arr.length >= RL_MAX) throw httpError('Too many requests — wait a moment and try again.', 429)
  arr.push(now)
  hits.set(uid, arr)
}

// --- Lightweight key validation: a tiny live call, status-only -------------
async function pingGemini(key, model) {
  return fetch(`${GEMINI_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 16 },
    }),
  })
}

// Returns the key's status ('active' | 'exhausted') or throws httpError(400) if
// Google rejects it. Tries a couple of models so one model's quirk can't
// wrongly mark a valid key invalid.
async function validateKey(key, modelsCsv) {
  const models = (typeof modelsCsv === 'string' && modelsCsv.trim())
    ? modelsCsv.split(',').map((s) => s.trim()).filter(Boolean)
    : ['gemini-flash-latest', 'gemini-flash-lite-latest']
  let sawReject = false
  for (const m of models.slice(0, 2)) {
    let r
    try {
      r = await pingGemini(key, m)
    } catch {
      throw httpError('Could not reach Google to validate the key. Try again.', 502)
    }
    if (r.ok) return 'active'
    if (r.status === 429) return 'exhausted' // valid, just rate-limited right now
    if (r.status === 400 || r.status === 401 || r.status === 403) {
      sawReject = true
      continue // maybe model-specific; try the next model
    }
  }
  if (sawReject) throw httpError('That key was rejected by Google (invalid, revoked, or disabled).', 400)
  throw httpError('Could not validate the key right now. Try again.', 502)
}

// --- Public: add a user's key (validate → encrypt → store) -------------------
export async function addKeyForUser({ authToken, env, key, label }) {
  const cfg = readConfig(env)
  const user = await getUser(authToken, cfg)
  const clean = (key || '').trim()
  if (!clean) throw httpError('Paste your Gemini API key.', 400)
  if (clean.length < 20) throw httpError('That does not look like a valid key.', 400)
  const knownPrefix = ACCEPTED_KEY_PREFIXES.some((p) => clean.startsWith(p))

  const status = await validateKey(clean, cfg.models) // throws 400 if rejected
  const encrypted = await encryptSecret(clean, cfg.masterKey)
  const row = {
    user_id: user.id,
    provider: 'gemini',
    encrypted_key: encrypted,
    key_last4: clean.slice(-4),
    key_label: (label || '').trim() || null,
    status,
    last_validated_at: new Date().toISOString(),
  }
  try {
    const inserted = await sbRest('user_api_keys', {
      ...cfg,
      token: authToken,
      method: 'POST',
      body: row,
      prefer: 'return=representation',
    })
    const r = Array.isArray(inserted) ? inserted[0] : inserted
    return { ok: true, id: r.id, key_last4: r.key_last4, status: r.status, knownPrefix }
  } catch (e) {
    // DB trigger limit (§7 backstop) → check_violation.
    if (e.pg?.code === 'check_violation' || /limit reached/i.test(e.message || '')) {
      throw httpError('You already have the maximum number of keys for your account.', 403)
    }
    throw e
  }
}

// --- Public: run a meal analysis on the user's own key -----------------------
export async function analyzeForUser({ authToken, env, body }) {
  const cfg = readConfig(env)
  const user = await getUser(authToken, cfg)
  rateLimit(user.id)

  const rows = await sbRest(
    'user_api_keys?select=id,encrypted_key,status&provider=eq.gemini&order=created_at.asc',
    { ...cfg, token: authToken }
  )
  const usable = (rows || []).filter((r) => r.status !== 'invalid')
  if (!usable.length) {
    const e = httpError('Add your own Gemini API key to use AI analysis.', 428)
    e.code = 'no_key'
    throw e
  }

  const keys = []
  const ids = []
  for (const r of usable) {
    try {
      keys.push(await decryptSecret(r.encrypted_key, cfg.masterKey))
      ids.push(r.id)
    } catch {
      /* undecryptable row (master-key mismatch) — skip */
    }
  }
  if (!keys.length) throw httpError('Your stored key could not be read. Please re-add your key.', 500)

  let result
  try {
    result = await analyzeFood({
      apiKeys: keys,
      models: cfg.models,
      images: body.images,
      imageBase64: body.image, // back-compat
      mediaType: body.mediaType,
      note: body.note,
    })
  } catch (e) {
    await markStatus(e, ids, { ...cfg, token: authToken })
    throw e
  }

  const usedId = ids[result.keyIndex] ?? ids[0]
  // Record use + clear any stale non-active status on the key that worked.
  try {
    await sbRest(`user_api_keys?id=eq.${usedId}`, {
      ...cfg,
      token: authToken,
      method: 'PATCH',
      body: { last_used_at: new Date().toISOString(), status: 'active' },
    })
  } catch {
    /* non-fatal */
  }

  return {
    items: result.items,
    dish: result.dish,
    confidence: result.confidence,
    totals: result.totals,
    model: result.model,
  }
}

// Flip stored key status on a hard failure (best-effort).
async function markStatus(err, ids, cfg) {
  let status
  if (err.status === 429) status = 'exhausted'
  else if (err.badKey) status = 'invalid'
  if (!status || !ids.length) return
  try {
    await sbRest(`user_api_keys?id=in.(${ids.join(',')})`, {
      ...cfg,
      method: 'PATCH',
      body: { status },
    })
  } catch {
    /* non-fatal */
  }
}

// Small helpers reused by the entry points.
export { bearer, httpError }
