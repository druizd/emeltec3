#!/usr/bin/env node
/**
 * ============================================================================
 *  SCRAPING CPA — poblar dga_user.caudal_max_lps por obra
 * ============================================================================
 *
 *  ¿QUE HACE?
 *  ----------
 *  Para cada informante DGA registrado en `dga_user`, consulta el Catastro
 *  Público de Aguas (CPA) de la DGA por su código de obra (OB-XXXX-XXX) y
 *  extrae el caudal máximo autorizado por el derecho de aprovechamiento.
 *  Actualiza `dga_user.caudal_max_lps` solo si está NULL (no pisa valores
 *  ya cargados manualmente, salvo --force).
 *
 *  Fuente:
 *      Catastro Público de Aguas (CPA) - DGA
 *      https://snia.mop.gob.cl/dgacatastro/
 *
 *      Búsqueda pública por código de obra. Devuelve los derechos asociados
 *      con caudal autorizado, tipo (consuntivo/no consuntivo), titular, etc.
 *
 *
 *  ESTADO: STUB / DOCUMENTADO
 *  --------------------------
 *  El script está dejado como esqueleto porque:
 *
 *    1. CPA NO tiene API REST pública documentada. La búsqueda es vía
 *       formulario HTML. Requiere parser HTML (cheerio) NO instalado en
 *       main-api. Agregar:
 *         npm i cheerio  (dep) + npm i -D @types/cheerio
 *
 *    2. La estructura de la página CPA puede cambiar. Implementar el parser
 *       requiere inspeccionar el HTML actual con una obra conocida.
 *
 *    3. Una obra puede tener MÚLTIPLES derechos de aprovechamiento (un pozo
 *       sirve a varios titulares o múltiples resoluciones DGA). Necesitamos
 *       definir: ¿sumar todos? ¿tomar el mayor? ¿el primero del titular
 *       coincidente con dga_user.rut_informante? Decisión de negocio
 *       pendiente.
 *
 *
 *  TODO PARA IMPLEMENTAR
 *  ---------------------
 *      [ ] npm i cheerio @types/cheerio
 *      [ ] Inspeccionar HTML CPA con OB-0601-292 (piloto) — confirmar
 *          selectores CSS para caudal autorizado.
 *      [ ] Definir política multi-derecho (sumar / mayor / por titular).
 *      [ ] Implementar fetchCpaByCodigoObra(codigoObra) → array de derechos.
 *      [ ] Loop principal: listar dga_user, scrape, update caudal_max_lps.
 *      [ ] Rate limiting (1 req/s) para no saturar CPA.
 *      [ ] Logs de progreso + summary final.
 *
 *
 *  USO (futuro, cuando se implemente)
 *  ----------------------------------
 *      node scripts/scrape-cpa-caudal-max.js               # solo NULLs
 *      node scripts/scrape-cpa-caudal-max.js --force       # pisa valores
 *      node scripts/scrape-cpa-caudal-max.js --obra=OB-0601-292
 *      node scripts/scrape-cpa-caudal-max.js --dry-run
 *
 *
 *  ALTERNATIVA MIENTRAS SE IMPLEMENTA
 *  ----------------------------------
 *  Carga manual desde frontend: el toggle activo+transport+caudal_max_lps
 *  en water-detail.ts permite admin cargar el valor a mano por obra. Útil
 *  para piloto (1 obra) y para obras con derecho conocido.
 *
 *  Heurística fallback: si caudal_max_lps queda NULL, la validación usa
 *  hardcode 1000 L/s (FLOW_HARDCODE_LIMIT_LPS en dga/validation.ts) +
 *  marca el slot como flow_absurd_no_water_right en requires_review.
 *
 * ============================================================================
 */
require('dotenv').config();

console.error('[scrape-cpa] STUB — ver TODO en encabezado del archivo.');
console.error('[scrape-cpa] Mientras tanto, cargar caudal_max_lps manualmente desde');
console.error('[scrape-cpa] el frontend (water-detail → modal DGA → informantes).');
process.exit(1);
