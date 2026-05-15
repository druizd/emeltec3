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

type HistoricoFiltro = 'todos' | AlertaSeveridad;

@Component({
  selector: 'app-alertas-historico',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      @if (errorMsg()) {
        <p class="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{{ errorMsg() }}</p>
      }

      <!-- Filtros -->
      <header class="flex flex-wrap items-center gap-2">
        @for (f of filtros; track f.key) {
          <button type="button" (click)="filtroActivo.set(f.key)" [class]="filtroClass(f.key)">
            {{ f.label }}
          </button>
        }
        <span class="ml-auto text-[11px] font-semibold text-slate-400"
          >{{ historialFiltrado().length }} registros</span
        >
      </header>

      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Código
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Variable
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Severidad
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Inicio
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Duración
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Resolvió
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Incidencia
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @if (loading()) {
                <tr>
                  <td colspan="7" class="px-4 py-10 text-center text-[12px] text-slate-400">
                    Cargando histórico…
                  </td>
                </tr>
              } @else {
                @for (ev of historialFiltrado(); track ev.id) {
                  <tr class="group hover:bg-slate-50/60">
                    <td class="px-4 py-3 font-mono text-[12px] text-slate-500">
                      {{ codigoEvento(ev) }}
                    </td>
                    <td class="px-4 py-3 font-semibold text-slate-800">
                      {{ ev.alerta_nombre || ev.variable_key }}
                    </td>
                    <td class="px-4 py-3">
                      <span
                        [class]="severidadClass(ev.severidad)"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide"
                      >
                        <span
                          [class]="severidadDotClass(ev.severidad)"
                          class="h-1.5 w-1.5 rounded-full"
                        ></span>
                        {{ severidadLabel(ev.severidad) }}
                      </span>
                    </td>
                    <td class="px-4 py-3 font-mono text-[12px] text-slate-600">
                      {{ formatFecha(ev.triggered_at) }}
                    </td>
                    <td class="px-4 py-3 text-[12px] font-semibold text-slate-600">
                      {{ duracion(ev.triggered_at, ev.resuelta_at) }}
                    </td>
                    <td class="px-4 py-3 text-[12px] text-slate-600">
                      {{ ev.asignado_nombre_completo || '—' }}
                    </td>
                    <td class="px-4 py-3">
                      @if (ev.incidencia_id) {
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-bold text-cyan-700"
                        >
                          <span class="material-symbols-outlined text-[12px]">link</span>
                          {{ ev.incidencia_id }}
                        </span>
                      } @else {
                        <span class="text-[11px] text-slate-300">—</span>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="7" class="px-4 py-10 text-center">
                      <span class="material-symbols-outlined text-3xl text-slate-300">history</span>
                      <p class="mt-2 text-sm font-semibold text-slate-400">
                        Sin registros con estos filtros
                      </p>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <p class="text-[11px] text-slate-400">Últimos 90 días</p>
          <button
            type="button"
            (click)="exportarCsv()"
            class="inline-flex items-center gap-1 text-[12px] font-bold text-cyan-700 hover:underline"
          >
            <span class="material-symbols-outlined text-[14px]">download</span>
            Exportar CSV
          </button>
        </div>
      </section>
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

  severidadClass(s: AlertaSeveridad): string {
    if (s === 'critica') return 'bg-rose-50 text-rose-600';
    if (s === 'alta') return 'bg-orange-50 text-orange-600';
    if (s === 'media') return 'bg-amber-50 text-amber-600';
    return 'bg-blue-50 text-blue-600';
  }

  severidadDotClass(s: AlertaSeveridad): string {
    if (s === 'critica') return 'bg-rose-500';
    if (s === 'alta') return 'bg-orange-500';
    if (s === 'media') return 'bg-amber-500';
    return 'bg-blue-500';
  }

  filtroClass(key: HistoricoFiltro): string {
    const active = this.filtroActivo() === key;
    return [
      'rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all',
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
      'Duracion',
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
