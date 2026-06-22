/**
 * Validación de slot DGA antes de marcar como 'pendiente'. Reglas:
 *   1. Sensor declarado defectuoso → requires_review siempre.
 *   2. Totalizador 0/NULL → requires_review con sugerencia de último válido.
 *   3. Caudal < 0 → requires_review (sensor invertido / glitch).
 *   4. Caudal > caudal_max_lps × tolerancia → requires_review.
 *      Fallback hardcode 1000 L/s si no hay caudal_max cargado.
 *   5. Telemetría con todos los valores null → requires_review.
 *
 * Reglas 3 y 4 pueden coexistir (caudal -15 con derecho 10 dispara ambas).
 *
 * Funciones puras (sin IO).
 */

import type { PozoDgaConfigRow, PriorReading, ValidationWarning } from './repo';

export const FLOW_HARDCODE_LIMIT_LPS = 1000;

/**
 * Ventana por defecto (en número de slots) para la regla sensor_frozen.
 * Se require que el totalizador sea idéntico en FROZEN_WINDOW_DEFAULT_N
 * lecturas consecutivas (actual + FROZEN_WINDOW_DEFAULT_N-1 previas).
 */
export const FROZEN_WINDOW_DEFAULT_N = 4;

/**
 * Umbral de caudal≈0 para la exención de pozo en reposo en sensor_frozen.
 * Un pozo con caudal <= FROZEN_RESTING_CAUDAL_EPS no se flagea aunque el
 * totalizador esté plano (extracción nula → acumulado sin avance es normal).
 * Valor 0 = solo caudal exactamente 0 queda exento. Puede ajustarse con
 * una clave de config futura (frozen_resting_caudal_eps) — fuera de scope
 * en este cambio.
 */
export const FROZEN_RESTING_CAUDAL_EPS = 0;

export interface SlotValues {
  caudal: number | null;
  totalizador: number | null;
  nivelFreatico: number | null;
}

export interface ValidationContext {
  pozoDga: PozoDgaConfigRow;
  /** reg_map.parametros del registro con rol_dashboard='totalizador'. */
  totalizadorParams: Record<string, unknown>;
  lastValidTotalizador: number | null;
  /**
   * Lecturas previas del pozo, ordenadas más reciente primero (index 0 = slot
   * inmediatamente anterior al actual). Inyectado por el worker antes de llamar
   * validateSlot — la función permanece pura (sin IO).
   */
  priorReadings: PriorReading[];
}

export interface ValidationResult {
  warnings: ValidationWarning[];
  failReason: string | null;
  ok: boolean;
}

/**
 * Regla 6 — Sensor congelado / pegado.
 *
 * Detecta cuando el totalizador (flujo_acumulado) no ha avanzado durante N
 * lecturas consecutivas mientras el caudal reportado es mayor que cero.
 *
 * Señal primaria: el totalizador es monotónico creciente durante extracción
 * real. Si está idéntico en N slots seguidos con caudal activo → sensor
 * posiblemente pegado o firmware colgado.
 *
 * Exención de pozo en reposo: si caudal ≤ FROZEN_RESTING_CAUDAL_EPS el pozo
 * no está extrayendo, el totalizador plano es legítimo → no se flagea.
 *
 * @returns ValidationWarning o null (sin flag).
 */
export function checkSensorFrozen(
  values: SlotValues,
  ctx: ValidationContext,
): ValidationWarning | null {
  const { totalizadorParams, priorReadings } = ctx;
  const { totalizador, caudal } = values;

  // Leer y sanitizar frozen_window_n.
  const rawN = Number(totalizadorParams.frozen_window_n);
  const n = Number.isFinite(rawN) && rawN >= 2 ? Math.trunc(rawN) : FROZEN_WINDOW_DEFAULT_N;

  // Se necesitan al menos n-1 lecturas previas.
  if (priorReadings.length < n - 1) return null;

  // Totalizador actual null → sin señal.
  if (totalizador == null) return null;

  // Ventana: las primeras n-1 lecturas previas (ya vienen ordenadas más reciente primero).
  const window = priorReadings.slice(0, n - 1);

  // Si alguna lectura de la ventana tiene totalizador null → historial incompleto, no afirmar.
  if (window.some((r) => r.totalizador == null)) return null;

  // Todos los totalizadores de la ventana deben ser idénticos al actual.
  const frozen = window.every((r) => r.totalizador === totalizador);
  if (!frozen) return null;

  // Exención de pozo en reposo: caudal ≈ 0 → totalizador plano es normal.
  if (caudal != null && Math.abs(caudal) <= FROZEN_RESTING_CAUDAL_EPS) return null;

  return {
    code: 'sensor_frozen',
    raw: totalizador,
    window_n: n,
    caudal,
    reason: `Sensor posiblemente pegado: totalizador sin variación en ${n} lecturas consecutivas con caudal activo`,
  };
}

