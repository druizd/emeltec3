import { Injectable, computed, inject, signal } from '@angular/core';
import { ColdRoomAuditService } from './cold-room-audit.service';

export type AlertLevel = 'ok' | 'info' | 'warn' | 'crit' | 'severe' | 'unknown';

export interface SalaThreshold {
  area: string;
  tMax: number;
  tMin?: number;
  /** °C below tMax where "warn" (anticipación) kicks in. Default 1.5°C */
  warnDeltaC?: number;
  /** Min consecutive minutes over tMax to consider sustained crit. Default 5 */
  sustainedMin?: number;
  /** Min consecutive minutes over tMax to escalate to severe. Default 30 */
  severeMin?: number;
  /** Hysteresis: °C below tMax required to clear an excursion. Default 0.5 */
  hysteresisC?: number;
  updatedAt: string;
}

type ThresholdsMap = Record<string, SalaThreshold>;

const STORAGE_KEY = 'coldroom:thresholds:v1';

export const THRESHOLD_DEFAULTS = {
  warnDeltaC: 1.5,
  sustainedMin: 5,
  severeMin: 30,
  hysteresisC: 0.5,
};

// Defaults provided by client (Ventisqueros faenadora).
const DEFAULT_THRESHOLDS: SalaThreshold[] = [
  { area: 'Matanza / Eviscerado', tMax: 10, updatedAt: '' },
  { area: 'Calibrado', tMax: 10, updatedAt: '' },
  { area: 'Empaque Primario', tMax: 10, updatedAt: '' },
  { area: 'Antecámara Primaria', tMax: 4, updatedAt: '' },
  { area: 'Cámara Primaria', tMax: -18, updatedAt: '' },
  { area: 'Filete', tMax: 10, updatedAt: '' },
  { area: 'Cámara de Tránsito', tMax: 4, updatedAt: '' },
  { area: 'Porciones', tMax: 10, updatedAt: '' },
  { area: 'Empaque Secundario', tMax: 10, updatedAt: '' },
  { area: 'Antecámara Secundaria', tMax: 4, updatedAt: '' },
  { area: 'Cámara Secundaria', tMax: -18, updatedAt: '' },
];

