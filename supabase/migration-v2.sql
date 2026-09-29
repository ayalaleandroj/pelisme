-- ============================================================================
-- Migración v2: pelisme pasa de 1.x a 2.0
-- NO destructiva: no borra ni renombra columnas/tablas existentes.
-- Idempotente: se puede ejecutar más de una vez sin errores
-- (IF NOT EXISTS donde Postgres lo permite; DROP IF EXISTS antes de
-- recrear políticas, que no soportan IF NOT EXISTS).
-- ============================================================================

-- 1. Nuevas columnas en tablas existentes -----------------------------------

-- Autoría compartida: quién agregó cada título (prefijo del email de sesión).
ALTER TABLE vistos        ADD COLUMN IF NOT EXISTS added_by TEXT;
ALTER TABLE watchlist     ADD COLUMN IF NOT EXISTS added_by TEXT;
ALTER TABLE top_favorites ADD COLUMN IF NOT EXISTS added_by TEXT;

-- Etiquetas libres por título (solo en vistos y watchlist).
ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Datos para el filtro local de la ruleta:
-- genre_ids se captura al agregar el título; runtime en minutos
-- (duración de la película o promedio de episode_run_time en series).
ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS genre_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS genre_ids INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE vistos    ADD COLUMN IF NOT EXISTS runtime INT;
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS runtime INT;

-- 2. Tabla de ratings (doble calificación, una por usuario) -----------------
-- Convive con la columna legacy vistos.rating, que se conserva intacta
-- como la nota de quien marcó el título como visto (compatibilidad hacia atrás).
CREATE TABLE IF NOT EXISTS ratings (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    visto_id TEXT NOT NULL REFERENCES vistos(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    rating NUMERIC(3,1) NOT NULL CHECK (rating >= 1 AND rating <= 10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (visto_id, author)
);

-- 3. Tabla de comentarios ----------------------------------------------------
-- Disponible en el modal de detalle de cualquier título, no solo vistos.
-- tmdb_ref usa la misma convención de id compuesto ('movie-550', 'tv-1399').
CREATE TABLE IF NOT EXISTS comments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tmdb_ref TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Índices de apoyo --------------------------------------------------------
CREATE INDEX IF NOT EXISTS ratings_visto_id_idx  ON ratings (visto_id);
CREATE INDEX IF NOT EXISTS comments_tmdb_ref_idx ON comments (tmdb_ref);

-- ============================================================================
-- CONFIGURACIÓN DE SEGURIDAD (RLS)
-- ============================================================================

-- Habilitar Row Level Security en las tablas nuevas
ALTER TABLE ratings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Políticas compartidas (mismo estilo que v1):
-- la app es de uso privado para 2 personas que comparten la misma biblioteca,
-- así que cualquier usuario autenticado tiene acceso total.
-- Se recrean para que la migración sea reejecutable.
DROP POLICY IF EXISTS "Acceso total a usuarios autenticados en ratings" ON ratings;
CREATE POLICY "Acceso total a usuarios autenticados en ratings"
ON ratings FOR ALL TO authenticated
USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total a usuarios autenticados en comments" ON comments;
CREATE POLICY "Acceso total a usuarios autenticados en comments"
ON comments FOR ALL TO authenticated
USING (true) WITH CHECK (true);
