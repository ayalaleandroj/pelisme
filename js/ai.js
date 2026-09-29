// ============================================================================
// AI recommendation provider layer (Gemini / OpenAI).
// Builds a taste-profile prompt, calls the configured LLM, parses the strict
// JSON answer and resolves each suggested title against TMDB.
// Depends on: js/config.js (CONFIG), js/tmdb.js (tmdbSearchMulti)
// ============================================================================

// Default model per provider; CONFIG.AI_MODEL overrides it when set.
const AI_DEFAULT_MODELS = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
};

// User-facing error messages (Spanish, Rioplatense voseo).
// Never include the API key in any error.
const AI_ERROR_NO_KEY = 'Configurá tu clave de IA en js/config.js para generar recomendaciones.';
const AI_ERROR_PROVIDER = 'La IA no respondió bien. Probá de nuevo en un ratito.';
const AI_ERROR_NO_RESULTS = 'La IA no sugirió nada que podamos encontrar en TMDB. Probá de nuevo.';

// True only when an API key exists and is not an obvious placeholder.
function aiIsConfigured() {
  const key = CONFIG.AI_API_KEY;
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  const placeholderPrefixes = ['TU_', 'YOUR_', 'PASTE_'];
  return !placeholderPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

// Spanish prompt: the model acts as a film curator and answers STRICT JSON.
// topTitles: string[] of top-favorite titles.
// vistosHigh: array of {title, rating} for highly-rated watched titles.
function aiBuildPrompt({ topTitles = [], vistosHigh = [] } = {}) {
  const topList = topTitles.length ? topTitles.join(', ') : '(sin favoritos todavía)';
  const highList = vistosHigh.length
    ? vistosHigh.map((item) => `${item.title} (${item.rating}/10)`).join(', ')
    : '(sin vistos destacados todavía)';
  return [
    'Actuá como un curador de cine y series que conoce muy bien el gusto de esta persona.',
    '',
    `Sus favoritos absolutos: ${topList}.`,
    `Títulos que ya vio y puntuó alto: ${highList}.`,
    '',
    'Recomendá EXACTAMENTE 5 títulos NUEVOS (películas o series) que NO estén en esas listas.',
    'Mezclá películas y series según lo que mejor encaje con su gusto.',
    '',
    'Respondé SOLO con JSON estricto, sin texto extra, con este formato exacto:',
    '{"recommendations":[{"title":"...","year":2000,"why":"..."}]}',
    '',
    'El campo "why" es UNA sola oración corta en español (voseo rioplatense) que explique',
    'el motivo personal de la recomendación, haciendo referencia a su gusto.',
  ].join('\n');
}

// Raw text answer from the configured provider. Throws on HTTP/transport
// errors. The API key is never logged nor included in thrown errors.
async function aiCallProvider(prompt) {
  const provider = CONFIG.AI_PROVIDER || 'gemini';
  const model = (CONFIG.AI_MODEL && CONFIG.AI_MODEL.trim()) || AI_DEFAULT_MODELS[provider];

  if (provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7,
      }),
    });
    if (!response.ok) {
      throw new Error(`AI provider request failed: ${response.status} openai`);
    }
    const data = await response.json();
    const content = data && data.choices && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content;
    if (!content) throw new Error('AI provider returned an empty answer');
    return content;
  }

  // Default: Gemini. The key travels in the query string per the API spec;
  // error messages below never echo the request URL.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(CONFIG.AI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    }),
  });
  if (!response.ok) {
    throw new Error(`AI provider request failed: ${response.status} gemini`);
  }
  const data = await response.json();
  const content = data && data.candidates && data.candidates[0]
    && data.candidates[0].content && data.candidates[0].content.parts
    && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  if (!content) throw new Error('AI provider returned an empty answer');
  return content;
}

// Defensive parse of the provider answer: strips markdown code fences,
// JSON.parses and validates the items. Returns [] on garbage; never throws.
function aiParseRecommendations(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  try {
    let text = rawText.trim();
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenceMatch) text = fenceMatch[1];
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.recommendations;
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => item && typeof item.title === 'string' && item.title.trim()
        && typeof item.why === 'string' && item.why.trim())
      .map((item) => ({ title: item.title.trim(), why: item.why.trim() }));
  } catch (err) {
    return [];
  }
}

// Resolve one AI-suggested title to its first TMDB movie/tv hit.
// Returns null when nothing usable comes back.
async function aiResolveTitle(title) {
  const data = await tmdbSearchMulti(title);
  const hit = (data.results || []).find(
    (item) => item.media_type === 'movie' || item.media_type === 'tv'
  );
  if (!hit) return null;
  return {
    mediaType: hit.media_type,
    tmdbId: hit.id,
    title: hit.title || hit.name || title,
    posterPath: hit.poster_path || null,
  };
}

// Full flow: config check -> prompt -> provider -> parse -> TMDB resolution.
// Returns [{mediaType, tmdbId, title, posterPath, why}].
// Throws an Error with a friendly Spanish message when not configured,
// when the provider call fails, or when no title could be resolved.
async function aiGetRecommendations(profileData) {
  if (!aiIsConfigured()) {
    throw new Error(AI_ERROR_NO_KEY);
  }
  const prompt = aiBuildPrompt(profileData);
  let rawText;
  try {
    rawText = await aiCallProvider(prompt);
  } catch (err) {
    throw new Error(AI_ERROR_PROVIDER);
  }
  const parsed = aiParseRecommendations(rawText);
  const resolved = [];
  for (const item of parsed) {
    try {
      const hit = await aiResolveTitle(item.title);
      if (hit) resolved.push({ ...hit, why: item.why });
    } catch (err) {
      // A single failed lookup must not kill the whole batch.
    }
  }
  if (!resolved.length) {
    throw new Error(AI_ERROR_NO_RESULTS);
  }
  return resolved;
}
