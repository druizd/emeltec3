import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';

export type AlertLevel = 'ok' | 'info' | 'warn' | 'crit' | 'severe' | 'unknown';

export interface SalaThreshold {
  area: string;
  tMax: number;
  tMin?: number;
  warnDeltaC?: number;
  sustainedMin?: number;
  severeMin?: number;
  hysteresisC?: number;
  note?: string;
  updatedAt: string;
  updatedBy?: string;
}

type ThresholdsMap = Record<string, SalaThreshold>;

export const THRESHOLD_DEFAULTS = {
  warnDeltaC: 1.5,
  sustainedMin: 5,
  severeMin: 30,
  hysteresisC: 0.5,
};

// Defaults autoritativos viven en backend (coldRoomRoutes.js → seedDefaultThresholdsIfEmpty).
// Frontend sólo lee. No seed cliente.

const STORAGE_KEY = 'coldroom:thresholds:v2';

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
  private readonly http = inject(HttpClient);
  private readonly map = signal<ThresholdsMap>(this.loadLocalCache());
  private currentSiteId: string | null = null;

  readonly thresholds = computed(() => this.map());

  /** Initialize for a site. Fetches from backend; falls back to local cache + defaults on error. */
  setSiteId(siteId: string): void {
    if (this.currentSiteId === siteId) return;
    this.currentSiteId = siteId;
    this.refresh();
  }

  refresh(): void {
    const siteId = this.currentSiteId;
    if (!siteId) return;
    this.http
      .get<{
        ok: boolean;
        data: Array<SalaThreshold & { slug: string }>;
      }>(`/api/cold-room/${encodeURIComponent(siteId)}/thresholds`)
      .subscribe({
        next: (res) => {
          if (!res.ok) return;
          const next: ThresholdsMap = {};
          for (const r of res.data) {
            const slug = r.slug || slugifyArea(r.area);
            next[slug] = {
              area: r.area,
              tMax: r.tMax,
              tMin: r.tMin ?? undefined,
              warnDeltaC: r.warnDeltaC ?? undefined,
              sustainedMin: r.sustainedMin ?? undefined,
              severeMin: r.severeMin ?? undefined,
              hysteresisC: r.hysteresisC ?? undefined,
              note: r.note ?? undefined,
              updatedAt: r.updatedAt,
              updatedBy: r.updatedBy,
            };
          }
          // Backend seeds defaults automáticamente si tabla vacía (single source of truth).
          this.map.set(next);
          this.persistLocalCache(next);
        },
        error: () => {
          // Keep local cache; UI continues with stale data.
        },
      });
  }

  list(): SalaThreshold[] {
    return Object.values(this.map()).sort((a, b) => a.area.localeCompare(b.area));
  }

  get(areaOrSlug: string): SalaThreshold | null {
    const slug = slugifyArea(areaOrSlug);
    return this.map()[slug] || null;
  }

  set(area: string, tMax: number, tMin?: number, note?: string): void {
    const slug = slugifyArea(area);
    const prev = this.map()[slug];
    const updated: ThresholdsMap = {
      ...this.map(),
      [slug]: {
        ...(prev || {}),
        area,
        tMax,
        tMin,
        note: note ?? prev?.note,
        updatedAt: new Date().toISOString(),
      },
    };
    this.map.set(updated); // optimistic
    this.persistLocalCache(updated);
    this.pushUpsert(area, tMax, tMin, note ?? prev?.note);
  }

  remove(area: string): void {
    const slug = slugifyArea(area);
    const { [slug]: _drop, ...rest } = this.map();
    this.map.set(rest);
    this.persistLocalCache(rest);
    const siteId = this.currentSiteId;
    if (!siteId) return;
    this.http
      .delete<{
        ok: boolean;
      }>(`/api/cold-room/${encodeURIComponent(siteId)}/thresholds/${encodeURIComponent(slug)}`)
      .subscribe({ error: () => this.refresh() });
  }

  resetToDefaults(): void {
    const siteId = this.currentSiteId;
    if (!siteId) return;
    // Backend re-siembra defaults dentro del endpoint reset.
    this.http
      .post<{ ok: boolean }>(`/api/cold-room/${encodeURIComponent(siteId)}/thresholds/reset`, {})
      .subscribe({
        next: () => this.refresh(),
        error: () => this.refresh(),
      });
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
      this.persistLocalCache(out);
    }
  }

  evaluate(
    area: string,
    currentMaxT: number,
    marginPct = 0.05,
  ): 'ok' | 'warn' | 'crit' | 'unknown' {
    const th = this.get(area);
    if (!th) return 'unknown';
    if (currentMaxT > th.tMax) return 'crit';
    const span = Math.abs(th.tMax) * marginPct || 0.5;
    if (currentMaxT > th.tMax - span) return 'warn';
    return 'ok';
  }

  evaluateLevel(area: string, currentMaxT: number, sustainedActiveMin = 0): AlertLevel {
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

  isSensorOutOfBand(area: string, t: number): boolean {
    const th = this.get(area);
    if (!th) return false;
    if (t > th.tMax) return true;
    if (typeof th.tMin === 'number' && t < th.tMin) return true;
    return false;
  }

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
    let inDev = false;
    let startIdx = -1;
    let peak = -Infinity;
    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      if (!inDev) {
        if (p.v > th.tMax) {
          inDev = true;
          startIdx = i;
          peak = p.v;
        }
      } else {
        if (p.v > peak) peak = p.v;
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
          inDev = false;
          startIdx = -1;
          peak = -Infinity;
        }
      }
    }
    if (inDev && startIdx >= 0) {
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

  private pushUpsert(area: string, tMax: number, tMin?: number, note?: string): void {
    const siteId = this.currentSiteId;
    if (!siteId) return;
    const slug = slugifyArea(area);
    this.http
      .put<{
        ok: boolean;
        error?: string;
      }>(`/api/cold-room/${encodeURIComponent(siteId)}/thresholds/${encodeURIComponent(slug)}`, {
        area,
        tMax,
        tMin: tMin ?? null,
        note: note ?? null,
      })
      .subscribe({
        next: (res) => {
          if (!res.ok) {
            console.error('[ColdRoomThresholds] PUT response not ok:', res.error || res);
          }
          // Refresh to confirm backend persisted (catches silent rollbacks).
          this.refresh();
        },
        error: (err) => {
          console.error(
            '[ColdRoomThresholds] PUT failed:',
            err?.status,
            err?.error || err?.message,
          );
          this.refresh();
        },
      });
  }

  private loadLocalCache(): ThresholdsMap {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ThresholdsMap;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  private persistLocalCache(map: ThresholdsMap): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
}
