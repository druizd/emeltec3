/**
 * Repositorio del módulo riles: `riles_config` (1:1 con sitio) y `riles_fuente`
 * (N:M con los sitios que alimentan el balance).
 */
import { query } from '../../config/dbHelpers';
import {
  DEFAULT_CONFIG,
  type RilesConfig,
  type RilesDireccion,
  type RilesFuente,
  type RilesModoCaudal,
  type RilesNorma,
} from './types';

const CONFIG_COLUMNS =
  'sitio_id, modo_caudal, coef_descarga_esperado_pct, coef_tolerancia_pct, norma, punto_descarga, caudal_max_autorizado_lps, volumen_max_mensual_m3, updated_at';

interface ConfigDbRow {
  sitio_id: string;
  modo_caudal: string;
  coef_descarga_esperado_pct: string | number | null;
  coef_tolerancia_pct: string | number | null;
  norma: string | null;
  punto_descarga: string | null;
  caudal_max_autorizado_lps: string | number | null;
  volumen_max_mensual_m3: string | number | null;
  updated_at: string;
}

/** pg devuelve NUMERIC como string para no perder precisión. */
function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapConfig(row: ConfigDbRow): RilesConfig {
  return {
    sitio_id: row.sitio_id,
    modo_caudal: row.modo_caudal as RilesModoCaudal,
    coef_descarga_esperado_pct: num(row.coef_descarga_esperado_pct),
    coef_tolerancia_pct: num(row.coef_tolerancia_pct) ?? DEFAULT_CONFIG.coef_tolerancia_pct,
    norma: (row.norma as RilesNorma | null) ?? null,
    punto_descarga: row.punto_descarga,
    caudal_max_autorizado_lps: num(row.caudal_max_autorizado_lps),
    volumen_max_mensual_m3: num(row.volumen_max_mensual_m3),
    updated_at: row.updated_at,
  };
}

export async function findRilesConfig(sitioId: string): Promise<RilesConfig | null> {
  const result = await query<ConfigDbRow>(
    `SELECT ${CONFIG_COLUMNS} FROM riles_config WHERE sitio_id = $1`,
    [sitioId],
    { name: 'riles__config_find' },
  );
  const row = result.rows[0];
  return row ? mapConfig(row) : null;
}

export async function upsertRilesConfig(
  opts: Omit<RilesConfig, 'updated_at'>,
): Promise<RilesConfig> {
  const result = await query<ConfigDbRow>(
    `
    INSERT INTO riles_config
      (sitio_id, modo_caudal, coef_descarga_esperado_pct, coef_tolerancia_pct,
       norma, punto_descarga, caudal_max_autorizado_lps, volumen_max_mensual_m3, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
    ON CONFLICT (sitio_id) DO UPDATE SET
      modo_caudal                = EXCLUDED.modo_caudal,
      coef_descarga_esperado_pct = EXCLUDED.coef_descarga_esperado_pct,
      coef_tolerancia_pct        = EXCLUDED.coef_tolerancia_pct,
      norma                      = EXCLUDED.norma,
      punto_descarga             = EXCLUDED.punto_descarga,
      caudal_max_autorizado_lps  = EXCLUDED.caudal_max_autorizado_lps,
      volumen_max_mensual_m3     = EXCLUDED.volumen_max_mensual_m3,
      updated_at                 = NOW()
    RETURNING ${CONFIG_COLUMNS}
    `,
    [
      opts.sitio_id,
      opts.modo_caudal,
      opts.coef_descarga_esperado_pct,
      opts.coef_tolerancia_pct,
      opts.norma,
      opts.punto_descarga,
      opts.caudal_max_autorizado_lps,
      opts.volumen_max_mensual_m3,
    ],
    { name: 'riles__config_upsert' },
  );
  return mapConfig(result.rows[0]!);
}

// ── Fuentes ──────────────────────────────────────────────────────────────────

interface FuenteDbRow {
  id: string | number;
  riles_sitio_id: string;
  fuente_sitio_id: string;
  rol: string;
  factor: string | number;
  direccion: string;
  vigencia_desde: string | Date;
  vigencia_hasta: string | Date | null;
  nota: string | null;
  created_at: string;
  fuente_descripcion: string | null;
  fuente_tipo_sitio: string | null;
}

