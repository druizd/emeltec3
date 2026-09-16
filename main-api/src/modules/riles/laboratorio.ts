/**
 * La aritmética del laboratorio de RILes, sin base de datos ni infraestructura.
 *
 * Hermana de `balance.ts`: acá tampoco se importa nada con side effects, así
 * que todo esto se testea tal cual, sin mocks.
 *
 * Hace tres cosas, y ninguna adivina:
 *
 *  1. **Convierte unidades.** Un metal informado en µg/L comparado contra un
 *     límite en mg/L da un veredicto mil veces malo. Si las unidades no son
 *     convertibles entre sí, el resultado queda `sin_comparar` — nunca `ok`.
 *  2. **Calcula la carga en kg** cruzando la concentración con el volumen que
 *     ya entrega el balance: mg/L × m³ ÷ 1000 = kg.
 *  3. **Emite el veredicto** contra el límite vigente a la fecha de la muestra.
 *
 * Ver docs/riles-propuesta-modulo.md §6.
 */
import type {
  RilesEstadoResultado,
  RilesLimite,
  RilesParametro,
  RilesResultado,
  RilesResultadoEvaluado,
  RilesTipoLimite,
} from './types';

// ── Unidades ─────────────────────────────────────────────────────────────────

/**
 * Cada unidad conocida, con la familia a la que pertenece y su factor hacia la
 * base de esa familia. Convertir sólo tiene sentido dentro de una familia: de
 * mg/L a µg/L sí, de mg/L a °C no.
 *
 * `mg/L` es la base de las concentraciones másicas porque es la unidad en que
 * están escritos el DS 90, el DS 609 y el DS 46.
 */
interface UnidadInfo {
  familia: string;
  /** Cuántas unidades base vale una de éstas. */
  factor: number;
}

const UNIDADES: Record<string, UnidadInfo> = {
  // Concentración másica — base mg/L.
  'mg/l': { familia: 'concentracion', factor: 1 },
  ppm: { familia: 'concentracion', factor: 1 },
  'g/m3': { familia: 'concentracion', factor: 1 },
  'mg/dm3': { familia: 'concentracion', factor: 1 },
  'ug/l': { familia: 'concentracion', factor: 0.001 },
  'µg/l': { familia: 'concentracion', factor: 0.001 },
  'mcg/l': { familia: 'concentracion', factor: 0.001 },
  ppb: { familia: 'concentracion', factor: 0.001 },
  'mg/m3': { familia: 'concentracion', factor: 0.001 },
  'g/l': { familia: 'concentracion', factor: 1000 },
  'kg/m3': { familia: 'concentracion', factor: 1000 },

  // pH — adimensional, pero con nombres varios.
  uph: { familia: 'ph', factor: 1 },
  ph: { familia: 'ph', factor: 1 },
  'unidad ph': { familia: 'ph', factor: 1 },
  'unidades ph': { familia: 'ph', factor: 1 },

  // Temperatura — base °C. Sin Fahrenheit a propósito: la conversión es afín
  // (no un factor) y ningún laboratorio chileno informa en °F.
  '°c': { familia: 'temperatura', factor: 1 },
  ºc: { familia: 'temperatura', factor: 1 },
  c: { familia: 'temperatura', factor: 1 },
  celsius: { familia: 'temperatura', factor: 1 },

  // Conductividad — base µS/cm.
  'us/cm': { familia: 'conductividad', factor: 1 },
  'µs/cm': { familia: 'conductividad', factor: 1 },
  'ms/cm': { familia: 'conductividad', factor: 1000 },

  // Sólidos sedimentables — base mL/L/h.
  'ml/l/h': { familia: 'sedimentables', factor: 1 },
  'ml/l': { familia: 'sedimentables', factor: 1 },

  // Poder espumógeno — base mm.
  mm: { familia: 'altura', factor: 1 },

  // Recuento microbiológico — base NMP/100 mL. NMP y UFC son métodos distintos
  // (número más probable vs. unidades formadoras de colonia) y acá se tratan
  // como intercambiables: es como está escrita la norma y como informan los
  // laboratorios. Es una convención, no una identidad.
  'nmp/100ml': { familia: 'recuento', factor: 1 },
  'ufc/100ml': { familia: 'recuento', factor: 1 },
  'nmp/100 ml': { familia: 'recuento', factor: 1 },
  'ufc/100 ml': { familia: 'recuento', factor: 1 },
};

