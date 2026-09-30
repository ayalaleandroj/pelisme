-- ============================================================================
-- Migración v3.0: Tabla unificada user_media
-- NO destructiva: migra datos existentes de vistos/watchlist/top_favorites.
-- Idempotente: se puede ejecutar más de una vez sin errores.
-- ROBUSTA: funciona tanto si se ejecutó v2 como si no (crea columnas faltantes).
-- ============================================================================

-- 0. Asegurar que las tablas viejas tengan las columnas necesarias ------------
-- (Estas columnas fueron agregadas en v2; si no se ejecutó v2, las creamos)

ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS added_by TEXT;
ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS review TEXT;
ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS genre_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS runtime INT;
ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS watched_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS added_by TEXT;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS genre_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS runtime INT;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ DEFAULT NOW();

-- 1. Crear tabla unificada user_media ----------------------------------------

CREATE TABLE IF NOT EXISTS user_media (
    id TEXT PRIMARY KEY,                    -- ID compuesto: 'movie-550', 'tv-1399'
    id_tmdb INT NOT NULL,                   -- ID de TMDB (sin prefijo)
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    title TEXT NOT NULL,
    poster_path TEXT,
    status TEXT NOT NULL DEFAULT 'watchlist' CHECK (status IN ('watchlist', 'watching', 'completed')),
    rating NUMERIC(3,1) CHECK (rating >= 1 AND rating <= 10),
    is_top_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    current_season INT DEFAULT 1,           -- Solo relevante si media_type es 'tv'
    current_episode INT DEFAULT 1,          -- Solo relevante si media_type es 'tv'
    added_by TEXT,                          -- Usuario que agregó el título
    review TEXT,                            -- Reseña opcional
    tags TEXT[] NOT NULL DEFAULT '{}',     -- Etiquetas libres
    genre_ids INTEGER[] NOT NULL DEFAULT '{}', -- Géneros TMDB
    runtime INT,                            -- Minutos (película) o promedio (serie)
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Índices para consultas frecuentes ---------------------------------------

CREATE INDEX IF NOT EXISTS user_media_status_idx ON user_media (status);
CREATE INDEX IF NOT EXISTS user_media_media_type_idx ON user_media (media_type);
CREATE INDEX IF NOT EXISTS user_media_is_top_favorite_idx ON user_media (is_top_favorite) WHERE is_top_favorite = TRUE;
CREATE INDEX IF NOT EXISTS user_media_rating_idx ON user_media (rating) WHERE rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_media_updated_at_idx ON user_media (updated_at DESC);

-- 3. Migrar datos existentes -------------------------------------------------

-- 3a. Migrar vistos → user_media (status = 'completed')
-- Usamos COALESCE para manejar columnas que puedan ser NULL
INSERT INTO user_media (id, id_tmdb, media_type, title, poster_path, status, rating, is_top_favorite, current_season, current_episode, added_by, review, tags, genre_ids, runtime, updated_at, created_at)
SELECT
    v.id,
    CAST(SUBSTRING(v.id FROM LENGTH(v.media_type) + 2) AS INT),
    v.media_type,
    v.title,
    COALESCE(v.poster_path, ''),
    'completed',
    v.rating,
    FALSE,
    COALESCE(v.current_season, 1),
    COALESCE(v.current_episode, 1),
    COALESCE(v.added_by, 'usuario'),
    v.review,
    COALESCE(v.tags, '{}'),
    COALESCE(v.genre_ids, '{}'),
    v.runtime,
    COALESCE(v.watched_at, NOW()),
    COALESCE(v.watched_at, NOW())
FROM vistos v
ON CONFLICT (id) DO NOTHING;

-- 3b. Migrar watchlist → user_media (status = 'watchlist')
INSERT INTO user_media (id, id_tmdb, media_type, title, poster_path, status, rating, is_top_favorite, current_season, current_episode, added_by, review, tags, genre_ids, runtime, updated_at, created_at)
SELECT
    w.id,
    CAST(SUBSTRING(w.id FROM LENGTH(w.media_type) + 2) AS INT),
    w.media_type,
    w.title,
    COALESCE(w.poster_path, ''),
    'watchlist',
    NULL,
    FALSE,
    1,
    1,
    COALESCE(w.added_by, 'usuario'),
    NULL,
    COALESCE(w.tags, '{}'),
    COALESCE(w.genre_ids, '{}'),
    w.runtime,
    COALESCE(w.added_at, NOW()),
    COALESCE(w.added_at, NOW())
FROM watchlist w
ON CONFLICT (id) DO NOTHING;

-- 3c. Marcar top_favorites en user_media (is_top_favorite = TRUE)
UPDATE user_media um
SET is_top_favorite = TRUE
FROM top_favorites tf
WHERE um.id = tf.id;

-- 4. Actualizar tabla ratings para referenciar user_media -------------------

-- La tabla ratings usa visto_id que es el mismo ID compuesto.
-- No necesita cambios estructurales, pero agregamos un índice si no existe.
CREATE INDEX IF NOT EXISTS ratings_visto_id_idx ON ratings (visto_id);

-- 5. Configurar RLS en user_media -------------------------------------------

ALTER TABLE user_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso total a usuarios autenticados en user_media" ON user_media;
CREATE POLICY "Acceso total a usuarios autenticados en user_media"
ON user_media FOR ALL TO authenticated
USING (true) WITH CHECK (true);

-- 6. Trigger para actualizar updated_at automáticamente ---------------------

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_user_media_updated_at ON user_media;
CREATE TRIGGER update_user_media_updated_at
    BEFORE UPDATE ON user_media
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- NOTA: Las tablas vistos, watchlist y top_favorites se conservan para
-- compatibilidad hacia atrás. En una futura migración v4.0 se pueden eliminar
-- una vez confirmado que todo funciona correctamente con user_media.
-- ============================================================================
