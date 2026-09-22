/**
 * Servicio del módulo riles: arma el balance hídrico de un sitio de RILes.
 *
 * El volumen NO se recalcula acá. Sale del módulo `contadores`, que ya resuelve
 * lo difícil para cualquier sitio y cualquier rol de contador: resets por
 * overflow, recambios de medidor que parten la serie, muestras corruptas y la
 * materialización mensual/diaria. Este módulo sólo combina esas series con el
 * prorrateo y la vigencia de cada vínculo — la aritmética vive en `balance.ts`.
 *
 * Ver docs/riles-propuesta-modulo.md.
 */
import {
  getDailySeries,
  getDayRangeChile,
  getMonthRangeChile,
  getMonthlySeries,
} from '../contadores/service';
import { getSiteById } from '../sites/repo';
import { NotFoundError } from '../../shared/errors';
import {
  aM3,
  construirPuntos,
  periodosDelRango,
  type AporteInput,
  type SeriePorPeriodo,
} from './balance';
import { findRilesConfig, listFuentes } from './repo';
import { catalogoPorCodigo, findMuestraById, listLimites, listMuestras } from './lab-repo';
import { contarExcedencias, evaluarResultados } from './laboratorio';
import {
  DEFAULT_CONFIG,
  type RilesBalancePayload,
  type RilesConfig,
  type RilesGranularidad,
  type RilesLimite,
  type RilesMuestra,
  type RilesMuestraEvaluada,
  type RilesNorma,
  type RilesParametro,
} from './types';

/** Cuántos meses hay que pedirle a contadores para cubrir desde `desdeIso`. */
export function mesesDesde(desdeIso: string, ref: Date = new Date()): number {
  const actual = getMonthRangeChile(ref).mesIso;
  const [ay, am] = actual.split('-').map(Number);
  const [dy, dm] = desdeIso.split('-').map(Number);
  return Math.max(1, (ay! - dy!) * 12 + (am! - dm!) + 1);
}