/**
 * Regla 7 — Salto de caudal físicamente imposible (caudal_spike).
 *
 * Compara el caudal actual con el del slot inmediatamente anterior. Si el
 * delta absoluto supera el umbral configurado en reg_map.parametros
 * (caudal_spike_max_delta_lps), emite warning.
 *
 * La regla se AUTO-DESACTIVA si el umbral no está configurado en el pozo →
 * despliegue seguro sin calibración previa.
 *
 * @returns ValidationWarning o null (sin flag).
 */
export function checkCaudalSpike(
  values: SlotValues,
  ctx: ValidationContext,
): ValidationWarning | null {
  const { totalizadorParams, priorReadings } = ctx;
  const { caudal } = values;

  // Umbral sin default duro: si ausente o no-número → regla inactiva.
  const rawMax = totalizadorParams.caudal_spike_max_delta_lps;
  if (typeof rawMax !== 'number' || !Number.isFinite(rawMax)) return null;
  const maxDelta = rawMax;

  // Sin lectura anterior disponible → no flagear (primer slot del pozo).
  const prev = priorReadings[0];
  if (prev == null || prev.caudal == null || caudal == null) return null;

  const delta = Math.abs(caudal - prev.caudal);
  if (delta <= maxDelta) return null;

  return {
    code: 'caudal_spike',
    raw: caudal,
    prev: prev.caudal,
    delta,
    limit: maxDelta,
    reason: `Salto de caudal físicamente imposible: delta ${delta.toFixed(2)} L/s supera límite ${maxDelta} L/s respecto al slot anterior`,
  };
}

export function validateSlot(values: SlotValues, ctx: ValidationContext): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const { caudal, totalizador, nivelFreatico } = values;
  const { pozoDga, totalizadorParams, lastValidTotalizador } = ctx;

  if (totalizadorParams.sensor_known_defective === true) {
    warnings.push({
      code: 'sensor_known_defective',
      raw: totalizador,
      suggested: lastValidTotalizador,
      reason:
        (totalizadorParams.defect_description as string | undefined) ??
        'sensor marcado como defectuoso en config',
    });
  }

  if (
    (totalizador == null || totalizador === 0) &&
    totalizadorParams.sensor_known_defective !== true
  ) {
    warnings.push({
      code: 'totalizator_zero',
      raw: totalizador,
      suggested: lastValidTotalizador,
      reason: 'lectura totalizador 0 o NULL (posible sensor desconectado o reset firmware)',
    });
  }

  if (caudal != null) {
    if (caudal < 0) {
      warnings.push({
        code: 'flow_negative',
        raw: caudal,
        reason:
          'caudal negativo no esperado en pozo de extracción ' +
          '(posible sensor invertido, glitch o cableado mal hecho)',
      });
    }

    const caudalMax =
      pozoDga.dga_caudal_max_lps != null ? Number(pozoDga.dga_caudal_max_lps) : null;
    const tolerancePct = Number(pozoDga.dga_caudal_tolerance_pct);

    if (caudalMax != null) {
      const limite = caudalMax * (1 + tolerancePct / 100);
      if (Math.abs(caudal) > limite) {
        warnings.push({
          code: 'flow_exceeds_water_right',
          raw: caudal,
          limit: limite,
          tolerance_pct: tolerancePct,
          reason: `caudal supera derecho ${caudalMax} L/s × (1+${tolerancePct}%)`,
        });
      }
    } else if (Math.abs(caudal) > FLOW_HARDCODE_LIMIT_LPS) {
      warnings.push({
        code: 'flow_absurd_no_water_right',
        raw: caudal,
        limit: FLOW_HARDCODE_LIMIT_LPS,
        reason: 'pozo sin derecho cargado en BD, caudal supera fallback 1000 L/s',
      });
    }
  }

  if (caudal == null && totalizador == null && nivelFreatico == null) {
    warnings.push({
      code: 'transform_failed_all_nulls',
      reason: 'ningún valor numérico extraído de telemetría (config mal mapeada?)',
    });
  }

  // Regla 6: sensor_frozen — después de las reglas de caudal para que fallas
  // más duras conserven prioridad en failReason cuando coexisten.
  const frozenWarning = checkSensorFrozen(values, ctx);
  if (frozenWarning != null) warnings.push(frozenWarning);

  // Regla 7: caudal_spike — se auto-desactiva si umbral no configurado.
  const spikeWarning = checkCaudalSpike(values, ctx);
  if (spikeWarning != null) warnings.push(spikeWarning);

  return {
    warnings,
    failReason: warnings.length > 0 ? (warnings[0]!.code as string) : null,
    ok: warnings.length === 0,
  };
}
