// ============================================================================
// Pelisme app: session restore, tab navigation, grids, detail modal, AI recs,
// dual ratings, comments, tags, stats and the "¡Sorprendeme!" roulette.
//
// Depends on globals provided by classic scripts loaded before this module:
//   js/config.js          -> CONFIG
//   js/tmdb.js            -> tmdbImage, tmdbSearchMulti, tmdbTrending,
//                            tmdbDetails, tmdbRecommendations, tmdbTrailerUrl,
//                            tmdbPopularMoviesAR, tmdbUpcomingAR,
//                            tmdbDiscoverByGenre, tmdbGenreList
//   js/supabaseClient.js  -> authSignIn, authSignOut, authGetSession,
//                            authOnChange, makeRowId, dbGet*/dbUpsert*/...
//   js/ai.js              -> aiGetRecommendations
//   js/match.js           -> matchGetDetails, matchNormalizeCandidate
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
  homeRows: null,
  aiRecommendations: null,
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

// ------------------------------------------------------------- skeletons ---

function renderSkeletons(container, count = 10) {
  container.innerHTML = Array.from({ length: count })
    .map(() => '<div class="skeleton aspect-[2/3] rounded-xl"></div>')
    .join('');
}

function renderRowSkeletons(container) {
  container.innerHTML = Array.from({ length: 8 })
    .map(() => '<div class="skeleton aspect-[2/3] rounded-xl shrink-0" style="width:9rem"></div>')
    .join('');
}

function renderEmpty(container, message) {
  container.innerHTML = `<p class="col-span-full text-center text-slate-500 py-10">${escapeHtml(message)}</p>`;
}

// ------------------------------------------------------------- poster card ---

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

function ratingBadge(rating) {
  return `<span class="rounded-md bg-amber-400/95 text-slate-900 px-1.5 py-0.5 text-[11px] font-bold shadow">${escapeHtml(String(rating))} ★</span>`;
}

// ============================================================== TAB LOADERS =

// ------------------------------------------------------------- Descubrir ---

const HOME_ROWS = [
  { id: 'tendencias', fetcher: () => tmdbTrending() },
  { id: 'populares-ar', fetcher: () => tmdbPopularMoviesAR() },
  { id: 'proximos-estrenos', fetcher: () => tmdbUpcomingAR() },
  { id: 'accion', fetcher: () => tmdbDiscoverByGenre(28) },
  { id: 'comedias', fetcher: () => tmdbDiscoverByGenre(35) },
];

async function loadDescubrir() {
  if (state.homeRows) {
    renderHomeRows(state.homeRows);
    return;
  }
  for (const row of HOME_ROWS) {
    renderRowSkeletons($(`#row-${row.id}`));
  }
  const results = await Promise.all(HOME_ROWS.map(async (row) => {
    try {
      const data = await row.fetcher();
      const items = (data.results || [])
        .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
        .map((r) => matchNormalizeCandidate(r));
      return { id: row.id, items };
    } catch (err) {
      return { id: row.id, items: [] };
    }
  }));
  state.homeRows = results;
  renderHomeRows(results);
}

function renderHomeRows(rows) {
  for (const row of rows) {
    const container = $(`#row-${row.id}`);
    if (!row.items.length) {
      container.innerHTML = '<p class="text-sm text-slate-500 py-2">No hay títulos disponibles.</p>';
      continue;
    }
    container.innerHTML = row.items.map((item) => posterCard({
      mediaType: item.mediaType,
      tmdbId: item.tmdbId,
      title: item.title,
      posterPath: item.posterPath,
    })).join('');
  }
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
    await ensureLibrary();
    const rows = state.watchlist;
    if (!rows.length) {
      renderEmpty(grid, 'La watchlist está vacía.');
      return;
    }
    grid.innerHTML = rows.map((row) => {
      const tmdbId = Number(row.id.slice(row.media_type.length + 1));
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
        footerHtml: footer,
      });
    }).join('');
  } catch (err) {
    renderEmpty(grid, 'No se pudo cargar la watchlist.');
  }
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
  if (state.aiRecommendations) {
    renderRecomendados(grid, state.aiRecommendations);
    return;
  }
  renderEmpty(grid, 'Tocá "Generar Recomendaciones con IA" para obtener sugerencias personalizadas.');
}

