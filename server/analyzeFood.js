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
const DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-3-flash']

// Abort a single model call that runs too long, so a slow/hung model doesn't
// stall the whole request — we cascade to the next instead.
const REQUEST_TIMEOUT_MS = 20000
// After a model returns 429 (quota), skip it for a while so we stop paying a
// failed round-trip on every request. Kept in module scope → persists across
// requests within a warm isolate (best-effort; fine if the isolate recycles).
const COOLDOWN_MS = 5 * 60 * 1000
const cooldownUntil = new Map()

function resolveModels({ models, model }) {
  if (Array.isArray(models) && models.length) return models
  if (typeof models === 'string' && models.trim()) {
    return models.split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (model && model.trim()) return [model.trim()]
  return DEFAULT_MODELS
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
    // Worth cascading to the next model: rate/quota limit, a model this key
    // can't use, or a transient overload.
    const retryable =
      resp.status === 429 ||
      resp.status === 404 ||
      resp.status === 503 ||
      /not found|not supported|does not exist|quota|rate limit/i.test(msg)
    if (resp.status === 400 && /api key/i.test(msg)) {
      msg = 'The photo feature is misconfigured on the server (invalid API key).'
    }
    const e = httpError(msg, resp.status === 429 ? 429 : 502)
    e.retryable = retryable
    throw e
  }
  return resp.json()
}

export async function analyzeFood({ apiKey, model, models, imageBase64, mediaType, note }) {
  if (!apiKey) {
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
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  }

  // Try each model in turn; cascade to the next only on retryable errors
  // (rate limit / unavailable model / overload / timeout). Any other error
  // stops early. Models cooling down from a recent 429 are tried last, so a
  // known-exhausted model doesn't cost a failed round-trip on every request.
  const chain = resolveModels({ models, model })
  const now = Date.now()
  const ordered = [...chain].sort(
    (a, b) => (cooldownUntil.get(a) > now ? 1 : 0) - (cooldownUntil.get(b) > now ? 1 : 0)
  )
  let data
  let usedModel
  let lastErr
  for (const m of ordered) {
    try {
      data = await callModel({ apiKey, model: m, body })
      usedModel = m
      cooldownUntil.delete(m) // it worked → clear any cooldown
      break
    } catch (e) {
      lastErr = e
      if (e.status === 429) cooldownUntil.set(m, Date.now() + COOLDOWN_MS)
      if (e.retryable) continue
      throw e
    }
  }
  if (!data) {
    if (lastErr?.status === 429) {
      throw httpError(
        'All AI models have hit their free daily limit. Try again after the daily reset, or add the food manually / by search.',
        429
      )
    }
    throw lastErr || httpError('Analysis failed. Try again.', 502)
  }

  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('')

  if (!text) {
    const reason = data.promptFeedback?.blockReason || cand?.finishReason
    throw httpError(
      reason
        ? `Could not analyse the image (${reason}). Try another photo.`
        : 'Could not read a food estimate from the image. Try another photo.',
      502
    )
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw httpError('Got an unreadable response from the model. Try again.', 502)
  }

  const items = Array.isArray(parsed.items) ? parsed.items : []
  const confidence = parsed.confidence || 'low'
  const totals = items.reduce(
    (a, it) => ({
      calories: a.calories + (Number(it.calories) || 0),
      protein_g: a.protein_g + (Number(it.protein_g) || 0),
      carbs_g: a.carbs_g + (Number(it.carbs_g) || 0),
      fat_g: a.fat_g + (Number(it.fat_g) || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  )

  return { items, confidence, totals, model: usedModel }
}
