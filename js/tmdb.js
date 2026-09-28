// ============================================================================
// TMDB API v3 client.
// Every request carries the API key and language=es-ES.
// Depends on: js/config.js (CONFIG)
// ============================================================================

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMG_BASE_URL = 'https://image.tmdb.org/t/p/';

// Image sizes used across the app, per the spec.
const TMDB_IMG_SIZES = {
  poster: 'w342',
  backdrop: 'w780',
  profile: 'w185',
};

// Build a full image URL for a TMDB file path ('/abc.jpg').
// Returns '' when TMDB gave us no image so callers can render a fallback.
function tmdbImage(path, kind = 'poster') {
  if (!path) return '';
  const size = TMDB_IMG_SIZES[kind] || TMDB_IMG_SIZES.poster;
  return `${TMDB_IMG_BASE_URL}${size}${path}`;
}

// Low-level GET helper. Throws on HTTP errors so callers can react.
async function tmdbFetch(path, params = {}) {
  const url = new URL(`${TMDB_BASE_URL}${path}`);
  url.searchParams.set('api_key', CONFIG.TMDB_API_KEY);
  url.searchParams.set('language', 'es-ES');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TMDB request failed: ${response.status} ${path}`);
  }
  return response.json();
}

// Instant-search endpoint; returns mixed movie/tv/person results.
function tmdbSearchMulti(query, page = 1) {
  return tmdbFetch('/search/multi', { query, page, include_adult: 'false' });
}

// Trending movies + series right now.
function tmdbTrending() {
  return tmdbFetch('/trending/all/day');
}

// Full title details with credits and videos inlined.
function tmdbDetails(mediaType, tmdbId) {
  return tmdbFetch(`/${mediaType}/${tmdbId}`, {
    append_to_response: 'credits,videos',
  });
}

// TMDB-native recommendations for a given title (feeds the match engine).
function tmdbRecommendations(mediaType, tmdbId) {
  return tmdbFetch(`/${mediaType}/${tmdbId}/recommendations`);
}

// Pick the best trailer link from a details payload:
// prefers a YouTube entry of type 'Trailer', falls back to any YouTube video.
function tmdbTrailerUrl(details) {
  const videos = (details && details.videos && details.videos.results) || [];
  const youtube = videos.filter((video) => video.site === 'YouTube');
  const best = youtube.find((video) => video.type === 'Trailer') || youtube[0];
  return best ? `https://www.youtube.com/watch?v=${best.key}` : null;
}
