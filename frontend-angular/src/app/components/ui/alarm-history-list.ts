import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SkeletonComponent } from './skeleton';

/** Tag extra (chip) de una alarma en el historial. */
export interface AlarmHistoryTag {
  icon: string;
  label: string;
  /** Resalta el tag (ej. incidencia vinculada). */
  emphasis?: boolean;
}

/**
 * Modelo normalizado de una alarma para el historial. Cada módulo (cold-room,
 * agua, futuros procesos) mapea SU data a esto y reusa el mismo UI.
 */
export interface AlarmHistoryItem {
  id: string | number;
  title: string;
  /** Código corto (ALT-0001, id, etc.). */
  code?: string;
  /** Línea secundaria (variable, valor vs umbral…). */
  detail?: string;
  /** Observación del operador (nota/causa HACCP). Se muestra resaltada y va al export. */
  observation?: string;
  /** Nivel para color: info | warn | crit. */
  severity: 'info' | 'warn' | 'crit';
  /** Etiqueta visible de severidad (Crítica, Alta, Advertencia…). */
  severityLabel: string;
  /** Inicio (ISO). */
  startedAt: string;
  /** Fin (ISO) o null si sigue activa. */
  endedAt?: string | null;
  status: 'activa' | 'resuelta';
  /** Ícono custom (Material Symbols). Si no, se usa uno según el estado. */
  icon?: string;
  /** Tags extra específicos del módulo (resolvió, incidencia…). */
  tags?: AlarmHistoryTag[];
  /** Acción opcional (routerLink) — ej. ir al detalle de sala. */
  link?: string[] | null;
  linkQuery?: Record<string, string>;
  linkTitle?: string;
  /** Columnas extra SOLO para el export Excel (ej. Resolvió, Incidencia). */
  exportExtra?: Record<string, string>;
}

/**
 * Historial de alarmas reutilizable (cards). Presentacional: recibe items ya
 * normalizados. Mismo diseño para cold-room, agua y cualquier proceso futuro.
 */
@Component({
  selector: 'app-alarm-history-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, SkeletonComponent],
  template: `
    @if (loading()) {
      <div class="space-y-2">
        @for (_ of [0, 1, 2, 3, 4]; track $index) {
          <app-skeleton class="h-[68px] w-full rounded-xl" />
        }
      </div>
    } @else {
      @if (exportable() && items().length) {
        <div class="mb-3 flex items-center justify-end">
          <button
            type="button"
            (click)="exportXlsx()"
            [disabled]="exporting()"
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-caption font-semibold text-slate-600 transition-colors hover:border-primary-tint-35 hover:text-primary-container disabled:opacity-50"
          >
            <span class="material-symbols-outlined text-[16px]">download</span>
            {{ exporting() ? 'Generando…' : 'Exportar Excel' }}
          </button>
        </div>
      }
      <div class="space-y-2">
        @for (it of items(); track it.id) {
          <article
            [class]="borderClass(it.severity)"
            class="flex items-stretch gap-3 rounded-xl border border-l-[3px] border-slate-200 bg-white p-3 shadow-sm"
          >
            <div
              [class]="iconClass(it.severity)"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
            >
              <span class="material-symbols-outlined text-[20px]">{{
                it.icon || (it.status === 'resuelta' ? 'history' : 'notifications_active')
              }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-2">
                <span class="truncate font-semibold text-slate-800">{{ it.title }}</span>
                <span
                  [class]="badgeClass(it.severity)"
                  class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption-xs font-semibold uppercase tracking-wide"
                >
                  <span [class]="dotClass(it.severity)" class="h-1.5 w-1.5 rounded-full"></span>
                  {{ it.severityLabel }}
                </span>
              </div>
              @if (it.code || it.detail) {
                <div class="mt-0.5 text-caption-xs text-slate-400">
                  @if (it.code) {
                    <span class="font-mono">{{ it.code }}</span>
                  }
                  @if (it.code && it.detail) {
                    <span> · </span>
                  }
                  @if (it.detail) {
                    <span>{{ it.detail }}</span>
                  }
                </div>
              }
              @if (it.observation) {
                <div
                  class="mt-1.5 flex items-start gap-1.5 rounded-lg bg-primary-tint-10 px-2 py-1 text-caption-xs text-slate-600"
                >
                  <span class="material-symbols-outlined mt-px text-[13px] text-primary-container"
                    >edit_note</span
                  >
                  <span class="min-w-0 break-words">{{ it.observation }}</span>
                </div>
              }
              <div
                class="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-caption-xs font-medium text-slate-500"
              >
                <span class="inline-flex items-center gap-1">
                  <span class="material-symbols-outlined text-[12px]">schedule</span>
                  {{ when(it.startedAt) }}
                </span>
                <span class="inline-flex items-center gap-1">
                  <span class="material-symbols-outlined text-[12px]">timelapse</span>
                  {{ duration(it) }}
                </span>
                <span
                  class="inline-flex items-center gap-1"
                  [class.text-emerald-600]="it.status === 'resuelta'"
                >
                  <span class="material-symbols-outlined text-[12px]">{{
                    it.status === 'resuelta' ? 'check_circle' : 'pending'
                  }}</span>
                  {{ it.status === 'resuelta' ? 'Resuelta' : 'Activa' }}
                </span>
                @for (t of it.tags || []; track t.label) {
                  <span
                    class="inline-flex items-center gap-1"
                    [class.font-bold]="t.emphasis"
                    [class.text-primary-container]="t.emphasis"
                  >
                    <span class="material-symbols-outlined text-[12px]">{{ t.icon }}</span>
                    {{ t.label }}
                  </span>
                }
              </div>
            </div>
            @if (it.link) {
              <a
                [routerLink]="it.link"
                [queryParams]="it.linkQuery || {}"
                [title]="it.linkTitle || 'Ver detalle'"
                class="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:border-primary-tint-35 hover:text-primary-container"
              >
                <span class="material-symbols-outlined text-[16px]">arrow_forward</span>
              </a>
            }
          </article>
        } @empty {
          <div
            class="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-10 text-center"
          >
            <span class="material-symbols-outlined text-3xl text-slate-300">history</span>
            <p class="mt-2 text-body-sm font-semibold text-slate-400">{{ emptyText() }}</p>
          </div>
        }
      </div>
    }
  `,
})
export class AlarmHistoryListComponent {
  readonly items = input<AlarmHistoryItem[]>([]);
  readonly loading = input<boolean>(false);
  readonly emptyText = input<string>('Sin alarmas registradas');
  /** Muestra el botón "Exportar Excel" (genera un .xlsx con los items actuales). */
  readonly exportable = input<boolean>(false);
  /** Título usado para el nombre de archivo y la hoja del Excel. */
  readonly exportTitle = input<string>('Historial de alarmas');

