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

// Popular movies in Argentina right now (home row).
function tmdbPopularMoviesAR(page = 1) {
  return tmdbFetch('/movie/popular', { region: 'AR', page });
}

// Upcoming theatrical releases in Argentina (home row).
function tmdbUpcomingAR(page = 1) {
  return tmdbFetch('/movie/upcoming', { region: 'AR', page });
}

// Genre-filtered movie discovery, ordered by popularity (home rows).
function tmdbDiscoverByGenre(genreId, page = 1) {
  return tmdbFetch('/discover/movie', {
    with_genres: genreId,
    sort_by: 'popularity.desc',
    page,
  });
}

// --------------------------------------------------------------- genres ----

const TMDB_GENRES_STORAGE_KEY = 'pelisme_tmdb_genres';
const TMDB_GENRES_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// In-flight promise shared by concurrent tmdbGenreList() callers so the
// two /genre/*/list requests only fire once per session.
let tmdbGenreListPromise = null;

function tmdbReadGenreCache() {
  try {
    const raw = localStorage.getItem(TMDB_GENRES_STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached || !cached.genres || typeof cached.savedAt !== 'number') return null;
    if (Date.now() - cached.savedAt > TMDB_GENRES_TTL_MS) return null;
    return cached.genres;
  } catch (err) {
    return null; // Corrupted or unavailable storage: fall through to the network.
  }
}

function tmdbWriteGenreCache(genres) {
  try {
    localStorage.setItem(
      TMDB_GENRES_STORAGE_KEY,
      JSON.stringify({ savedAt: Date.now(), genres })
    );
  } catch (err) {
    // Storage full or blocked (private mode): caching is best-effort only.
  }
}

// Merged {id: name} map of movie + tv genres with es-ES names.
// Cached in localStorage for 30 days; concurrent calls share one request.
async function tmdbGenreList() {
  const cached = tmdbReadGenreCache();
  if (cached) return cached;
  if (!tmdbGenreListPromise) {
    tmdbGenreListPromise = Promise.all([
      tmdbFetch('/genre/movie/list'),
      tmdbFetch('/genre/tv/list'),
    ]).then(([movieList, tvList]) => {
      const genres = {};
      for (const genre of (movieList.genres || [])) genres[genre.id] = genre.name;
      for (const genre of (tvList.genres || [])) genres[genre.id] = genre.name;
      tmdbWriteGenreCache(genres);
      return genres;
    }).finally(() => {
      tmdbGenreListPromise = null;
    });
  }
  return tmdbGenreListPromise;
}

// Pick the best trailer link from a details payload:
// prefers a YouTube entry of type 'Trailer', falls back to any YouTube video.
function tmdbTrailerUrl(details) {
  const videos = (details && details.videos && details.videos.results) || [];
  const youtube = videos.filter((video) => video.site === 'YouTube');
  const best = youtube.find((video) => video.type === 'Trailer') || youtube[0];
  return best ? `https://www.youtube.com/watch?v=${best.key}` : null;
}
