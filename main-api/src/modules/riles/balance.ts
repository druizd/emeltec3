/**
 * La aritmética del balance hídrico, sin base de datos ni infraestructura.
 *
 * Vive aparte de `service.ts` a propósito: acá no se importa nada que tenga
 * side effects, así que el cálculo se puede testear tal cual, sin mocks.
 */
import type {
  RilesBalanceAporte,
  RilesBalancePoint,
  RilesConfig,
  RilesEstadoPeriodo,
  RilesFuente,
  RilesGranularidad,
} from './types';

/** Serie de un contador ya normalizada a m³, indexada por período. */
export type SeriePorPeriodo = Map<
  string,
  { delta_m3: number | null; unidad_origen: string | null }
>;

// ── Unidades ─────────────────────────────────────────────────────────────────

const FACTOR_A_M3: Record<string, number> = {
  m3: 1,
  'm³': 1,
  mc: 1,
  l: 0.001,
  lt: 0.001,
  lts: 0.001,
  litro: 0.001,
  litros: 0.001,
};

/**
 * Normaliza un delta de contador a m³.
 *
 * El totalizador de un medidor puede venir en litros — pasó en S130 — y sumar
 * litros con m³ en el mismo balance daría un coeficiente mil veces malo sin que
 * nada se queje. Unidad desconocida o vacía se asume m³, y el aporte conserva
 * `unidad_origen` para que la pantalla pueda mostrarla.
 */
export function aM3(delta: number | null, unidad: string | null): number | null {
  if (delta === null || !Number.isFinite(delta)) return null;
  const key = String(unidad ?? '')
    .trim()
    .toLowerCase();
  if (!key) return delta;
  const factor = FACTOR_A_M3[key];
  return factor === undefined ? delta : delta * factor;
}

// ── Períodos ─────────────────────────────────────────────────────────────────

/** Último día del mes de un período `YYYY-MM-01`. */
function finDeMes(periodo: string): string {
  const [y, m] = periodo.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return `${periodo.slice(0, 8)}${String(ultimo).padStart(2, '0')}`;
}

export function limitesPeriodo(
  periodo: string,
  granularidad: RilesGranularidad,
): { inicio: string; fin: string } {
  return granularidad === 'mes'
    ? { inicio: periodo, fin: finDeMes(periodo) }
    : { inicio: periodo, fin: periodo };
}

