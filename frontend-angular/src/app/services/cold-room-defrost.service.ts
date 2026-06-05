import { Injectable, computed, inject, signal } from '@angular/core';
import { slugifyArea } from './cold-room-thresholds.service';
import { ColdRoomAuditService } from './cold-room-audit.service';

/**
 * Ventana defrost: programación periódica de descongelado donde la temperatura
 * sube transitoriamente. Desviaciones dentro de estas ventanas se marcan como
 * "esperadas" y no cuentan como crítico HACCP.
 *
 * daysOfWeek: 1=Lun, 2=Mar, ..., 7=Dom (ISO 8601).
 */
export interface DefrostWindow {
  id: string;
  startHHmm: string; // "02:00"
  durationMin: number;
  daysOfWeek: number[]; // 1..7 (ISO 8601: 1=Lun, 7=Dom)
  enabled: boolean;
  /** Optional human note: "ciclo automático evaporador A". */
  note?: string;
}

type DefrostMap = Record<string /* slug */, DefrostWindow[]>;

const STORAGE_KEY = 'coldroom:defrost-schedules:v1';

@Injectable({ providedIn: 'root' })
export class ColdRoomDefrostService {
  private readonly audit = inject(ColdRoomAuditService);
  private readonly map = signal<DefrostMap>(this.load());

  readonly schedules = computed(() => this.map());

  list(areaOrSlug: string): DefrostWindow[] {
    const slug = slugifyArea(areaOrSlug);
    return this.map()[slug] || [];
  }

  setWindows(area: string, windows: DefrostWindow[]): void {
    const slug = slugifyArea(area);
    const prev = this.map()[slug] || [];
    const next: DefrostMap = { ...this.map(), [slug]: windows };
    this.map.set(next);
    this.persist(next);
    this.audit.record('defrost', 'update', area, prev, windows);
  }

  addWindow(area: string, w: Omit<DefrostWindow, 'id'>): DefrostWindow {
    const slug = slugifyArea(area);
    const newW: DefrostWindow = { ...w, id: this.newId() };
    const current = this.list(area);
    const next: DefrostMap = { ...this.map(), [slug]: [...current, newW] };
    this.map.set(next);
    this.persist(next);
    this.audit.record('defrost', 'create', `${area}/${newW.id}`, undefined, newW);
    return newW;
  }

  removeWindow(area: string, id: string): void {
    const slug = slugifyArea(area);
    const prev = this.list(area).find((w) => w.id === id);
    const current = this.list(area).filter((w) => w.id !== id);
    const next: DefrostMap = { ...this.map(), [slug]: current };
    this.map.set(next);
    this.persist(next);
    if (prev) {
      this.audit.record('defrost', 'delete', `${area}/${id}`, prev, undefined);
    }
  }

  updateWindow(area: string, id: string, patch: Partial<DefrostWindow>): void {
    const slug = slugifyArea(area);
    const prev = this.list(area).find((w) => w.id === id);
    const current = this.list(area).map((w) => (w.id === id ? { ...w, ...patch } : w));
    const next: DefrostMap = { ...this.map(), [slug]: current };
    this.map.set(next);
    this.persist(next);
    this.audit.record('defrost', 'update', `${area}/${id}`, prev, patch);
  }

  /**
   * Returns true if timestamp falls within any enabled defrost window for area.
   */
  isInDefrost(area: string, ts: string | Date): boolean {
    const windows = this.list(area).filter((w) => w.enabled);
    if (windows.length === 0) return false;
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    if (!isFinite(d.getTime())) return false;
    const dow = ((d.getDay() + 6) % 7) + 1; // JS 0=Sun -> ISO 1=Mon..7=Sun
    const minOfDay = d.getHours() * 60 + d.getMinutes();
    for (const w of windows) {
      if (!w.daysOfWeek.includes(dow)) continue;
      const [hh, mm] = w.startHHmm.split(':').map((n) => parseInt(n, 10));
      if (!isFinite(hh) || !isFinite(mm)) continue;
      const start = hh * 60 + mm;
      const end = start + w.durationMin;
      // Wraps to next day if > 24h.
      if (end <= 24 * 60) {
        if (minOfDay >= start && minOfDay < end) return true;
      } else {
        if (minOfDay >= start) return true;
        // Spill into next day handled by checking previous day's window:
        const prevDow = dow === 1 ? 7 : dow - 1;
        if (w.daysOfWeek.includes(prevDow) && minOfDay < end - 24 * 60) return true;
      }
    }
    return false;
  }

  /**
   * Returns count of overlap minutes between [startTs, endTs] interval and
   * defrost windows. Used to discount "expected" excess time from HACCP totals.
   */
  defrostOverlapMin(area: string, startTs: string, endTs: string | null): number {
    const start = new Date(startTs);
    const end = endTs ? new Date(endTs) : new Date();
    if (!isFinite(start.getTime()) || !isFinite(end.getTime()) || end <= start) return 0;
    let overlap = 0;
    const stepMs = 60_000;
    for (let t = start.getTime(); t < end.getTime(); t += stepMs) {
      if (this.isInDefrost(area, new Date(t))) overlap++;
    }
    return overlap;
  }

  /** Reset to defaults (no schedules). */
  clear(area?: string): void {
    if (!area) {
      const prev = this.map();
      this.map.set({});
      this.persist({});
      this.audit.record('defrost', 'reset', 'all', prev, {});
      return;
    }
    const slug = slugifyArea(area);
    const prev = this.map()[slug];
    const { [slug]: _drop, ...rest } = this.map();
    this.map.set(rest);
    this.persist(rest);
    if (prev) this.audit.record('defrost', 'delete', area, prev, undefined);
  }

  private newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private load(): DefrostMap {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as DefrostMap;
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      /* ignore */
    }
    return {};
  }

  private persist(map: DefrostMap): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
}
