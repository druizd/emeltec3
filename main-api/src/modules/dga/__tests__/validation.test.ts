/**
 * Tests unitarios para validateSlot — funciones puras, sin IO.
 *
 * Cubre las 5 reglas declaradas en validation.ts:
 *   1. sensor_known_defective
 *   2. totalizator_zero
 *   3. flow_exceeds_water_right (con derecho cargado + tolerancia)
 *   4. flow_absurd_no_water_right (sin derecho, fallback 1000 L/s)
 *   5. transform_failed_all_nulls
 */
import { describe, it, expect } from 'vitest';
import { validateSlot, FLOW_HARDCODE_LIMIT_LPS, type ValidationContext } from '../validation';
import type { PozoDgaConfigRow } from '../repo';

// Factory: construye PozoDgaConfigRow con defaults razonables.
function makePozoDga(overrides: Partial<PozoDgaConfigRow> = {}): PozoDgaConfigRow {
  return {
    sitio_id: 'S100',
    obra_dga: 'OB-0601-001',
    dga_activo: true,
    dga_transport: 'rest',
    dga_caudal_max_lps: null,
    dga_caudal_tolerance_pct: '0',
    dga_periodicidad: 'hora',
    dga_fecha_inicio: '2026-06-01',
    dga_hora_inicio: '00:00:00',
    dga_informante_rut: '12345678-9',
    dga_max_retry_attempts: 5,
    dga_gcs_export: false,
    dga_last_run_at: null,
    ...overrides,
  };
}

function makeCtx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    pozoDga: makePozoDga(),
    totalizadorParams: {},
    lastValidTotalizador: null,
    priorReadings: [],
    ...overrides,
  };
}

describe('validateSlot — happy path', () => {
  it('valores válidos sin restricciones → ok=true, sin warnings', () => {
    const res = validateSlot(
      { caudal: 10, totalizador: 5000, nivelFreatico: 12 },
      makeCtx({ pozoDga: makePozoDga({ dga_caudal_max_lps: '50' }) }),
    );
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(res.failReason).toBeNull();
  });

  it('caudal exactamente en el límite con tolerancia → OK (no excede)', () => {
    // Derecho 10 L/s, tolerancia 20% → límite efectivo = 12.
    // caudal 12 NO excede (Math.abs(12) > 12 es false).
    const res = validateSlot(
      { caudal: 12, totalizador: 100, nivelFreatico: 5 },
      makeCtx({
        pozoDga: makePozoDga({ dga_caudal_max_lps: '10', dga_caudal_tolerance_pct: '20' }),
      }),
    );
    expect(res.ok).toBe(true);
  });
});

describe('validateSlot — regla 1: sensor_known_defective', () => {
  it('parametro true → warning con sugerencia lastValid', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { sensor_known_defective: true, defect_description: 'sensor bug' },
        lastValidTotalizador: 950,
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.warnings[0]?.code).toBe('sensor_known_defective');
    expect(res.warnings[0]?.suggested).toBe(950);
    expect(res.warnings[0]?.reason).toBe('sensor bug');
    expect(res.failReason).toBe('sensor_known_defective');
  });

  it('parametro true sin defect_description → usa default reason', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({ totalizadorParams: { sensor_known_defective: true } }),
    );
    expect(res.warnings[0]?.reason).toContain('sensor marcado como defectuoso');
  });

  it('sensor_defective bloquea regla totalizator_zero (no se duplica)', () => {
    // totalizador=0 + sensor_defective → solo warning de sensor, NO de zero.
    const res = validateSlot(
      { caudal: 5, totalizador: 0, nivelFreatico: 10 },
      makeCtx({ totalizadorParams: { sensor_known_defective: true } }),
    );
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]?.code).toBe('sensor_known_defective');
  });
});

describe('validateSlot — regla 2: totalizator_zero', () => {
  it('totalizador 0 → warning + sugerencia lastValid', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: 0, nivelFreatico: 10 },
      makeCtx({ lastValidTotalizador: 850 }),
    );
    expect(res.ok).toBe(false);
    expect(res.warnings[0]?.code).toBe('totalizator_zero');
    expect(res.warnings[0]?.raw).toBe(0);
    expect(res.warnings[0]?.suggested).toBe(850);
  });

  it('totalizador null → warning', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: null, nivelFreatico: 10 },
      makeCtx({ lastValidTotalizador: 700 }),
    );
    expect(res.warnings[0]?.code).toBe('totalizator_zero');
    expect(res.warnings[0]?.raw).toBeNull();
    expect(res.warnings[0]?.suggested).toBe(700);
  });

  it('totalizador positivo → sin warning', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: 1, nivelFreatico: 10 },
      makeCtx({ pozoDga: makePozoDga({ dga_caudal_max_lps: '50' }) }),
    );
    expect(res.ok).toBe(true);
  });
});

