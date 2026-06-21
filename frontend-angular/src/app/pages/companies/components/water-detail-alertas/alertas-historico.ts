import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { AlertaService, AlertaSeveridad, EventoRow } from '../../../../services/alerta.service';
import { InlineErrorComponent } from '../../../../components/ui/inline-error';
import {
  AlarmHistoryListComponent,
  type AlarmHistoryItem,
} from '../../../../components/ui/alarm-history-list';

type HistoricoFiltro = 'todos' | AlertaSeveridad;

@Component({
  selector: 'app-alertas-historico',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, InlineErrorComponent, AlarmHistoryListComponent],
  template: `
    <div class="space-y-3">
      @if (errorMsg()) {
        <app-inline-error [message]="errorMsg()" />
      }

      <!-- Filtros -->
      <header class="flex flex-wrap items-center gap-2">
        @for (f of filtros; track f.key) {
          <button type="button" (click)="filtroActivo.set(f.key)" [class]="filtroClass(f.key)">
            {{ f.label }}
          </button>
        }
        <span class="ml-auto text-caption-xs font-semibold text-slate-400"
          >{{ historialFiltrado().length }} registros</span
        >
      </header>

      <!-- Lista compartida (mismo diseño que el historial de Ventisqueros) -->
      <app-alarm-history-list
        [items]="items()"
        [loading]="loading()"
        emptyText="Sin registros con estos filtros"
      />
      <div class="flex items-center justify-between px-1 pt-1">
        <p class="text-caption-xs text-slate-400">Últimos 90 días</p>
        <button
          type="button"
          (click)="exportarCsv()"
          class="inline-flex items-center gap-1 text-caption font-bold text-primary-container hover:underline"
        >
          <span class="material-symbols-outlined text-[14px]">download</span>
          Exportar CSV
        </button>
      </div>
    </div>
  `,
})
export class AlertasHistoricoComponent {
  private readonly alertaService = inject(AlertaService);

  readonly sitioId = input<string>('');

  readonly filtroActivo = signal<HistoricoFiltro>('todos');
  readonly historial = signal<EventoRow[]>([]);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);

  readonly filtros: { key: HistoricoFiltro; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'critica', label: 'Críticas' },
    { key: 'alta', label: 'Altas' },
    { key: 'media', label: 'Medias' },
    { key: 'baja', label: 'Bajas' },
  ];

  constructor() {
    effect(() => {
      const sid = this.sitioId();
      if (sid) this.recargar();
    });
  }

  private recargar(): void {
    const sid = this.sitioId();
    if (!sid) return;
    this.loading.set(true);
    this.errorMsg.set(null);
    const desde = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    this.alertaService
      .listarEventos({ sitio_id: sid, resuelta: true, desde, limit: 500 })
      .subscribe({
        next: (rows) => {
          this.historial.set(rows);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMsg.set(err?.error?.error || 'Error cargando histórico');
          this.loading.set(false);
        },
      });
  }

  readonly historialFiltrado = computed(() => {
    const f = this.filtroActivo();
    return f === 'todos' ? this.historial() : this.historial().filter((e) => e.severidad === f);
  });

  // Mapea EventoRow → AlarmHistoryItem para el componente compartido.
  readonly items = computed<AlarmHistoryItem[]>(() =>
    this.historialFiltrado().map((ev) => {
      const sev: 'info' | 'warn' | 'crit' =
        ev.severidad === 'critica' ? 'crit' : ev.severidad === 'baja' ? 'info' : 'warn';
      const tags: AlarmHistoryItem['tags'] = [];
      if (ev.asignado_nombre_completo)
        tags.push({ icon: 'person', label: ev.asignado_nombre_completo });
      if (ev.incidencia_id) tags.push({ icon: 'link', label: ev.incidencia_id, emphasis: true });
      return {
        id: ev.id,
        title: ev.alerta_nombre || ev.variable_key,
        code: this.codigoEvento(ev),
        detail: ev.variable_key,
        severity: sev,
        severityLabel: this.severidadLabel(ev.severidad),
        startedAt: ev.triggered_at,
        endedAt: ev.resuelta_at,
        status: ev.resuelta_at ? 'resuelta' : 'activa',
        tags,
      } satisfies AlarmHistoryItem;
    }),
  );

  codigoEvento(ev: EventoRow): string {
    return `ALT-${String(ev.id).padStart(4, '0')}`;
  }

  formatFecha(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  duracion(triggered: string, resuelta: string | null): string {
    if (!resuelta) return '—';
    const ms = new Date(resuelta).getTime() - new Date(triggered).getTime();
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const totalMin = Math.floor(ms / 60000);
    const horas = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    if (horas === 0) return `${min} min`;
    return `${horas} h ${String(min).padStart(2, '0')} min`;
  }

  severidadLabel(s: AlertaSeveridad): string {
    return { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' }[s];
  }

  filtroClass(key: HistoricoFiltro): string {
    const active = this.filtroActivo() === key;
    return [
      'rounded-xl px-3 py-1.5 text-caption font-bold transition-all',
      active
        ? 'bg-slate-800 text-white'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  exportarCsv(): void {
    const rows = this.historialFiltrado();
    if (!rows.length) return;
    const header = [
      'Codigo',
      'Variable',
      'Severidad',
      'Inicio',
      'Cierre',
      'Duración',
      'Resolvio',
      'Incidencia',
    ];
    const lines = rows.map((ev) =>
      [
        this.codigoEvento(ev),
        ev.alerta_nombre || ev.variable_key,
        ev.severidad,
        this.formatFecha(ev.triggered_at),
        ev.resuelta_at ? this.formatFecha(ev.resuelta_at) : '',
        this.duracion(ev.triggered_at, ev.resuelta_at),
        ev.asignado_nombre_completo || '',
        ev.incidencia_id || '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alertas-historico-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
