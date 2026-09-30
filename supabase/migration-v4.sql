-- ============================================================================
-- Migración v4.0: Fix FK de ratings para referenciar user_media
-- Corrige el bug "No se puede guardar" al puntuar títulos que solo existen
-- en user_media (no en la tabla legacy vistos).
-- NO destructiva: solo elimina la FK vieja y agrega la nueva.
-- Idempotente: se puede ejecutar más de una vez.
-- ============================================================================

-- 1. Eliminar la FK vieja que apunta a vistos
ALTER TABLE ratings DROP CONSTRAINT IF EXISTS ratings_visto_id_fkey;

-- 2. Eliminar ratings huérfanos (sin match en user_media)
DELETE FROM ratings r
WHERE NOT EXISTS (SELECT 1 FROM user_media um WHERE um.id = r.visto_id);

-- 3. Agregar nueva FK que apunte a user_media
ALTER TABLE ratings
  ADD CONSTRAINT ratings_visto_id_fkey
  FOREIGN KEY (visto_id) REFERENCES user_media(id) ON DELETE CASCADE;

-- 4. Asegurar RLS
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

-- 5. Recrear política de acceso (idempotente)
DROP POLICY IF EXISTS "Acceso total a usuarios autenticados en ratings" ON ratings;
CREATE POLICY "Acceso total a usuarios autenticados en ratings"
ON ratings FOR ALL TO authenticated
USING (true) WITH CHECK (true);
