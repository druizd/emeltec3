import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

type AlertaEstado = 'activa' | 'reconocida' | 'asignada' | 'resuelta';
type AlertaSeveridad = 'critica' | 'advertencia' | 'info';

interface AlertaActiva {
  id: string;
  codigo: string;
  variable: string;
  mensaje: string;
  severidad: AlertaSeveridad;
  estado: AlertaEstado;
  fechaInicio: string;
  tecnicoAsignado: string | null;
  incidenciaVinculada: string | null;
  tiempoTranscurrido: string;
}

@Component({
  selector: 'app-alertas-bandeja',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
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
          {{ alertasFiltradas().length }} alertas
        </span>
      </div>

      <!-- Lista de alertas -->
      <div class="space-y-2">
        @for (alerta of alertasFiltradas(); track alerta.id) {
          <article
            class="rounded-2xl border bg-white shadow-sm"
            [class]="tarjetaBorde(alerta.severidad, alerta.estado)"
          >
            <div class="p-4">
              <div class="flex items-start gap-3">
                <!-- Icono severidad -->
                <span
                  [class]="severidadIconClass(alerta.severidad)"
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                >
                  <span class="material-symbols-outlined text-[20px]">{{
                    severidadIcon(alerta.severidad)
                  }}</span>
                </span>

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="font-mono text-[11px] font-bold text-slate-400">{{
                          alerta.codigo
                        }}</span>
                        <span
                          [class]="severidadBadgeClass(alerta.severidad)"
                          class="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide"
                        >
                          {{ severidadLabel(alerta.severidad) }}
                        </span>
                      </div>
                      <p class="mt-0.5 font-black text-slate-800">{{ alerta.variable }}</p>
                      <p class="text-[12px] text-slate-500">{{ alerta.mensaje }}</p>
                    </div>
                    <span
                      [class]="estadoBadgeClass(alerta.estado)"
                      class="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
                    >
                      <span
                        [class]="estadoDotClass(alerta.estado)"
                        class="h-1.5 w-1.5 rounded-full"
                      ></span>
                      {{ estadoLabel(alerta.estado) }}
                    </span>
                  </div>

                  <!-- Meta info -->
                  <div
                    class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400"
                  >
                    <span class="flex items-center gap-1">
                      <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                      {{ alerta.fechaInicio }}
                    </span>
                    <span class="flex items-center gap-1">
                      <span class="material-symbols-outlined text-[14px]">timer</span>
                      {{ alerta.tiempoTranscurrido }}
                    </span>
                    @if (alerta.tecnicoAsignado) {
                      <span class="flex items-center gap-1">
                        <span class="material-symbols-outlined text-[14px]">person</span>
                        {{ alerta.tecnicoAsignado }}
                      </span>
                    }
                    @if (alerta.incidenciaVinculada) {
                      <span class="flex items-center gap-1 text-cyan-600">
                        <span class="material-symbols-outlined text-[14px]">link</span>
                        {{ alerta.incidenciaVinculada }}
                      </span>
                    }
                  </div>

                  <!-- Acciones -->
                  @if (alerta.estado !== 'resuelta') {
                    <div class="mt-3 flex flex-wrap gap-2">
                      @if (alerta.estado === 'activa') {
                        <button
                          type="button"
                          (click)="reconocer(alerta)"
                          class="inline-flex items-center gap-1 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[12px] font-bold text-cyan-700 hover:bg-cyan-100"
                        >
                          <span class="material-symbols-outlined text-[14px]">visibility</span>
                          Reconocer
                        </button>
                      }
                      @if (alerta.estado === 'activa' || alerta.estado === 'reconocida') {
                        <button
                          type="button"
                          (click)="asignar(alerta)"
                          class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50"
                        >
                          <span class="material-symbols-outlined text-[14px]">person_add</span>
                          Asignar
                        </button>
                      }
                      <button
                        type="button"
                        (click)="resolver(alerta)"
                        class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100"
                      >
                        <span class="material-symbols-outlined text-[14px]">check_circle</span>
                        Resolver
                      </button>
                      @if (!alerta.incidenciaVinculada) {
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50"
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
          <div
            class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"
          >
            <span class="material-symbols-outlined text-4xl text-slate-300">inbox</span>
            <p class="mt-2 text-sm font-semibold text-slate-400">Bandeja vacía con estos filtros</p>
          </div>
        }
      </div>
    </div>
  `,
})
export class AlertasBandejaComponent {
  readonly filtroActivo = signal<AlertaEstado | 'todos'>('todos');

  readonly filtros: { key: AlertaEstado | 'todos'; label: string }[] = [
    { key: 'todos', label: 'Todas' },
    { key: 'activa', label: 'Activas' },
    { key: 'reconocida', label: 'Reconocidas' },
    { key: 'asignada', label: 'Asignadas' },
    { key: 'resuelta', label: 'Resueltas' },
  ];

  alertas: AlertaActiva[] = [
    {
      id: '1',
      codigo: 'ALT-0044',
      variable: 'Tablero eléctrico',
      mensaje: 'Temperatura superior a 65°C detectada en tablero de control.',
      severidad: 'critica',
      estado: 'asignada',
      fechaInicio: '06/05/2026 10:03',
      tecnicoAsignado: 'L. Pérez',
      incidenciaVinculada: 'INC-0018',
      tiempoTranscurrido: 'Hace 2 h',
    },
    {
      id: '2',
      codigo: 'ALT-0043',
      variable: 'Caudal mínimo',
      mensaje: 'Caudal 1.8 L/s — por debajo del umbral de 2.0 L/s.',
      severidad: 'advertencia',
      estado: 'reconocida',
      fechaInicio: '06/05/2026 07:45',
      tecnicoAsignado: null,
      incidenciaVinculada: null,
      tiempoTranscurrido: 'Hace 4 h',
    },
    {
      id: '3',
      codigo: 'ALT-0042',
      variable: 'Batería de respaldo',
      mensaje: 'UPS con nivel de batería al 18%. Revisar conexión a red.',
      severidad: 'advertencia',
      estado: 'activa',
      fechaInicio: '06/05/2026 06:00',
      tecnicoAsignado: null,
      incidenciaVinculada: null,
      tiempoTranscurrido: 'Hace 6 h',
    },
    {
      id: '4',
      codigo: 'ALT-0041',
      variable: 'Sensor de nivel',
      mensaje: 'Sin lectura por más de 60 minutos. Posible desconexión.',
      severidad: 'critica',
      estado: 'resuelta',
      fechaInicio: '28/04/2026 09:00',
      tecnicoAsignado: 'L. Pérez',
      incidenciaVinculada: 'INC-0016',
      tiempoTranscurrido: 'Hace 8 días',
    },
  ];

  readonly alertasFiltradas = computed(() => {
    const f = this.filtroActivo();
    return f === 'todos' ? this.alertas : this.alertas.filter((a) => a.estado === f);
  });

  readonly stats = computed(() => {
    const activas = this.alertas.filter((a) => a.estado === 'activa').length;
    const criticas = this.alertas.filter(
      (a) => a.severidad === 'critica' && a.estado !== 'resuelta',
    ).length;
    const asignadas = this.alertas.filter((a) => a.estado === 'asignada').length;
    const resueltas = this.alertas.filter((a) => a.estado === 'resuelta').length;
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
        valor: resueltas,
        borderClass: 'border-slate-200',
        labelClass: 'text-slate-400',
        valueClass: 'text-slate-700',
      },
    ];
  });

  reconocer(alerta: AlertaActiva): void {
    alerta.estado = 'reconocida';
  }

  asignar(alerta: AlertaActiva): void {
    alerta.estado = 'asignada';
    alerta.tecnicoAsignado = 'L. Pérez';
  }

  resolver(alerta: AlertaActiva): void {
    alerta.estado = 'resuelta';
  }

  tarjetaBorde(severidad: AlertaSeveridad, estado: AlertaEstado): string {
    if (estado === 'resuelta') return 'border-slate-100 opacity-70';
    if (severidad === 'critica') return 'border-rose-200';
    if (severidad === 'advertencia') return 'border-amber-200';
    return 'border-slate-200';
  }

  severidadIcon(s: AlertaSeveridad): string {
    return s === 'critica' ? 'emergency' : s === 'advertencia' ? 'warning' : 'info';
  }

  severidadIconClass(s: AlertaSeveridad): string {
    return s === 'critica'
      ? 'bg-rose-50 text-rose-500'
      : s === 'advertencia'
        ? 'bg-amber-50 text-amber-500'
        : 'bg-blue-50 text-blue-500';
  }

  severidadLabel(s: AlertaSeveridad): string {
    return s === 'critica' ? 'Crítica' : s === 'advertencia' ? 'Advertencia' : 'Info';
  }

  severidadBadgeClass(s: AlertaSeveridad): string {
    return s === 'critica'
      ? 'bg-rose-50 text-rose-600'
      : s === 'advertencia'
        ? 'bg-amber-50 text-amber-600'
        : 'bg-blue-50 text-blue-600';
  }

  estadoLabel(e: AlertaEstado): string {
    const map: Record<AlertaEstado, string> = {
      activa: 'Activa',
      reconocida: 'Reconocida',
      asignada: 'Asignada',
      resuelta: 'Resuelta',
    };
    return map[e];
  }

  estadoBadgeClass(e: AlertaEstado): string {
    const map: Record<AlertaEstado, string> = {
      activa: 'bg-rose-50 text-rose-600',
      reconocida: 'bg-amber-50 text-amber-700',
      asignada: 'bg-cyan-50 text-cyan-700',
      resuelta: 'bg-slate-100 text-slate-500',
    };
    return map[e];
  }

  estadoDotClass(e: AlertaEstado): string {
    const map: Record<AlertaEstado, string> = {
      activa: 'bg-rose-500',
      reconocida: 'bg-amber-500',
      asignada: 'bg-cyan-500',
      resuelta: 'bg-slate-400',
    };
    return map[e];
  }

  filtroClass(key: AlertaEstado | 'todos'): string {
    const active = this.filtroActivo() === key;
    return [
      'rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all',
      active
        ? 'bg-slate-800 text-white'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }
}
