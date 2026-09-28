-- 1. Tabla de Vistos (Historial de películas y series consumidas)
-- Almacena la nota, reseña y el progreso de las series.
CREATE TABLE IF NOT EXISTS vistos (
    id TEXT PRIMARY KEY, -- ID proveniente de TMDB (Ej: 'movie-550' o 'tv-1399')
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    title TEXT NOT NULL,
    poster_path TEXT,
    rating NUMERIC(3,1) CHECK (rating >= 1 AND rating <= 10),
    review TEXT,
    current_season INT DEFAULT 1,     -- Solo relevante si media_type es 'tv'
    current_episode INT DEFAULT 1,    -- Solo relevante si media_type es 'tv'
    watched_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabla de Watchlist (Pendientes)
-- Almacena los títulos que los usuarios quieren ver en el futuro.
CREATE TABLE IF NOT EXISTS watchlist (
    id TEXT PRIMARY KEY, -- ID proveniente de TMDB
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    title TEXT NOT NULL,
    poster_path TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Tabla de Mi Top (Favoritos absolutos)
-- Contenedor de las joyas elegidas por los usuarios. 
-- Esta tabla es la fuente principal para entrenar el Motor de Recomendación.
CREATE TABLE IF NOT EXISTS top_favorites (
    id TEXT PRIMARY KEY, -- ID proveniente de TMDB
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    title TEXT NOT NULL,
    poster_path TEXT,
    added_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- CONFIGURACIÓN DE SEGURIDAD (RLS)
-- ==========================================

-- Habilitar Row Level Security (RLS) en todas las tablas
ALTER TABLE vistos ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE top_favorites ENABLE ROW LEVEL SECURITY;

-- Crear políticas compartidas
-- Como la app es de uso privado para 2 personas que comparten la misma biblioteca,
-- se otorga acceso total (Select, Insert, Update, Delete) a cualquier usuario autenticado.

-- Políticas para la tabla 'vistos'
CREATE POLICY "Acceso total a usuarios autenticados en vistos" 
ON vistos FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

-- Políticas para la tabla 'watchlist'
CREATE POLICY "Acceso total a usuarios autenticados en watchlist" 
ON watchlist FOR ALL TO authenticated 
USING (true) WITH CHECK (true);

-- Políticas para la tabla 'top_favorites'
CREATE POLICY "Acceso total a usuarios autenticados en top_favorites" 
ON top_favorites FOR ALL TO authenticated 
USING (true) WITH CHECK (true);
