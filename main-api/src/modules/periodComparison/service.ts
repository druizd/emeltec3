/**
 * Comparación de períodos A vs B por sitio, para la "Vista General" de una
 * empresa o sub-empresa.
 *
 * Reemplaza las 3 llamadas por sitio que hacía el frontend (period-aggregates
 * de A, de B y contadores-diarios): con 11 pozos eran 33 requests encoladas de
 * a 6 por el navegador y tardaban 30-40 s en llenar la vista. Acá se resuelve
 * todo del lado servidor con una consulta a `equipo_5min` por sitio (cubre A y
 * B en un solo WHERE) más la serie diaria del totalizador que ya materializa
 * el módulo contadores.
 *
 * Las funciones puras (acumularAgregados, sumarConsumo, diasInclusivos,
 * diasCoberturaContadores) no tocan la DB y se testean con fechas fijas.
 */
import { query } from '../../config/dbHelpers';
import { CHILE_TIME_ZONE } from '../../shared/time';
import { getMappingsBySiteId, getPozoConfigBySiteId } from '../sites/repo';
import { mapHistoricalDashboardRow } from '../sites/service';
import type { HistoricalCell, HistoryEquipoRow, PozoConfig, RegMap, Site } from '../sites/types';
import { chileDayKey, getDailySeries } from '../contadores/service';
import type { ContadorDiarioPoint } from '../contadores/types';

/** Tope de `period-aggregates`: un año por período. */
export const MAX_DIAS_RANGO = 366;
/** Tope de `contadores-diarios` (zod max(120) en su controller). */
export const MAX_DIAS_CONTADORES = 120;
/** Sitios procesados en paralelo. Cada uno son 3-4 consultas. */
const CONCURRENCIA_SITIOS = 4;

/** Rango inclusivo de días Chile, ISO 'YYYY-MM-DD'. */
export interface RangoIso {
  desde: string;
  hasta: string;
}

export interface AggStat {
  avg: number | null;
  n: number;
  unidad: string | null;
}

export interface ConsumoStat {
  /** Suma de deltas diarios del totalizador en el rango. null si ningún día tuvo muestras. */
  m3: number | null;
  dias_con_datos: number;
  unidad: string | null;
}

export interface SitioComparacion {
  site_id: string;
  descripcion: string;
  tipo_sitio: string;
  activo: boolean;
  caudal: { a: AggStat; b: AggStat };
  /** Nivel freático proyectado si el sitio lo tiene; si no, nivel crudo del sensor. */
  nivel: { a: AggStat; b: AggStat };
  consumo: { a: ConsumoStat; b: ConsumoStat };
}

export interface ComparacionPeriodos {
  periodos: { a: RangoIso; b: RangoIso };
  /**
   * false cuando alguno de los períodos empieza más de MAX_DIAS_CONTADORES
   * días atrás: el consumo no se puede calcular y viene null en todos los sitios.
   */
  consumo_disponible: boolean;
  sitios: SitioComparacion[];
}

/* ── Fechas ─────────────────────────────────────────────────────────────── */

