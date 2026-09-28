// ============================================================================
// Match engine: builds a weighted taste profile from the shared library and
// scores candidates against it. Renders affinity as "NN% Match".
//
// Depends on: js/tmdb.js (tmdbDetails, tmdbTrending, tmdbRecommendations)
//             js/supabaseClient.js (dbGet* + makeRowId)
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

// --------------------------------------------------------- taste profile ---

function matchEmptyProfile() {
  return {
    genres: {},     // genreId  -> accumulated weight
    directors: {},  // personId -> accumulated weight
    cast: {},       // personId -> accumulated weight (half weight)
    mediaTypes: {}, // 'movie' | 'tv' -> accumulated weight
    totalWeight: 0,
  };
}

function matchAccumulate(profile, details, mediaType, weight) {
  for (const genre of details.genres || []) {
    profile.genres[genre.id] = (profile.genres[genre.id] || 0) + weight;
  }

  const crew = (details.credits && details.credits.crew) || [];
  for (const person of crew) {
    if (person.job === 'Director') {
      profile.directors[person.id] = (profile.directors[person.id] || 0) + weight;
    }
  }

  const topCast = ((details.credits && details.credits.cast) || []).slice(0, 5);
  for (const person of topCast) {
    profile.cast[person.id] = (profile.cast[person.id] || 0) + weight * 0.5;
  }

  profile.mediaTypes[mediaType] = (profile.mediaTypes[mediaType] || 0) + weight;
  profile.totalWeight += weight;
}

// Build the taste profile:
//   - every Mi Top entry weighs 3
//   - every Visto with rating >= 7 weighs rating / 10
// Details come from the cache whenever possible.
async function matchBuildProfile(vistos, topFavorites) {
  const profile = matchEmptyProfile();
  const jobs = [];

  for (const row of topFavorites) {
    const tmdbId = Number(row.id.slice(row.media_type.length + 1));
    jobs.push(
      matchGetDetails(row.media_type, tmdbId)
        .then((details) => ({ details, mediaType: row.media_type, weight: 3 }))
        .catch(() => null)
    );
  }

  for (const row of vistos) {
    if (Number(row.rating) >= 7) {
      const tmdbId = Number(row.id.slice(row.media_type.length + 1));
      jobs.push(
        matchGetDetails(row.media_type, tmdbId)
          .then((details) => ({
            details,
            mediaType: row.media_type,
            weight: Number(row.rating) / 10,
          }))
          .catch(() => null)
      );
    }
  }

  const results = await Promise.all(jobs);
  for (const result of results) {
    if (result && result.details) {
      matchAccumulate(profile, result.details, result.mediaType, result.weight);
    }
  }
  return profile;
}

// ------------------------------------------------------------- scoring -----

function matchSumWeights(weightMap) {
  return Object.values(weightMap).reduce((sum, w) => sum + w, 0);
}

// Genre overlap affinity, normalized 0..1 against the whole profile.
function matchGenreAffinity(profile, genreIds) {
  const total = matchSumWeights(profile.genres);
  if (!total || !genreIds || !genreIds.length) return 0;
  let overlap = 0;
  for (const id of genreIds) overlap += profile.genres[id] || 0;
  return Math.min(1, overlap / total);
}

// People affinity (directors + top-5 cast), normalized 0..1.
function matchPeopleAffinity(profile, details) {
  const directorTotal = matchSumWeights(profile.directors);
  const castTotal = matchSumWeights(profile.cast);
  const crew = (details.credits && details.credits.crew) || [];
  const cast = ((details.credits && details.credits.cast) || []).slice(0, 5);

  let parts = 0;
  let sum = 0;

  if (directorTotal) {
    let hit = 0;
    for (const person of crew) {
      if (person.job === 'Director') hit += profile.directors[person.id] || 0;
    }
    sum += Math.min(1, hit / directorTotal);
    parts++;
  }

  if (castTotal) {
    let hit = 0;
    for (const person of cast) hit += profile.cast[person.id] || 0;
    sum += Math.min(1, hit / castTotal);
    parts++;
  }

  return parts ? sum / parts : 0;
}

// Quality multiplier from the TMDB community vote (0.5 .. 1.0).
function matchQuality(voteAverage) {
  const vote = Number(voteAverage) || 0;
  return 0.5 + 0.5 * (vote / 10);
}

// Score one candidate. With full details the formula blends genre and people
// affinity; with only list-endpoint data it falls back to genre affinity.
// Both are scaled by the quality multiplier.
function matchScore(profile, candidate, details) {
  const genreIds = details
    ? (details.genres || []).map((g) => g.id)
    : candidate.genreIds;
  const voteAverage = details ? details.vote_average : candidate.voteAverage;

  const genreAffinity = matchGenreAffinity(profile, genreIds);
  const quality = matchQuality(voteAverage);

  if (details) {
    const peopleAffinity = matchPeopleAffinity(profile, details);
    return (0.6 * genreAffinity + 0.4 * peopleAffinity) * quality;
  }
  return genreAffinity * quality;
}

