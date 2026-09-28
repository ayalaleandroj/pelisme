// ============================================================================
// Pelisme app: session restore, tab navigation, grids, detail modal and the
// "¡Sorprendeme!" roulette.
//
// Depends on globals provided by classic scripts loaded before this module:
//   js/config.js          -> CONFIG
//   js/tmdb.js            -> tmdbImage, tmdbSearchMulti, tmdbTrending,
//                            tmdbDetails, tmdbRecommendations, tmdbTrailerUrl
//   js/supabaseClient.js  -> authSignIn, authSignOut, authGetSession,
//                            authOnChange, makeRowId, dbGet*/dbUpsert*/...
//   js/match.js           -> matchBuildProfile, matchScore, matchLabel,
//                            matchScoreRows, matchNormalizeCandidate,
//                            matchBuildRecommendations, matchRoulette,
//                            matchGetDetails
// ============================================================================

// ------------------------------------------------------------ tiny helpers ---

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function showToast(message, type = 'info') {
  const root = $('#toast-root');
  const toast = document.createElement('div');
  const palette = type === 'error'
    ? 'bg-rose-600 text-white'
    : 'bg-slate-800 text-slate-100 border border-slate-700';
  toast.className = `pointer-events-auto px-4 py-2.5 rounded-xl shadow-xl text-sm font-medium ${palette}`;
  toast.textContent = message;
  root.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
    setTimeout(() => toast.remove(), 320);
  }, 3200);
}

function mediaLabel(mediaType) {
  return mediaType === 'tv' ? 'Serie' : 'Película';
}

function detailTitle(details) {
  return details.title || details.name || '';
}

function detailYear(details) {
  const date = details.release_date || details.first_air_date || '';
  return date ? date.slice(0, 4) : '';
}

// ------------------------------------------------------------------- state ---

const state = {
  session: null,
  activeTab: 'descubrir',
  vistos: null,
  watchlist: null,
  top: null,
  profile: null,
  // Invalidation flag: any library mutation dirties the taste profile and the
  // TMDB-driven tabs so they rebuild on next activation.
  profileDirty: true,
  trendingCache: null,
  recommendationsCache: null,
};

// Refresh the shared library rows from Supabase.
async function loadLibrary() {
  const [vistos, watchlist, top] = await Promise.all([
    dbGetVistos(),
    dbGetWatchlist(),
    dbGetTopFavorites(),
  ]);
  state.vistos = vistos;
  state.watchlist = watchlist;
  state.top = top;
}

async function ensureLibrary() {
  if (!state.vistos || !state.watchlist || !state.top) {
    await loadLibrary();
  }
}

// Taste profile, rebuilt only when the library changed.
async function ensureProfile() {
  await ensureLibrary();
  if (!state.profile || state.profileDirty) {
    state.profile = await matchBuildProfile(state.vistos, state.top);
    state.profileDirty = false;
  }
  return state.profile;
}

// Called after every mutation so dependent views rebuild.
function invalidateDerived() {
  state.profileDirty = true;
  state.recommendationsCache = null;
}

// ------------------------------------------------------------- skeletons ---

function renderSkeletons(container, count = 10) {
  container.innerHTML = Array.from({ length: count })
    .map(() => '<div class="skeleton aspect-[2/3] rounded-xl"></div>')
    .join('');
}

function renderEmpty(container, message) {
  container.innerHTML = `<p class="col-span-full text-center text-slate-500 py-10">${escapeHtml(message)}</p>`;
}

// ------------------------------------------------------------- poster card ---

