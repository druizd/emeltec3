import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

type HistoricoFiltro = 'todos' | 'critica' | 'advertencia' | 'info';

interface AlertaHistorica {
  id: string;
  codigo: string;
  variable: string;
  severidad: 'critica' | 'advertencia' | 'info';
  fechaInicio: string;
  fechaCierre: string;
  duracion: string;
  resolvidoPor: string;
  incidenciaVinculada: string | null;
}

@Component({
  selector: 'app-alertas-historico',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
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
              @for (alerta of historialFiltrado(); track alerta.id) {
                <tr class="group hover:bg-slate-50/60">
                  <td class="px-4 py-3 font-mono text-[12px] text-slate-500">
                    {{ alerta.codigo }}
                  </td>
                  <td class="px-4 py-3 font-semibold text-slate-800">{{ alerta.variable }}</td>
                  <td class="px-4 py-3">
                    <span
                      [class]="severidadClass(alerta.severidad)"
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide"
                    >
                      <span
                        [class]="severidadDotClass(alerta.severidad)"
                        class="h-1.5 w-1.5 rounded-full"
                      ></span>
                      {{ severidadLabel(alerta.severidad) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 font-mono text-[12px] text-slate-600">
                    {{ alerta.fechaInicio }}
                  </td>
                  <td class="px-4 py-3 text-[12px] font-semibold text-slate-600">
                    {{ alerta.duracion }}
                  </td>
                  <td class="px-4 py-3 text-[12px] text-slate-600">{{ alerta.resolvidoPor }}</td>
                  <td class="px-4 py-3">
                    @if (alerta.incidenciaVinculada) {
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 text-[11px] font-bold text-cyan-700"
                      >
                        <span class="material-symbols-outlined text-[12px]">link</span>
                        {{ alerta.incidenciaVinculada }}
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
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <p class="text-[11px] text-slate-400">Últimos 90 días</p>
          <button
            type="button"
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
  readonly filtroActivo = signal<HistoricoFiltro>('todos');

  readonly filtros: { key: HistoricoFiltro; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'critica', label: 'Críticas' },
    { key: 'advertencia', label: 'Advertencias' },
    { key: 'info', label: 'Informativas' },
  ];

  readonly historial: AlertaHistorica[] = [
    {
      id: '1',
      codigo: 'ALT-0041',
      variable: 'Sensor de nivel',
      severidad: 'critica',
      fechaInicio: '28/04/2026 09:00',
      fechaCierre: '28/04/2026 14:22',
      duracion: '5 h 22 min',
      resolvidoPor: 'L. Pérez',
      incidenciaVinculada: 'INC-0016',
    },
    {
      id: '2',
      codigo: 'ALT-0040',
      variable: 'Caudal mínimo',
      severidad: 'advertencia',
      fechaInicio: '15/04/2026 06:30',
      fechaCierre: '15/04/2026 18:45',
      duracion: '12 h 15 min',
      resolvidoPor: 'L. Pérez',
      incidenciaVinculada: 'INC-0015',
    },
    {
      id: '3',
      codigo: 'ALT-0039',
      variable: 'Sin comunicación',
      severidad: 'advertencia',
      fechaInicio: '02/04/2026 11:00',
      fechaCierre: '02/04/2026 14:05',
      duracion: '3 h 05 min',
      resolvidoPor: 'M. Torres',
      incidenciaVinculada: null,
    },
    {
      id: '4',
      codigo: 'ALT-0038',
      variable: 'Temperatura tablero',
      severidad: 'info',
      fechaInicio: '28/03/2026 13:00',
      fechaCierre: '28/03/2026 14:30',
      duracion: '1 h 30 min',
      resolvidoPor: 'Sistema (auto)',
      incidenciaVinculada: null,
    },
    {
      id: '5',
      codigo: 'ALT-0037',
      variable: 'Nivel freático crítico',
      severidad: 'critica',
      fechaInicio: '15/03/2026 08:00',
      fechaCierre: '16/03/2026 10:00',
      duracion: '26 h',
      resolvidoPor: 'L. Pérez',
      incidenciaVinculada: 'INC-0012',
    },
    {
      id: '6',
      codigo: 'ALT-0036',
      variable: 'Caudal mínimo',
      severidad: 'advertencia',
      fechaInicio: '01/03/2026 07:00',
      fechaCierre: '01/03/2026 09:15',
      duracion: '2 h 15 min',
      resolvidoPor: 'M. Torres',
      incidenciaVinculada: null,
    },
  ];

  readonly historialFiltrado = computed(() => {
    const f = this.filtroActivo();
    return f === 'todos' ? this.historial : this.historial.filter((a) => a.severidad === f);
  });

  severidadLabel(s: string): string {
    return s === 'critica' ? 'Crítica' : s === 'advertencia' ? 'Advertencia' : 'Info';
  }

  severidadClass(s: string): string {
    return s === 'critica'
      ? 'bg-rose-50 text-rose-600'
      : s === 'advertencia'
        ? 'bg-amber-50 text-amber-600'
        : 'bg-blue-50 text-blue-600';
  }

  severidadDotClass(s: string): string {
    return s === 'critica' ? 'bg-rose-500' : s === 'advertencia' ? 'bg-amber-500' : 'bg-blue-500';
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
}