function matchPercent(score) {
  return Math.round(score * 100);
}

function matchLabel(score) {
  return `${matchPercent(score)}% Match`;
}

// Score a batch of candidates, lazily fetching (cached) details for each.
// Falls back to the light formula when a details fetch fails.
// Returns [{ candidate, details, score }] sorted by score descending.
async function matchScoreWithDetails(profile, candidates) {
  const scored = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const details = await matchGetDetails(candidate.mediaType, candidate.tmdbId);
        return { candidate, details, score: matchScore(profile, candidate, details) };
      } catch (err) {
        return { candidate, details: null, score: matchScore(profile, candidate, null) };
      }
    })
  );
  return scored.sort((a, b) => b.score - a.score);
}

// Convenience: score DB rows and get back a Map of composite row id -> score.
async function matchScoreRows(profile, rows) {
  const candidates = rows.map((row) => matchNormalizeCandidate(row));
  const scored = await matchScoreWithDetails(profile, candidates);
  const byId = new Map();
  for (const entry of scored) {
    byId.set(makeRowId(entry.candidate.mediaType, entry.candidate.tmdbId), entry.score);
  }
  return byId;
}

// ------------------------------------------------------- library feeders ---

// Recomendados feed: trending + recommendations per Mi Top entry (limited to
// a few), deduped by composite id, excluding anything already in Vistos,
// scored with details and sorted by match descending.
async function matchBuildRecommendations() {
  const [vistos, topFavorites] = await Promise.all([dbGetVistos(), dbGetTopFavorites()]);
  const profile = await matchBuildProfile(vistos, topFavorites);
  const seenIds = new Set(vistos.map((row) => row.id));

  const pool = new Map(); // compositeId -> normalized candidate (dedupe)
  const addAll = (items) => {
    for (const candidate of items) {
      const key = makeRowId(candidate.mediaType, candidate.tmdbId);
      if (!pool.has(key)) pool.set(key, candidate);
    }
  };

  try {
    const trending = await tmdbTrending();
    addAll(
      (trending.results || [])
        .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
        .map((r) => matchNormalizeCandidate(r))
    );
  } catch (err) {
    // Trending failing must not kill the feed.
  }

  const favorites = topFavorites.slice(0, 3); // limit to a few
  await Promise.all(
    favorites.map(async (fav) => {
      const tmdbId = Number(fav.id.slice(fav.media_type.length + 1));
      try {
        const recs = await tmdbRecommendations(fav.media_type, tmdbId);
        addAll(
          (recs.results || []).map((r) => matchNormalizeCandidate(r, fav.media_type))
        );
      } catch (err) {
        // A single favorite failing must not kill the feed.
      }
    })
  );

  const candidates = [...pool.values()].filter(
    (c) => !seenIds.has(makeRowId(c.mediaType, c.tmdbId))
  );
  return matchScoreWithDetails(profile, candidates);
}

// "¡Sorprendeme!" roulette, sequential per spec:
//   1) watchlist titles scoring > 80% match -> pick one at random.
//   2) otherwise: recommendations of a random Mi Top entry (fallback:
//      trending), excluding anything in Vistos, pick a high-match surprise.
// Returns a scored entry { candidate, details, score } or null.
async function matchRoulette() {
  const [vistos, watchlist, topFavorites] = await Promise.all([
    dbGetVistos(),
    dbGetWatchlist(),
    dbGetTopFavorites(),
  ]);
  const profile = await matchBuildProfile(vistos, topFavorites);
  const seenIds = new Set(vistos.map((row) => row.id));

  // 1) Hidden gems already sitting in the watchlist.
  if (watchlist.length) {
    const scored = await matchScoreWithDetails(
      profile,
      watchlist.map((row) => matchNormalizeCandidate(row))
    );
    const gems = scored.filter((entry) => matchPercent(entry.score) > 80);
    if (gems.length) {
      return gems[Math.floor(Math.random() * gems.length)];
    }
  }

  // 2) Fresh surprise from a random favorite's recommendations.
  let pool = [];
  if (topFavorites.length) {
    const fav = topFavorites[Math.floor(Math.random() * topFavorites.length)];
    const tmdbId = Number(fav.id.slice(fav.media_type.length + 1));
    try {
      const recs = await tmdbRecommendations(fav.media_type, tmdbId);
      pool = (recs.results || []).map((r) => matchNormalizeCandidate(r, fav.media_type));
    } catch (err) {
      pool = [];
    }
  }
  if (!pool.length) {
    const trending = await tmdbTrending();
    pool = (trending.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => matchNormalizeCandidate(r));
  }

  const fresh = pool.filter((c) => !seenIds.has(makeRowId(c.mediaType, c.tmdbId)));
  if (!fresh.length) return null;

  const scored = await matchScoreWithDetails(profile, fresh);
  const strong = scored.filter((entry) => matchPercent(entry.score) >= 50);
  const pickFrom = strong.length ? strong : scored.slice(0, 5);
  return pickFrom[Math.floor(Math.random() * pickFrom.length)];
}