describe('validateSlot — regla 3: flow_exceeds_water_right', () => {
  it('caudal > derecho × (1+tol) → warning con limit calculado', () => {
    // Derecho 10, tolerancia 20% → límite 12. Caudal 13 → excede.
    const res = validateSlot(
      { caudal: 13, totalizador: 100, nivelFreatico: 5 },
      makeCtx({
        pozoDga: makePozoDga({ dga_caudal_max_lps: '10', dga_caudal_tolerance_pct: '20' }),
      }),
    );
    expect(res.warnings[0]?.code).toBe('flow_exceeds_water_right');
    expect(res.warnings[0]?.raw).toBe(13);
    expect(res.warnings[0]?.limit).toBeCloseTo(12, 5);
  });

  it('caudal negativo con magnitud > límite → flow_negative + flow_exceeds_water_right', () => {
    const res = validateSlot(
      { caudal: -15, totalizador: 100, nivelFreatico: 5 },
      makeCtx({
        pozoDga: makePozoDga({ dga_caudal_max_lps: '10', dga_caudal_tolerance_pct: '20' }),
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain('flow_negative');
    expect(codes).toContain('flow_exceeds_water_right');
    // flow_negative se evalúa primero, define failReason
    expect(res.failReason).toBe('flow_negative');
  });

  it('tolerancia 0% → límite = derecho exacto', () => {
    // Derecho 10, tol 0 → caudal 10.001 ya excede.
    const res = validateSlot(
      { caudal: 10.001, totalizador: 100, nivelFreatico: 5 },
      makeCtx({
        pozoDga: makePozoDga({ dga_caudal_max_lps: '10', dga_caudal_tolerance_pct: '0' }),
      }),
    );
    expect(res.warnings[0]?.code).toBe('flow_exceeds_water_right');
  });
});

describe('validateSlot — regla 4: flow_absurd_no_water_right (fallback 1000 L/s)', () => {
  it('sin derecho + caudal > 1000 → warning fallback', () => {
    const res = validateSlot(
      { caudal: FLOW_HARDCODE_LIMIT_LPS + 1, totalizador: 100, nivelFreatico: 5 },
      makeCtx({ pozoDga: makePozoDga({ dga_caudal_max_lps: null }) }),
    );
    expect(res.warnings[0]?.code).toBe('flow_absurd_no_water_right');
    expect(res.warnings[0]?.limit).toBe(FLOW_HARDCODE_LIMIT_LPS);
  });

  it('sin derecho + caudal ≤ 1000 → sin warning de caudal', () => {
    const res = validateSlot(
      { caudal: 500, totalizador: 100, nivelFreatico: 5 },
      makeCtx({ pozoDga: makePozoDga({ dga_caudal_max_lps: null }) }),
    );
    expect(res.ok).toBe(true);
  });

  it('sin derecho + caudal negativo magnitud > 1000 → flow_negative + flow_absurd', () => {
    const res = validateSlot(
      { caudal: -1500, totalizador: 100, nivelFreatico: 5 },
      makeCtx({ pozoDga: makePozoDga({ dga_caudal_max_lps: null }) }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain('flow_negative');
    expect(codes).toContain('flow_absurd_no_water_right');
  });
});

describe('validateSlot — regla 5: transform_failed_all_nulls', () => {
  it('caudal/totalizador/nivel todos null → warning', () => {
    const res = validateSlot({ caudal: null, totalizador: null, nivelFreatico: null }, makeCtx());
    // Aparece junto con totalizator_zero (null cuenta como zero).
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain('transform_failed_all_nulls');
  });

  it('al menos un valor no-null → sin warning de all_nulls', () => {
    const res = validateSlot({ caudal: null, totalizador: null, nivelFreatico: 5 }, makeCtx());
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('transform_failed_all_nulls');
  });
});

describe('validateSlot — regla flow_negative', () => {
  it('caudal negativo pequeño → warning flow_negative + bloquea envío', () => {
    const res = validateSlot(
      { caudal: -0.5, totalizador: 100, nivelFreatico: 5 },
      makeCtx({ pozoDga: makePozoDga({ dga_caudal_max_lps: '50' }) }),
    );
    expect(res.ok).toBe(false);
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain('flow_negative');
    expect(res.warnings.find((w) => w.code === 'flow_negative')?.raw).toBe(-0.5);
    expect(res.failReason).toBe('flow_negative');
  });

  it('caudal 0 → sin warning flow_negative', () => {
    const res = validateSlot(
      { caudal: 0, totalizador: 100, nivelFreatico: 5 },
      makeCtx({ pozoDga: makePozoDga({ dga_caudal_max_lps: '50' }) }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('flow_negative');
    expect(res.ok).toBe(true);
  });

  it('caudal positivo dentro derecho → sin warning flow_negative', () => {
    const res = validateSlot(
      { caudal: 10, totalizador: 100, nivelFreatico: 5 },
      makeCtx({ pozoDga: makePozoDga({ dga_caudal_max_lps: '50' }) }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('flow_negative');
  });

  it('caudal NULL → sin warning flow_negative (no aplica)', () => {
    const res = validateSlot({ caudal: null, totalizador: 100, nivelFreatico: 5 }, makeCtx());
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('flow_negative');
  });
});

describe('validateSlot — combinación múltiple', () => {
  it('múltiples warnings → failReason es el primero detectado', () => {
    const res = validateSlot(
      { caudal: 999, totalizador: 0, nivelFreatico: 1 },
      makeCtx({
        totalizadorParams: { sensor_known_defective: true },
        pozoDga: makePozoDga({ dga_caudal_max_lps: '10', dga_caudal_tolerance_pct: '0' }),
        lastValidTotalizador: 500,
      }),
    );
    // Orden en validation.ts: sensor → totalizator_zero (bloqueado por sensor) → flow.
    expect(res.failReason).toBe('sensor_known_defective');
    expect(res.warnings.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Regla 6: sensor_frozen
// ---------------------------------------------------------------------------
describe('validateSlot — regla sensor_frozen', () => {
  // Helpers para construir lecturas previas con totalizador idéntico al actual.
  function makePriors(
    count: number,
    totalizador: number,
    caudal = 5,
  ): { ts: string; caudal: number | null; totalizador: number | null }[] {
    return Array.from({ length: count }, (_, i) => ({
      ts: `2026-06-01T0${i}:00:00Z`,
      caudal,
      totalizador,
    }));
  }

  it('N lecturas idénticas de totalizador + caudal activo → sensor_frozen flagged', () => {
    // frozen_window_n=4 por defecto → necesita 3 previas con mismo valor.
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 4 },
        priorReadings: makePriors(3, 1000),
      }),
    );
    expect(res.ok).toBe(false);
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain('sensor_frozen');
    expect(res.failReason).toBe('sensor_frozen');
  });

  it('totalizador avanzando (al menos un prior distinto) → no flagged', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: 1050, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 4 },
        priorReadings: [
          { ts: '2026-06-01T02:00:00Z', caudal: 5, totalizador: 1040 },
          { ts: '2026-06-01T01:00:00Z', caudal: 5, totalizador: 1030 },
          { ts: '2026-06-01T00:00:00Z', caudal: 5, totalizador: 1020 },
        ],
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('sensor_frozen');
  });

  it('pozo en reposo (caudal=0, totalizador plano) → NO flagged (exención)', () => {
    const res = validateSlot(
      { caudal: 0, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 4 },
        priorReadings: makePriors(3, 1000, 0),
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('sensor_frozen');
  });

  it('historial insuficiente (< frozen_window_n - 1 previas) → no flagged', () => {
    // frozen_window_n=4, necesita 3 previas pero solo hay 2 → no flag.
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 4 },
        priorReadings: makePriors(2, 1000),
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('sensor_frozen');
  });

  it('config frozen_window_n ausente → usa FROZEN_WINDOW_DEFAULT_N=4', () => {
    // Sin config: default N=4 → necesita 3 previas idénticas.
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: {},
        priorReadings: makePriors(3, 1000),
      }),
    );
    expect(res.warnings.map((w) => w.code)).toContain('sensor_frozen');
  });

  it('frozen_window_n inválido (NaN) → cae a default 4', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 'no-es-numero' },
        priorReadings: makePriors(3, 1000),
      }),
    );
    expect(res.warnings.map((w) => w.code)).toContain('sensor_frozen');
  });

  it('frozen_window_n inválido (< 2) → cae a default 4', () => {
    // Valor 1 sería degenerado → cae a default 4, necesita 3 previas.
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 1 },
        priorReadings: makePriors(3, 1000),
      }),
    );
    expect(res.warnings.map((w) => w.code)).toContain('sensor_frozen');
  });

  it('totalizador actual null → no flagged', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: null, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 4 },
        priorReadings: makePriors(3, 1000),
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('sensor_frozen');
  });

  it('totalizador null en un prior de la ventana → no flagged', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 4 },
        priorReadings: [
          { ts: '2026-06-01T02:00:00Z', caudal: 5, totalizador: 1000 },
          { ts: '2026-06-01T01:00:00Z', caudal: 5, totalizador: null },
          { ts: '2026-06-01T00:00:00Z', caudal: 5, totalizador: 1000 },
        ],
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('sensor_frozen');
  });

  it('coexistencia con flow_negative → failReason=flow_negative, warnings incluye sensor_frozen', () => {
    // caudal < 0 dispara flow_negative (regla más dura, evaluada antes).
    // Totalizador plano + caudal negativo ≠ 0 → sensor_frozen también dispara.
    const res = validateSlot(
      { caudal: -5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 4 },
        priorReadings: makePriors(3, 1000, -5),
      }),
    );
    expect(res.failReason).toBe('flow_negative');
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain('flow_negative');
    expect(codes).toContain('sensor_frozen');
    expect(res.ok).toBe(false);
  });

  it('warning sensor_frozen contiene mensaje en español con cantidad de lecturas', () => {
    const res = validateSlot(
      { caudal: 5, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { frozen_window_n: 4 },
        priorReadings: makePriors(3, 1000),
      }),
    );
    const w = res.warnings.find((x) => x.code === 'sensor_frozen');
    expect(w).toBeDefined();
    expect(typeof w?.reason).toBe('string');
    // Debe mencionar el número de lecturas (N=4)
    expect(w!.reason).toMatch(/4/);
  });
});