  readonly exporting = signal(false);

  async exportXlsx(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const items = this.items();
      // Columnas extra aportadas por el módulo (unión de claves de todos los items).
      const extraKeys = Array.from(
        new Set(items.flatMap((it) => Object.keys(it.exportExtra ?? {}))),
      );
      const rows = items.map((it) => {
        const row: Record<string, string> = {
          Código: it.code ?? '',
          Alarma: it.title,
          Severidad: it.severityLabel,
          Detalle: it.detail ?? '',
          Observación: it.observation ?? '',
          Inicio: this.when(it.startedAt),
          Cierre: it.endedAt ? this.when(it.endedAt) : '',
          Duración: this.duration(it),
          Estado: it.status === 'resuelta' ? 'Resuelta' : 'Activa',
        };
        for (const k of extraKeys) row[k] = it.exportExtra?.[k] ?? '';
        return row;
      });

      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(rows);
      // Ancho de columnas aproximado al contenido.
      const headers = Object.keys(rows[0] ?? { Alarma: '' });
      ws['!cols'] = headers.map((h) => ({
        wch: Math.min(
          48,
          Math.max(h.length + 2, ...rows.map((r) => String(r[h] ?? '').length + 2)),
        ),
      }));
      ws['!freeze'] = { xSplit: 0, ySplit: 1 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Alarmas');
      XLSX.writeFile(wb, `${this.exportSlug()}-${this.stamp()}.xlsx`);
    } finally {
      this.exporting.set(false);
    }
  }

  private exportSlug(): string {
    return (
      this.exportTitle()
        .normalize('NFD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'historial-alarmas'
    );
  }

  private stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  // Mismos colores que las cards .vs-alarm-* de Ventisqueros: crit=rojo,
  // warn=ámbar, info=teal (primary).
  borderClass(s: AlarmHistoryItem['severity']): string {
    if (s === 'crit') return 'border-l-rose-500';
    if (s === 'warn') return 'border-l-amber-500';
    return 'border-l-primary';
  }

  iconClass(s: AlarmHistoryItem['severity']): string {
    if (s === 'crit') return 'bg-rose-500/10 text-rose-600';
    if (s === 'warn') return 'bg-amber-500/10 text-amber-600';
    return 'bg-primary-tint-10 text-primary-container';
  }

  badgeClass(s: AlarmHistoryItem['severity']): string {
    if (s === 'crit') return 'bg-rose-500/10 text-rose-700';
    if (s === 'warn') return 'bg-amber-500/10 text-amber-700';
    return 'bg-primary-tint-14 text-primary-container';
  }

  dotClass(s: AlarmHistoryItem['severity']): string {
    if (s === 'crit') return 'bg-rose-500';
    if (s === 'warn') return 'bg-amber-500';
    return 'bg-primary';
  }

  when(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  duration(it: AlarmHistoryItem): string {
    const start = new Date(it.startedAt).getTime();
    const end = it.endedAt ? new Date(it.endedAt).getTime() : Date.now();
    const min = Math.max(0, Math.round((end - start) / 60000));
    const txt = min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}min`;
    return it.endedAt ? txt : `${txt} (en curso)`;
  }
}
