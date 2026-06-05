import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * Audit log local para cambios HACCP en cámara fría.
 * Trazabilidad SERNAPESCA Res. 3160/2016: quién/cuándo/qué.
 * Almacena en localStorage; cap 2000 entradas. Para producción enviar a backend.
 */
export type ColdRoomAuditCategory = 'threshold' | 'defrost' | 'deviation';

export type ColdRoomAuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'reset'
  | 'ack'
  | 'resolve'
  | 'classify-cause'
  | 'clear-cause'
  | 'note';

export interface ColdRoomAuditEntry {
  id: string;
  ts: string;
  actor: string;
  actorRole?: string;
  category: ColdRoomAuditCategory;
  action: ColdRoomAuditAction;
  target: string;
  prev?: unknown;
  next?: unknown;
  note?: string;
}

const STORAGE_KEY = 'coldroom:audit-log:v2';
const MAX_ENTRIES = 2000;

@Injectable({ providedIn: 'root' })
export class ColdRoomAuditService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly entriesSignal = signal<ColdRoomAuditEntry[]>(this.load());
  private currentSiteId: string | null = null;

  readonly entries = computed(() => this.entriesSignal());

  setSiteId(siteId: string): void {
    if (this.currentSiteId === siteId) return;
    this.currentSiteId = siteId;
    this.refresh();
  }

  refresh(): void {
    const siteId = this.currentSiteId;
    if (!siteId) return;
    this.http
      .get<{ ok: boolean; data: ColdRoomAuditEntry[] }>(
        `/api/cold-room/${encodeURIComponent(siteId)}/audit?limit=2000`,
      )
      .subscribe({
        next: (res) => {
          if (!res.ok) return;
          this.entriesSignal.set(res.data || []);
          this.persist(res.data || []);
        },
        error: () => {
          /* keep local cache */
        },
      });
  }

  /**
   * Backend ahora registra audit automáticamente al recibir mutaciones (PUT/POST/DELETE
   * en /thresholds, /defrost, /acks). Esta función queda para registrar entradas
   * client-initiated (eventos explícitos sin mutación HTTP correspondiente).
   * Refresca la lista local desde backend después de enviar.
   */
  record(
    category: ColdRoomAuditCategory,
    action: ColdRoomAuditAction,
    target: string,
    prev?: unknown,
    next?: unknown,
    note?: string,
  ): void {
    const siteId = this.currentSiteId;
    // Optimistic local insert.
    const u = this.auth.user();
    const actor = u ? `${u.nombre} ${u.apellido}`.trim() || u.email : 'operador';
    const actorRole = u?.tipo;
    const entry: ColdRoomAuditEntry = {
      id: this.newId(),
      ts: new Date().toISOString(),
      actor,
      actorRole,
      category,
      action,
      target,
      prev,
      next,
      note,
    };
    const list = [entry, ...this.entriesSignal()].slice(0, MAX_ENTRIES);
    this.entriesSignal.set(list);
    this.persist(list);
    if (!siteId) return;
    this.http
      .post<{ ok: boolean }>(`/api/cold-room/${encodeURIComponent(siteId)}/audit`, {
        category,
        action,
        target,
        prev,
        next,
        note,
      })
      .subscribe({
        next: () => this.refresh(),
        error: () => {
          /* keep local */
        },
      });
  }

  filter(opts: {
    category?: ColdRoomAuditCategory;
    action?: ColdRoomAuditAction;
    actor?: string;
    from?: string;
    to?: string;
    query?: string;
  }): ColdRoomAuditEntry[] {
    const list = this.entriesSignal();
    const q = (opts.query || '').trim().toLowerCase();
    const fromMs = opts.from ? new Date(opts.from).getTime() : null;
    const toMs = opts.to ? new Date(opts.to).getTime() : null;
    return list.filter((e) => {
      if (opts.category && e.category !== opts.category) return false;
      if (opts.action && e.action !== opts.action) return false;
      if (opts.actor && !e.actor.toLowerCase().includes(opts.actor.toLowerCase())) return false;
      const tsMs = new Date(e.ts).getTime();
      if (fromMs !== null && tsMs < fromMs) return false;
      if (toMs !== null && tsMs > toMs) return false;
      if (q) {
        const hay = [
          e.actor,
          e.target,
          this.stringify(e.prev),
          this.stringify(e.next),
          e.note,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  exportCsv(entries?: ColdRoomAuditEntry[]): Blob {
    const list = entries || this.entriesSignal();
    const header = [
      'id',
      'timestamp',
      'actor',
      'rol',
      'categoria',
      'accion',
      'objetivo',
      'valor_anterior',
      'valor_nuevo',
      'nota',
    ].join(',');
    const rows = list.map((e) =>
      [
        e.id,
        e.ts,
        this.csvEscape(e.actor),
        this.csvEscape(e.actorRole || ''),
        e.category,
        e.action,
        this.csvEscape(e.target),
        this.csvEscape(this.stringify(e.prev)),
        this.csvEscape(this.stringify(e.next)),
        this.csvEscape(e.note || ''),
      ].join(','),
    );
    return new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  }

  clear(): void {
    this.entriesSignal.set([]);
    this.persist([]);
  }

  private csvEscape(value: string): string {
    if (value == null) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  private stringify(v: unknown): string {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  private newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private load(): ColdRoomAuditEntry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ColdRoomAuditEntry[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  private persist(list: ColdRoomAuditEntry[]): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
  }
}