function renderRecomendados(grid, recs) {
  if (!recs.length) {
    renderEmpty(grid, 'No se pudieron generar recomendaciones.');
    return;
  }
  grid.innerHTML = recs.map((rec) => {
    const image = rec.posterPath
      ? `<img src="${tmdbImage(rec.posterPath, 'poster')}" alt="Póster de ${escapeHtml(rec.title)}" loading="lazy" class="w-full aspect-[2/3] object-cover">`
      : `<div class="w-full aspect-[2/3] flex items-center justify-center bg-slate-800 text-slate-500 text-sm px-2 text-center">${escapeHtml(rec.title)}</div>`;
    return `
      <article class="ai-card cursor-pointer" data-media-type="${rec.mediaType}" data-tmdb-id="${rec.tmdbId}">
        ${image}
        <div class="p-3">
          <p class="text-xs font-semibold leading-tight line-clamp-2 mb-1">${escapeHtml(rec.title)}</p>
          <p class="text-[11px] text-slate-400 leading-snug line-clamp-3">${escapeHtml(rec.why)}</p>
        </div>
      </article>`;
  }).join('');
}

async function handleGenerateAI() {
  const btn = $('#ai-generate-btn');
  const grid = $('#recomendados-grid');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = 'Generando...';
  grid.innerHTML = '<div class="skeleton col-span-full h-40 rounded-xl"></div>';
  try {
    await ensureLibrary();
    const topTitles = state.top.map((row) => row.title);
    const vistosHigh = state.vistos
      .filter((row) => Number(row.rating) > 8)
      .map((row) => ({ title: row.title, rating: Number(row.rating) }));
    const recs = await aiGetRecommendations({ topTitles, vistosHigh });
    state.aiRecommendations = recs;
    renderRecomendados(grid, recs);
  } catch (err) {
    const message = err && err.message ? err.message : 'No se pudieron generar recomendaciones.';
    grid.innerHTML = `<p class="col-span-full text-center text-rose-400 py-10">${escapeHtml(message)}</p>`;
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
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

  // Ratings section (only for vistos)
  const ratingsBlock = vistoRow ? `
    <div class="mt-4 rounded-xl bg-slate-800/60 border border-slate-700 p-4">
      <h3 class="text-sm font-bold text-slate-300 mb-2">Nuestras notas</h3>
      <div id="ratings-list" class="flex flex-wrap gap-2 mb-3"></div>
      <div class="flex gap-2">
        <input id="rating-input" type="number" min="1" max="10" step="0.5"
          class="w-24 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
          placeholder="1-10">
        <button type="button" data-action="submit-rating"
          class="rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 transition-colors px-4 py-2 text-sm font-bold">Puntuar</button>
      </div>
    </div>` : '';

  // Comments section (any title)
  const commentsBlock = `
    <div class="mt-4 rounded-xl bg-slate-800/60 border border-slate-700 p-4">
      <h3 class="text-sm font-bold text-slate-300 mb-2">Comentarios</h3>
      <div id="comments-list" class="space-y-2 mb-3 max-h-48 overflow-y-auto"></div>
      <div class="flex gap-2">
        <input id="comment-input" type="text"
          class="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
          placeholder="Escribí un comentario...">
        <button type="button" data-action="submit-comment"
          class="rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors px-4 py-2 text-sm font-bold">Enviar</button>
      </div>
    </div>`;

  // Tags section (vistos and watchlist)
  const tagsBlock = (vistoRow || inWatchlist) ? `
    <div class="mt-4 rounded-xl bg-slate-800/60 border border-slate-700 p-4">
      <h3 class="text-sm font-bold text-slate-300 mb-2">Etiquetas</h3>
      <div id="tags-list" class="flex flex-wrap gap-1.5 mb-3"></div>
      <div class="flex gap-2">
        <input id="tag-input" type="text"
          class="flex-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600"
          placeholder="Nueva etiqueta...">
        <button type="button" data-action="add-tag"
          class="rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors px-4 py-2 text-sm font-bold">Añadir</button>
      </div>
    </div>` : '';

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

      ${ratingsBlock}
      ${commentsBlock}
      ${tagsBlock}

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
    const rowId = makeRowId(mediaType, details.id);
    loadModalExtras(rowId, mediaType, details.id);
  } catch (err) {
    renderModalError();
  }
}

