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

async function authGetSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

function authOnChange(callback) {
  return sb.auth.onAuthStateChange(callback);
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

async function dbUpsertVisto(row) {
  const { error } = await sb.from('vistos').upsert(row);
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

async function dbAddToWatchlist(row) {
  const { error } = await sb.from('watchlist').upsert(row);
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

async function dbAddToTop(row) {
  const { error } = await sb.from('top_favorites').upsert(row);
  if (error) throw error;
}

async function dbRemoveFromTop(id) {
  const { error } = await sb.from('top_favorites').delete().eq('id', id);
  if (error) throw error;
}
