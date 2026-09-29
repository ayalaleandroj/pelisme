// ============================================================================
// Match engine (trimmed): TMDB details cache + candidate normalizer.
// The scoring/recommendation engine was retired from the UI; only the shared
// details fetcher and the normalizer remain.
//
// Depends on: js/tmdb.js (tmdbDetails)
//             js/supabaseClient.js (makeRowId)
// ============================================================================

// ------------------------------------------------------- details caching ---

const MATCH_CACHE_PREFIX = 'pelisme_tmdb_details_';
const MATCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-flight request dedupe: cacheKey -> Promise (prevents parallel refetches
// of the same title when several cards render at once).
const matchPendingDetails = new Map();

function matchCacheKey(mediaType, tmdbId) {
  return `${MATCH_CACHE_PREFIX}${mediaType}-${tmdbId}`;
}

// Full TMDB details with a 7-day localStorage cache and in-flight dedupe.
async function matchGetDetails(mediaType, tmdbId) {
  const key = matchCacheKey(mediaType, tmdbId);

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const entry = JSON.parse(raw);
      if (entry && entry.data && Date.now() - entry.ts < MATCH_CACHE_TTL_MS) {
        return entry.data;
      }
    }
  } catch (err) {
    // Corrupted cache entry: fall through and refetch.
  }

  if (matchPendingDetails.has(key)) {
    return matchPendingDetails.get(key);
  }

  const promise = tmdbDetails(mediaType, tmdbId)
    .then((data) => {
      try {
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
      } catch (err) {
        // Storage full or unavailable: caching is best-effort.
      }
      return data;
    })
    .finally(() => matchPendingDetails.delete(key));

  matchPendingDetails.set(key, promise);
  return promise;
}

// -------------------------------------------------------- normalization ----

// Normalize any source into a common candidate shape:
//   - DB rows:        { id: 'movie-550', media_type, title, poster_path }
//   - TMDB payloads:  { id: 550, media_type?, genre_ids, vote_average, ... }
// fallbackMediaType is needed for /recommendations payloads, which carry no
// media_type of their own.
function matchNormalizeCandidate(source, fallbackMediaType) {
  if (typeof source.id === 'string' && source.media_type) {
    return {
      mediaType: source.media_type,
      tmdbId: Number(source.id.slice(source.media_type.length + 1)),
      genreIds: [],
      voteAverage: 0,
      title: source.title,
      posterPath: source.poster_path,
    };
  }
  const mediaType = source.media_type === 'tv' ? 'tv' : (fallbackMediaType || 'movie');
  return {
    mediaType,
    tmdbId: source.id,
    genreIds: source.genre_ids || [],
    voteAverage: source.vote_average || 0,
    title: source.title || source.name || '',
    posterPath: source.poster_path || '',
  };
}
