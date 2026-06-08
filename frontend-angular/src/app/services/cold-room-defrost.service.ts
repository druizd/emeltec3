import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { slugifyArea } from './cold-room-thresholds.service';

export interface DefrostWindow {
  id: string;
  startHHmm: string;
  durationMin: number;
  daysOfWeek: number[];
  enabled: boolean;
  note?: string;
}

type DefrostMap = Record<string, DefrostWindow[]>;

const STORAGE_KEY = 'coldroom:defrost-schedules:v2';

@Injectable({ providedIn: 'root' })
export class ColdRoomDefrostService {
  private readonly http = inject(HttpClient);
  private readonly map = signal<DefrostMap>(this.loadLocalCache());
  private currentSiteId: string | null = null;

  readonly schedules = computed(() => this.map());

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
        data: (DefrostWindow & { slug: string })[];
      }>(`/api/cold-room/${encodeURIComponent(siteId)}/defrost`)
      .subscribe({
        next: (res) => {
          if (!res.ok) return;
          const next: DefrostMap = {};
          for (const w of res.data) {
            const slug = w.slug;
            if (!next[slug]) next[slug] = [];
            next[slug].push({
              id: w.id,
              startHHmm: w.startHHmm,
              durationMin: w.durationMin,
              daysOfWeek: w.daysOfWeek || [],
              enabled: w.enabled,
              note: w.note,
            });
          }
          this.map.set(next);
          this.persistLocalCache(next);
        },
        error: () => {
          /* keep cache */
        },
      });
  }

  list(areaOrSlug: string): DefrostWindow[] {
    const slug = slugifyArea(areaOrSlug);
    return this.map()[slug] || [];
  }

  setWindows(area: string, windows: DefrostWindow[]): void {
    // Used rarely; bulk replace not exposed in backend — issue individual updates.
    const slug = slugifyArea(area);
    const next: DefrostMap = { ...this.map(), [slug]: windows };
    this.map.set(next);
    this.persistLocalCache(next);
    // No bulk endpoint; caller should use add/update/remove for persistence.
  }

  addWindow(area: string, w: Omit<DefrostWindow, 'id'>): DefrostWindow {
    const slug = slugifyArea(area);
    const newW: DefrostWindow = { ...w, id: this.newId() };
    const current = this.list(area);
    const next: DefrostMap = { ...this.map(), [slug]: [...current, newW] };
    this.map.set(next);
    this.persistLocalCache(next);
    const siteId = this.currentSiteId;
    if (siteId) {
      this.http
        .post<{ ok: boolean }>(`/api/cold-room/${encodeURIComponent(siteId)}/defrost`, {
          id: newW.id,
          slug,
          startHHmm: newW.startHHmm,
          durationMin: newW.durationMin,
          daysOfWeek: newW.daysOfWeek,
          enabled: newW.enabled,
          note: newW.note ?? null,
        })
        .subscribe({ error: () => this.refresh() });
    }
    return newW;
  }

  removeWindow(area: string, id: string): void {
    const slug = slugifyArea(area);
    const current = this.list(area).filter((w) => w.id !== id);
    const next: DefrostMap = { ...this.map(), [slug]: current };
    this.map.set(next);
    this.persistLocalCache(next);
    const siteId = this.currentSiteId;
    if (siteId) {
      this.http
        .delete<{
          ok: boolean;
        }>(`/api/cold-room/${encodeURIComponent(siteId)}/defrost/${encodeURIComponent(id)}`)
        .subscribe({ error: () => this.refresh() });
    }
  }

  updateWindow(area: string, id: string, patch: Partial<DefrostWindow>): void {
    const slug = slugifyArea(area);
    const current = this.list(area).map((w) => (w.id === id ? { ...w, ...patch } : w));
    const next: DefrostMap = { ...this.map(), [slug]: current };
    this.map.set(next);
    this.persistLocalCache(next);
    const siteId = this.currentSiteId;
    if (siteId) {
      this.http
        .put<{
          ok: boolean;
        }>(`/api/cold-room/${encodeURIComponent(siteId)}/defrost/${encodeURIComponent(id)}`, patch)
        .subscribe({ error: () => this.refresh() });
    }
  }

  isInDefrost(area: string, ts: string | Date): boolean {
    const windows = this.list(area).filter((w) => w.enabled);
    if (windows.length === 0) return false;
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    if (!isFinite(d.getTime())) return false;
    const dow = ((d.getDay() + 6) % 7) + 1;
    const minOfDay = d.getHours() * 60 + d.getMinutes();
    for (const w of windows) {
      if (!w.daysOfWeek.includes(dow)) continue;
      const [hh, mm] = w.startHHmm.split(':').map((n) => parseInt(n, 10));
      if (!isFinite(hh) || !isFinite(mm)) continue;
      const start = hh * 60 + mm;
      const end = start + w.durationMin;
      if (end <= 24 * 60) {
        if (minOfDay >= start && minOfDay < end) return true;
      } else {
        if (minOfDay >= start) return true;
        const prevDow = dow === 1 ? 7 : dow - 1;
        if (w.daysOfWeek.includes(prevDow) && minOfDay < end - 24 * 60) return true;
      }
    }
    return false;
  }

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

  clear(area?: string): void {
    if (!area) {
      // Local only — no bulk wipe endpoint.
      this.map.set({});
      this.persistLocalCache({});
      return;
    }
    const slug = slugifyArea(area);
    const current = this.list(area);
    const rest = { ...this.map() };
    delete rest[slug];
    this.map.set(rest);
    this.persistLocalCache(rest);
    const siteId = this.currentSiteId;
    if (siteId) {
      for (const w of current) {
        this.http
          .delete(
            `/api/cold-room/${encodeURIComponent(siteId)}/defrost/${encodeURIComponent(w.id)}`,
          )
          .subscribe({ error: () => this.refresh() });
      }
    }
  }

  private newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private loadLocalCache(): DefrostMap {
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

  private persistLocalCache(map: DefrostMap): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
      /* ignore */
    }
  }
}
