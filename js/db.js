// ============================================================================
// Pelisme v3.0 — Unified data layer for the user_media table.
// Replaces the old per-table CRUD (vistos/watchlist/top_favorites) with a
// single status-driven model. Ratings and comments keep their own tables but
// reference the same composite id ('movie-550', 'tv-1399').
//
// Depends on: js/config.js (CONFIG), js/supabaseClient.js (sb, makeRowId,
//              currentUsername, authSignIn, authSignOut, authGetSession,
//              authOnChange)
// ============================================================================

// ------------------------------------------------------- user_media CRUD ---

// Fetch all rows for the current user, optionally filtered by status
// and/or media_type. Returns rows ordered by updated_at DESC.
async function dbGetUserMedia({ status, mediaType } = {}) {
  let query = sb.from('user_media').select('*');
  if (status) query = query.eq('status', status);
  if (mediaType) query = query.eq('media_type', mediaType);
  query = query.order('updated_at', { ascending: false });
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

// Fetch a single row by composite id.
async function dbGetUserMediaById(id) {
  const { data, error } = await sb
    .from('user_media')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

// Insert or update a user_media row. The row must include at least:
//   { id, id_tmdb, media_type, title, poster_path, status }
// Optional fields: rating, is_top_favorite, current_season, current_episode,
//   review, tags, genre_ids, runtime.
// added_by defaults to the current user when not provided.
async function dbUpsertUserMedia(row) {
  const withAuthor = { ...row };
  if (!withAuthor.added_by) withAuthor.added_by = await currentUsername();
  const { error } = await sb.from('user_media').upsert(withAuthor);
  if (error) throw error;
}

// Ensure a title exists in user_media before rating. If it doesn't exist,
// creates a minimal row with status 'watchlist'. Returns the row.
async function dbEnsureUserMedia(rowId, details, mediaType) {
  const existing = await dbGetUserMediaById(rowId);
  if (existing) return existing;
  const row = {
    id: rowId,
    id_tmdb: details.id,
    media_type: mediaType,
    title: details.title || details.name || '',
    poster_path: details.poster_path || '',
    status: 'watchlist',
    genre_ids: (details.genres || []).map((g) => g.id),
    runtime: details.runtime || (details.episode_run_time && details.episode_run_time[0]) || null,
  };
  await dbUpsertUserMedia(row);
  return row;
}

// Update specific fields of a user_media row by id.
async function dbUpdateUserMedia(id, updates) {
  const { error } = await sb
    .from('user_media')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

// Change the status of a user_media row (watchlist/watching/completed).
// Also updates rating if provided.
async function dbChangeStatus(id, newStatus, extra = {}) {
  const updates = { status: newStatus, ...extra };
  await dbUpdateUserMedia(id, updates);
}

// Delete a user_media row completely.
async function dbDeleteUserMedia(id) {
  const { error } = await sb.from('user_media').delete().eq('id', id);
  if (error) throw error;
}

// ------------------------------------------------------- status helpers ---

// Get all rows with a specific status.
async function dbGetByStatus(status) {
  return dbGetUserMedia({ status });
}

// Get all top favorites (is_top_favorite = TRUE).
async function dbGetTopFavorites() {
  const { data, error } = await sb
    .from('user_media')
    .select('*')
    .eq('is_top_favorite', true)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Get highly-rated titles (rating >= 8) for AI recommendations.
async function dbGetHighlyRated(minRating = 8) {
  const { data, error } = await sb
    .from('user_media')
    .select('*')
    .gte('rating', minRating)
    .order('rating', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Get all titles NOT in user_media (for AI recommendations base filter).
// Returns the set of id_tmdb values already in the library.
async function dbGetLibraryTmdbIds() {
  const { data, error } = await sb
    .from('user_media')
    .select('id_tmdb, media_type');
  if (error) throw error;
  return (data || []).map((r) => ({ idTmdb: r.id_tmdb, mediaType: r.media_type }));
}

// ------------------------------------------------------- episode helpers ---

// Increment episode for a series. If the series is in watchlist, move it to watching.
async function dbIncrementEpisode(id) {
  const row = await dbGetUserMediaById(id);
  if (!row) throw new Error('Título no encontrado');
  const newEpisode = (row.current_episode || 1) + 1;
  const updates = { current_episode: newEpisode };
  // Auto-move from watchlist to watching when incrementing episodes
  if (row.status === 'watchlist') {
    updates.status = 'watching';
  }
  await dbUpdateUserMedia(id, updates);
  return { ...row, ...updates };
}

// Increment season for a series (resets episode to 1).
async function dbIncrementSeason(id) {
  const row = await dbGetUserMediaById(id);
  if (!row) throw new Error('Título no encontrado');
  const newSeason = (row.current_season || 1) + 1;
  const updates = { current_season: newSeason, current_episode: 1 };
  if (row.status === 'watchlist') {
    updates.status = 'watching';
  }
  await dbUpdateUserMedia(id, updates);
  return { ...row, ...updates };
}

// ------------------------------------------------------- ratings (v2) -----

// Both users' ratings for one title, ordered by author for stable display.
async function dbGetRatings(vistoId) {
  const { data, error } = await sb
    .from('ratings')
    .select('author, rating')
    .eq('visto_id', vistoId)
    .order('author', { ascending: true });
  if (error) throw error;
  return data || [];
}

// One rating per (title, user): re-rating overwrites the previous value.
async function dbUpsertRating(vistoId, rating) {
  const row = {
    visto_id: vistoId,
    author: await currentUsername(),
    rating,
  };
  const { error } = await sb
    .from('ratings')
    .upsert(row, { onConflict: 'visto_id,author' });
  if (error) throw error;
}

// ------------------------------------------------------- comments (v2) ----

// Comment thread for any title, oldest first.
async function dbGetComments(tmdbRef) {
  const { data, error } = await sb
    .from('comments')
    .select('*')
    .eq('tmdb_ref', tmdbRef)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function dbAddComment(tmdbRef, body) {
  const row = {
    tmdb_ref: tmdbRef,
    author: await currentUsername(),
    body,
  };
  const { error } = await sb.from('comments').insert(row);
  if (error) throw error;
}

async function dbDeleteComment(commentId) {
  const { error } = await sb.from('comments').delete().eq('id', commentId);
  if (error) throw error;
}

// ------------------------------------------------------- tags (v2) ---------

// Updates only the tags column on the given user_media row.
async function dbUpdateTags(id, tags) {
  const { error } = await sb
    .from('user_media')
    .update({ tags })
    .eq('id', id);
  if (error) throw error;
}
