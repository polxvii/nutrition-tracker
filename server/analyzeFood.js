// Core food-photo analysis via Google Gemini (free tier). Runs server-side
// only (Cloudflare Pages Function in prod, Vite dev middleware locally) so the
// API key never reaches the client. Raw fetch — works in Workers and Node,
// zero dependencies. Uses a personal Google AI Studio key, entirely separate
// from any corporate Claude/Anthropic plan.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
// Free-tier vision models, tried in order. Each model has its own daily
// request quota (RPD), so when the first is exhausted (HTTP 429) we cascade to
// the next — buying several times the free daily budget. Every request starts
// from the top again, so once a model's quota resets we're back on the primary
// automatically (no persisted state). "gemini-flash-latest" is a Google alias
// that always points at the current flash model. Override the whole list with
// the GEMINI_MODELS env var (comma-separated), or a single GEMINI_MODEL.
// Verified working for this key (ListModels), distinct daily quota buckets:
//   gemini-flash-latest (alias → current flash), gemini-3-flash-preview,
//   gemini-flash-lite-latest. NB: gemini-2.5-flash / *-lite are "not available
//   to new users" (404), and gemini-3-flash / gemini-2.0-flash are unavailable
//   or quota-0 — do not add them back without re-checking ListModels.
// Best → worst. The best available model is tried across ALL keys before we
// drop to the next model (quality first). gemini-3.1-flash-lite is an extra —
// if this key can't use it, it simply cascades (harmless).
const DEFAULT_MODELS = [
  'gemini-flash-latest',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
]

// Abort a single model call that runs too long, so a slow/hung model doesn't
// stall the whole request — we cascade to the next instead.
const REQUEST_TIMEOUT_MS = 20000
// After a (key,model) returns 429 (quota), skip it for a while so we stop
// paying a failed round-trip on every request. Module scope → persists across
// requests within a warm isolate (best-effort; fine if the isolate recycles).
const COOLDOWN_MS = 5 * 60 * 1000
const cooldownUntil = new Map()
const ckey = (model, keyIdx) => `${keyIdx}::${model}`

function resolveModels({ models, model }) {
  if (Array.isArray(models) && models.length) return models
  if (typeof models === 'string' && models.trim()) {
    return models.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (model && model.trim()) return [model.trim()]
  return DEFAULT_MODELS
}

// One or more API keys (each its own free daily quota). GEMINI_API_KEY plus an
// optional GEMINI_API_KEYS (comma-separated) — e.g. a second account's key to
// double the budget. Deduped, order preserved (primary key first).
function resolveKeys({ apiKey, apiKeys }) {
  const raw = []
  if (apiKey) raw.push(apiKey)
  if (typeof apiKeys === 'string') raw.push(...apiKeys.split(','))
  else if (Array.isArray(apiKeys)) raw.push(...apiKeys)
  return [...new Set(raw.map((s) => (s || '').trim()).filter(Boolean))]
}

const SYSTEM_PROMPT = `You are a nutrition estimation assistant specialising in Thai food and made-to-order (ตามสั่ง) dishes. Estimate the nutrition of a meal from a photo, a text description, or both.

Guidelines:
- Break the meal into its distinct components (e.g. rice, protein, vegetables, sauce, fried egg, drink). One entry per component.
- Estimate each component's weight in grams. Use visible reference objects for scale: a dinner plate is ~26 cm, a Thai spoon ~15 ml, a standard rice scoop (ทัพพี) ~100 g cooked rice, a soup bowl ~350 ml.
- Account for cooking method — deep-fried and stir-fried dishes carry significant oil; Thai dishes often include sugar and coconut milk.
- If the user provides a note/description, treat it as ground truth and prioritise it (stated amounts, ingredients, or cooking style override any visual guess).
- If there is no photo, estimate from the text description alone. If amounts are unstated, assume typical Thai portions and lower the confidence.
- Give per-component calories, protein, carbs, and fat in grams.
- Set overall confidence: "high" (clear photo, familiar dish, or a detailed description), "medium", or "low" (blurry, ambiguous, or portion hard to judge).
- Respond ONLY with a JSON object matching the required schema. No commentary, no markdown.`

// Gemini responseSchema (OpenAPI subset — types are UPPERCASE).
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          grams: { type: 'NUMBER' },
          calories: { type: 'NUMBER' },
          protein_g: { type: 'NUMBER' },
          carbs_g: { type: 'NUMBER' },
          fat_g: { type: 'NUMBER' },
        },
        required: ['name', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
      },
    },
    confidence: { type: 'STRING', enum: ['low', 'medium', 'high'] },
  },
  required: ['items', 'confidence'],
}

function httpError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

