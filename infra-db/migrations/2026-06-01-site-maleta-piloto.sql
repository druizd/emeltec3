-- 2026-06-01 — Flag "Maleta Piloto" a nivel sitio.
--
-- Problema: el módulo "Maletas Piloto" del sidebar agrupa por `tipo_sitio`
-- (catch-all `generico`/`maleta`). Para mandar un sitio ahí había que ponerle
-- `tipo_sitio = 'maleta'`, pero eso le quita la lógica real de detalle (un pozo
-- dejaba de abrir la vista de pozo).
--
-- Solución: un booleano independiente. Si `es_maleta_piloto = true`, el sitio se
-- muestra bajo "Maletas Piloto" sin importar su `tipo_sitio`, pero `tipo_sitio`
-- sigue intacto, así que la vista de detalle (pozo/eléctrico/vertiente) no cambia.
-- Es un override puramente visual de agrupación, seteable a mano por sitio.
--
-- IDEMPOTENCIA: `ADD COLUMN IF NOT EXISTS` para re-aplicar seguro en cada deploy.

ALTER TABLE sitio
    ADD COLUMN IF NOT EXISTS es_maleta_piloto BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN sitio.es_maleta_piloto IS
    'Override visual: agrupa el sitio bajo "Maletas Piloto" en sidebar/dashboard sin alterar tipo_sitio ni la lógica de detalle.';
