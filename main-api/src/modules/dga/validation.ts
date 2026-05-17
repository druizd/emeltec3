/**
 * Validación de slot DGA antes de marcar como 'pendiente' para envío.
 *
 * Reglas (ver migración 2026-05-16-dga-pipeline-refactor.sql y Res 2170):
 *   1. Sensor declarado defectuoso (reg_map.parametros.sensor_known_defective)
 *      → siempre requires_review. NO asumimos lecturas como válidas aunque
 *        técnicamente lo sean, porque sin contexto humano no podemos
 *        distinguir cero-real de cero-glitch.
 *   2. Totalizador 0 o NULL → requires_review con sugerencia de último valor
 *      válido. Causas típicas: cable suelto, modbus timeout, reset firmware.
 *   3. Caudal supera derecho de aprovechamiento × tolerancia → requires_review.
 *      Si caudal_max_lps no está cargado, fallback hardcode 1000 L/s.
 *   4. Telemetría vino pero todas las transformaciones produjeron null →
 *      requires_review (transform_failed_all_nulls). Indica config mal mapeada
 *      o telemetría corrupta.
 *
 * Las funciones son puras (sin IO) para facilitar tests.
 */

import type { DgaUserRow, ValidationWarning } from './repo';

/** Límite hardcoded usado cuando no hay caudal_max_lps cargado (legacy). */
export const FLOW_HARDCODE_LIMIT_LPS = 1000;

export interface SlotValues {
  caudal: number | null;
  totalizador: number | null;
  nivelFreatico: number | null;
}

export interface ValidationContext {
  user: DgaUserRow;
  /** reg_map.parametros del registro con rol_dashboard='totalizador' (puede no existir). */
  totalizadorParams: Record<string, unknown>;
  /** Último totalizador válido conocido (> 0) anterior al slot, para sugerencia. */
  lastValidTotalizador: number | null;
}

export interface ValidationResult {
  warnings: ValidationWarning[];
  /** Código de la primera anomalía detectada. Usado como fail_reason resumen. */
  failReason: string | null;
  /** true si el slot puede ir a 'pendiente'. false → 'requires_review'. */
  ok: boolean;
}

/**
 * Valida los valores extraídos de telemetría contra reglas de negocio DGA.
 * Devuelve la lista de warnings. Si está vacía → ok=true.
 */
export function validateSlot(values: SlotValues, ctx: ValidationContext): ValidationResult {
  const warnings: ValidationWarning[] = [];
  const { caudal, totalizador, nivelFreatico } = values;
  const { user, totalizadorParams, lastValidTotalizador } = ctx;

  // Regla 1: sensor marcado defectuoso por config (ej. site 73 OB-1306-1642).
  // Siempre requires_review aunque el dato luzca razonable.
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

  // Regla 2: totalizador 0 o NULL → glitch típico, sugiere fallback.
  // Excluimos el caso ya capturado por regla 1 (sensor_known_defective).
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

  // Regla 3: caudal excede derecho de aprovechamiento.
  if (caudal != null) {
    const caudalMax = user.caudal_max_lps != null ? Number(user.caudal_max_lps) : null;
    const tolerancePct = Number(user.caudal_tolerance_pct);

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
      // Fallback hardcode cuando obra no tiene caudal_max_lps cargado.
      warnings.push({
        code: 'flow_absurd_no_water_right',
        raw: caudal,
        limit: FLOW_HARDCODE_LIMIT_LPS,
        reason: 'obra sin derecho cargado en BD, caudal supera fallback 1000 L/s',
      });
    }
  }

  // Regla 4: todos los valores null → transformación falló completamente.
  if (caudal == null && totalizador == null && nivelFreatico == null) {
    warnings.push({
      code: 'transform_failed_all_nulls',
      reason: 'ningún valor numérico extraído de telemetría (config mal mapeada?)',
    });
  }

  return {
    warnings,
    failReason: warnings.length > 0 ? (warnings[0]!.code as string) : null,
    ok: warnings.length === 0,
  };
}
