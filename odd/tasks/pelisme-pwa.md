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
- [x] T1 — DB schema: `supabase/schema.sql` — commit `097cb48`
- [x] T2 — PWA scaffold: `manifest.json`, `sw.js`, `icons/icon.svg`, `.gitignore`, `js/config.js` — commit `2c4b3ce`
- [x] T3 — API clients: `js/tmdb.js`, `js/supabaseClient.js` — commit `0cc84ff`
- [x] T4 — Match engine: `js/match.js` — commit `821503d`
- [x] T5 — App UI: `index.html`, `css/style.css`, `js/app.js` — commit `73cde46`
- [x] T6 — Verification pass — gate results below

## Acceptance criteria
All listed files exist; every JS file passes `node --check`; `manifest.json` is valid JSON; SQL matches the provided schema; Spanish UI labels per spec; one Conventional Commit per task on `feat/pwa-scaffold`; no AI attribution in commits.

## Progress
- 2026-09-28: Document created. First writer completed T1–T4 before its transport was cancelled; resumed with a second writer for T5+T6. All tasks complete.

## Verification evidence
- Writer self-check: `node --check` OK on sw.js + all js/*.js; manifest.json parses; index.html readback (5 tabs with exact labels, FAB, modal-root, login view); app.js readback (session restore, 300ms debounce, optimistic +1 Cap with rollback, two-step roulette, loading="lazy" in all 5 image paths).
- Parent spot check: `node --check js/app.js` → OK; `git log --oneline` → 5 conventional commits; `git status --short` → clean.
- `gentle-ai review assess --base-ref 821503d --committed-only` → risk `medium`, 1149 lines / 3 paths, `review_due=true (slice_budget_reached)`. RDD is globally OFF → native review lifecycle intentionally not started; recorded here, delivery under ordinary repository policy.
- Parent structural readback of index.html → passes.

## Next step
User fills `js/config.js` (TMDB key, Supabase URL + anon key), runs `supabase/schema.sql` in the SQL Editor, creates the 2 auth users (`<usuario>@pelisme.app`) in Supabase Auth, and deploys statically. Push/PR and chain strategy (`ask-on-risk`) when the user decides.