/** Minúsculas, sin espacios de sobra y con las variantes de micro unificadas. */
export function normalizarUnidad(unidad: string | null | undefined): string {
  return String(unidad ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/μ/g, 'µ'); // U+03BC (mu griega) → U+00B5 (signo micro)
}

/**
 * Convierte `valor` de `desde` a `hacia`. `null` cuando no son convertibles —
 * unidad desconocida o de otra familia. Nunca devuelve el valor sin tocar como
 * consuelo: un número en la unidad equivocada es peor que ningún número.
 */
export function convertir(valor: number, desde: string, hacia: string): number | null {
  if (!Number.isFinite(valor)) return null;
  const a = normalizarUnidad(desde);
  const b = normalizarUnidad(hacia);
  if (a === b) return valor;

  const info = UNIDADES[a];
  const destino = UNIDADES[b];
  if (!info || !destino || info.familia !== destino.familia) return null;
  return (valor * info.factor) / destino.factor;
}

// ── Carga ────────────────────────────────────────────────────────────────────

/**
 * Carga contaminante en kg.
 *
 * mg/L × m³ = mg/L × 1000 L = 1000 mg = 1 g, así que kg = mg/L × m³ ÷ 1000.
 *
 * Sólo tiene sentido sobre una concentración másica. El pH es logarítmico y la
 * temperatura es intensiva: multiplicarlos por un volumen no da kg de nada, y
 * por eso el catálogo los marca con `aplica_carga = false`.
 */
export function cargaKg(concentracionMgL: number | null, volumenM3: number | null): number | null {
  if (concentracionMgL === null || volumenM3 === null) return null;
  if (!Number.isFinite(concentracionMgL) || !Number.isFinite(volumenM3)) return null;
  return (concentracionMgL * volumenM3) / 1000;
}

// ── Límites ──────────────────────────────────────────────────────────────────

/**
 * El límite que estaba vigente a `fecha` para ese parámetro, esa norma y ese
 * tipo. Si hay varios que califican —no debería, pero el índice único sólo
 * impide repetir el `vigencia_desde`— gana el que empezó después.
 *
 * Misma lógica que `reg_map`: un cambio de límite se expresa con dos filas de
 * ventanas disjuntas, nunca editando la vigente.
 */
export function limiteVigente(
  limites: RilesLimite[],
  opts: { parametro: string; norma: string | null; fecha: string; tipo: RilesTipoLimite },
): RilesLimite | null {
  if (!opts.norma) return null;
  const candidatos = limites.filter(
    (l) =>
      l.parametro === opts.parametro &&
      l.norma === opts.norma &&
      l.tipo === opts.tipo &&
      l.vigencia_desde <= opts.fecha &&
      (l.vigencia_hasta === null || l.vigencia_hasta >= opts.fecha),
  );
  if (candidatos.length === 0) return null;
  return candidatos.reduce((mejor, l) => (l.vigencia_desde > mejor.vigencia_desde ? l : mejor));
}

/**
 * Veredicto de un valor contra un límite.
 *
 * El `< LD` es el caso interesante. El laboratorio no midió: informó que el
 * método no alcanza a ver por debajo de cierto umbral, y `valor` es ese umbral.
 *
 *  - Si el umbral ya está bajo el techo, el verdadero también lo está → `ok`.
 *  - Si el umbral está sobre el techo, el verdadero puede estar de los dos
 *    lados y el método no lo resuelve → `sin_comparar`, nunca `excede`.
 *  - Contra un piso se invierte: si el umbral está bajo el piso, el verdadero
 *    también → `bajo_minimo`, y eso sí es determinante.
 */
export function veredicto(opts: {
  valor: number;
  bajoLd: boolean;
  limiteMin: number | null;
  limiteMax: number | null;
}): RilesEstadoResultado {
  const { valor, bajoLd, limiteMin, limiteMax } = opts;
  if (limiteMin === null && limiteMax === null) return 'sin_limite';

  if (bajoLd) {
    if (limiteMin !== null && valor <= limiteMin) return 'bajo_minimo';
    if (limiteMax !== null && valor > limiteMax) return 'sin_comparar';
    return 'ok';
  }

  if (limiteMin !== null && valor < limiteMin) return 'bajo_minimo';
  if (limiteMax !== null && valor > limiteMax) return 'excede';
  return 'ok';
}

