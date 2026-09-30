// ============================================================================
// Pelisme v3.0 — AI recommendation engine with TMDB quality filter + LLM.
// Flow:
//   1. Fetch highly-rated user titles (rating >= 8) for taste profile
//   2. Fetch quality pool from TMDB (/discover with vote_average.gte=7.5)
//   3. Send both to LLM with a curated prompt
//   4. Parse JSON response with IDs + justifications
//   5. Resolve each suggestion against TMDB for full metadata
//
// Depends on: js/config.js (CONFIG), js/tmdb.js (tmdbSearchMulti, tmdbDetails),
//             js/api.js (apiGetQualityPool)
// ============================================================================

// Default model per provider; CONFIG.AI_MODEL overrides it when set.
const AI_DEFAULT_MODELS = {
  gemini: 'gemini-2.0-flash',
  openai: 'gpt-4o-mini',
};

// User-facing error messages (Spanish, Rioplatense voseo).
const AI_ERROR_NO_KEY = 'Configurá tu clave de IA en js/config.js para generar recomendaciones.';
const AI_ERROR_PROVIDER = 'La IA no respondió bien. Probá de nuevo en un ratito.';
const AI_ERROR_NO_RESULTS = 'La IA no sugirió nada que podamos encontrar en TMDB. Probá de nuevo.';
const AI_ERROR_NO_QUALITY = 'No encontré suficientes títulos de calidad en TMDB. Probá de nuevo.';

// True only when an API key exists and is not an obvious placeholder.
function aiIsConfigured() {
  const key = CONFIG.AI_API_KEY;
  if (!key || typeof key !== 'string') return false;
  const trimmed = key.trim();
  if (!trimmed) return false;
  const placeholderPrefixes = ['TU_', 'YOUR_', 'PASTE_'];
  return !placeholderPrefixes.some((prefix) => trimmed.startsWith(prefix));
}

// ------------------------------------------------------- prompt builder ---

// Build the AI prompt with user taste profile + TMDB quality candidates.
// highlyRated: array of {title, rating} for titles rated 8+.
// qualityCandidates: array of TMDB result objects from /discover.
function aiBuildPrompt({ highlyRated = [], qualityCandidates = [] } = {}) {
  const highList = highlyRated.length
    ? highlyRated.map((item) => `${item.title} (${item.rating}/10)`).join(', ')
    : '(sin títulos destacados todavía)';

  // Format quality candidates for the prompt
  const candidateList = qualityCandidates.length
    ? qualityCandidates.map((item) => {
        const title = item.title || item.name || '';
        const year = (item.release_date || item.first_air_date || '').slice(0, 4);
        const vote = (Number(item.vote_average) || 0).toFixed(1);
        const type = item.media_type === 'tv' ? 'Serie' : 'Película';
        const id = item.id;
        return `- [${id}] ${title} (${year}) - ${type} - TMDB: ${vote}`;
      }).join('\n')
    : '(sin candidatos de calidad todavía)';

  return [
    'Actuá como un curador de cine y series que conoce muy bien el gusto de esta persona.',
    '',
    `El usuario califica con nota alta a: ${highList}.`,
    '',
    'De esta lista de opciones de alta calidad de TMDB, selecciona las 5 mejores recomendaciones',
    'que hagan un match perfecto con sus gustos. Prioriza la justificación personal.',
    '',
    'Opciones de alta calidad:',
    candidateList,
    '',
    'Respondé SOLO con JSON estricto, sin texto extra, con este formato exacto:',
    '{"recommendations":[{"id":123,"title":"...","why":"..."}]}',
    '',
    'El campo "id" es el ID de TMDB de la recomendación (número entero).',
    'El campo "why" es UNA justificación de 2 líneas en español (voseo rioplatense) que explique',
    'el motivo personal de la recomendación, haciendo referencia a su gusto.',
    'NO incluyas títulos que el usuario ya calificó arriba.',
  ].join('\n');
}

// ------------------------------------------------------- provider call -----

// Raw text answer from the configured provider. Throws on HTTP/transport errors.
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

  // Default: Gemini
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

// ------------------------------------------------------- response parser ---

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
      .filter((item) => item
        && (typeof item.id === 'number' || typeof item.id === 'string')
        && typeof item.why === 'string' && item.why.trim())
      .map((item) => ({
        tmdbId: Number(item.id),
        title: typeof item.title === 'string' ? item.title.trim() : '',
        why: item.why.trim(),
      }));
  } catch (err) {
    return [];
  }
}

// ------------------------------------------------------- TMDB resolution ---

// Resolve one AI-suggested title to full TMDB metadata.
// Returns null when nothing usable comes back.
async function aiResolveTitle(tmdbId, mediaType = 'movie') {
  try {
    const details = await tmdbDetails(mediaType, tmdbId);
    return {
      mediaType,
      tmdbId: details.id,
      title: details.title || details.name || '',
      posterPath: details.poster_path || null,
    };
  } catch (err) {
    return null;
  }
}

// ------------------------------------------------------- main entry point ---

// Full flow: config check -> quality pool -> prompt -> provider -> parse -> resolve.
// profileData: { highlyRated: [{title, rating}], excludeIds: [{idTmdb, mediaType}] }
// Returns [{mediaType, tmdbId, title, posterPath, why}].
async function aiGetRecommendations(profileData = {}) {
  if (!aiIsConfigured()) {
    throw new Error(AI_ERROR_NO_KEY);
  }

  const { highlyRated = [], excludeIds = [] } = profileData;

  // Step 1: Fetch quality pool from TMDB (movies + TV)
  const [moviePool, tvPool] = await Promise.all([
    apiGetQualityPool({ mediaType: 'movie', excludeTmdbIds: excludeIds, page: 1 }),
    apiGetQualityPool({ mediaType: 'tv', excludeTmdbIds: excludeIds, page: 1 }),
  ]);

  // Combine and limit candidates for the prompt (max 30 to keep prompt manageable)
  const allCandidates = [
    ...moviePool.results.map((r) => ({ ...r, media_type: 'movie' })),
    ...tvPool.results.map((r) => ({ ...r, media_type: 'tv' })),
  ].slice(0, 30);

  if (!allCandidates.length) {
    throw new Error(AI_ERROR_NO_QUALITY);
  }

  // Step 2: Build prompt and call provider
  const prompt = aiBuildPrompt({ highlyRated, qualityCandidates: allCandidates });
  let rawText;
  try {
    rawText = await aiCallProvider(prompt);
  } catch (err) {
    throw new Error(AI_ERROR_PROVIDER);
  }

  // Step 3: Parse response
  const parsed = aiParseRecommendations(rawText);
  if (!parsed.length) {
    throw new Error(AI_ERROR_NO_RESULTS);
  }

  // Step 4: Resolve each suggestion against TMDB
  const resolved = [];
  for (const item of parsed.slice(0, 5)) {
    // Try movie first, then TV
    let hit = await aiResolveTitle(item.tmdbId, 'movie');
    if (!hit) hit = await aiResolveTitle(item.tmdbId, 'tv');
    if (hit) {
      resolved.push({ ...hit, why: item.why });
    }
  }

  if (!resolved.length) {
    throw new Error(AI_ERROR_NO_RESULTS);
  }
  return resolved;
}
