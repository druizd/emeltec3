/**
 * Validación de slot DGA antes de marcar como 'pendiente'. Reglas:
 *   1. Sensor declarado defectuoso → requires_review siempre.
 *   2. Totalizador 0/NULL → requires_review con sugerencia de último válido.
 *   3. Caudal > caudal_max_lps × tolerancia → requires_review.
 *      Fallback hardcode 1000 L/s si no hay caudal_max cargado.
 *   4. Telemetría con todos los valores null → requires_review.
 *
 * Funciones puras (sin IO).
 */

import type { PozoDgaConfigRow, ValidationWarning } from './repo';

export const FLOW_HARDCODE_LIMIT_LPS = 1000;

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
}

export interface ValidationResult {
  warnings: ValidationWarning[];
  failReason: string | null;
  ok: boolean;
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

  return {
    warnings,
    failReason: warnings.length > 0 ? (warnings[0]!.code as string) : null,
    ok: warnings.length === 0,
  };
}