// ── Evaluación de una muestra ────────────────────────────────────────────────

export interface EvaluarOpts {
  resultados: RilesResultado[];
  catalogo: Map<string, RilesParametro>;
  limites: RilesLimite[];
  norma: string | null;
  fecha: string;
  /** Volumen descargado el día de la muestra, en m³. NULL si no hay balance. */
  volumenM3: number | null;
}

/**
 * Cruza cada resultado con su parámetro del catálogo, su límite vigente y el
 * volumen del día. Devuelve los resultados en el orden del catálogo, que es el
 * orden en que los lee un informe de laboratorio.
 */
export function evaluarResultados(opts: EvaluarOpts): RilesResultadoEvaluado[] {
  const { resultados, catalogo, limites, norma, fecha, volumenM3 } = opts;

  const evaluados = resultados.map((r): RilesResultadoEvaluado => {
    const param = catalogo.get(r.parametro) ?? null;
    const unidadCanonica = param?.unidad ?? null;

    // Sin catálogo no hay unidad canónica contra la cual normalizar; el valor
    // se deja como vino y se compara sólo si el límite usa la misma unidad.
    const valorNorm =
      unidadCanonica === null ? r.valor : convertir(r.valor, r.unidad, unidadCanonica);

    const limite = limiteVigente(limites, {
      parametro: r.parametro,
      norma,
      fecha,
      tipo: 'concentracion',
    });

    // El límite también puede venir en otra unidad que la canónica.
    const limMin =
      limite?.limite_min != null && unidadCanonica
        ? convertir(limite.limite_min, limite.unidad, unidadCanonica)
        : (limite?.limite_min ?? null);
    const limMax =
      limite?.limite_max != null && unidadCanonica
        ? convertir(limite.limite_max, limite.unidad, unidadCanonica)
        : (limite?.limite_max ?? null);

    let estado: RilesEstadoResultado;
    if (!limite) {
      estado = 'sin_limite';
    } else if (
      valorNorm === null ||
      (limite.limite_min != null && limMin === null) ||
      (limite.limite_max != null && limMax === null)
    ) {
      // Hay límite, pero alguna de las dos puntas no se pudo llevar a la misma
      // unidad. Comparar igual sería inventar el veredicto.
      estado = 'sin_comparar';
    } else {
      estado = veredicto({
        valor: valorNorm,
        bajoLd: r.bajo_ld,
        limiteMin: limMin,
        limiteMax: limMax,
      });
    }

    // La carga sólo sale de una concentración másica real y de un volumen real.
    const esMasica = normalizarUnidad(unidadCanonica) === 'mg/l';
    const carga = param?.aplica_carga && esMasica ? cargaKg(valorNorm, volumenM3) : null;

    return {
      ...r,
      parametro_nombre: param?.nombre ?? null,
      unidad_canonica: unidadCanonica,
      valor_norm: valorNorm,
      carga_kg: carga,
      carga_es_cota: carga !== null && r.bajo_ld,
      estado,
      limite_min: limMin,
      limite_max: limMax,
      limite_unidad: limite?.unidad ?? null,
      uso_limite_pct:
        valorNorm !== null && limMax !== null && limMax > 0 ? (valorNorm / limMax) * 100 : null,
    };
  });

  return ordenarPorCatalogo(evaluados, catalogo);
}

/** Orden del catálogo; lo que no está en él va al final, alfabético. */
export function ordenarPorCatalogo<T extends { parametro: string }>(
  filas: T[],
  catalogo: Map<string, RilesParametro>,
): T[] {
  return [...filas].sort((a, b) => {
    const oa = catalogo.get(a.parametro)?.orden ?? Number.MAX_SAFE_INTEGER;
    const ob = catalogo.get(b.parametro)?.orden ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return a.parametro.localeCompare(b.parametro);
  });
}

/** Cuántos resultados de la muestra superan su límite. */
export function contarExcedencias(resultados: RilesResultadoEvaluado[]): number {
  return resultados.filter((r) => r.estado === 'excede' || r.estado === 'bajo_minimo').length;
}
