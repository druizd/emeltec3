import { CommonModule } from '@angular/common';
import { InlineErrorComponent } from '../../../../components/ui/inline-error';
import { SkeletonComponent } from '../../../../components/ui/skeleton';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  AuditLogEntry,
  AuditLogService,
  AuditTargetType,
  describeAccion,
} from '../../../../services/audit-log.service';

type RecursoFiltro = AuditTargetType | 'todos';

@Component({
  selector: 'app-bitacora-trazabilidad',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, InlineErrorComponent, SkeletonComponent],
  template: `
    <div class="space-y-3">
      @if (errorMsg()) {
        <app-inline-error [message]="errorMsg()" />
      }

      <header class="flex flex-wrap items-center gap-2">
        @for (f of filtros; track f.key) {
          <button
            type="button"
            (click)="filtroRecurso.set(f.key)"
            [class]="filtroClass(f.key)"
            [attr.aria-pressed]="filtroRecurso() === f.key"
          >
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">{{ f.icon }}</span>
            {{ f.label }}
          </button>
        }
        <span class="ml-auto text-caption-xs font-semibold text-slate-400">
          {{ entradas().length }} registros
        </span>
      </header>

      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[680px] text-left text-body-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th
                  class="px-4 py-3 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Fecha y hora
                </th>
                <th
                  class="px-4 py-3 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Usuario
                </th>
                <th
                  class="px-4 py-3 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Acción
                </th>
                <th
                  class="px-4 py-3 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Recurso
                </th>
                <th
                  class="px-4 py-3 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >
                  Detalle
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @if (loading()) {
                @for (_ of [0, 1, 2, 3, 4]; track $index) {
                  <tr>
                    @for (__ of [0, 1, 2, 3, 4]; track $index) {
                      <td class="px-4 py-3">
                        <app-skeleton class="h-3 w-full rounded" />
                      </td>
                    }
                  </tr>
                }
              } @else {
                @for (entry of entradas(); track entry.id) {
                  <tr class="hover:bg-slate-50/60">
                    <td class="px-4 py-3 font-mono text-caption text-slate-500">
                      {{ formatFecha(entry.ts) }}
                    </td>
                    <td class="px-4 py-3">
                      <p class="font-semibold text-slate-800">
                        {{ entry.actor_email || '—' }}
                      </p>
                      <p class="text-caption-xs uppercase tracking-wide text-slate-400">
                        {{ entry.actor_tipo || '—' }}
                      </p>
                    </td>
                    <td class="px-4 py-3">
                      <span
                        [class]="accionClass(entry.action)"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption-xs font-bold"
                      >
                        {{ accionLabel(entry.action) }}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      <span
                        [class]="recursoClass(entry.target_type)"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption-xs font-bold"
                      >
                        <span class="material-symbols-outlined text-[12px]" aria-hidden="true">
                          {{ recursoIcon(entry.target_type) }}
                        </span>
                        {{ recursoLabel(entry.target_type) }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-caption text-slate-500">
                      {{ detalle(entry) }}
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="px-4 py-10 text-center">
                      <span class="material-symbols-outlined text-3xl text-slate-300" aria-hidden="true"
                        >fact_check</span
                      >
                      <p class="mt-2 text-body-sm font-semibold text-slate-400">
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
          <p class="text-caption-xs text-slate-400">Registro automático — solo lectura</p>
          <button
            type="button"
            (click)="exportarCsv()"
            class="inline-flex items-center gap-1 text-caption font-bold text-primary-container hover:underline active:scale-95"
          >
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">download</span>
            Exportar CSV
          </button>
        </div>
      </section>
    </div>
  `,
})
export class BitacoraAuditLogComponent {
  private readonly auditService = inject(AuditLogService);

  readonly sitioId = input<string>('');
  readonly empresaId = input<string>('');

  readonly filtroRecurso = signal<RecursoFiltro>('todos');
  readonly entradasAll = signal<AuditLogEntry[]>([]);
  readonly loading = signal(false);
  readonly errorMsg = signal<string | null>(null);

  readonly filtros: { key: RecursoFiltro; label: string; icon: string }[] = [
    { key: 'todos', label: 'Todos', icon: 'list' },
    { key: 'sitio', label: 'Sitio', icon: 'settings' },
    { key: 'alerta', label: 'Alertas', icon: 'notifications' },
    { key: 'evento', label: 'Eventos', icon: 'campaign' },
    { key: 'incidencia', label: 'Incidencias', icon: 'history' },
    { key: 'usuario', label: 'Usuarios', icon: 'person' },
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
    this.auditService.listar({ sitio_id: sid, limit: 200 }).subscribe({
      next: (rows) => {
        this.entradasAll.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'Error cargando bitácora');
        this.loading.set(false);
      },
    });
  }

  readonly entradas = computed(() => {
    const f = this.filtroRecurso();
    return f === 'todos'
      ? this.entradasAll()
      : this.entradasAll().filter((e) => e.target_type === f);
  });

  accionLabel(action: string): string {
    return describeAccion(action).verbo;
  }

  recursoLabel(t: string | null): string {
    const map: Record<string, string> = {
      usuario: 'Usuario',
      empresa: 'Empresa',
      alerta: 'Alerta',
      evento: 'Evento',
      incidencia: 'Incidencia',
      sitio: 'Sitio',
    };
    return map[t || ''] || '—';
  }

  recursoIcon(t: string | null): string {
    const map: Record<string, string> = {
      usuario: 'person',
      empresa: 'apartment',
      alerta: 'notifications',
      evento: 'campaign',
      incidencia: 'history',
      sitio: 'settings',
    };
    return map[t || ''] || 'circle';
  }

  recursoClass(t: string | null): string {
    const map: Record<string, string> = {
      usuario: 'bg-accent/10 text-accent-container',
      empresa: 'bg-blue-50 text-blue-700',
      alerta: 'bg-amber-50 text-amber-700',
      evento: 'bg-rose-50 text-rose-700',
      incidencia: 'bg-orange-50 text-orange-700',
      sitio: 'bg-slate-100 text-slate-600',
    };
    return map[t || ''] || 'bg-slate-100 text-slate-600';
  }

  accionClass(action: string): string {
    const { verbo } = describeAccion(action);
    if (verbo === 'Creó') return 'bg-primary-tint-08 text-primary-container';
    if (verbo === 'Modificó') return 'bg-amber-50 text-amber-700';
    if (verbo === 'Eliminó') return 'bg-rose-50 text-rose-700';
    return 'bg-slate-100 text-slate-600';
  }

  detalle(entry: AuditLogEntry): string {
    const path = (entry.metadata as { path?: string })?.path;
    const method = (entry.metadata as { method?: string })?.method;
    const target = entry.target_id ? `#${entry.target_id}` : '';
    return [method, path, target].filter(Boolean).join(' ');
  }

  formatFecha(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  filtroClass(key: RecursoFiltro): string {
    const active = this.filtroRecurso() === key;
    return [
      'inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-caption font-bold transition-colors active:scale-95',
      active
        ? 'bg-primary-tint-08 text-primary-container ring-1 ring-primary-tint-30'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  exportarCsv(): void {
    const rows = this.entradas();
    if (!rows.length) return;
    const header = ['Fecha', 'Usuario', 'Rol', 'Acción', 'Recurso', 'Target ID', 'Status', 'IP'];
    const lines = rows.map((e) =>
      [
        this.formatFecha(e.ts),
        e.actor_email || '',
        e.actor_tipo || '',
        e.action,
        e.target_type || '',
        e.target_id || '',
        e.status_code ?? '',
        e.ip || '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bitacora-trazabilidad-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
