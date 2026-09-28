# Feature: pelisme-pwa — Personal Movie & Series Library PWA

## Objective
Build a complete, lightweight PWA: a shared movie/series catalog for 2 users with an intelligent recommendation engine, per the user's pasted requirements spec (Spanish UI, dark Netflix-style design).

## Why
User provided two requirement documents (functional spec + DB schema) and asked for the full, deployable implementation.

## Authorized scope
Explicit user request to generate the full app: `index.html`, `js/app.js`, `js/tmdb.js`, `js/supabaseClient.js`, `js/match.js`, `js/config.js`, `css/style.css`, `sw.js`, `manifest.json`, icons, `supabase/schema.sql`. Commits on a feature branch are authorized; push/PR remain user decisions.

## Constraints
- Stack: HTML5 + Tailwind (CDN) + vanilla JS. NO frameworks.
- Backend: Supabase (PostgreSQL), auth via email built from username (`<user>@pelisme.app`).
- External API: TMDB v3, always `language=es-ES`.
- API keys live in `js/config.js` as placeholders (user fills them in).
- Code, identifiers and comments in English; UI copy in Spanish exactly as the spec dictates ("¡Sorprendeme!", "Vistos", "+1 Cap", etc.).
- RDD is off: no review ceremony; ordinary functional checks only.

## TDD resolution
TDD: OFF. Source: no test runner or framework in this greenfield static PWA. Applicable checks: `node --check` on every JS file, JSON parse validation of `manifest.json`, structural readback of HTML/SQL.

## Route per task
All tasks: delegated direct (one writer). Trigger evidence: writer trigger — 10+ non-trivial files; preparation trigger — spec compression.

## Delivery strategy
`ask-on-risk` (default). Forecast ~1200 authored lines across 6 work-unit commits. No PR requested; chain strategy deferred until the user asks for PRs.

## Tasks
- [ ] T1 — DB schema: `supabase/schema.sql` with the user-provided SQL verbatim (3 tables + RLS policies). Check: readback matches spec.
- [ ] T2 — PWA scaffold: `manifest.json` (standalone, dark), `sw.js` (cache app shell, stale-while-revalidate posters), `icons/icon.svg`, `.gitignore` (`.atl/`), `js/config.js` placeholders. Checks: JSON parses, `node --check sw.js`.
- [ ] T3 — API clients: `js/tmdb.js` (search/multi, trending/all/day, movie+tv details with credits & videos, image helpers) and `js/supabaseClient.js` (client init, username→email auth, session, CRUD for the 3 tables, composite text ids `movie-550`). Check: `node --check`.
- [ ] T4 — Match engine: `js/match.js`. Taste profile from `top_favorites` (weight 3) + `vistos` rating>=7 (weight rating/10): genres, directors, top-5 cast; TMDB-details cache in localStorage; score = affinity × quality(vote_average), shown as "NN% Match". Check: `node --check`.
- [ ] T5 — App UI: `index.html`, `css/style.css`, `js/app.js`. Login screen; bottom nav with 5 tabs (Descubrir with debounced autocomplete search + trending grid + floating "¡Sorprendeme!"; Vistos with rating badges and "+1 Cap" optimistic increment for series; Watchlist with % Match and quick "mark as seen"; Mi Top; Recomendados sorted by match desc). Detail modal: poster, synopsis, genres, main cast, TMDB vote, YouTube trailer link, actions (Mi Top / Watchlist / Marcar como Vista with rating+review+season/episode form). Roulette: watchlist match>=80% → random; else recommendations from a random top favorite not in vistos, high match. Lazy images. Checks: `node --check`, readback of the 5 tabs and modal.
- [ ] T6 — Verification pass: run all checks, fix anything, report.

## Acceptance criteria
All listed files exist; every JS file passes `node --check`; `manifest.json` is valid JSON; SQL matches the provided schema; Spanish UI labels per spec; one Conventional Commit per task on `feat/pwa-scaffold`; no AI attribution in commits.

## Progress
- 2026-09-28: Document created. Writer delegation pending.

## Verification evidence
(pending)

## Next step
Delegate the writer with the full spec, then run the verification gate (RDD off → `gentle-ai review assess` tier table).