/** `DATE` vuelve como Date en node-pg; el resto del stack habla ISO corto. */
function dateIso(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

function mapFuente(row: FuenteDbRow): RilesFuente {
  return {
    id: String(row.id),
    riles_sitio_id: row.riles_sitio_id,
    fuente_sitio_id: row.fuente_sitio_id,
    rol: row.rol,
    factor: num(row.factor) ?? 1,
    direccion: row.direccion as RilesDireccion,
    vigencia_desde: dateIso(row.vigencia_desde)!,
    vigencia_hasta: dateIso(row.vigencia_hasta),
    nota: row.nota,
    fuente_descripcion: row.fuente_descripcion,
    fuente_tipo_sitio: row.fuente_tipo_sitio,
    created_at: row.created_at,
  };
}

const FUENTE_SELECT = `
  SELECT f.id, f.riles_sitio_id, f.fuente_sitio_id, f.rol, f.factor, f.direccion,
         f.vigencia_desde, f.vigencia_hasta, f.nota, f.created_at,
         s.descripcion AS fuente_descripcion, s.tipo_sitio AS fuente_tipo_sitio
  FROM riles_fuente f
  JOIN sitio s ON s.id = f.fuente_sitio_id
`;

export async function listFuentes(rilesSitioId: string): Promise<RilesFuente[]> {
  const result = await query<FuenteDbRow>(
    `${FUENTE_SELECT}
     WHERE f.riles_sitio_id = $1
     ORDER BY f.direccion, s.descripcion, f.vigencia_desde`,
    [rilesSitioId],
    { name: 'riles__fuentes_list' },
  );
  return result.rows.map(mapFuente);
}

export async function findFuenteById(id: string): Promise<RilesFuente | null> {
  const result = await query<FuenteDbRow>(`${FUENTE_SELECT} WHERE f.id = $1`, [id], {
    name: 'riles__fuente_find',
  });
  const row = result.rows[0];
  return row ? mapFuente(row) : null;
}

export async function createFuente(opts: {
  riles_sitio_id: string;
  fuente_sitio_id: string;
  rol: string;
  factor: number;
  direccion: RilesDireccion;
  vigencia_desde: string;
  vigencia_hasta: string | null;
  nota: string | null;
}): Promise<RilesFuente> {
  const inserted = await query<{ id: string | number }>(
    `
    INSERT INTO riles_fuente
      (riles_sitio_id, fuente_sitio_id, rol, factor, direccion, vigencia_desde, vigencia_hasta, nota)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    [
      opts.riles_sitio_id,
      opts.fuente_sitio_id,
      opts.rol,
      opts.factor,
      opts.direccion,
      opts.vigencia_desde,
      opts.vigencia_hasta,
      opts.nota,
    ],
    { name: 'riles__fuente_create' },
  );
  const fuente = await findFuenteById(String(inserted.rows[0]!.id));
  return fuente!;
}

/**
 * Dar de baja una fuente cierra su ventana de vigencia — nunca borra la fila.
 * Borrarla reescribiría el balance histórico que el cliente ya vio.
 */
export async function cerrarFuente(id: string, hasta: string): Promise<RilesFuente | null> {
  await query(`UPDATE riles_fuente SET vigencia_hasta = $2 WHERE id = $1`, [id, hasta], {
    name: 'riles__fuente_cerrar',
  });
  return findFuenteById(id);
}

// ── Validaciones ─────────────────────────────────────────────────────────────

/**
 * Dos sitios son ligables sólo si comparten subempresa.
 *
 * No es cosmético: ligar un pozo de otro cliente publicaría su volumen extraído
 * en la pantalla de este. Es el mismo candado que `ensureSerialAvailable` pone
 * sobre los seriales compartidos.
 */
export async function mismaSubEmpresa(sitioA: string, sitioB: string): Promise<boolean> {
  const result = await query<{ iguales: boolean }>(
    `
    SELECT (a.sub_empresa_id IS NOT DISTINCT FROM b.sub_empresa_id
            AND a.sub_empresa_id IS NOT NULL) AS iguales
    FROM sitio a, sitio b
    WHERE a.id = $1 AND b.id = $2
    `,
    [sitioA, sitioB],
    { name: 'riles__misma_subempresa' },
  );
  return result.rows[0]?.iguales === true;
}

/**
 * ¿Agregar `fuente → riles` cerraría un ciclo?
 *
 * Un RILes puede alimentarse de otro RILes (un punto final que agrupa puntos
 * parciales), así que el grafo existe de verdad. Lo que no puede es morderse la
 * cola: A→B→A haría que el balance se llame a sí mismo. La recursión se corta a
 * 10 saltos por seguridad, aunque el ciclo ya se detecta antes.
 */
export async function creariaCiclo(rilesSitioId: string, fuenteSitioId: string): Promise<boolean> {
  const result = await query<{ alcanza: boolean }>(
    `
    WITH RECURSIVE alcanzables(sitio_id, profundidad) AS (
      SELECT $2::varchar, 0
      UNION ALL
      SELECT f.fuente_sitio_id, a.profundidad + 1
      FROM riles_fuente f
      JOIN alcanzables a ON a.sitio_id = f.riles_sitio_id
      WHERE a.profundidad < 10
    )
    SELECT EXISTS (SELECT 1 FROM alcanzables WHERE sitio_id = $1) AS alcanza
    `,
    [rilesSitioId, fuenteSitioId],
    { name: 'riles__ciclo_check' },
  );
  return result.rows[0]?.alcanza === true;
}