// Load ratings, comments and tags asynchronously after the modal renders.
async function loadModalExtras(rowId, mediaType, tmdbId) {
  // Comments for any title
  try {
    const comments = await dbGetComments(rowId);
    renderComments(comments);
  } catch (err) {
    // Non-critical: comments are best-effort
  }

  // Ratings (only for vistos)
  const vistoRow = state.vistos.find((r) => r.id === rowId);
  if (vistoRow) {
    try {
      const ratings = await dbGetRatings(rowId);
      renderRatings(ratings);
    } catch (err) {
      // Non-critical
    }
  }

  // Tags (vistos and watchlist)
  const inWatchlist = state.watchlist.some((r) => r.id === rowId);
  if (vistoRow || inWatchlist) {
    const table = vistoRow ? 'vistos' : 'watchlist';
    const row = vistoRow || state.watchlist.find((r) => r.id === rowId);
    renderTags(row.tags || []);
  }
}

function renderRatings(ratings) {
  const container = $('#ratings-list');
  if (!container) return;
  if (!ratings.length) {
    container.innerHTML = '<p class="text-xs text-slate-500">Todavía no hay notas.</p>';
    return;
  }
  container.innerHTML = ratings.map((r) => `
    <span class="rounded-md bg-amber-400/95 text-slate-900 px-2 py-0.5 text-xs font-bold shadow">
      ${escapeHtml(r.author)}: ${escapeHtml(String(r.rating))} ★
    </span>`).join('');
}

function renderComments(comments) {
  const container = $('#comments-list');
  if (!container) return;
  if (!comments.length) {
    container.innerHTML = '<p class="text-xs text-slate-500">Todavía no hay comentarios.</p>';
    return;
  }
  container.innerHTML = comments.map((c) => `
    <div class="comment-bubble">
      <p class="text-xs font-bold text-rose-400">${escapeHtml(c.author)}</p>
      <p class="text-sm text-slate-200 mt-0.5">${escapeHtml(c.body)}</p>
    </div>`).join('');
}

function renderTags(tags) {
  const container = $('#tags-list');
  if (!container) return;
  if (!tags.length) {
    container.innerHTML = '<p class="text-xs text-slate-500">Sin etiquetas.</p>';
    return;
  }
  container.innerHTML = tags.map((tag, i) => `
    <span class="chip">
      ${escapeHtml(tag)}
      <button type="button" data-action="remove-tag" data-tag-index="${i}"
        class="text-slate-400 hover:text-rose-400 font-bold ml-0.5">&times;</button>
    </span>`).join('');
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
  renderModalContent(modalContext.details, modalContext.mediaType, modalContext.opts);
  TAB_LOADERS[state.activeTab]();
}

async function handleModalAction(action, event) {
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
    } else if (action === 'submit-rating') {
      await handleSubmitRating();
      return;
    } else if (action === 'submit-comment') {
      await handleSubmitComment();
      return;
    } else if (action === 'add-tag') {
      await handleAddTag();
      return;
    } else if (action === 'remove-tag') {
      const btn = event.target.closest('[data-action="remove-tag"]');
      await handleRemoveTag(btn);
      return;
    }
    await refreshModalAfterMutation();
  } catch (err) {
    showToast('No se pudo guardar el cambio.', 'error');
  }
}

