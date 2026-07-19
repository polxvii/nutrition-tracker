// Core food-photo analysis. Runs server-side only (Cloudflare Pages Function
// in prod, Vite dev middleware locally) so the Anthropic API key never reaches
// the client. Uses raw fetch — works identically in the Workers and Node
// runtimes with zero dependencies.

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
// Blueprint §2 chose Sonnet for Thai-food vision (accuracy per cost).
// Override with the ANTHROPIC_MODEL env var if desired.
const DEFAULT_MODEL = 'claude-sonnet-5'

const SYSTEM_PROMPT = `You are a nutrition estimation assistant specialising in Thai food and made-to-order (ตามสั่ง) dishes. Analyse the food photo and estimate its nutrition.

Guidelines:
- Break the meal into its distinct components (e.g. rice, protein, vegetables, sauce, fried egg, drink). One entry per component.
- Estimate each component's weight in grams. Use visible reference objects for scale: a dinner plate is ~26 cm, a Thai spoon ~15 ml, a standard rice scoop (ทัพพี) ~100 g cooked rice, a soup bowl ~350 ml.
- Account for cooking method — deep-fried and stir-fried dishes carry significant oil; Thai dishes often include sugar and coconut milk.
- If the user provides a note, treat it as ground truth and prioritise it (stated amounts, ingredients, or cooking style override your visual guess).
- Give per-component calories, protein, carbs, and fat in grams.
- Set overall confidence: "high" (clear photo, familiar dish, or a helpful note), "medium", or "low" (blurry, ambiguous, or portion hard to judge).
- Return your estimate ONLY by calling the log_food tool. Do not reply with text.`

const LOG_FOOD_TOOL = {
  name: 'log_food',
  description: 'Record the estimated nutrition breakdown of the food in the image.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        description: 'One entry per distinct food or drink component.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string', description: 'Short name of the component' },
            grams: { type: 'number', description: 'Estimated weight in grams' },
            calories: { type: 'number', description: 'kcal' },
            protein_g: { type: 'number' },
            carbs_g: { type: 'number' },
            fat_g: { type: 'number' },
          },
          required: ['name', 'grams', 'calories', 'protein_g', 'carbs_g', 'fat_g'],
        },
      },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    },
    required: ['items', 'confidence'],
  },
}

function httpError(message, status) {
  const e = new Error(message)
  e.status = status
  return e
}

export async function analyzeFood({ apiKey, model, imageBase64, mediaType, note }) {
  if (!apiKey) {
    throw httpError(
      'The photo feature is not configured yet — ANTHROPIC_API_KEY is missing on the server.',
      500
    )
  }
  if (!imageBase64) throw httpError('No image was provided.', 400)

  const userText =
    note && note.trim()
      ? `Estimate the nutrition for this meal.\nUser note (treat as ground truth): ${note.trim()}`
      : 'Estimate the nutrition for this meal. No additional note was provided.'

  const body = {
    model: model || DEFAULT_MODEL,
    max_tokens: 1024,
    thinking: { type: 'disabled' }, // fast, deterministic structured extraction
    system: SYSTEM_PROMPT,
    tools: [LOG_FOOD_TOOL],
    tool_choice: { type: 'tool', name: 'log_food' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType || 'image/jpeg',
              data: imageBase64,
            },
          },
          { type: 'text', text: userText },
        ],
      },
    ],
  }

  let resp
  try {
    resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
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
    // Don't leak auth specifics to the client.
    if (resp.status === 401 || resp.status === 403) {
      msg = 'The photo feature is misconfigured on the server (invalid API key).'
    }
    throw httpError(msg, 502)
  }

  const data = await resp.json()
  const toolUse = (data.content || []).find(
    (b) => b.type === 'tool_use' && b.name === 'log_food'
  )
  if (!toolUse?.input) {
    throw httpError('Could not read a food estimate from the image. Try another photo.', 502)
  }

  const items = Array.isArray(toolUse.input.items) ? toolUse.input.items : []
  const confidence = toolUse.input.confidence || 'low'
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
