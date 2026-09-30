# Feature: Refactorización v3.0 — Bug Fix + Separación + Match

## Objetivo
Corregir el bug crítico de guardado de puntuación, agregar separación Películas/Series en Vistos y Watchlist, e implementar la función de Match en catálogos.

## Problema
1. **Bug crítico**: Al puntuar un título, la app muestra "No se puede guardar" porque la FK de `ratings.visto_id` apunta a `vistos(id)` pero los datos viven en `user_media`.
2. **UX**: Las secciones Vistos y Watchlist mezclan películas y series sin filtro.
3. **Feature**: No existe función de Match para cruzar gustos entre usuarios.

## Alcance
- Migración v4 de Supabase (FK fix)
- Fix en `js/db.js` y `js/app.js` para guardado de ratings
- Tabs Películas/Series en Vistos y Watchlist
- Motor de Match basado en similitud de coseno de géneros

## Restricciones
- No destructivo: las tablas legacy se conservan
- Idempotente: migraciones reejecutables
- App privada para 2 usuarios (sin registro público)

## Criterios de aceptación
- Puntuar un título nuevo o existente persiste correctamente en `ratings` y `user_media`
- Los tabs Películas/Series filtran correctamente en Vistos y Watchlist
- El match percentage se calcula y muestra en catálogos

## Tareas

### T1 — Bug Fix: Guardado de puntuación
- [x] Crear `supabase/migration-v4.sql` (FK ratings → user_media)
- [x] Agregar `dbEnsureUserMedia()` en `js/db.js`
- [x] Fix `handleSubmitRating()` en `js/app.js`

### T2 — Separación Películas/Series
- [x] Agregar tabs HTML en secciones Vistos y Watchlist (`index.html`)
- [x] Agregar `mediaTabState` y `bindMediaTabs()` en `js/app.js`
- [x] Modificar `loadCompleted()` y `loadWatchlist()` para filtrar por media_type

### T3 — Motor de Match
- [x] Agregar funciones de match en `js/match.js`
- [x] Integrar badge de match en catálogos (`js/app.js`)

## Progreso
- T1: completado
- T2: completado
- T3: completado

## Verificación
- [x] `supabase/migration-v4.sql` creado (28 líneas)
- [x] `js/db.js` — `dbEnsureUserMedia()` agregado (línea 51)
- [x] `js/app.js` — `handleSubmitRating()` corregido (línea 956)
- [x] `index.html` — tabs en Vistos (línea 148) y Watchlist (línea 161)
- [x] `js/app.js` — `mediaTabState` (línea 81), `bindMediaTabs()` (línea 1596), `matchBadge()` (línea 153)
- [x] `js/match.js` — motor completo (líneas 87-162)

## Próximo paso
Ejecutar la migración v4 en Supabase Dashboard y probar en la app