async function handleSubmitRating() {
  if (!modalContext) return;
  const input = $('#rating-input');
  const rating = Number(input.value);
  if (!Number.isFinite(rating) || rating < 1 || rating > 10) {
    showToast('La nota tiene que estar entre 1 y 10.', 'error');
    return;
  }
  const rowId = makeRowId(modalContext.mediaType, modalContext.details.id);
  await dbUpsertRating(rowId, rating);
  showToast('¡Nota guardada!');
  const ratings = await dbGetRatings(rowId);
  renderRatings(ratings);
}

async function handleSubmitComment() {
  if (!modalContext) return;
  const input = $('#comment-input');
  const body = input.value.trim();
  if (!body) return;
  const rowId = makeRowId(modalContext.mediaType, modalContext.details.id);
  await dbAddComment(rowId, body);
  input.value = '';
  showToast('Comentario añadido');
  const comments = await dbGetComments(rowId);
  renderComments(comments);
}

async function handleAddTag() {
  if (!modalContext) return;
  const input = $('#tag-input');
  const tag = input.value.trim();
  if (!tag) return;
  const rowId = makeRowId(modalContext.mediaType, modalContext.details.id);
  const vistoRow = state.vistos.find((r) => r.id === rowId);
  const inWatchlist = state.watchlist.some((r) => r.id === rowId);
  const table = vistoRow ? 'vistos' : 'watchlist';
  const row = vistoRow || state.watchlist.find((r) => r.id === rowId);
  const tags = row.tags || [];
  if (!tags.includes(tag)) {
    tags.push(tag);
    await dbUpdateTags(table, rowId, tags);
    row.tags = tags;
  }
  input.value = '';
  renderTags(tags);
}

async function handleRemoveTag(btn) {
  if (!modalContext) return;
  if (!btn) return;
  const index = Number(btn.dataset.tagIndex);
  const rowId = makeRowId(modalContext.mediaType, modalContext.details.id);
  const vistoRow = state.vistos.find((r) => r.id === rowId);
  const inWatchlist = state.watchlist.some((r) => r.id === rowId);
  const table = vistoRow ? 'vistos' : 'watchlist';
  const row = vistoRow || state.watchlist.find((r) => r.id === rowId);
  const tags = row.tags || [];
  tags.splice(index, 1);
  await dbUpdateTags(table, rowId, tags);
  row.tags = tags;
  renderTags(tags);
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
    if (state.watchlist.some((r) => r.id === row.id)) {
      await dbRemoveFromWatchlist(row.id);
      state.watchlist = state.watchlist.filter((r) => r.id !== row.id);
    }
    showToast('¡Guardado en Vistos!');
    closeModal();
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
  const grids = [
    '#row-tendencias', '#row-populares-ar', '#row-proximos-estrenos',
    '#row-accion', '#row-comedias',
    '#vistos-grid', '#watchlist-grid', '#mitop-grid', '#recomendados-grid',
  ];

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
    await ensureLibrary();
    const filters = await showRouletteFilter();
    if (!filters) {
      fab.disabled = false;
      fab.textContent = original;
      return;
    }
    const pick = await pickRoulette(filters);
    if (!pick) {
      showToast('No encontré ninguna sorpresa con esos filtros.', 'error');
      return;
    }
    openDetail(pick.mediaType, pick.tmdbId, { surprise: true });
  } catch (err) {
    showToast('La ruleta falló. Probá de nuevo.', 'error');
  } finally {
    fab.disabled = false;
    fab.textContent = original;
  }
}