export function slugifyArea(area: string): string {
  return area
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable({ providedIn: 'root' })
export class ColdRoomThresholdsService {
  private readonly audit = inject(ColdRoomAuditService);
  private readonly map = signal<ThresholdsMap>(this.load());

  readonly thresholds = computed(() => this.map());

  list(): SalaThreshold[] {
    const m = this.map();
    return Object.values(m).sort((a, b) => a.area.localeCompare(b.area));
  }

  get(areaOrSlug: string): SalaThreshold | null {
    const slug = slugifyArea(areaOrSlug);
    return this.map()[slug] || null;
  }

  set(area: string, tMax: number, tMin?: number): void {
    const slug = slugifyArea(area);
    const prev = this.map()[slug];
    const updated: ThresholdsMap = {
      ...this.map(),
      [slug]: {
        area,
        tMax,
        tMin,
        updatedAt: new Date().toISOString(),
      },
    };
    this.map.set(updated);
    this.persist(updated);
    this.audit.record(
      'threshold',
      prev ? 'update' : 'create',
      area,
      prev ? { tMax: prev.tMax, tMin: prev.tMin } : undefined,
      { tMax, tMin },
    );
  }

  remove(area: string): void {
    const slug = slugifyArea(area);
    const prev = this.map()[slug];
    const { [slug]: _drop, ...rest } = this.map();
    this.map.set(rest);
    this.persist(rest);
    if (prev) {
      this.audit.record('threshold', 'delete', area, prev, undefined);
    }
  }

  resetToDefaults(): void {
    const seeded = this.seedDefaults();
    this.map.set(seeded);
    this.persist(seeded);
    this.audit.record('threshold', 'reset', 'all', undefined, undefined, 'Restablecido a defaults cliente');
  }

  /**
   * Legacy 3-level evaluation. Use `evaluateLevel` for HACCP multi-level.
   */
  evaluate(area: string, currentMaxT: number, marginPct = 0.05): 'ok' | 'warn' | 'crit' | 'unknown' {
    const th = this.get(area);
    if (!th) return 'unknown';
    if (currentMaxT > th.tMax) return 'crit';
    const span = Math.abs(th.tMax) * marginPct || 0.5;
    if (currentMaxT > th.tMax - span) return 'warn';
    return 'ok';
  }

  /**
   * HACCP multi-level evaluation. Considers:
   * - currentMaxT vs tMax
   * - warnDeltaC for "info" (approaching)
   * - sustainedMin / severeMin for elevated severity based on ongoing duration
   * @param sustainedActiveMin Minutes the violation has been ongoing now.
   */
  evaluateLevel(
    area: string,
    currentMaxT: number,
    sustainedActiveMin = 0,
  ): AlertLevel {
    const th = this.get(area);
    if (!th) return 'unknown';
    const warnDelta = th.warnDeltaC ?? THRESHOLD_DEFAULTS.warnDeltaC;
    const sustained = th.sustainedMin ?? THRESHOLD_DEFAULTS.sustainedMin;
    const severe = th.severeMin ?? THRESHOLD_DEFAULTS.severeMin;
    const over = currentMaxT > th.tMax;
    if (over && sustainedActiveMin >= severe) return 'severe';
    if (over && sustainedActiveMin >= sustained) return 'crit';
    if (over) return 'warn';
    if (currentMaxT > th.tMax - warnDelta) return 'info';
    return 'ok';
  }

  /**
   * Detect deviations in a temperature time series. Returns list of intervals
   * where T > tMax for ≥ 1 sample, with hysteresis for closing.
   * Terminología: "desviación" per SERNAPESCA Res. 3160/2016.
   */
  detectDeviations(
    area: string,
    series: Array<{ t: string; v: number }>,
  ): Array<{
    startTs: string;
    endTs: string | null;
    durationMin: number;
    peakT: number;
    sustained: boolean;
    severe: boolean;
  }> {
    const th = this.get(area);
    if (!th || !series.length) return [];
    const sustained = th.sustainedMin ?? THRESHOLD_DEFAULTS.sustainedMin;
    const severe = th.severeMin ?? THRESHOLD_DEFAULTS.severeMin;
    const hyst = th.hysteresisC ?? THRESHOLD_DEFAULTS.hysteresisC;

    const out: Array<{
      startTs: string;
      endTs: string | null;
      durationMin: number;
      peakT: number;
      sustained: boolean;
      severe: boolean;
    }> = [];
    let inExcursion = false;
    let startIdx = -1;
    let peak = -Infinity;

    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      if (!inExcursion) {
        if (p.v > th.tMax) {
          inExcursion = true;
          startIdx = i;
          peak = p.v;
        }
      } else {
        if (p.v > peak) peak = p.v;
        // Close when drops below tMax - hysteresis
        if (p.v <= th.tMax - hyst) {
          const startTs = series[startIdx].t;
          const endTs = p.t;
          const durMs = new Date(endTs).getTime() - new Date(startTs).getTime();
          const durMin = Math.max(1, Math.round(durMs / 60000));
          out.push({
            startTs,
            endTs,
            durationMin: durMin,
            peakT: +peak.toFixed(2),
            sustained: durMin >= sustained,
            severe: durMin >= severe,
          });
          inExcursion = false;
          startIdx = -1;
          peak = -Infinity;
        }
      }
    }
    // Open-ended (still active)
    if (inExcursion && startIdx >= 0) {
      const startTs = series[startIdx].t;
      const last = series[series.length - 1];
      const durMs = new Date(last.t).getTime() - new Date(startTs).getTime();
      const durMin = Math.max(1, Math.round(durMs / 60000));
      out.push({
        startTs,
        endTs: null,
        durationMin: durMin,
        peakT: +peak.toFixed(2),
        sustained: durMin >= sustained,
        severe: durMin >= severe,
      });
    }
    return out;
  }

  isSensorOutOfBand(area: string, t: number): boolean {
    const th = this.get(area);
    if (!th) return false;
    if (t > th.tMax) return true;
    if (typeof th.tMin === 'number' && t < th.tMin) return true;
    return false;
  }

  private load(): ThresholdsMap {
    let stored: ThresholdsMap = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ThresholdsMap;
        if (parsed && typeof parsed === 'object') stored = parsed;
      }
    } catch {
      /* ignore */
    }
    // Merge defaults: keep user overrides, fill missing keys from defaults.
    const merged: ThresholdsMap = { ...this.seedDefaults(), ...stored };
    this.persist(merged);
    return merged;
  }

  ensureAreas(areas: string[]): void {
    const cur = this.map();
    let changed = false;
    const out: ThresholdsMap = { ...cur };
    for (const area of areas) {
      const slug = slugifyArea(area);
      if (!out[slug]) {
        out[slug] = { area, tMax: NaN, updatedAt: '' };
        changed = true;
      }
    }
    if (changed) {
      this.map.set(out);
      this.persist(out);
    }
  }

  private seedDefaults(): ThresholdsMap {
    const out: ThresholdsMap = {};
    const now = new Date().toISOString();
    for (const t of DEFAULT_THRESHOLDS) {
      out[slugifyArea(t.area)] = { ...t, updatedAt: now };
    }
    return out;
  }

  private persist(map: ThresholdsMap): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
}
