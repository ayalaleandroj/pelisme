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

// ------------------------------------------------------- match engine ----

// Build genre frequency vector from user_media rows.
function buildGenreVector(rows) {
  const vector = {};
  for (const row of rows) {
    for (const gid of (row.genre_ids || [])) {
      vector[gid] = (vector[gid] || 0) + 1;
    }
  }
  return vector;
}

// Cosine similarity between two genre vectors.
function cosineSimilarity(vecA, vecB) {
  const keys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
  let dot = 0, magA = 0, magB = 0;
  for (const k of keys) {
    const a = vecA[k] || 0;
    const b = vecB[k] || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Calculate match percentage between the two app users.
// Returns { percentage, sharedGenres, userA, userB }.
async function matchCalculateCompatibility() {
  const allRows = await dbGetUserMedia();
  // Split by author (first user vs everyone else)
  const userAName = allRows.length > 0 ? allRows[0].added_by : null;
  const userARows = allRows.filter((r) => r.added_by === userAName);
  const userBRows = allRows.filter((r) => r.added_by !== userAName);
  const vecA = buildGenreVector(userARows);
  const vecB = buildGenreVector(userBRows);
  const similarity = cosineSimilarity(vecA, vecB);
  // Shared genre IDs
  const sharedGenreIds = Object.keys(vecA).filter((k) => vecB[k]);
  // Average rating per user
  const avgA = userARows.length
    ? userARows.reduce((s, r) => s + (r.rating || 0), 0) / userARows.length
    : 0;
  const avgB = userBRows.length
    ? userBRows.reduce((s, r) => s + (r.rating || 0), 0) / userBRows.length
    : 0;
  // Rating factor: penalize if users rate very differently
  let ratingFactor = 1;
  if (avgA > 0 && avgB > 0) {
    const diff = Math.abs(avgA - avgB);
    ratingFactor = Math.max(0.5, 1 - diff / 10);
  }
  const percentage = Math.round(similarity * ratingFactor * 100);
  return {
    percentage: Math.min(100, Math.max(0, percentage)),
    sharedGenres: sharedGenreIds,
    userA: { count: userARows.length, avgRating: avgA.toFixed(1) },
    userB: { count: userBRows.length, avgRating: avgB.toFixed(1) },
  };
}

// Get top match titles (shared genres + high rating).
async function matchGetTopMatches(limit = 10) {
  const allRows = await dbGetUserMedia();
  const compat = await matchCalculateCompatibility();
  const scored = allRows.map((row) => {
    const shared = (row.genre_ids || []).filter((g) => compat.sharedGenres.includes(String(g)));
    return { ...row, matchScore: shared.length };
  });
  return scored
    .filter((r) => r.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}