export function diasInclusivos(desde: string, hasta: string): number {
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Días que hay que pedir a `contadores-diarios` (siempre termina hoy) para
 * cubrir ambos rangos. null si excede el tope del endpoint.
 */
export function diasCoberturaContadores(rangos: RangoIso[], hoyIso: string): number | null {
  const desdeMin = rangos.map((r) => r.desde).sort()[0];
  if (!desdeMin) return null;
  const dias = diasInclusivos(desdeMin, hoyIso);
  return dias >= 1 && dias <= MAX_DIAS_CONTADORES ? dias : null;
}

function enRango(dia: string, rango: RangoIso): boolean {
  return dia >= rango.desde && dia <= rango.hasta;
}

/* ── Agregados de caudal / nivel ────────────────────────────────────────── */

/** Fila de `equipo_5min` ya transformada, con su día Chile precalculado. */
export interface FilaHistorica {
  dia: string;
  caudal: HistoricalCell;
  nivel: HistoricalCell;
  nivel_freatico: HistoricalCell;
}

interface Acumulador {
  sum: number;
  n: number;
  unidad: string | null;
}

function acumular(acc: Acumulador, cell: HistoricalCell): void {
  const v = Number(cell.valor);
  if (!cell.ok || !Number.isFinite(v)) return;
  acc.sum += v;
  acc.n += 1;
  if (!acc.unidad) acc.unidad = cell.unidad;
}

function cerrar(acc: Acumulador): AggStat {
  return { avg: acc.n > 0 ? acc.sum / acc.n : null, n: acc.n, unidad: acc.unidad };
}

/**
 * Promedio de caudal y nivel de las filas que caen dentro del rango. El nivel
 * prefiere `nivel_freatico` (proyectado con pozo_config) y cae a `nivel` crudo
 * cuando el sitio no tiene ninguna muestra freática en el rango, igual que la
 * tabla diaria de Resumen por Período.
 */
export function acumularAgregados(
  filas: FilaHistorica[],
  rango: RangoIso,
): { caudal: AggStat; nivel: AggStat } {
  const caudal: Acumulador = { sum: 0, n: 0, unidad: null };
  const freatico: Acumulador = { sum: 0, n: 0, unidad: null };
  const crudo: Acumulador = { sum: 0, n: 0, unidad: null };
  for (const f of filas) {
    if (!enRango(f.dia, rango)) continue;
    acumular(caudal, f.caudal);
    acumular(freatico, f.nivel_freatico);
    acumular(crudo, f.nivel);
  }
  return { caudal: cerrar(caudal), nivel: cerrar(freatico.n > 0 ? freatico : crudo) };
}

/* ── Consumo ────────────────────────────────────────────────────────────── */

/**
 * Suma los deltas diarios del totalizador dentro del rango. Un día sin
 * muestras no cuenta; un día con muestras y delta null suma 0 (sin datos ≠
 * consumo 0, por eso `m3` es null cuando ningún día tuvo muestras).
 */
export function sumarConsumo(serie: ContadorDiarioPoint[], rango: RangoIso): ConsumoStat {
  const dias = serie.filter((d) => enRango(d.dia, rango) && d.muestras > 0);
  if (dias.length === 0) return { m3: null, dias_con_datos: 0, unidad: null };
  const m3 = dias.reduce((acc, d) => acc + Number(d.delta ?? 0), 0);
  return { m3, dias_con_datos: dias.length, unidad: dias.find((d) => d.unidad)?.unidad ?? null };
}

/* ── Acceso a datos ─────────────────────────────────────────────────────── */

const SITE_COLUMNS =
  'id, descripcion, empresa_id, sub_empresa_id, id_serial, ubicacion, coord_norte, coord_este, huso, tipo_sitio, activo';

export interface AlcanceComparacion {
  /** 'sub_empresa' cuando :id es una sub-empresa, 'empresa' cuando es una empresa. */
  tipo: 'sub_empresa' | 'empresa';
  id: string;
  nombre: string;
  empresa_id: string;
}

/** Resuelve :id como sub-empresa primero y como empresa después (mismo orden que `/:id/sites`). */
export async function resolverAlcance(id: string): Promise<AlcanceComparacion | null> {
  const sub = await query<{ id: string; nombre: string; empresa_id: string }>(
    'SELECT id, nombre, empresa_id FROM sub_empresa WHERE id = $1',
    [id],
    { name: 'periodcmp__sub_empresa_by_id' },
  );
  const s = sub.rows[0];
  if (s) return { tipo: 'sub_empresa', id: s.id, nombre: s.nombre, empresa_id: s.empresa_id };

  const emp = await query<{ id: string; nombre: string }>(
    'SELECT id, nombre FROM empresa WHERE id = $1',
    [id],
    { name: 'periodcmp__empresa_by_id' },
  );
  const e = emp.rows[0];
  if (e) return { tipo: 'empresa', id: e.id, nombre: e.nombre, empresa_id: e.id };
  return null;
}

/**
 * Sitios del alcance. `soloSubEmpresaId` restringe a una sub-empresa aunque el
 * alcance sea la empresa completa (Gerente/Cliente con sub-empresa asignada).
 */
export async function listarSitiosDelAlcance(
  alcance: AlcanceComparacion,
  soloSubEmpresaId: string | null,
): Promise<Site[]> {
  const params: unknown[] = [alcance.id];
  let where =
    alcance.tipo === 'sub_empresa' ? 'WHERE sub_empresa_id = $1' : 'WHERE empresa_id = $1';
  if (soloSubEmpresaId) {
    params.push(soloSubEmpresaId);
    where += ` AND sub_empresa_id = $${params.length}`;
  }
  const result = await query<Site>(
    `SELECT ${SITE_COLUMNS} FROM sitio ${where} ORDER BY descripcion ASC`,
    params,
    { name: `periodcmp__sitios_${alcance.tipo}${soloSubEmpresaId ? '_sub' : ''}` },
  );
  return result.rows;
}

interface FilaEquipo5min {
  time: string;
  id_serial: string;
  data: Record<string, unknown>;
}

/**
 * Filas de `equipo_5min` del serial que caen en cualquiera de los rangos (una
 * sola consulta para A y B). Los bordes se calculan en días Chile, igual que
 * `period-aggregates`.
 */
async function listarEquipo5minEnRangos(
  idSerial: string,
  rangos: RangoIso[],
): Promise<FilaEquipo5min[]> {
  const params: unknown[] = [idSerial];
  const clauses = rangos.map((r) => {
    params.push(r.desde, r.hasta);
    const i = params.length - 1;
    return `(bucket >= ($${i}::date::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}')
         AND bucket <  (($${i + 1}::date + INTERVAL '1 day')::timestamp AT TIME ZONE '${CHILE_TIME_ZONE}'))`;
  });
  const result = await query<FilaEquipo5min>(
    `SELECT bucket AS time, id_serial, data
       FROM equipo_5min
      WHERE id_serial = $1
        AND (${clauses.join(' OR ')})`,
    params,
    { name: `periodcmp__equipo_5min_${rangos.length}r` },
  );
  return result.rows;
}

/* ── Cálculo por sitio ──────────────────────────────────────────────────── */

function statVacio(): AggStat {
  return { avg: null, n: 0, unidad: null };
}

function consumoVacio(): ConsumoStat {
  return { m3: null, dias_con_datos: 0, unidad: null };
}

function filaVacia(site: Site): SitioComparacion {
  return {
    site_id: site.id,
    descripcion: site.descripcion,
    tipo_sitio: site.tipo_sitio,
    activo: site.activo,
    caudal: { a: statVacio(), b: statVacio() },
    nivel: { a: statVacio(), b: statVacio() },
    consumo: { a: consumoVacio(), b: consumoVacio() },
  };
}

/** Convierte las filas crudas de equipo_5min en FilaHistorica con el mapper del módulo sites. */
export function transformarFilas(
  filas: FilaEquipo5min[],
  site: Site,
  mappings: RegMap[],
  pozoConfig: PozoConfig | null,
): FilaHistorica[] {
  return filas.map((f) => {
    const row: HistoryEquipoRow = {
      time: f.time,
      received_at: null,
      id_serial: f.id_serial,
      data: f.data,
    };
    const mapped = mapHistoricalDashboardRow({ row, site, mappings, pozoConfig });
    return {
      dia: chileDayKey(new Date(f.time)),
      caudal: mapped.caudal,
      nivel: mapped.nivel,
      nivel_freatico: mapped.nivel_freatico,
    };
  });
}

async function compararSitio(
  site: Site,
  rangos: { a: RangoIso; b: RangoIso },
  diasContadores: number | null,
): Promise<SitioComparacion> {
  const fila = filaVacia(site);
  if (!site.id_serial) return fila;

  const [crudas, mappings, pozoConfig, serieDiaria] = await Promise.all([
    listarEquipo5minEnRangos(site.id_serial, [rangos.a, rangos.b]),
    getMappingsBySiteId(site.id),
    site.tipo_sitio === 'pozo' ? getPozoConfigBySiteId(site.id) : Promise.resolve(null),
    diasContadores
      ? getDailySeries({ sitioId: site.id, rol: 'totalizador', dias: diasContadores })
      : Promise.resolve<ContadorDiarioPoint[]>([]),
  ]);

  const filas = transformarFilas(crudas, site, mappings, pozoConfig);
  const a = acumularAgregados(filas, rangos.a);
  const b = acumularAgregados(filas, rangos.b);
  fila.caudal = { a: a.caudal, b: b.caudal };
  fila.nivel = { a: a.nivel, b: b.nivel };
  if (diasContadores) {
    fila.consumo = {
      a: sumarConsumo(serieDiaria, rangos.a),
      b: sumarConsumo(serieDiaria, rangos.b),
    };
  }
  return fila;
}

/** Promise.all con a lo más `limite` tareas en vuelo, preservando el orden. */
async function mapConLimite<T, R>(
  items: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      if (item === undefined) continue;
      out[i] = await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, worker));
  return out;
}

export async function compararPeriodos(opts: {
  sitios: Site[];
  rangos: { a: RangoIso; b: RangoIso };
  hoyIso?: string;
}): Promise<ComparacionPeriodos> {
  const hoy = opts.hoyIso ?? chileDayKey(new Date());
  const diasContadores = diasCoberturaContadores([opts.rangos.a, opts.rangos.b], hoy);
  const sitios = await mapConLimite(opts.sitios, CONCURRENCIA_SITIOS, (site) =>
    compararSitio(site, opts.rangos, diasContadores),
  );
  return {
    periodos: opts.rangos,
    consumo_disponible: diasContadores !== null,
    sitios,
  };
}