// Shared card renderer. `badgeHtml` renders top-left, `footerHtml` bottom.
function posterCard({ mediaType, tmdbId, title, posterPath, badgeHtml = '', footerHtml = '' }) {
  const image = posterPath
    ? `<img src="${tmdbImage(posterPath, 'poster')}" alt="Póster de ${escapeHtml(title)}"
         loading="lazy" class="w-full aspect-[2/3] object-cover">`
    : `<div class="w-full aspect-[2/3] flex items-center justify-center bg-slate-800 text-slate-500 text-sm px-2 text-center">${escapeHtml(title)}</div>`;

  return `
    <article class="poster-card relative rounded-xl overflow-hidden bg-slate-900 cursor-pointer"
      data-media-type="${mediaType}" data-tmdb-id="${tmdbId}">
      ${image}
      ${badgeHtml ? `<div class="absolute top-2 left-2">${badgeHtml}</div>` : ''}
      <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2 pt-8">
        <p class="text-xs font-semibold leading-tight line-clamp-2">${escapeHtml(title)}</p>
        ${footerHtml}
      </div>
    </article>`;
}

function matchBadge(score) {
  return `<span class="rounded-md bg-rose-600/95 px-1.5 py-0.5 text-[11px] font-bold shadow">${escapeHtml(matchLabel(score))}</span>`;
}

function ratingBadge(rating) {
  return `<span class="rounded-md bg-amber-400/95 text-slate-900 px-1.5 py-0.5 text-[11px] font-bold shadow">${escapeHtml(String(rating))} ★</span>`;
}

// ============================================================== TAB LOADERS =

// ------------------------------------------------------------- Descubrir ---
async function loadDescubrir() {
  const grid = $('#trending-grid');
  if (state.trendingCache) {
    renderTrending(grid, state.trendingCache);
    return;
  }
  renderSkeletons(grid);
  try {
    const [trending, profile] = await Promise.all([tmdbTrending(), ensureProfile()]);
    const items = (trending.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => matchNormalizeCandidate(r));
    // List-level score only: genre affinity × quality, no per-card details.
    const scored = items.map((candidate) => ({
      candidate,
      score: matchScore(profile, candidate, null),
    }));
    state.trendingCache = scored;
    renderTrending(grid, scored);
  } catch (err) {
    renderEmpty(grid, 'No se pudieron cargar las tendencias.');
  }
}

function renderTrending(grid, scored) {
  if (!scored.length) {
    renderEmpty(grid, 'No hay tendencias disponibles.');
    return;
  }
  grid.innerHTML = scored
    .map(({ candidate, score }) => posterCard({
      mediaType: candidate.mediaType,
      tmdbId: candidate.tmdbId,
      title: candidate.title,
      posterPath: candidate.posterPath,
      badgeHtml: matchBadge(score),
    }))
    .join('');
}

// ---------------------------------------------------------------- Vistos ---
async function loadVistos() {
  const grid = $('#vistos-grid');
  renderSkeletons(grid);
  try {
    await ensureLibrary();
    const rows = state.vistos;
    if (!rows.length) {
      renderEmpty(grid, 'Todavía no marcaron nada como visto.');
      return;
    }
    grid.innerHTML = rows.map((row) => {
      const tmdbId = Number(row.id.slice(row.media_type.length + 1));
      const isSeries = row.media_type === 'tv';
      const progress = isSeries
        ? `<div class="mt-1 flex items-center justify-between gap-1">
             <span class="text-[11px] text-slate-300" data-episode-label="${escapeHtml(row.id)}">T${row.current_season ?? 1} · Cap ${row.current_episode ?? 1}</span>
             <button type="button" data-inc-episode="${escapeHtml(row.id)}"
               class="rounded-md bg-rose-600 hover:bg-rose-500 transition-colors px-2 py-0.5 text-[11px] font-bold">+1 Cap</button>
           </div>`
        : '';
      return posterCard({
        mediaType: row.media_type,
        tmdbId,
        title: row.title,
        posterPath: row.poster_path,
        badgeHtml: ratingBadge(row.rating),
        footerHtml: progress,
      });
    }).join('');
  } catch (err) {
    renderEmpty(grid, 'No se pudieron cargar los vistos.');
  }
}