/** Cuántos días hay que pedirle a contadores para cubrir desde `desdeIso`. */
export function diasDesde(desdeIso: string, ref: Date = new Date()): number {
  const hoy = getDayRangeChile(ref).diaIso;
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${desdeIso}T00:00:00Z`);
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

function configPorDefecto(sitioId: string): RilesConfig {
  return { sitio_id: sitioId, ...DEFAULT_CONFIG };
}

async function serieDe(
  sitioId: string,
  rol: string,
  granularidad: RilesGranularidad,
  desde: string,
): Promise<SeriePorPeriodo> {
  const serie: SeriePorPeriodo = new Map();
  if (granularidad === 'mes') {
    for (const p of await getMonthlySeries({ sitioId, rol, meses: mesesDesde(desde) })) {
      serie.set(p.mes, { delta_m3: aM3(p.delta, p.unidad), unidad_origen: p.unidad });
    }
  } else {
    for (const p of await getDailySeries({ sitioId, rol, dias: diasDesde(desde) })) {
      serie.set(p.dia, { delta_m3: aM3(p.delta, p.unidad), unidad_origen: p.unidad });
    }
  }
  return serie;
}

export async function getBalance(opts: {
  sitioId: string;
  desde: string;
  hasta: string;
  granularidad: RilesGranularidad;
}): Promise<RilesBalancePayload> {
  const { sitioId, desde, hasta, granularidad } = opts;

  const site = await getSiteById(sitioId);
  if (!site) throw new NotFoundError('Sitio no encontrado');

  const config = (await findRilesConfig(sitioId)) ?? configPorDefecto(sitioId);
  const fuentes = await listFuentes(sitioId);
  const periodos = periodosDelRango(desde, hasta, granularidad);

  // Una fuente puede aparecer dos veces con ventanas distintas (cambio de
  // prorrateo): la serie del sitio se pide una sola vez y se comparte.
  const cache = new Map<string, SeriePorPeriodo>();
  const serieCacheada = async (id: string, rol: string): Promise<SeriePorPeriodo> => {
    const key = `${id}|${rol}`;
    if (!cache.has(key)) cache.set(key, await serieDe(id, rol, granularidad, desde));
    return cache.get(key)!;
  };

  const aportes: AporteInput[] = [];
  for (const fuente of fuentes) {
    aportes.push({ fuente, serie: await serieCacheada(fuente.fuente_sitio_id, fuente.rol) });
  }

  // En modo derivado no hay medidor en la descarga: ni se consulta.
  const propio: SeriePorPeriodo =
    config.modo_caudal === 'derivado' ? new Map() : await serieCacheada(sitioId, 'totalizador');

  return {
    site: { id: site.id, descripcion: site.descripcion, tipo_sitio: site.tipo_sitio },
    config,
    granularidad,
    desde,
    hasta,
    puntos: construirPuntos({ periodos, granularidad, config, aportes, propio }),
  };
}

// ── Laboratorio (fase 2) ─────────────────────────────────────────────────────

/**
 * El volumen descargado por día en el rango, indexado por fecha.
 *
 * Es el mismo `getBalance` de la pantalla, pedido en granularidad diaria: la
 * carga de una muestra se calcula contra el volumen del día en que se tomó, no
 * contra el del mes. Se pide UNA vez para todas las muestras del rango.
 */
async function volumenesPorDia(
  sitioId: string,
  desde: string,
  hasta: string,
): Promise<Map<string, { m3: number | null; estimado: boolean }>> {
  const balance = await getBalance({ sitioId, desde, hasta, granularidad: 'dia' });
  return new Map(
    balance.puntos.map((p) => [p.periodo, { m3: p.volumen_salida_m3, estimado: p.estimado }]),
  );
}

function evaluarMuestra(opts: {
  muestra: RilesMuestra;
  catalogo: Map<string, RilesParametro>;
  limites: RilesLimite[];
  norma: RilesNorma | null;
  volumen: { m3: number | null; estimado: boolean } | undefined;
}): RilesMuestraEvaluada {
  const { muestra, catalogo, limites, norma, volumen } = opts;
  const resultados = evaluarResultados({
    resultados: muestra.resultados,
    catalogo,
    limites,
    norma,
    fecha: muestra.fecha_muestra,
    volumenM3: volumen?.m3 ?? null,
  });
  return {
    ...muestra,
    volumen_dia_m3: volumen?.m3 ?? null,
    volumen_estimado: volumen?.estimado ?? false,
    norma,
    resultados,
    n_excede: contarExcedencias(resultados),
  };
}

export async function getMuestras(opts: {
  sitioId: string;
  desde: string;
  hasta: string;
}): Promise<RilesMuestraEvaluada[]> {
  const { sitioId, desde, hasta } = opts;

  const site = await getSiteById(sitioId);
  if (!site) throw new NotFoundError('Sitio no encontrado');

  const muestras = await listMuestras({ sitioId, desde, hasta });
  // Sin muestras no hay nada que cruzar: ni se consulta el balance, que es la
  // parte cara (dos series de contadores por cada día del rango).
  if (muestras.length === 0) return [];

  const [config, catalogo, limites] = await Promise.all([
    findRilesConfig(sitioId),
    catalogoPorCodigo(),
    listLimites(sitioId),
  ]);

  // El rango de las muestras, no el pedido: si el operador pide un año y hay
  // tres muestras en marzo, el balance diario se pide sólo para marzo.
  const fechas = muestras.map((m) => m.fecha_muestra).sort();
  const volumenes = await volumenesPorDia(sitioId, fechas[0]!, fechas[fechas.length - 1]!);

  const norma = config?.norma ?? null;
  return muestras.map((muestra) =>
    evaluarMuestra({
      muestra,
      catalogo,
      limites,
      norma,
      volumen: volumenes.get(muestra.fecha_muestra),
    }),
  );
}

export async function getMuestra(
  sitioId: string,
  muestraId: string,
): Promise<RilesMuestraEvaluada> {
  const muestra = await findMuestraById(muestraId);
  if (!muestra || muestra.sitio_id !== sitioId) {
    throw new NotFoundError('Muestra no encontrada en este sitio');
  }

  const [config, catalogo, limites, volumenes] = await Promise.all([
    findRilesConfig(sitioId),
    catalogoPorCodigo(),
    listLimites(sitioId),
    volumenesPorDia(sitioId, muestra.fecha_muestra, muestra.fecha_muestra),
  ]);

  return evaluarMuestra({
    muestra,
    catalogo,
    limites,
    norma: config?.norma ?? null,
    volumen: volumenes.get(muestra.fecha_muestra),
  });
}
