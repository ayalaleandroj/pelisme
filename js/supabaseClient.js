// ============================================================================
// Supabase client: auth (shared 2-user login) + CRUD for the three tables.
// Depends on: js/config.js (CONFIG) and the @supabase/supabase-js@2 UMD
// bundle, which exposes the global `supabase`.
// ============================================================================

const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

// Composite row id shared by every table: '<media_type>-<tmdb_id>'
// (e.g. 'movie-550', 'tv-1399').
function makeRowId(mediaType, tmdbId) {
  return `${mediaType}-${tmdbId}`;
}

// ------------------------------------------------------------------ auth ---

// The ultra-simple login maps a plain username to a synthetic email.
function usernameToEmail(username) {
  return `${String(username).trim().toLowerCase()}@pelisme.app`;
}

function authSignIn(username, password) {
  return sb.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
}

function authSignOut() {
  return sb.auth.signOut();
}

// Session cached after the first authGetSession() call so currentUsername()
// and friends don't hit the auth API on every write.
let cachedSession = null;

async function authGetSession() {
  const { data } = await sb.auth.getSession();
  cachedSession = data.session;
  return data.session;
}

function authOnChange(callback) {
  return sb.auth.onAuthStateChange(callback);
}

// Username of the logged-in user, derived from the email prefix before '@'.
// Falls back to 'alguien' when there is no session.
async function currentUsername() {
  const session = cachedSession || await authGetSession();
  const email = session && session.user && session.user.email;
  if (!email) return 'alguien';
  const prefix = email.split('@')[0];
  return prefix || 'alguien';
}

// ---------------------------------------------------------------- vistos ---

async function dbGetVistos() {
  const { data, error } = await sb
    .from('vistos')
    .select('*')
    .order('watched_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Rows may carry the v2 fields (tags, genre_ids, runtime); they pass through
// untouched. added_by defaults to the current user when not provided.
async function dbUpsertVisto(row) {
  const withAuthor = { ...row };
  if (!withAuthor.added_by) withAuthor.added_by = await currentUsername();
  const { error } = await sb.from('vistos').upsert(withAuthor);
  if (error) throw error;
}

// Used by the optimistic "+1 Cap" quick action on series cards.
async function dbUpdateEpisode(id, currentEpisode) {
  const { error } = await sb
    .from('vistos')
    .update({ current_episode: currentEpisode })
    .eq('id', id);
  if (error) throw error;
}

async function dbDeleteVisto(id) {
  const { error } = await sb.from('vistos').delete().eq('id', id);
  if (error) throw error;
}

// ------------------------------------------------------------- watchlist ---

async function dbGetWatchlist() {
  const { data, error } = await sb
    .from('watchlist')
    .select('*')
    .order('added_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Rows may carry the v2 fields (tags, genre_ids, runtime); they pass through
// untouched. added_by defaults to the current user when not provided.
async function dbAddToWatchlist(row) {
  const withAuthor = { ...row };
  if (!withAuthor.added_by) withAuthor.added_by = await currentUsername();
  const { error } = await sb.from('watchlist').upsert(withAuthor);
  if (error) throw error;
}

async function dbRemoveFromWatchlist(id) {
  const { error } = await sb.from('watchlist').delete().eq('id', id);
  if (error) throw error;
}

// ------------------------------------------------------------ favorites ---

async function dbGetTopFavorites() {
  const { data, error } = await sb
    .from('top_favorites')
    .select('*')
    .order('added_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// added_by defaults to the current user when the row doesn't provide it.
async function dbAddToTop(row) {
  const withAuthor = { ...row };
  if (!withAuthor.added_by) withAuthor.added_by = await currentUsername();
  const { error } = await sb.from('top_favorites').upsert(withAuthor);
  if (error) throw error;
}

async function dbRemoveFromTop(id) {
  const { error } = await sb.from('top_favorites').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------- ratings ---

// Both users' ratings for one visto, ordered by author for stable display.
async function dbGetRatings(vistoId) {
  const { data, error } = await sb
    .from('ratings')
    .select('author, rating')
    .eq('visto_id', vistoId)
    .order('author', { ascending: true });
  if (error) throw error;
  return data || [];
}

// One rating per (visto, user): re-rating overwrites the previous value.
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

// --------------------------------------------------------------- comments ---

// Comment thread for any title, oldest first. tmdbRef uses the composite
// id convention ('movie-550', 'tv-1399').
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

// ------------------------------------------------------------------- tags ---

// Updates only the tags column on the given row. The table name is
// whitelisted because it can't be parameterized by the query builder.
async function dbUpdateTags(table, id, tags) {
  if (table !== 'vistos' && table !== 'watchlist') {
    throw new Error(`dbUpdateTags: unsupported table "${table}"`);
  }
  const { error } = await sb.from(table).update({ tags }).eq('id', id);
  if (error) throw error;
}