// ---------------------------------------------------------------------------
// Regla 7: caudal_spike
// ---------------------------------------------------------------------------
describe('validateSlot — regla caudal_spike', () => {
  it('sin umbral configurado → regla desactivada, no flagged, sin excepción', () => {
    // Delta enorme pero sin config → la regla no dispara.
    const res = validateSlot(
      { caudal: 950, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: {},
        priorReadings: [{ ts: '2026-06-01T00:00:00Z', caudal: 8, totalizador: 990 }],
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('caudal_spike');
    expect(res.ok).toBe(true);
  });

  it('delta supera umbral → caudal_spike flagged con requires_review', () => {
    // caudal_spike_max_delta_lps=100, actual=950, prev=8 → delta=942 > 100
    const res = validateSlot(
      { caudal: 950, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { caudal_spike_max_delta_lps: 100 },
        priorReadings: [{ ts: '2026-06-01T00:00:00Z', caudal: 8, totalizador: 990 }],
      }),
    );
    expect(res.ok).toBe(false);
    const codes = res.warnings.map((w) => w.code);
    expect(codes).toContain('caudal_spike');
    expect(res.failReason).toBe('caudal_spike');
  });

  it('delta bajo el umbral → no flagged', () => {
    // caudal_spike_max_delta_lps=100, actual=10, prev=8 → delta=2 ≤ 100
    const res = validateSlot(
      { caudal: 10, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { caudal_spike_max_delta_lps: 100 },
        priorReadings: [{ ts: '2026-06-01T00:00:00Z', caudal: 8, totalizador: 990 }],
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('caudal_spike');
    expect(res.ok).toBe(true);
  });

  it('primer slot del pozo (priorReadings vacío) → no flagged', () => {
    const res = validateSlot(
      { caudal: 500, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { caudal_spike_max_delta_lps: 10 },
        priorReadings: [],
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('caudal_spike');
  });

  it('priorReadings[0].caudal null → no flagged', () => {
    const res = validateSlot(
      { caudal: 500, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { caudal_spike_max_delta_lps: 10 },
        priorReadings: [{ ts: '2026-06-01T00:00:00Z', caudal: null, totalizador: 990 }],
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('caudal_spike');
  });

  it('caudal actual null → no flagged aunque haya prev y umbral', () => {
    const res = validateSlot(
      { caudal: null, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { caudal_spike_max_delta_lps: 10 },
        priorReadings: [{ ts: '2026-06-01T00:00:00Z', caudal: 8, totalizador: 990 }],
      }),
    );
    const codes = res.warnings.map((w) => w.code);
    expect(codes).not.toContain('caudal_spike');
  });

  it('warning caudal_spike contiene delta y límite en el reason', () => {
    // delta=942, limit=100
    const res = validateSlot(
      { caudal: 950, totalizador: 1000, nivelFreatico: 10 },
      makeCtx({
        totalizadorParams: { caudal_spike_max_delta_lps: 100 },
        priorReadings: [{ ts: '2026-06-01T00:00:00Z', caudal: 8, totalizador: 990 }],
      }),
    );
    const w = res.warnings.find((x) => x.code === 'caudal_spike');
    expect(w).toBeDefined();
    expect(typeof w?.reason).toBe('string');
    // Debe mencionar el delta (942) y el límite (100)
    expect(w!.reason).toMatch(/942/);
    expect(w!.reason).toMatch(/100/);
  });
});
