// Core food-photo analysis via Google Gemini (free tier). Runs server-side
// only (Cloudflare Pages Function in prod, Vite dev middleware locally) so the
// API key never reaches the client. Raw fetch — works in Workers and Node,
// zero dependencies. Uses a personal Google AI Studio key, entirely separate
// from any corporate Claude/Anthropic plan.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
// Free-tier vision model. "gemini-flash-latest" is a Google-maintained alias
// that always points to the current flash model, so it won't break when a
// pinned version is retired for new keys. Override with the GEMINI_MODEL env
// var (e.g. "gemini-3.5-flash" for the newest explicit version).
const DEFAULT_MODEL = 'gemini-flash-latest'

const SYSTEM_PROMPT = `You are a nutrition estimation assistant specialising in Thai food and made-to-order (ตามสั่ง) dishes. Analyse the food photo and estimate its nutrition.

Guidelines:
- Break the meal into its distinct components (e.g. rice, protein, vegetables, sauce, fried egg, drink). One entry per component.
- Estimate each component's weight in grams. Use visible reference objects for scale: a dinner plate is ~26 cm, a Thai spoon ~15 ml, a standard rice scoop (ทัพพี) ~100 g cooked rice, a soup bowl ~350 ml.
- Account for cooking method — deep-fried and stir-fried dishes carry significant oil; Thai dishes often include sugar and coconut milk.
- If the user provides a note, treat it as ground truth and prioritise it (stated amounts, ingredients, or cooking style override your visual guess).
- Give per-component calories, protein, carbs, and fat in grams.
- Set overall confidence: "high" (clear photo, familiar dish, or a helpful note), "medium", or "low" (blurry, ambiguous, or portion hard to judge).
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

export async function analyzeFood({ apiKey, model, imageBase64, mediaType, note }) {
  if (!apiKey) {
    throw httpError(
      'The photo feature is not configured yet — GEMINI_API_KEY is missing on the server.',
      500
    )
  }
  if (!imageBase64) throw httpError('No image was provided.', 400)

  const userText =
    note && note.trim()
      ? `Estimate the nutrition for this meal.\nUser note (treat as ground truth): ${note.trim()}`
      : 'Estimate the nutrition for this meal. No additional note was provided.'

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: mediaType || 'image/jpeg', data: imageBase64 } },
          { text: userText },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  }

  const url = `${GEMINI_BASE}/${model || DEFAULT_MODEL}:generateContent`
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    })
  } catch {
    throw httpError('Could not reach the analysis service. Try again.', 502)
  }

  if (!resp.ok) {
    let msg = `Analysis service error (${resp.status}).`
    try {
      const j = await resp.json()
      if (j?.error?.message) msg = j.error.message
    } catch {
      /* ignore */
    }
    if (resp.status === 400 && /api key/i.test(msg)) {
      msg = 'The photo feature is misconfigured on the server (invalid API key).'
    }
    throw httpError(msg, 502)
  }

  const data = await resp.json()
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

  return { items, confidence, totals }
}
