// ============================================================================
// Pelisme v3.0 — TMDB discovery API for the massive catalog explorer.
// Provides paginated /discover/movie and /discover/tv with year/genre filters,
// plus the strict-quality filter used by the AI recommendation engine.
//
// Depends on: js/tmdb.js (tmdbFetch, tmdbGenreList)
// ============================================================================

// ------------------------------------------------------- discover movies ---

// Fetch a page of movies from /discover/movie with optional filters.
// Returns { results: [...], page, totalPages }.
async function apiDiscoverMovies({ year, genreId, page = 1, minVoteAverage = 0, minVoteCount = 0 } = {}) {
  const params = {
    sort_by: 'popularity.desc',
    page,
    include_adult: 'false',
  };
  if (year) params.primary_release_year = year;
  if (genreId) params.with_genres = genreId;
  if (minVoteAverage > 0) params['vote_average.gte'] = minVoteAverage;
  if (minVoteCount > 0) params['vote_count.gte'] = minVoteCount;

  const data = await tmdbFetch('/discover/movie', params);
  return {
    results: data.results || [],
    page: data.page || 1,
    totalPages: data.total_pages || 1,
  };
}

// ------------------------------------------------------- discover tv -------

// Fetch a page of TV series from /discover/tv with optional filters.
async function apiDiscoverTv({ year, genreId, page = 1, minVoteAverage = 0, minVoteCount = 0 } = {}) {
  const params = {
    sort_by: 'popularity.desc',
    page,
    include_adult: 'false',
  };
  if (year) params.first_air_date_year = year;
  if (genreId) params.with_genres = genreId;
  if (minVoteAverage > 0) params['vote_average.gte'] = minVoteAverage;
  if (minVoteCount > 0) params['vote_count.gte'] = minVoteCount;

  const data = await tmdbFetch('/discover/tv', params);
  return {
    results: data.results || [],
    page: data.page || 1,
    totalPages: data.total_pages || 1,
  };
}

// ------------------------------------------------------- quality filter ---

// Strict quality filter for AI recommendations base.
// Returns high-quality titles not yet in the user's library.
// excludeTmdbIds: array of { idTmdb, mediaType } to exclude.
async function apiGetQualityPool({ mediaType = 'movie', excludeTmdbIds = [], page = 1 } = {}) {
  const minVoteAverage = 7.5;
  const minVoteCount = 500;

  const fetcher = mediaType === 'tv' ? apiDiscoverTv : apiDiscoverMovies;
  const { results, totalPages } = await fetcher({ page, minVoteAverage, minVoteCount });

  // Filter out titles already in the library
  const excludeSet = new Set(
    excludeTmdbIds.map((e) => `${e.mediaType}-${e.idTmdb}`)
  );
  const filtered = results.filter((item) => {
    const key = `${mediaType}-${item.id}`;
    return !excludeSet.has(key);
  });

  return { results: filtered, page, totalPages };
}

// ------------------------------------------------------- genre helpers -----

// Get genre list for a specific media type (movie or tv).
// Returns [{ id, name }].
async function apiGetGenres(mediaType = 'movie') {
  const data = await tmdbFetch(`/genre/${mediaType}/list`);
  return data.genres || [];
}

// Get all genres (movie + tv merged) as { id: name }.
// Cached for 30 days in localStorage.
async function apiGetAllGenres() {
  return tmdbGenreList();
}

// ------------------------------------------------------- infinite scroll ---

// Create an infinite scroll controller for a catalog section.
// Usage:
//   const scroller = createInfiniteScroll({
//     container: document.getElementById('catalog-grid'),
//     fetcher: (page) => apiDiscoverMovies({ page }),
//     renderItem: (item) => posterCard({...}),
//   });
//   scroller.loadMore(); // initial load
function createInfiniteScroll({ container, fetcher, renderItem, loadingHtml }) {
  let currentPage = 0;
  let totalPages = 1;
  let loading = false;
  let finished = false;

  const sentinel = document.createElement('div');
  sentinel.className = 'col-span-full flex justify-center py-6';
  sentinel.innerHTML = loadingHtml || '<div class="skeleton w-8 h-8 rounded-full"></div>';
  sentinel.style.display = 'none';
  container.appendChild(sentinel);

  async function loadMore() {
    if (loading || finished) return;
    loading = true;
    sentinel.style.display = 'flex';

    try {
      const nextPage = currentPage + 1;
      const { results, totalPages: tp } = await fetcher(nextPage);
      totalPages = tp;

      if (!results.length || nextPage >= totalPages) {
        finished = true;
        sentinel.style.display = 'none';
      } else {
        const html = results.map(renderItem).join('');
        sentinel.insertAdjacentHTML('beforebegin', html);
      }
      currentPage = nextPage;
    } catch (err) {
      finished = true;
      sentinel.style.display = 'none';
    } finally {
      loading = false;
    }
  }

  // IntersectionObserver for automatic loading
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries[0].isIntersecting) loadMore();
    },
    { rootMargin: '200px' }
  );
  observer.observe(sentinel);

  return { loadMore, reset: () => { currentPage = 0; finished = false; loading = false; } };
}
