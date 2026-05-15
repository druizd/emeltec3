import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { User } from '@emeltec/shared';
import {
  AlertaService,
  AlertaSeveridad,
  EventoEstado,
  EventoRow,
} from '../../../../services/alerta.service';
import { UserService } from '../../../../services/user.service';

type FiltroEstado = EventoEstado | 'todos';

@Component({
  selector: 'app-alertas-bandeja',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">
      @if (loading()) {
        <p class="rounded-xl bg-slate-50 px-4 py-3 text-[12px] text-slate-500">Cargando eventos…</p>
      }
      @if (errorMsg()) {
        <p class="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{{ errorMsg() }}</p>
      }

      <!-- Resumen rápido -->
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        @for (stat of stats(); track stat.label) {
          <div class="rounded-xl border bg-white px-4 py-3 shadow-sm" [class]="stat.borderClass">
            <p class="text-[10px] font-black uppercase tracking-widest" [class]="stat.labelClass">
              {{ stat.label }}
            </p>
            <p class="mt-0.5 text-2xl font-black" [class]="stat.valueClass">{{ stat.valor }}</p>
          </div>
        }
      </div>

      <!-- Filtro por estado -->
      <div class="flex flex-wrap gap-1.5">
        @for (f of filtros; track f.key) {
          <button type="button" (click)="filtroActivo.set(f.key)" [class]="filtroClass(f.key)">
            {{ f.label }}
          </button>
        }
        <span class="ml-auto self-center text-[11px] font-semibold text-slate-400">
          {{ eventosFiltrados().length }} alertas
        </span>
      </div>

      <!-- Lista de eventos -->
      <div class="space-y-2">
        @for (ev of eventosFiltrados(); track ev.id) {
          <article
            class="rounded-2xl border bg-white shadow-sm"
            [class]="tarjetaBorde(ev.severidad, ev.estado)"
          >
            <div class="p-4">
              <div class="flex items-start gap-3">
                <span
                  [class]="severidadIconClass(ev.severidad)"
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                >
                  <span class="material-symbols-outlined text-[20px]">{{
                    severidadIcon(ev.severidad)
                  }}</span>
                </span>

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-mono text-[11px] font-bold text-slate-400">{{
                          codigoEvento(ev)
                        }}</span>
                        <span
                          [class]="severidadBadgeClass(ev.severidad)"
                          class="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide"
                        >
                          {{ severidadLabel(ev.severidad) }}
                        </span>
                      </div>
                      <p class="mt-0.5 font-black text-slate-800">
                        {{ ev.alerta_nombre || ev.variable_key }}
                      </p>
                      <p class="text-[12px] text-slate-500">{{ ev.mensaje }}</p>
                    </div>
                    <span
                      [class]="estadoBadgeClass(ev.estado)"
                      class="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
                    >
                      <span
                        [class]="estadoDotClass(ev.estado)"
                        class="h-1.5 w-1.5 rounded-full"
                      ></span>
                      {{ estadoLabel(ev.estado) }}
                    </span>
                  </div>

                  <!-- Meta info -->
                  <div
                    class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400"
                  >
                    <span class="flex items-center gap-1">
                      <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                      {{ formatFecha(ev.triggered_at) }}
                    </span>
                    <span class="flex items-center gap-1">
                      <span class="material-symbols-outlined text-[14px]">timer</span>
                      {{ tiempoTranscurrido(ev.triggered_at) }}
                    </span>
                    @if (ev.asignado_nombre_completo) {
                      <span class="flex items-center gap-1">
                        <span class="material-symbols-outlined text-[14px]">person</span>
                        {{ ev.asignado_nombre_completo }}
                      </span>
                    }
                    @if (ev.incidencia_id) {
                      <span class="flex items-center gap-1 text-cyan-600">
                        <span class="material-symbols-outlined text-[14px]">link</span>
                        {{ ev.incidencia_id }}
                      </span>
                    }
                  </div>

                  <!-- Selector de asignación inline -->
                  @if (asignandoId() === ev.id) {
                    <div
                      class="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2"
                    >
                      <select
                        [(ngModel)]="asignadoSeleccionado"
                        class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-700"
                      >
                        <option value="">Selecciona usuario…</option>
                        @for (u of usuariosEmpresa(); track u.id) {
                          <option [value]="u.id">{{ u.nombre }} {{ u.apellido }}</option>
                        }
                      </select>
                      <button
                        type="button"
                        (click)="confirmarAsignar(ev)"
                        [disabled]="!asignadoSeleccionado || actuando()"
                        class="inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-cyan-700 disabled:opacity-50"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        (click)="cancelarAsignar()"
                        class="text-[12px] font-bold text-slate-500 hover:text-slate-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  }

                  <!-- Acciones -->
                  @if (ev.estado !== 'resuelta' && asignandoId() !== ev.id) {
                    <div class="mt-3 flex flex-wrap gap-2">
                      @if (ev.estado === 'activa') {
                        <button
                          type="button"
                          [disabled]="actuando()"
                          (click)="reconocer(ev)"
                          class="inline-flex items-center gap-1 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[12px] font-bold text-cyan-700 hover:bg-cyan-100 disabled:opacity-50"
                        >
                          <span class="material-symbols-outlined text-[14px]">visibility</span>
                          Reconocer
                        </button>
                      }
                      @if (ev.estado === 'activa' || ev.estado === 'reconocida') {
                        <button
                          type="button"
                          [disabled]="actuando()"
                          (click)="iniciarAsignar(ev)"
                          class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <span class="material-symbols-outlined text-[14px]">person_add</span>
                          Asignar
                        </button>
                      }
                      <button
                        type="button"
                        [disabled]="actuando()"
                        (click)="resolver(ev)"
                        class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <span class="material-symbols-outlined text-[14px]">check_circle</span>
                        Resolver
                      </button>
                      @if (!ev.incidencia_id) {
                        <button
                          type="button"
                          [disabled]="actuando()"
                          (click)="vincularIncidencia(ev)"
                          class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <span class="material-symbols-outlined text-[14px]">link</span>
                          Vincular incidencia
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>
            </div>
          </article>
        } @empty {
          @if (!loading()) {
            <div
              class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"
            >
              <span class="material-symbols-outlined text-4xl text-slate-300">inbox</span>
              <p class="mt-2 text-sm font-semibold text-slate-400">Bandeja vacía con estos filtros</p>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class AlertasBandejaComponent {
  private readonly alertaService = inject(AlertaService);
  private readonly userService = inject(UserService);

  readonly sitioId = input<string>('');
  readonly empresaId = input<string>('');

  readonly filtroActivo = signal<FiltroEstado>('todos');
  readonly eventos = signal<EventoRow[]>([]);
  readonly loading = signal(false);
  readonly actuando = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly asignandoId = signal<number | null>(null);
  readonly usuariosEmpresa = signal<User[]>([]);

  asignadoSeleccionado = '';

  readonly filtros: { key: FiltroEstado; label: string }[] = [
    { key: 'todos', label: 'Todas' },
    { key: 'activa', label: 'Activas' },
    { key: 'reconocida', label: 'Reconocidas' },
    { key: 'asignada', label: 'Asignadas' },
    { key: 'resuelta', label: 'Resueltas' },
  ];

  constructor() {
    effect(() => {
      const sid = this.sitioId();
      if (sid) this.recargar();
    });
    effect(() => {
      const eid = this.empresaId();
      if (eid) this.cargarUsuarios(eid);
    });
  }

  private recargar(): void {
    const sid = this.sitioId();
    if (!sid) return;
    this.loading.set(true);
    this.errorMsg.set(null);
    this.alertaService.listarEventos({ sitio_id: sid, limit: 200 }).subscribe({
      next: (rows) => {
        this.eventos.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'Error cargando eventos');
        this.loading.set(false);
      },
    });
  }

  private cargarUsuarios(empresaId: string): void {
    this.userService.getUsers({ empresa_id: empresaId }).subscribe({
      next: (res) => {
        if (res.ok) this.usuariosEmpresa.set(res.data);
      },
    });
  }

  readonly eventosFiltrados = computed(() => {
    const f = this.filtroActivo();
    return f === 'todos' ? this.eventos() : this.eventos().filter((e) => e.estado === f);
  });

  readonly stats = computed(() => {
    const all = this.eventos();
    const activas = all.filter((e) => e.estado === 'activa').length;
    const criticas = all.filter((e) => e.severidad === 'critica' && e.estado !== 'resuelta').length;
    const asignadas = all.filter((e) => e.estado === 'asignada').length;
    const resueltasHoy = all.filter((e) => e.estado === 'resuelta' && esDeHoy(e.resuelta_at)).length;
    return [
      {
        label: 'Activas',
        valor: activas,
        borderClass: activas ? 'border-rose-200' : 'border-slate-200',
        labelClass: 'text-rose-500',
        valueClass: activas ? 'text-rose-600' : 'text-slate-400',
      },
      {
        label: 'Críticas',
        valor: criticas,
        borderClass: criticas ? 'border-amber-200' : 'border-slate-200',
        labelClass: 'text-amber-500',
        valueClass: criticas ? 'text-amber-600' : 'text-slate-400',
      },
      {
        label: 'Asignadas',
        valor: asignadas,
        borderClass: 'border-slate-200',
        labelClass: 'text-slate-400',
        valueClass: 'text-slate-700',
      },
      {
        label: 'Resueltas hoy',
        valor: resueltasHoy,
        borderClass: 'border-slate-200',
        labelClass: 'text-slate-400',
        valueClass: 'text-slate-700',
      },
    ];
  });

  reconocer(ev: EventoRow): void {
    this.actuando.set(true);
    this.alertaService.reconocerEvento(ev.id).subscribe({
      next: (updated) => this.aplicarUpdate(updated),
      error: (err) => this.errorMsg.set(err?.error?.error || 'No se pudo reconocer'),
      complete: () => this.actuando.set(false),
    });
  }

  iniciarAsignar(ev: EventoRow): void {
    this.asignadoSeleccionado = ev.asignado_a || '';
    this.asignandoId.set(ev.id);
  }

  cancelarAsignar(): void {
    this.asignandoId.set(null);
    this.asignadoSeleccionado = '';
  }

  confirmarAsignar(ev: EventoRow): void {
    if (!this.asignadoSeleccionado) return;
    this.actuando.set(true);
    this.alertaService.asignarEvento(ev.id, this.asignadoSeleccionado).subscribe({
      next: (updated) => {
        this.aplicarUpdate(updated);
        this.cancelarAsignar();
      },
      error: (err) => this.errorMsg.set(err?.error?.error || 'No se pudo asignar'),
      complete: () => this.actuando.set(false),
    });
  }

  resolver(ev: EventoRow): void {
    if (!confirm(`¿Marcar como resuelta la alerta "${ev.alerta_nombre || ev.variable_key}"?`)) return;
    this.actuando.set(true);
    this.alertaService.resolverEvento(ev.id).subscribe({
      next: (updated) => this.aplicarUpdate(updated),
      error: (err) =>
        this.errorMsg.set(
          err?.error?.error ||
            'No se pudo resolver (¿tu rol tiene permisos? requiere Admin/SuperAdmin)',
        ),
      complete: () => this.actuando.set(false),
    });
  }

  vincularIncidencia(ev: EventoRow): void {
    const inc = prompt('Código de incidencia (ej. INC-0018):', ev.incidencia_id || '');
    if (!inc || !inc.trim()) return;
    this.actuando.set(true);
    this.alertaService.vincularIncidencia(ev.id, inc.trim()).subscribe({
      next: (updated) => this.aplicarUpdate(updated),
      error: (err) => this.errorMsg.set(err?.error?.error || 'No se pudo vincular'),
      complete: () => this.actuando.set(false),
    });
  }

  private aplicarUpdate(updated: EventoRow): void {
    this.eventos.update((list) => list.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)));
  }

  codigoEvento(ev: EventoRow): string {
    return `ALT-${String(ev.id).padStart(4, '0')}`;
  }

  formatFecha(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  tiempoTranscurrido(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const min = Math.floor(diffMs / 60000);
    if (min < 1) return 'Hace un instante';
    if (min < 60) return `Hace ${min} min`;
    const horas = Math.floor(min / 60);
    if (horas < 24) return `Hace ${horas} h`;
    const dias = Math.floor(horas / 24);
    return `Hace ${dias} día${dias === 1 ? '' : 's'}`;
  }

  tarjetaBorde(severidad: AlertaSeveridad, estado: EventoEstado): string {
    if (estado === 'resuelta') return 'border-slate-100 opacity-70';
    if (severidad === 'critica') return 'border-rose-200';
    if (severidad === 'alta') return 'border-orange-200';
    if (severidad === 'media') return 'border-amber-200';
    return 'border-slate-200';
  }

  severidadIcon(s: AlertaSeveridad): string {
    if (s === 'critica') return 'emergency';
    if (s === 'alta') return 'warning';
    if (s === 'media') return 'warning';
    return 'info';
  }

  severidadIconClass(s: AlertaSeveridad): string {
    if (s === 'critica') return 'bg-rose-50 text-rose-500';
    if (s === 'alta') return 'bg-orange-50 text-orange-500';
    if (s === 'media') return 'bg-amber-50 text-amber-500';
    return 'bg-blue-50 text-blue-500';
  }

  severidadLabel(s: AlertaSeveridad): string {
    return { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' }[s];
  }

  severidadBadgeClass(s: AlertaSeveridad): string {
    if (s === 'critica') return 'bg-rose-50 text-rose-600';
    if (s === 'alta') return 'bg-orange-50 text-orange-600';
    if (s === 'media') return 'bg-amber-50 text-amber-600';
    return 'bg-blue-50 text-blue-600';
  }

  estadoLabel(e: EventoEstado): string {
    return { activa: 'Activa', reconocida: 'Reconocida', asignada: 'Asignada', resuelta: 'Resuelta' }[e];
  }

  estadoBadgeClass(e: EventoEstado): string {
    const map: Record<EventoEstado, string> = {
      activa: 'bg-rose-50 text-rose-600',
      reconocida: 'bg-amber-50 text-amber-700',
      asignada: 'bg-cyan-50 text-cyan-700',
      resuelta: 'bg-slate-100 text-slate-500',
    };
    return map[e];
  }

  estadoDotClass(e: EventoEstado): string {
    const map: Record<EventoEstado, string> = {
      activa: 'bg-rose-500',
      reconocida: 'bg-amber-500',
      asignada: 'bg-cyan-500',
      resuelta: 'bg-slate-400',
    };
    return map[e];
  }

  filtroClass(key: FiltroEstado): string {
    const active = this.filtroActivo() === key;
    return [
      'rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all',
      active
        ? 'bg-slate-800 text-white'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }
}

function esDeHoy(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}
