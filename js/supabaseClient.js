// ============================================================================
// Pelisme v3.0 — Supabase auth client only.
// Data CRUD lives in js/db.js (unified user_media table).
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