function showRouletteFilter() {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    root.innerHTML = `
      <div id="modal-overlay" class="modal-backdrop fixed inset-0 z-50 overflow-y-auto">
        <div class="absolute inset-0 bg-black/75" data-modal-close></div>
        <div class="modal-panel relative z-10 mx-auto my-0 sm:my-10 w-full max-w-md bg-slate-900 sm:rounded-2xl shadow-2xl min-h-full sm:min-h-0 overflow-hidden">
          <button type="button" data-modal-close aria-label="Cerrar"
            class="absolute top-3 right-3 z-20 rounded-full bg-black/60 hover:bg-black/80 p-2 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div class="p-6">
            <h2 class="text-xl font-extrabold mb-4">🎲 Filtros de la ruleta</h2>
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Tipo</label>
                <select id="filter-media-type" class="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600">
                  <option value="all">Todos</option>
                  <option value="movie">Películas</option>
                  <option value="tv">Series</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Género</label>
                <select id="filter-genre" class="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600">
                  <option value="all">Todos</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-300 mb-1">Duración máxima (min, opcional)</label>
                <input id="filter-max-duration" type="number" min="1" step="1" placeholder="Ej: 120"
                  class="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-600">
              </div>
            </div>
            <div class="flex gap-3 mt-6">
              <button type="button" data-action="roulette-cancel"
                class="flex-1 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors font-bold py-2.5 text-sm">Cancelar</button>
              <button type="button" data-action="roulette-apply"
                class="flex-1 rounded-lg bg-rose-600 hover:bg-rose-500 transition-colors font-bold py-2.5 text-sm">¡Girar!</button>
            </div>
          </div>
        </div>
      </div>`;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => $('#modal-overlay').classList.add('modal-visible'));

    // Populate genre dropdown
    tmdbGenreList().then((genres) => {
      const select = $('#filter-genre');
      for (const [id, name] of Object.entries(genres)) {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = name;
        select.appendChild(opt);
      }
    }).catch(() => {});

    const overlay = $('#modal-overlay');
    overlay.addEventListener('click', (event) => {
      if (event.target.closest('[data-modal-close]')) {
        closeModal();
        resolve(null);
        return;
      }
      const actionBtn = event.target.closest('[data-action]');
      if (actionBtn) {
        if (actionBtn.dataset.action === 'roulette-cancel') {
          closeModal();
          resolve(null);
        } else if (actionBtn.dataset.action === 'roulette-apply') {
          const mediaType = $('#filter-media-type').value;
          const genre = $('#filter-genre').value;
          const maxDuration = Number($('#filter-max-duration').value) || null;
          closeModal();
          resolve({ mediaType, genre, maxDuration });
        }
      }
    });
  });
}