/** Los períodos del rango, en el mismo formato de clave que usa contadores. */
export function periodosDelRango(
  desde: string,
  hasta: string,
  granularidad: RilesGranularidad,
): string[] {
  const periodos: string[] = [];
  if (granularidad === 'mes') {
    const [y, m] = desde.split('-').map(Number);
    const cursor = new Date(Date.UTC(y!, m! - 1, 1));
    const limite = hasta.slice(0, 7);
    while (cursor.toISOString().slice(0, 7) <= limite) {
      periodos.push(`${cursor.toISOString().slice(0, 7)}-01`);
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  } else {
    const cursor = new Date(`${desde}T00:00:00Z`);
    const limite = Date.parse(`${hasta}T00:00:00Z`);
    while (cursor.getTime() <= limite) {
      periodos.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  return periodos;
}

export type Solape = 'fuera' | 'total' | 'parcial';

/**
 * Cuánto de un período cubre la ventana de vigencia de una fuente.
 * Las fechas son ISO cortas, así que comparar como string ordena bien.
 */
export function solapeVigencia(
  fuente: Pick<RilesFuente, 'vigencia_desde' | 'vigencia_hasta'>,
  inicio: string,
  fin: string,
): Solape {
  const desde = fuente.vigencia_desde;
  const hasta = fuente.vigencia_hasta ?? '9999-12-31';
  if (hasta < inicio || desde > fin) return 'fuera';
  if (desde <= inicio && hasta >= fin) return 'total';
  return 'parcial';
}

// ── Balance ──────────────────────────────────────────────────────────────────

function sumarNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

export interface AporteInput {
  fuente: RilesFuente;
  serie: SeriePorPeriodo;
}

export function construirPuntos(opts: {
  periodos: string[];
  granularidad: RilesGranularidad;
  config: RilesConfig;
  aportes: AporteInput[];
  /** Totalizador propio del sitio RILes. Vacío si no tiene medidor. */
  propio: SeriePorPeriodo;
}): RilesBalancePoint[] {
  const { periodos, granularidad, config, aportes, propio } = opts;

  return periodos.map((periodo) => {
    const { inicio, fin } = limitesPeriodo(periodo, granularidad);

    const detalle: RilesBalanceAporte[] = [];
    for (const { fuente, serie } of aportes) {
      const solape = solapeVigencia(fuente, inicio, fin);
      if (solape === 'fuera') continue;

      const dato = serie.get(periodo);
      const deltaM3 = dato?.delta_m3 ?? null;
      detalle.push({
        fuente_id: fuente.id,
        sitio_id: fuente.fuente_sitio_id,
        descripcion: fuente.fuente_descripcion ?? null,
        direccion: fuente.direccion,
        rol: fuente.rol,
        factor: fuente.factor,
        delta_m3: deltaM3,
        aporte_m3: deltaM3 === null ? null : deltaM3 * fuente.factor,
        unidad_origen: dato?.unidad_origen ?? null,
        sin_dato: deltaM3 === null,
        vigencia_parcial: solape === 'parcial',
      });
    }

    // `null` cuando NINGUNA fuente de esa dirección tuvo dato: un período sin
    // lecturas no es un período de cero m³.
    const sumar = (direccion: 'entrada' | 'salida'): number | null =>
      detalle
        .filter((a) => a.direccion === direccion && a.aporte_m3 !== null)
        .reduce<number | null>((acc, a) => (acc ?? 0) + a.aporte_m3!, null);

    const entrada = sumar('entrada');
    const salidaDeFuentes = sumar('salida');
    const propioDelta = propio.get(periodo)?.delta_m3 ?? null;

    const coefEsperado = config.coef_descarga_esperado_pct;
    const derivada =
      entrada !== null && coefEsperado !== null ? (entrada * coefEsperado) / 100 : null;

    let salidaBase: number | null = null;
    let estimado = false;
    if (config.modo_caudal === 'propio' || config.modo_caudal === 'mixto') {
      salidaBase = propioDelta;
    }
    if (
      salidaBase === null &&
      (config.modo_caudal === 'derivado' || config.modo_caudal === 'mixto')
    ) {
      salidaBase = derivada;
      estimado = salidaBase !== null;
    }

    const salida = sumarNullable(salidaBase, salidaDeFuentes);

    const coeficiente =
      entrada !== null && entrada > 0 && salida !== null ? (salida / entrada) * 100 : null;
    const consumoNeto = entrada !== null && salida !== null ? entrada - salida : null;

    const fuentesOk = detalle.every((a) => !a.sin_dato && !a.vigencia_parcial);
    const esperaMedidorPropio = config.modo_caudal !== 'derivado';
    const completo = fuentesOk && (!esperaMedidorPropio || propioDelta !== null);

    return {
      periodo,
      volumen_entrada_m3: entrada,
      volumen_salida_m3: salida,
      coeficiente_pct: coeficiente,
      consumo_neto_m3: consumoNeto,
      estimado,
      completo,
      estado: estadoPeriodo(coeficiente, config),
      aportes: detalle,
    };
  });
}

/**
 * En modo `derivado` el coeficiente es, por construcción, el configurado: el
 * estado siempre dará `ok`. No es un bug — es la tautología de estimar la
 * salida desde la entrada, y por eso el punto viaja con `estimado: true`.
 */
export function estadoPeriodo(
  coeficiente: number | null,
  config: Pick<RilesConfig, 'coef_descarga_esperado_pct' | 'coef_tolerancia_pct'>,
): RilesEstadoPeriodo {
  const esperado = config.coef_descarga_esperado_pct;
  if (esperado === null) return 'sin_banda';
  if (coeficiente === null) return 'sin_dato';
  const diff = coeficiente - esperado;
  if (Math.abs(diff) <= config.coef_tolerancia_pct) return 'ok';
  return diff > 0 ? 'sobre' : 'bajo';
}
