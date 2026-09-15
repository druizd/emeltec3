/**
 * Repositorio del laboratorio de RILes: catálogo de parámetros, límites por
 * sitio y norma, muestras y sus resultados.
 *
 * Aparte de `repo.ts` por volumen, no por diseño: es el mismo módulo y las
 * mismas convenciones (NUMERIC como string, DATE como Date, baja por cierre de
 * vigencia). Mismo criterio que `daily-repo.ts` en contadores.
 */
import { query, transaction } from '../../config/dbHelpers';
import type {
  RilesLimite,
  RilesMuestra,
  RilesNorma,
  RilesParametro,
  RilesResultado,
  RilesTipoLimite,
  RilesTipoMuestra,
} from './types';

/** pg devuelve NUMERIC como string para no perder precisión. */
function num(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

// ── Catálogo ─────────────────────────────────────────────────────────────────

interface ParametroDbRow {
  codigo: string;
  nombre: string;
  unidad: string;
  aplica_carga: boolean;
  grupo: string;
  orden: number | string;
  activo: boolean;
}

function mapParametro(row: ParametroDbRow): RilesParametro {
  return {
    codigo: row.codigo,
    nombre: row.nombre,
    unidad: row.unidad,
    aplica_carga: row.aplica_carga === true,
    grupo: row.grupo,
    orden: Number(row.orden),
    activo: row.activo === true,
  };
}

export async function listParametros(opts?: { soloActivos?: boolean }): Promise<RilesParametro[]> {
  const soloActivos = opts?.soloActivos !== false;
  const result = await query<ParametroDbRow>(
    `SELECT codigo, nombre, unidad, aplica_carga, grupo, orden, activo
       FROM riles_parametro
      ${soloActivos ? 'WHERE activo' : ''}
      ORDER BY orden, nombre`,
    [],
    { name: 'riles__parametros_list' },
  );
  return result.rows.map(mapParametro);
}

/** El catálogo indexado por código, que es como lo consume el cálculo. */
export async function catalogoPorCodigo(): Promise<Map<string, RilesParametro>> {
  const filas = await listParametros({ soloActivos: false });
  return new Map(filas.map((p) => [p.codigo, p]));
}

// ── Límites ──────────────────────────────────────────────────────────────────

interface LimiteDbRow {
  id: string | number;
  sitio_id: string;
  parametro: string;
  norma: string;
  tipo: string;
  limite_min: string | number | null;
  limite_max: string | number | null;
  unidad: string;
  vigencia_desde: string | Date;
  vigencia_hasta: string | Date | null;
  nota: string | null;
  created_at: string;
  parametro_nombre: string | null;
}

function mapLimite(row: LimiteDbRow): RilesLimite {
  return {
    id: String(row.id),
    sitio_id: row.sitio_id,
    parametro: row.parametro,
    norma: row.norma as RilesNorma,
    tipo: row.tipo as RilesTipoLimite,
    limite_min: num(row.limite_min),
    limite_max: num(row.limite_max),
    unidad: row.unidad,
    vigencia_desde: dateIso(row.vigencia_desde)!,
    vigencia_hasta: dateIso(row.vigencia_hasta),
    nota: row.nota,
    parametro_nombre: row.parametro_nombre,
    created_at: row.created_at,
  };
}

const LIMITE_SELECT = `
  SELECT l.id, l.sitio_id, l.parametro, l.norma, l.tipo, l.limite_min, l.limite_max,
         l.unidad, l.vigencia_desde, l.vigencia_hasta, l.nota, l.created_at,
         p.nombre AS parametro_nombre
  FROM riles_limite l
  JOIN riles_parametro p ON p.codigo = l.parametro
`;

export async function listLimites(sitioId: string): Promise<RilesLimite[]> {
  const result = await query<LimiteDbRow>(
    `${LIMITE_SELECT}
     WHERE l.sitio_id = $1
     ORDER BY p.orden, l.parametro, l.vigencia_desde DESC`,
    [sitioId],
    { name: 'riles__limites_list' },
  );
  return result.rows.map(mapLimite);
}

export async function findLimiteById(id: string): Promise<RilesLimite | null> {
  const result = await query<LimiteDbRow>(`${LIMITE_SELECT} WHERE l.id = $1`, [id], {
    name: 'riles__limite_find',
  });
  const row = result.rows[0];
  return row ? mapLimite(row) : null;
}

export async function createLimite(opts: {
  sitio_id: string;
  parametro: string;
  norma: RilesNorma;
  tipo: RilesTipoLimite;
  limite_min: number | null;
  limite_max: number | null;
  unidad: string;
  vigencia_desde: string;
  vigencia_hasta: string | null;
  nota: string | null;
}): Promise<RilesLimite> {
  const inserted = await query<{ id: string | number }>(
    `
    INSERT INTO riles_limite
      (sitio_id, parametro, norma, tipo, limite_min, limite_max, unidad,
       vigencia_desde, vigencia_hasta, nota)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING id
    `,
    [
      opts.sitio_id,
      opts.parametro,
      opts.norma,
      opts.tipo,
      opts.limite_min,
      opts.limite_max,
      opts.unidad,
      opts.vigencia_desde,
      opts.vigencia_hasta,
      opts.nota,
    ],
    { name: 'riles__limite_create' },
  );
  return (await findLimiteById(String(inserted.rows[0]!.id)))!;
}

/**
 * Cerrar la vigencia, nunca borrar la fila. Un límite que ya emitió veredictos
 * sobre muestras históricas no puede desaparecer: la muestra de marzo tiene que
 * seguir leyéndose contra el límite que regía en marzo.
 */
export async function cerrarLimite(id: string, hasta: string): Promise<RilesLimite | null> {
  await query(`UPDATE riles_limite SET vigencia_hasta = $2 WHERE id = $1`, [id, hasta], {
    name: 'riles__limite_cerrar',
  });
  return findLimiteById(id);
}

// ── Muestras ─────────────────────────────────────────────────────────────────

interface MuestraDbRow {
  id: string | number;
  sitio_id: string;
  fecha_muestra: string | Date;
  tipo: string;
  laboratorio: string | null;
  n_informe: string | null;
  punto: string | null;
  documento_id: string | number | null;
  nota: string | null;
  created_at: string;
  created_by: string | null;
}

interface ResultadoDbRow {
  id: string | number;
  muestra_id: string | number;
  parametro: string;
  valor: string | number;
  unidad: string;
  bajo_ld: boolean;
  nota: string | null;
}

function mapResultado(row: ResultadoDbRow): RilesResultado {
  return {
    id: String(row.id),
    muestra_id: String(row.muestra_id),
    parametro: row.parametro,
    valor: num(row.valor) ?? 0,
    unidad: row.unidad,
    bajo_ld: row.bajo_ld === true,
    nota: row.nota,
  };
}

function mapMuestra(row: MuestraDbRow, resultados: RilesResultado[]): RilesMuestra {
  return {
    id: String(row.id),
    sitio_id: row.sitio_id,
    fecha_muestra: dateIso(row.fecha_muestra)!,
    tipo: row.tipo as RilesTipoMuestra,
    laboratorio: row.laboratorio,
    n_informe: row.n_informe,
    punto: row.punto,
    documento_id: row.documento_id === null ? null : String(row.documento_id),
    nota: row.nota,
    created_at: row.created_at,
    created_by: row.created_by,
    resultados,
  };
}

const MUESTRA_COLUMNS =
  'id, sitio_id, fecha_muestra, tipo, laboratorio, n_informe, punto, documento_id, nota, created_at, created_by';

/**
 * Las muestras del sitio en el rango, con sus resultados.
 *
 * Los resultados salen en UNA consulta para todas las muestras en vez de una
 * por muestra: un año de autocontrol semanal son 52 muestras, y 52 consultas
 * extra por abrir una pantalla no se justifican.
 */
export async function listMuestras(opts: {
  sitioId: string;
  desde: string;
  hasta: string;
}): Promise<RilesMuestra[]> {
  const muestras = await query<MuestraDbRow>(
    `SELECT ${MUESTRA_COLUMNS}
       FROM riles_muestra
      WHERE sitio_id = $1 AND fecha_muestra BETWEEN $2 AND $3
      ORDER BY fecha_muestra DESC, id DESC`,
    [opts.sitioId, opts.desde, opts.hasta],
    { name: 'riles__muestras_list' },
  );
  if (muestras.rows.length === 0) return [];

  const ids = muestras.rows.map((m) => String(m.id));
  const resultados = await query<ResultadoDbRow>(
    `SELECT id, muestra_id, parametro, valor, unidad, bajo_ld, nota
       FROM riles_muestra_resultado
      WHERE muestra_id = ANY($1::bigint[])`,
    [ids],
    { name: 'riles__resultados_list' },
  );

  const porMuestra = new Map<string, RilesResultado[]>();
  for (const row of resultados.rows) {
    const key = String(row.muestra_id);
    const lista = porMuestra.get(key) ?? [];
    lista.push(mapResultado(row));
    porMuestra.set(key, lista);
  }

  return muestras.rows.map((m) => mapMuestra(m, porMuestra.get(String(m.id)) ?? []));
}

export async function findMuestraById(id: string): Promise<RilesMuestra | null> {
  const muestra = await query<MuestraDbRow>(
    `SELECT ${MUESTRA_COLUMNS} FROM riles_muestra WHERE id = $1`,
    [id],
    { name: 'riles__muestra_find' },
  );
  const row = muestra.rows[0];
  if (!row) return null;

  const resultados = await query<ResultadoDbRow>(
    `SELECT id, muestra_id, parametro, valor, unidad, bajo_ld, nota
       FROM riles_muestra_resultado WHERE muestra_id = $1`,
    [id],
    { name: 'riles__resultados_de_muestra' },
  );
  return mapMuestra(row, resultados.rows.map(mapResultado));
}

/**
 * Crea la muestra y sus resultados en una transacción.
 *
 * Sin transacción, un resultado que viola el índice único dejaría una muestra a
 * medio cargar en la base y el operador no tendría cómo saber cuáles de los 20
 * parámetros entraron.
 */
export async function createMuestra(opts: {
  sitio_id: string;
  fecha_muestra: string;
  tipo: RilesTipoMuestra;
  laboratorio: string | null;
  n_informe: string | null;
  punto: string | null;
  documento_id: string | null;
  nota: string | null;
  created_by: string | null;
  resultados: {
    parametro: string;
    valor: number;
    unidad: string;
    bajo_ld: boolean;
    nota: string | null;
  }[];
}): Promise<RilesMuestra> {
  const id = await transaction(async (client) => {
    const inserted = await client.query<{ id: string | number }>(
      `
      INSERT INTO riles_muestra
        (sitio_id, fecha_muestra, tipo, laboratorio, n_informe, punto, documento_id, nota, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
      `,
      [
        opts.sitio_id,
        opts.fecha_muestra,
        opts.tipo,
        opts.laboratorio,
        opts.n_informe,
        opts.punto,
        opts.documento_id,
        opts.nota,
        opts.created_by,
      ],
    );
    const muestraId = String(inserted.rows[0]!.id);

    for (const r of opts.resultados) {
      await client.query(
        `INSERT INTO riles_muestra_resultado (muestra_id, parametro, valor, unidad, bajo_ld, nota)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [muestraId, r.parametro, r.valor, r.unidad, r.bajo_ld, r.nota],
      );
    }
    return muestraId;
  });

  return (await findMuestraById(id))!;
}

/**
 * Una muestra sí se borra, a diferencia de un límite o una fuente.
 *
 * No es un dato declarado que el cliente ya vio en un balance: es la
 * transcripción de un informe de laboratorio, y una transcripción equivocada se
 * corrige borrándola y volviéndola a cargar. Los resultados caen con ella por
 * ON DELETE CASCADE.
 */
export async function deleteMuestra(id: string): Promise<void> {
  await query(`DELETE FROM riles_muestra WHERE id = $1`, [id], { name: 'riles__muestra_delete' });
}

/** ¿Existe el parámetro en el catálogo? Evita un FK violation con traza fea. */
export async function parametrosDesconocidos(codigos: string[]): Promise<string[]> {
  if (codigos.length === 0) return [];
  const result = await query<{ codigo: string }>(
    `SELECT codigo FROM riles_parametro WHERE codigo = ANY($1::varchar[])`,
    [codigos],
    { name: 'riles__parametros_existen' },
  );
  const conocidos = new Set(result.rows.map((r) => r.codigo));
  return codigos.filter((c) => !conocidos.has(c));
}
