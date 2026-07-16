import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ColdRoomAuditService,
  type ColdRoomAuditEntry,
  type ColdRoomAuditCategory,
} from '../../../services/cold-room-audit.service';

@Component({
  selector: 'app-ventisqueros-audit-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="vs-drawer-backdrop" (click)="open.set(false)" aria-hidden="true"></div>
      <aside
        class="vs-drawer vs-drawer--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Audit log"
      >
        <header class="vs-drawer-head">
          <div class="min-w-0">
            <div class="vs-drawer-title">Auditoría HACCP</div>
            <div class="vs-drawer-sub">
              Registro de cambios: umbrales, defrost schedules, desviaciones. Trazabilidad
              SERNAPESCA.
            </div>
          </div>
          <button
            type="button"
            class="vs-drawer-close"
            (click)="open.set(false)"
            aria-label="Cerrar"
          >
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </header>
        <div class="vs-drawer-body vs-audit-body">
          <div class="vs-audit-toolbar">
            <select
              class="vs-audit-filter"
              [value]="auditFilterCategory()"
              (change)="setAuditCategory($event)"
              aria-label="Categoría"
            >
              <option value="">Todas las categorías</option>
              <option value="threshold">Umbrales</option>
              <option value="defrost">Defrost</option>
              <option value="deviation">Desviaciones</option>
            </select>
            <input
              type="date"
              class="vs-audit-filter vs-audit-filter--date"
              [value]="auditFilterFrom()"
              (change)="setAuditFrom($event)"
              aria-label="Desde"
              title="Desde"
            />
            <input
              type="date"
              class="vs-audit-filter vs-audit-filter--date"
              [value]="auditFilterTo()"
              (change)="setAuditTo($event)"
              aria-label="Hasta"
              title="Hasta"
            />
            <input
              type="search"
              class="vs-audit-filter vs-audit-filter--search"
              placeholder="Buscar actor, objetivo, nota…"
              [value]="auditFilterQuery()"
              (input)="setAuditQuery($any($event.target).value)"
              aria-label="Búsqueda"
            />
            <button
              type="button"
              class="vs-audit-btn vs-audit-btn--primary"
              [disabled]="auditFiltered().length === 0"
              (click)="exportAuditCsv()"
              title="Exportar CSV"
            >
              <span class="material-symbols-outlined text-[14px]">download</span>
              CSV
            </button>
            <span class="vs-audit-locked" title="Audit log inmutable (almacenado en DB, HACCP)">
              <span class="material-symbols-outlined text-[14px]">lock</span>
              Inmutable
            </span>
          </div>

          <div class="vs-audit-meta">
            Mostrando {{ auditPaged().length }} de {{ auditFiltered().length }} filtradas ·
            {{ auditEntries().length }} totales · persistido en DB
          </div>

          @if (auditFiltered().length === 0) {
            <div class="vs-audit-empty">
              <span class="material-symbols-outlined text-[28px] text-slate-300">history</span>
              <div class="mt-2 text-[13px] font-medium text-slate-500">
                {{
                  auditEntries().length === 0
                    ? 'Sin registros aún'
                    : 'Sin resultados con esos filtros'
                }}
              </div>
            </div>
          } @else {
            <div class="vs-audit-list">
              @for (e of auditPaged(); track e.id) {
                <article class="vs-audit-row" [attr.data-category]="e.category">
                  <div class="vs-audit-row-head">
                    <span class="vs-audit-cat" [attr.data-category]="e.category">
                      {{ auditCategoryLabel(e.category) }}
                    </span>
                    <span class="vs-audit-action">{{ auditActionLabel(e.action) }}</span>
                    <span class="vs-audit-target" [title]="e.target">{{ e.target }}</span>
                    <span class="vs-audit-ts">{{ auditFmtTs(e.ts) }}</span>
                  </div>
                  <div class="vs-audit-row-body">
                    <span class="vs-audit-actor">
                      <span class="material-symbols-outlined text-[12px]">person</span>
                      {{ e.actor }}
                      @if (e.actorRole) {
                        <span class="vs-audit-role">{{ e.actorRole }}</span>
                      }
                    </span>
                    @if (auditFmtSummary(e); as summary) {
                      @if (summary) {
                        <span class="vs-audit-summary">{{ summary }}</span>
                      }
                    }
                    @if (e.note) {
                      <span class="vs-audit-note">"{{ e.note }}"</span>
                    }
                  </div>
                </article>
              }
            </div>
            @if (auditFiltered().length > auditPaged().length) {
              <button type="button" class="vs-audit-loadmore" (click)="loadMoreAudit()">
                <span class="material-symbols-outlined text-[14px]">expand_more</span>
                Cargar más ({{ auditFiltered().length - auditPaged().length }} restantes)
              </button>
            }
          }
        </div>
      </aside>
    }
  `,
  styles: [
    `
      .vs-audit-body {
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .vs-audit-toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .vs-audit-filter {
        font-family: var(--font-dm);
        font-size: 11.5px;
        padding: 6px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        color: #1e293b;
      }
      .vs-audit-filter:focus {
        outline: 2px solid var(--color-primary);
        outline-offset: 1px;
        border-color: var(--color-primary);
      }
      .vs-audit-filter--search {
        flex: 1;
        min-width: 200px;
      }
      .vs-audit-filter--date {
        width: 140px;
      }
      .vs-audit-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .vs-audit-btn:hover {
        background: #f8fafc;
      }
      .vs-audit-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .vs-audit-btn--primary {
        background: var(--color-primary);
        color: #ffffff;
        border-color: var(--color-primary);
      }
      .vs-audit-btn--primary:hover {
        background: #0a7d87;
      }
      .vs-audit-locked {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px 9px;
        border-radius: 8px;
        background: var(--color-primary-tint-08);
        border: 1px solid var(--color-primary-tint-20);
        color: var(--color-primary);
        font-family: var(--font-dm);
        font-size: 10.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        cursor: help;
      }

      .vs-audit-meta {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .vs-audit-empty {
        padding: 36px 16px;
        text-align: center;
        background: #f8fafc;
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
      }

      .vs-audit-loadmore {
        margin-top: 8px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        width: 100%;
        padding: 8px 12px;
        border: 1px dashed #e2e8f0;
        background: #ffffff;
        color: #64748b;
        font-family: var(--font-dm);
        font-size: 12px;
        font-weight: 500;
        border-radius: 8px;
        transition:
          color 0.15s,
          border-color 0.15s,
          background 0.15s;
      }
      .vs-audit-loadmore:hover {
        color: var(--color-primary);
        border-color: var(--color-primary-tint-35);
        background: var(--color-primary-tint-04);
      }

      .vs-audit-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 55vh;
        overflow-y: auto;
        padding-right: 4px;
      }
      .vs-audit-row {
        padding: 10px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #ffffff;
      }
      .vs-audit-row[data-category='threshold'] .vs-audit-cat {
        background: var(--color-primary-tint-10);
        color: var(--color-primary);
      }
      .vs-audit-row[data-category='defrost'] .vs-audit-cat {
        background: rgba(14, 165, 233, 0.1);
        color: #0369a1;
      }
      .vs-audit-row[data-category='deviation'] .vs-audit-cat {
        background: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
      }
      .vs-audit-row-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .vs-audit-cat {
        font-family: var(--font-mono);
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 6px;
        border-radius: 999px;
      }
      .vs-audit-cat[data-category='threshold'] {
        background: var(--color-primary-tint-10);
        color: var(--color-primary);
      }
      .vs-audit-cat[data-category='defrost'] {
        background: rgba(14, 165, 233, 0.1);
        color: #0369a1;
      }
      .vs-audit-cat[data-category='deviation'] {
        background: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
      }
      .vs-audit-action {
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 600;
        color: #1e293b;
      }
      .vs-audit-target {
        font-family: var(--font-mono);
        font-size: 11.5px;
        color: #475569;
        background: #f1f5f9;
        border-radius: 4px;
        padding: 1px 6px;
        max-width: 280px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vs-audit-ts {
        margin-left: auto;
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: #94a3b8;
      }
      .vs-audit-row-body {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #475569;
      }
      .vs-audit-actor {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .vs-audit-role {
        font-family: var(--font-mono);
        font-size: 9.5px;
        color: #94a3b8;
        background: #f1f5f9;
        border-radius: 4px;
        padding: 1px 5px;
        margin-left: 4px;
      }
      .vs-audit-change {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-mono);
        font-size: 11px;
      }
      .vs-audit-prev {
        color: #94a3b8;
        text-decoration: line-through;
      }
      .vs-audit-next {
        color: var(--color-primary);
      }
      .vs-audit-note {
        font-style: italic;
        color: #64748b;
      }
      .vs-audit-summary {
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #475569;
        background: #f8fafc;
        padding: 2px 7px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
      }
    `,
  ],
})
export class VentisquerosAuditDrawerComponent {
  readonly open = model<boolean>(false);

  private readonly auditSvc = inject(ColdRoomAuditService);

  readonly auditFilterCategory = signal<ColdRoomAuditCategory | ''>('');
  readonly auditFilterQuery = signal<string>('');
  readonly auditFilterFrom = signal<string>('');
  readonly auditFilterTo = signal<string>('');

  readonly auditEntries = computed(() => this.auditSvc.entries());

  readonly auditFiltered = computed(() => {
    return this.auditSvc.filter({
      category: this.auditFilterCategory() || undefined,
      from: this.auditFilterFrom() || undefined,
      to: this.auditFilterTo() || undefined,
      query: this.auditFilterQuery() || undefined,
    });
  });

  // Paginación visual: muestra solo primeras N entradas con botón "Cargar más".
  // Evita renderizar 2000 rows en DOM cuando audit log crece.
  readonly auditPageSize = 10;
  readonly auditDisplayCount = signal<number>(this.auditPageSize);

  readonly auditPaged = computed(() => {
    return this.auditFiltered().slice(0, this.auditDisplayCount());
  });

  loadMoreAudit(): void {
    this.auditDisplayCount.update((n) => n + this.auditPageSize);
  }

  resetAuditPaging(): void {
    this.auditDisplayCount.set(this.auditPageSize);
  }

  setAuditCategory(ev: Event): void {
    const target = ev.target as HTMLSelectElement | null;
    this.auditFilterCategory.set((target?.value as ColdRoomAuditCategory) || '');
    this.resetAuditPaging();
  }

  setAuditQuery(value: string): void {
    this.auditFilterQuery.set(value);
    this.resetAuditPaging();
  }

  setAuditFrom(ev: Event): void {
    const target = ev.target as HTMLInputElement | null;
    this.auditFilterFrom.set(target?.value || '');
    this.resetAuditPaging();
  }

  setAuditTo(ev: Event): void {
    const target = ev.target as HTMLInputElement | null;
    this.auditFilterTo.set(target?.value || '');
    this.resetAuditPaging();
  }

  exportAuditCsv(): void {
    const blob = this.auditSvc.exportCsv(this.auditFiltered());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cold-room-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clearAudit(): void {
    if (!confirm('¿Borrar todo el audit log local? Esta acción no se puede deshacer.')) return;
    this.auditSvc.clear();
  }

  auditCategoryLabel(c: ColdRoomAuditCategory): string {
    return c === 'threshold' ? 'Umbral' : c === 'defrost' ? 'Defrost' : 'Desviación';
  }

  auditActionLabel(a: ColdRoomAuditEntry['action']): string {
    switch (a) {
      case 'create':
        return 'Creó';
      case 'update':
        return 'Modificó';
      case 'delete':
        return 'Eliminó';
      case 'reset':
        return 'Restableció';
      case 'ack':
        return 'Reconoció';
      case 'resolve':
        return 'Resolvió';
      case 'classify-cause':
        return 'Clasificó causa';
      case 'clear-cause':
        return 'Quitó causa';
      case 'note':
        return 'Anotó';
    }
  }

  auditFmtValue(v: unknown): string {
    if (v === undefined || v === null) return '—';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  // Render humano del diff de un audit entry (sin dump JSON). Usa category+action
  // para decidir qué campos mostrar. Fallback al JSON crudo si no se reconoce.
  auditFmtSummary(e: ColdRoomAuditEntry): string {
    const prev = (e.prev || {}) as Record<string, unknown>;
    const next = (e.next || {}) as Record<string, unknown>;
    const get = (obj: Record<string, unknown>, ...keys: string[]): string | null => {
      for (const k of keys) {
        const v = obj[k];
        if (v !== undefined && v !== null && v !== '') return String(v);
      }
      return null;
    };
    const diffField = (label: string, key: string, ...altKeys: string[]): string | null => {
      const p = get(prev, key, ...altKeys);
      const n = get(next, key, ...altKeys);
      if (p === n) return null;
      if (p === null && n !== null) return `${label}: ${n}`;
      if (p !== null && n === null) return `${label}: ${p} → —`;
      return `${label}: ${p} → ${n}`;
    };

    if (e.category === 'deviation') {
      if (e.action === 'ack') return 'Reconocida';
      if (e.action === 'resolve') return 'Marcada como resuelta';
      if (e.action === 'clear-cause') return 'Causa retirada';
      if (e.action === 'classify-cause') {
        const causePrev = get(prev, 'cause');
        const causeNext = get(next, 'cause');
        const lbl = causeNext ? this.causeLabel(causeNext) || causeNext : '—';
        if (causePrev && causePrev !== causeNext) {
          return `Causa: ${this.causeLabel(causePrev)} → ${lbl}`;
        }
        return `Causa: ${lbl}`;
      }
    }

    if (e.category === 'threshold') {
      const parts: string[] = [];
      const tMax = diffField('Tmáx', 'tMax', 't_max');
      const tMin = diffField('Tmín', 'tMin', 't_min');
      if (tMax) parts.push(tMax);
      if (tMin) parts.push(tMin);
      if (parts.length === 0 && e.action === 'create') return 'Umbral creado';
      if (parts.length === 0 && e.action === 'delete') return 'Umbral eliminado';
      if (parts.length === 0 && e.action === 'reset') return 'Restaurado a defaults';
      return parts.join(' · ') || 'Actualizado';
    }

    if (e.category === 'defrost') {
      if (e.action === 'create') {
        const start = get(next, 'startHHmm', 'start_hhmm');
        const dur = get(next, 'durationMin', 'duration_min');
        return `Ventana ${start || '?'} · ${dur || '?'}min`;
      }
      if (e.action === 'delete') return 'Ventana eliminada';
      if (e.action === 'update') {
        const parts: string[] = [];
        const start = diffField('Inicio', 'startHHmm', 'start_hhmm');
        const dur = diffField('Duración', 'durationMin', 'duration_min');
        const enabled = diffField('Activa', 'enabled');
        if (start) parts.push(start);
        if (dur) parts.push(dur);
        if (enabled) parts.push(enabled);
        return parts.join(' · ') || 'Actualizada';
      }
    }

    return '';
  }

  causeLabel(key: string): string {
    const labels: Record<string, string> = {
      defrost: 'Defrost',
      'door-open': 'Apertura puerta',
      'load-unload': 'Carga/descarga',
      cleaning: 'Limpieza/mantención',
      other: 'Otra',
      unclassified: 'Sin clasificar',
    };
    return labels[key] || key;
  }

  auditFmtTs(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
