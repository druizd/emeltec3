-- Soft-delete de usuarios: columna `activo`. Eliminar un usuario = activo=false
-- (reversible, auditable). Login rechaza usuarios inactivos.
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