// One generateContent call. On failure throws an error carrying .status and
// .retryable (true when it's worth trying the next model in the chain).
async function callModel({ apiKey, model, body }) {
  const url = `${GEMINI_BASE}/${model}:generateContent`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    // Timed out (aborted) or network failure → worth trying the next model.
    const msg =
      err?.name === 'AbortError'
        ? 'The model took too long to respond.'
        : 'Could not reach the analysis service. Try again.'
    const e = httpError(msg, 504)
    e.retryable = true
    throw e
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    let msg = `Analysis service error (${resp.status}).`
    try {
      const j = await resp.json()
      if (j?.error?.message) msg = j.error.message
    } catch {
      /* ignore */
    }
    // A broken/denied key must be skipped, not abort the whole cascade. Detect
    // it by status (401/403) or message — covers "project denied access",
    // "API key not valid", and "bound service account is deleted or disabled"
    // (key tied to a disabled Google Cloud project's service account).
    const badKeyMsg =
      /api key|service account|permission|denied|disabled|deleted|suspended|not valid/i.test(msg)
    const badKey = resp.status === 401 || resp.status === 403 || badKeyMsg
    const retryable =
      resp.status === 429 ||
      resp.status === 404 ||
      resp.status === 503 ||
      badKey ||
      /not found|not supported|does not exist|quota|rate limit/i.test(msg)
    const e = httpError(msg, resp.status === 429 ? 429 : 502)
    e.retryable = retryable
    e.badKey = badKey
    throw e
  }

  // Parse here so a 200-with-garbage / empty / truncated response also
  // cascades to the next model instead of dead-ending.
  const data = await resp.json().catch(() => null)
  const cand = data?.candidates?.[0]
  const text = (cand?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('')
  if (!text) {
    const reason = data?.promptFeedback?.blockReason || cand?.finishReason
    const e = httpError(
      reason ? `Could not analyse (${reason}). Try again.` : 'Empty response from the model.',
      502
    )
    e.retryable = true
    throw e
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    const e = httpError('Got an unreadable response from the model. Try again.', 502)
    e.retryable = true
    throw e
  }
  const items = Array.isArray(parsed.items) ? parsed.items : []
  const totals = items.reduce(
    (a, it) => ({
      calories: a.calories + (Number(it.calories) || 0),
      protein_g: a.protein_g + (Number(it.protein_g) || 0),
      carbs_g: a.carbs_g + (Number(it.carbs_g) || 0),
      fat_g: a.fat_g + (Number(it.fat_g) || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  )
  return { items, confidence: parsed.confidence || 'low', totals }
}

export async function analyzeFood({ apiKey, apiKeys, model, models, imageBase64, mediaType, note }) {
  const keys = resolveKeys({ apiKey, apiKeys })
  if (keys.length === 0) {
    throw httpError(
      'The photo feature is not configured yet — GEMINI_API_KEY is missing on the server.',
      500
    )
  }
  const hasNote = !!(note && note.trim())
  if (!imageBase64 && !hasNote) {
    throw httpError('Describe the food or add a photo.', 400)
  }

  let userText
  if (imageBase64) {
    userText = hasNote
      ? `Estimate the nutrition for this meal shown in the photo.\nUser note (treat as ground truth): ${note.trim()}`
      : 'Estimate the nutrition for this meal shown in the photo.'
  } else {
    userText = `Estimate the nutrition for this meal, described as:\n${note.trim()}`
  }

  const parts = []
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } })
  }
  parts.push({ text: userText })

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.2,
      // Disable model "thinking": faster, and stops thinking tokens from
      // eating the output budget and truncating the JSON. Accepted by the
      // flash / flash-lite / gemini-3 models in the chain.
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  }

  // Quality first: the best model is tried across ALL keys before dropping to
  // the next model. Build (model, key) attempts in that order, then skip any
  // pair cooling down from a recent 429 (retryable errors cascade; a hard
  // error stops early).
  const chain = resolveModels({ models, model })
  const now = Date.now()
  const attempts = []
  for (const m of chain) {
    for (let ki = 0; ki < keys.length; ki++) attempts.push({ m, ki })
  }
  const live = attempts.filter(({ m, ki }) => !(cooldownUntil.get(ckey(m, ki)) > now))
  // Everything is cooling down → all quotas hit recently; fail fast.
  if (live.length === 0) {
    throw httpError(
      'All AI models have hit their free daily limit. Try again after the daily reset, or add the food manually / by search.',
      429
    )
  }

  let lastErr
  const deadKeys = new Set() // keys that are denied/invalid this request — skip them
  for (const { m, ki } of live) {
    if (deadKeys.has(ki)) continue
    try {
      const result = await callModel({ apiKey: keys[ki], model: m, body })
      cooldownUntil.delete(ckey(m, ki)) // it worked → clear any cooldown
      return { ...result, model: m }
    } catch (e) {
      lastErr = e
      if (e.status === 429) cooldownUntil.set(ckey(m, ki), Date.now() + COOLDOWN_MS)
      if (e.badKey) {
        // Dead key (403/invalid): skip it for every remaining model this
        // request, and rest it a while so future requests skip it too.
        deadKeys.add(ki)
        cooldownUntil.set(ckey(m, ki), Date.now() + COOLDOWN_MS)
      }
      if (e.retryable) continue
      throw e
    }
  }
  if (lastErr?.status === 429) {
    throw httpError(
      'All AI models have hit their free daily limit. Try again after the daily reset, or add the food manually / by search.',
      429
    )
  }
  throw lastErr || httpError('Analysis failed. Try again.', 502)
}