// ------------------------------------------------------------- Watchlist ---
async function loadWatchlist() {
  const grid = $('#watchlist-grid');
  renderSkeletons(grid);
  try {
    const profile = await ensureProfile();
    const rows = state.watchlist;
    if (!rows.length) {
      renderEmpty(grid, 'La watchlist está vacía.');
      return;
    }
    // Score with details: matchScoreRows fetches (cached) TMDB details.
    const scores = await matchScoreRows(profile, rows);
    grid.innerHTML = rows.map((row) => {
      const tmdbId = Number(row.id.slice(row.media_type.length + 1));
      const score = scores.get(row.id) || 0;
      const footer = `
        <div class="mt-1">
          <button type="button" data-quick-seen="${escapeHtml(row.id)}"
            class="rounded-md bg-emerald-600 hover:bg-emerald-500 transition-colors px-2 py-0.5 text-[11px] font-bold">✓ Marcar como Vista</button>
        </div>`;
      return posterCard({
        mediaType: row.media_type,
        tmdbId,
        title: row.title,
        posterPath: row.poster_path,
        badgeHtml: `<span class="rounded-md bg-rose-600/95 px-1.5 py-0.5 text-[11px] font-bold shadow">${matchPercentLabel(score)} de Coincidencia</span>`,
        footerHtml: footer,
      });
    }).join('');
  } catch (err) {
    renderEmpty(grid, 'No se pudo cargar la watchlist.');
  }
}

function matchPercentLabel(score) {
  return `${Math.round(score * 100)}%`;
}

// ---------------------------------------------------------------- Mi Top ---
async function loadMiTop() {
  const grid = $('#mitop-grid');
  renderSkeletons(grid);
  try {
    await ensureLibrary();
    const rows = state.top;
    if (!rows.length) {
      renderEmpty(grid, 'Todavía no hay joyas en Mi Top.');
      return;
    }
    grid.innerHTML = rows.map((row) => {
      const tmdbId = Number(row.id.slice(row.media_type.length + 1));
      return posterCard({
        mediaType: row.media_type,
        tmdbId,
        title: row.title,
        posterPath: row.poster_path,
      });
    }).join('');
  } catch (err) {
    renderEmpty(grid, 'No se pudo cargar Mi Top.');
  }
}

// ---------------------------------------------------------- Recomendados ---
async function loadRecomendados() {
  const grid = $('#recomendados-grid');
  if (state.recommendationsCache) {
    renderRecomendados(grid, state.recommendationsCache);
    return;
  }
  renderSkeletons(grid, 15);
  try {
    // Feed from the match engine: trending + per-favorite recommendations,
    // deduped, excluding Vistos, sorted by match descending.
    const scored = await matchBuildRecommendations();
    state.recommendationsCache = scored;
    renderRecomendados(grid, scored);
  } catch (err) {
    renderEmpty(grid, 'No se pudieron generar recomendaciones.');
  }
}

function renderRecomendados(grid, scored) {
  if (!scored.length) {
    renderEmpty(grid, 'Sin recomendaciones por ahora. ¡Agregá títulos a Mi Top!');
    return;
  }
  grid.innerHTML = scored
    .map(({ candidate, score }) => posterCard({
      mediaType: candidate.mediaType,
      tmdbId: candidate.tmdbId,
      title: candidate.title,
      posterPath: candidate.posterPath,
      badgeHtml: matchBadge(score),
    }))
    .join('');
}

const TAB_LOADERS = {
  descubrir: loadDescubrir,
  vistos: loadVistos,
  watchlist: loadWatchlist,
  mitop: loadMiTop,
  recomendados: loadRecomendados,
};

function activateTab(tab) {
  state.activeTab = tab;
  for (const name of Object.keys(TAB_LOADERS)) {
    $(`#tab-${name}`).classList.toggle('hidden', name !== tab);
  }
  for (const btn of document.querySelectorAll('.nav-btn')) {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('text-rose-500', active);
    btn.classList.toggle('text-slate-400', !active);
  }
  TAB_LOADERS[tab]();
}