async function pickRoulette(filters) {
  const seenIds = new Set(state.vistos.map((row) => row.id));
  const pool = [];

  // Watchlist items
  for (const row of state.watchlist) {
    const tmdbId = Number(row.id.slice(row.media_type.length + 1));
    pool.push({ mediaType: row.media_type, tmdbId, genreIds: row.genre_ids || [], runtime: row.runtime || null });
  }

  // Trending fallback
  try {
    const trending = await tmdbTrending();
    for (const item of (trending.results || [])) {
      if (item.media_type === 'movie' || item.media_type === 'tv') {
        pool.push({ mediaType: item.media_type, tmdbId: item.id, genreIds: item.genre_ids || [], runtime: null });
      }
    }
  } catch (err) {
    // Trending failing is not critical
  }

  // Dedupe and exclude vistos
  const seen = new Set();
  const candidates = pool.filter((c) => {
    const key = makeRowId(c.mediaType, c.tmdbId);
    if (seen.has(key) || seenIds.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Apply filters
  let filtered = candidates;
  if (filters.mediaType !== 'all') {
    filtered = filtered.filter((c) => c.mediaType === filters.mediaType);
  }
  if (filters.genre !== 'all') {
    const genreId = Number(filters.genre);
    filtered = filtered.filter((c) => c.genreIds.includes(genreId));
  }
  if (filters.maxDuration) {
    // Fetch details for items missing runtime to apply duration filter
    const withRuntime = await Promise.all(filtered.map(async (c) => {
      if (c.runtime) return c;
      try {
        const details = await matchGetDetails(c.mediaType, c.tmdbId);
        return { ...c, runtime: details.runtime || details.episode_run_time?.[0] || null };
      } catch (err) {
        return c;
      }
    }));
    filtered = withRuntime.filter((c) => !c.runtime || c.runtime <= filters.maxDuration);
  }

  if (!filtered.length) return null;
  return filtered[Math.floor(Math.random() * filtered.length)];
}

// ==================================================================== STATS ==

async function handleStats() {
  try {
    await ensureLibrary();
    const totalVistos = state.vistos.length;
    const movies = state.vistos.filter((r) => r.media_type === 'movie').length;
    const series = state.vistos.filter((r) => r.media_type === 'tv').length;

    // Estimated watch time
    let totalMinutes = 0;
    const genreCounts = {};

    await Promise.all(state.vistos.map(async (row) => {
      const tmdbId = Number(row.id.slice(row.media_type.length + 1));
      try {
        const details = await matchGetDetails(row.media_type, tmdbId);
        if (row.media_type === 'movie') {
          totalMinutes += details.runtime || 0;
        } else {
          const episodes = row.current_episode || details.number_of_episodes || 0;
          const epRuntime = (details.episode_run_time && details.episode_run_time[0]) || 45;
          totalMinutes += episodes * epRuntime;
        }
        for (const g of (details.genres || [])) {
          genreCounts[g.name] = (genreCounts[g.name] || 0) + 1;
        }
      } catch (err) {
        // Skip titles with failed detail fetch
      }
    }));

    const hours = Math.round(totalMinutes / 60);
    const days = (hours / 24).toFixed(1);

    const topGenres = Object.entries(genreCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const root = $('#modal-root');
    root.innerHTML = `
      <div id="modal-overlay" class="modal-backdrop fixed inset-0 z-50 overflow-y-auto">
        <div class="absolute inset-0 bg-black/75" data-modal-close></div>
        <div class="modal-panel relative z-10 mx-auto my-0 sm:my-10 w-full max-w-md bg-slate-900 sm:rounded-2xl shadow-2xl min-h-full sm:min-h-0 overflow-hidden">
          <button type="button" data-modal-close aria-label="Cerrar"
            class="absolute top-3 right-3 z-20 rounded-full bg-black/60 hover:bg-black/80 p-2 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-5 h-5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div class="p-6">
            <h2 class="text-xl font-extrabold mb-4">📊 Tus estadísticas</h2>
            <div class="grid grid-cols-2 gap-3 mb-4">
              <div class="stat-card">
                <p class="text-2xl font-extrabold text-rose-400">${totalVistos}</p>
                <p class="text-xs text-slate-400 mt-1">Títulos vistos</p>
              </div>
              <div class="stat-card">
                <p class="text-2xl font-extrabold text-rose-400">${hours}h</p>
                <p class="text-xs text-slate-400 mt-1">Tiempo estimado (${days} días)</p>
              </div>
              <div class="stat-card">
                <p class="text-2xl font-extrabold text-rose-400">${movies}</p>
                <p class="text-xs text-slate-400 mt-1">Películas</p>
              </div>
              <div class="stat-card">
                <p class="text-2xl font-extrabold text-rose-400">${series}</p>
                <p class="text-xs text-slate-400 mt-1">Series</p>
              </div>
            </div>
            ${topGenres.length ? `
              <h3 class="text-sm font-bold text-slate-300 mb-2">Géneros favoritos</h3>
              <div class="space-y-1.5">
                ${topGenres.map((g) => `
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-slate-300">${escapeHtml(g.name)}</span>
                    <span class="text-slate-500">${g.count}</span>
                  </div>`).join('')}
              </div>` : '<p class="text-sm text-slate-500">Marcá títulos como ver para ver tus géneros favoritos.</p>'}
          </div>
        </div>
      </div>`;
    document.body.classList.add('modal-open');
    requestAnimationFrame(() => $('#modal-overlay').classList.add('modal-visible'));
  } catch (err) {
    showToast('No se pudieron cargar las estadísticas.', 'error');
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
      handleModalAction(actionBtn.dataset.action, event);
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
  $('#stats-btn').addEventListener('click', handleStats);
  $('#ai-generate-btn').addEventListener('click', handleGenerateAI);

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