// =================================================================== MODAL ==

let modalContext = null; // { details, mediaType, opts }

function openModalShell(surprise) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div id="modal-overlay" class="modal-backdrop fixed inset-0 z-50 overflow-y-auto">
      <div class="absolute inset-0 bg-black/75" data-modal-close></div>
      <div class="modal-panel relative z-10 mx-auto my-0 sm:my-10 w-full max-w-2xl bg-slate-900 sm:rounded-2xl shadow-2xl min-h-full sm:min-h-0 overflow-hidden">
        ${surprise ? '<div class="bg-rose-600 text-center font-extrabold py-2 text-sm tracking-wide">🎲 ¡Sorprendeme!</div>' : ''}
        <button type="button" data-modal-close aria-label="Cerrar"
          class="absolute top-3 right-3 z-20 rounded-full bg-black/60 hover:bg-black/80 p-2 transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div id="modal-body"></div>
      </div>
    </div>`;
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => $('#modal-overlay').classList.add('modal-visible'));
}

function closeModal() {
  const overlay = $('#modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('modal-visible');
  document.body.classList.remove('modal-open');
  modalContext = null;
  setTimeout(() => { $('#modal-root').innerHTML = ''; }, 220);
}

function renderModalLoading() {
  $('#modal-body').innerHTML = `
    <div class="p-6 space-y-4">
      <div class="skeleton h-56 rounded-xl"></div>
      <div class="skeleton h-6 w-2/3 rounded"></div>
      <div class="skeleton h-4 w-full rounded"></div>
      <div class="skeleton h-4 w-5/6 rounded"></div>
    </div>`;
}

function renderModalError() {
  $('#modal-body').innerHTML = `
    <div class="p-10 text-center text-slate-400">No se pudo cargar la información del título.</div>`;
}

// Render the full modal content from a TMDB details payload.
function renderModalContent(details, mediaType, opts = {}) {
  const title = detailTitle(details);
  const year = detailYear(details);
  const backdropUrl = tmdbImage(details.backdrop_path, 'backdrop');
  const posterUrl = tmdbImage(details.poster_path, 'poster');
  const genres = (details.genres || []).map((g) => g.name);
  const cast = ((details.credits && details.credits.cast) || []).slice(0, 10);
  const trailerUrl = tmdbTrailerUrl(details);
  const vote = (Number(details.vote_average) || 0).toFixed(1);
  const rowId = makeRowId(mediaType, details.id);

  const inWatchlist = state.watchlist.some((row) => row.id === rowId);
  const inTop = state.top.some((row) => row.id === rowId);
  const vistoRow = state.vistos.find((row) => row.id === rowId);

  const backdropBlock = backdropUrl
    ? `<div class="relative h-48 sm:h-64">
         <img src="${backdropUrl}" alt="Imagen de ${escapeHtml(title)}" loading="lazy" class="w-full h-full object-cover">
         <div class="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/30 to-transparent"></div>
       </div>`
    : '';

  const genresBlock = genres.length
    ? `<div class="flex flex-wrap gap-1.5 mt-2">${genres.map((name) =>
        `<span class="rounded-full bg-slate-800 border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300">${escapeHtml(name)}</span>`).join('')}</div>`
    : '';

  const castBlock = cast.length
    ? `<h3 class="text-sm font-bold text-slate-300 mt-6 mb-2">Reparto principal</h3>
       <div class="flex gap-3 overflow-x-auto pb-2">
         ${cast.map((person) => `
           <div class="w-16 shrink-0 text-center">
             ${person.profile_path
               ? `<img src="${tmdbImage(person.profile_path, 'profile')}" alt="Foto de ${escapeHtml(person.name)}" loading="lazy" class="w-16 h-16 rounded-full object-cover mx-auto">`
               : `<div class="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 text-lg mx-auto">${escapeHtml((person.name || '?').slice(0, 1))}</div>`}
             <p class="text-[11px] text-slate-400 mt-1 leading-tight line-clamp-2">${escapeHtml(person.name)}</p>
           </div>`).join('')}
       </div>`
    : '';

  const trailerBlock = trailerUrl
    ? `<a href="${trailerUrl}" target="_blank" rel="noopener noreferrer"
         class="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-400 hover:text-rose-300 transition-colors">
         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4"><path d="M8 5.14v13.72c0 .8.87 1.3 1.56.88l10.5-6.86a1.04 1.04 0 000-1.76L9.56 4.26A1.04 1.04 0 008 5.14z"/></svg>
         Ver tráiler</a>`
    : '';

  const topBtn = inTop
    ? { action: 'remove-top', label: '★ Quitar de Mi Top', cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30' }
    : { action: 'add-top', label: '☆ Añadir a Mi Top', cls: 'bg-amber-500 text-slate-900 hover:bg-amber-400' };

  const watchlistBtn = inWatchlist
    ? { action: 'remove-watchlist', label: 'Quitar de Watchlist', cls: 'bg-slate-700 text-slate-200 hover:bg-slate-600' }
    : { action: 'add-watchlist', label: 'Añadir a Watchlist', cls: 'bg-slate-700 text-slate-200 hover:bg-slate-600' };

  const isSeries = mediaType === 'tv';
  const seasonEpisodeInputs = isSeries
    ? `<div class="flex gap-3">
         <div class="flex-1">
           <label class="block text-xs text-slate-400 mb-1" for="seen-season">Temporada</label>
           <input id="seen-season" type="number" min="1" step="1" value="${vistoRow ? (vistoRow.current_season ?? 1) : 1}"
             class="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600">
         </div>
         <div class="flex-1">
           <label class="block text-xs text-slate-400 mb-1" for="seen-episode">Episodio</label>
           <input id="seen-episode" type="number" min="1" step="1" value="${vistoRow ? (vistoRow.current_episode ?? 1) : 1}"
             class="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600">
         </div>
       </div>`
    : '';

  $('#modal-body').innerHTML = `
    ${backdropBlock}
    <div class="p-5 sm:p-6 ${backdropBlock ? '-mt-16 relative' : ''}">
      <div class="flex gap-4">
        ${posterUrl
          ? `<img src="${posterUrl}" alt="Póster de ${escapeHtml(title)}" loading="lazy" class="w-24 sm:w-32 rounded-lg shadow-xl shrink-0 self-start">`
          : ''}
        <div class="min-w-0">
          <h2 class="text-xl sm:text-2xl font-extrabold leading-tight">${escapeHtml(title)}</h2>
          <p class="text-sm text-slate-400 mt-1">
            ${year ? `${escapeHtml(year)} · ` : ''}${mediaLabel(mediaType)} · ★ ${vote}
          </p>
          ${genresBlock}
          <div class="mt-3">${trailerBlock}</div>
        </div>
      </div>

      <p class="text-sm text-slate-300 leading-relaxed mt-4">${escapeHtml(details.overview || 'Sin sinopsis disponible.')}</p>

      ${castBlock}

      <div class="flex flex-wrap gap-2 mt-6">
        <button type="button" data-action="${topBtn.action}"
          class="rounded-lg px-4 py-2 text-sm font-bold transition-colors ${topBtn.cls}">${topBtn.label}</button>
        <button type="button" data-action="${watchlistBtn.action}"
          class="rounded-lg px-4 py-2 text-sm font-bold transition-colors ${watchlistBtn.cls}">${watchlistBtn.label}</button>
        <button type="button" data-action="toggle-seen-form"
          class="rounded-lg px-4 py-2 text-sm font-bold bg-rose-600 hover:bg-rose-500 transition-colors">Marcar como Vista</button>
      </div>

      <form id="seen-form" class="${opts.expandRating ? '' : 'hidden'} mt-4 rounded-xl bg-slate-800/60 border border-slate-700 p-4 space-y-3">
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="seen-rating">Tu nota (1 a 10)</label>
          <input id="seen-rating" type="number" min="1" max="10" step="0.5" required
            value="${vistoRow && vistoRow.rating != null ? escapeHtml(String(vistoRow.rating)) : ''}"
            class="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
            placeholder="Ej: 8.5">
        </div>
        <div>
          <label class="block text-xs text-slate-400 mb-1" for="seen-review">Reseña (opcional)</label>
          <textarea id="seen-review" rows="3"
            class="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
            placeholder="¿Qué les pareció?">${vistoRow && vistoRow.review ? escapeHtml(vistoRow.review) : ''}</textarea>
        </div>
        ${seasonEpisodeInputs}
        <button type="submit"
          class="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 transition-colors font-bold py-2.5 text-sm">Guardar en Vistos</button>
      </form>
    </div>`;

  modalContext = { details, mediaType, opts };
}

async function openDetail(mediaType, tmdbId, opts = {}) {
  openModalShell(Boolean(opts.surprise));
  renderModalLoading();
  try {
    await ensureLibrary();
    const details = await matchGetDetails(mediaType, tmdbId);
    renderModalContent(details, mediaType, opts);
  } catch (err) {
    renderModalError();
  }
}

// ----------------------------------------------------- modal action wiring ---

function buildLibraryRow(details, mediaType) {
  return {
    id: makeRowId(mediaType, details.id),
    media_type: mediaType,
    title: detailTitle(details),
    poster_path: details.poster_path || '',
  };
}

async function refreshModalAfterMutation() {
  if (!modalContext) return;
  invalidateDerived();
  renderModalContent(modalContext.details, modalContext.mediaType, modalContext.opts);
  TAB_LOADERS[state.activeTab]();
}

async function handleModalAction(action) {
  if (!modalContext) return;
  const { details, mediaType } = modalContext;
  const row = buildLibraryRow(details, mediaType);
  try {
    if (action === 'add-top') {
      await dbAddToTop(row);
      state.top = [row, ...state.top.filter((r) => r.id !== row.id)];
      showToast('Añadido a Mi Top');
    } else if (action === 'remove-top') {
      await dbRemoveFromTop(row.id);
      state.top = state.top.filter((r) => r.id !== row.id);
      showToast('Quitado de Mi Top');
    } else if (action === 'add-watchlist') {
      await dbAddToWatchlist(row);
      state.watchlist = [row, ...state.watchlist.filter((r) => r.id !== row.id)];
      showToast('Añadido a la Watchlist');
    } else if (action === 'remove-watchlist') {
      await dbRemoveFromWatchlist(row.id);
      state.watchlist = state.watchlist.filter((r) => r.id !== row.id);
      showToast('Quitado de la Watchlist');
    } else if (action === 'toggle-seen-form') {
      $('#seen-form').classList.toggle('hidden');
      return;
    }
    await refreshModalAfterMutation();
  } catch (err) {
    showToast('No se pudo guardar el cambio.', 'error');
  }
}

async function handleSeenSubmit(event) {
  event.preventDefault();
  if (!modalContext) return;
  const { details, mediaType } = modalContext;
  const rating = Number($('#seen-rating').value);
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    showToast('La nota tiene que estar entre 1 y 10.', 'error');
    return;
  }

  const row = {
    ...buildLibraryRow(details, mediaType),
    rating,
    review: $('#seen-review').value.trim() || null,
  };
  if (mediaType === 'tv') {
    row.current_season = Math.max(1, parseInt($('#seen-season').value, 10) || 1);
    row.current_episode = Math.max(1, parseInt($('#seen-episode').value, 10) || 1);
  }

  try {
    await dbUpsertVisto(row);
    state.vistos = [row, ...state.vistos.filter((r) => r.id !== row.id)];
    // A watched title no longer belongs in the watchlist.
    if (state.watchlist.some((r) => r.id === row.id)) {
      await dbRemoveFromWatchlist(row.id);
      state.watchlist = state.watchlist.filter((r) => r.id !== row.id);
    }
    showToast('¡Guardado en Vistos!');
    closeModal();
    invalidateDerived();
    TAB_LOADERS[state.activeTab]();
  } catch (err) {
    showToast('No se pudo guardar en Vistos.', 'error');
  }
}

// ================================================================== SEARCH ==

const SEARCH_DEBOUNCE_MS = 300;
let searchTimer = null;

function hideSearchDropdown() {
  const dropdown = $('#search-dropdown');
  dropdown.classList.add('hidden');
  dropdown.classList.remove('dropdown-visible');
}

async function runSearch(query) {
  const dropdown = $('#search-dropdown');
  try {
    const payload = await tmdbSearchMulti(query);
    const results = (payload.results || [])
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .slice(0, 8);

    if (!results.length) {
      dropdown.innerHTML = '<p class="px-4 py-3 text-sm text-slate-500">Sin resultados.</p>';
    } else {
      dropdown.innerHTML = results.map((item) => {
        const title = item.title || item.name || '';
        const date = item.release_date || item.first_air_date || '';
        const year = date ? date.slice(0, 4) : '';
        const poster = item.poster_path
          ? `<img src="${tmdbImage(item.poster_path, 'poster')}" alt="Póster de ${escapeHtml(title)}" loading="lazy" class="w-10 h-14 rounded object-cover shrink-0">`
          : '<div class="w-10 h-14 rounded bg-slate-800 shrink-0"></div>';
        return `
          <button type="button" class="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-800 transition-colors text-left"
            data-media-type="${item.media_type}" data-tmdb-id="${item.id}">
            ${poster}
            <div class="min-w-0">
              <p class="text-sm font-semibold truncate">${escapeHtml(title)}</p>
              <p class="text-xs text-slate-400">${year ? `${escapeHtml(year)} · ` : ''}${mediaLabel(item.media_type)}</p>
            </div>
          </button>`;
      }).join('');
    }

    dropdown.classList.remove('hidden');
    requestAnimationFrame(() => dropdown.classList.add('dropdown-visible'));
  } catch (err) {
    dropdown.innerHTML = '<p class="px-4 py-3 text-sm text-slate-500">Error al buscar. Probá de nuevo.</p>';
    dropdown.classList.remove('hidden');
  }
}

function bindSearch() {
  const input = $('#search-input');
  const dropdown = $('#search-dropdown');

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = input.value.trim();
    if (query.length < 2) {
      hideSearchDropdown();
      return;
    }
    searchTimer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
  });

  dropdown.addEventListener('click', (event) => {
    const item = event.target.closest('[data-tmdb-id]');
    if (!item) return;
    hideSearchDropdown();
    input.value = '';
    openDetail(item.dataset.mediaType, Number(item.dataset.tmdbId));
  });

  document.addEventListener('click', (event) => {
    if (!$('#search-wrapper').contains(event.target)) {
      hideSearchDropdown();
    }
  });
}

// ============================================================ QUICK ACTIONS =

// Optimistic "+1 Cap": bump the episode locally, persist, roll back on error.
async function handleIncrementEpisode(rowId, button) {
  const row = state.vistos.find((r) => r.id === rowId);
  if (!row) return;
  const previous = Number(row.current_episode) || 1;
  row.current_episode = previous + 1;

  const label = document.querySelector(`[data-episode-label="${CSS.escape(rowId)}"]`);
  if (label) label.textContent = `T${row.current_season ?? 1} · Cap ${row.current_episode}`;
  button.disabled = true;

  try {
    await dbUpdateEpisode(rowId, row.current_episode);
  } catch (err) {
    row.current_episode = previous;
    if (label) label.textContent = `T${row.current_season ?? 1} · Cap ${previous}`;
    showToast('No se pudo actualizar el capítulo.', 'error');
  } finally {
    button.disabled = false;
  }
}

function bindGridActions() {
  const grids = ['#trending-grid', '#vistos-grid', '#watchlist-grid', '#mitop-grid', '#recomendados-grid'];

  for (const selector of grids) {
    $(selector).addEventListener('click', (event) => {
      const incButton = event.target.closest('[data-inc-episode]');
      if (incButton) {
        event.stopPropagation();
        handleIncrementEpisode(incButton.dataset.incEpisode, incButton);
        return;
      }

      const quickSeen = event.target.closest('[data-quick-seen]');
      if (quickSeen) {
        event.stopPropagation();
        const card = quickSeen.closest('[data-tmdb-id]');
        openDetail(card.dataset.mediaType, Number(card.dataset.tmdbId), { expandRating: true });
        return;
      }

      const card = event.target.closest('[data-tmdb-id]');
      if (card) {
        openDetail(card.dataset.mediaType, Number(card.dataset.tmdbId));
      }
    });
  }
}

// ================================================================ ROULETTE ==

async function handleRoulette() {
  const fab = $('#roulette-fab');
  fab.disabled = true;
  const original = fab.textContent;
  fab.textContent = '🎲 Buscando...';
  try {
    // Two-step roulette lives in match.js: watchlist gems > 80% first, then a
    // random Mi Top recommendation pool (fallback: trending), excluding Vistos.
    const pick = await matchRoulette();
    if (!pick) {
      showToast('No encontré ninguna sorpresa nueva.', 'error');
      return;
    }
    openDetail(pick.candidate.mediaType, pick.candidate.tmdbId, {
      surprise: true,
      score: pick.score,
    });
  } catch (err) {
    showToast('La ruleta falló. Probá de nuevo.', 'error');
  } finally {
    fab.disabled = false;
    fab.textContent = original;
  }
}

// ==================================================================== AUTH ==

function showLogin() {
  $('#app-shell').classList.add('hidden');
  $('#login-view').classList.remove('hidden');
  state.session = null;
}

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  activateTab('descubrir');
}

function bindAuth() {
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = $('#login-error');
    const submit = $('#login-submit');
    errorBox.classList.add('hidden');
    submit.disabled = true;
    submit.textContent = 'Entrando...';
    try {
      const { error } = await authSignIn($('#login-username').value, $('#login-password').value);
      if (error) throw error;
      const session = await authGetSession();
      state.session = session;
      showApp();
    } catch (err) {
      errorBox.textContent = 'Usuario o contraseña incorrectos.';
      errorBox.classList.remove('hidden');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Entrar';
    }
  });

  $('#signout-btn').addEventListener('click', async () => {
    try {
      await authSignOut();
    } finally {
      showLogin();
    }
  });

  authOnChange((eventName) => {
    if (eventName === 'SIGNED_OUT') showLogin();
  });
}

// ==================================================================== MISC ==

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support is best-effort; never block the app on it.
    });
  }
}

function bindNavigation() {
  for (const btn of document.querySelectorAll('.nav-btn')) {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  }
}

function bindModal() {
  $('#modal-root').addEventListener('click', (event) => {
    if (event.target.closest('[data-modal-close]')) {
      closeModal();
      return;
    }
    const actionBtn = event.target.closest('[data-action]');
    if (actionBtn) {
      handleModalAction(actionBtn.dataset.action);
    }
  });

  $('#modal-root').addEventListener('submit', (event) => {
    if (event.target.id === 'seen-form') {
      handleSeenSubmit(event);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
  });
}

// ==================================================================== INIT ==

async function init() {
  registerServiceWorker();
  bindAuth();
  bindNavigation();
  bindSearch();
  bindGridActions();
  bindModal();
  $('#roulette-fab').addEventListener('click', handleRoulette);

  // Session restore on load: no session -> login view only.
  try {
    state.session = await authGetSession();
  } catch (err) {
    state.session = null;
  }

  if (state.session) {
    showApp();
  } else {
    showLogin();
  }
}

init();
