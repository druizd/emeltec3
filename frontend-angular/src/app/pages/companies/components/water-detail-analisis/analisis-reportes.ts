import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

type ReporteTipo = 'todos' | 'dga' | 'operacional' | 'mantenciones' | 'incidencias';
type ReporteEstado = 'liberado' | 'revisado' | 'borrador';

interface Reporte {
  id: string;
  titulo: string;
  tipo: ReporteTipo;
  periodo: string;
  fechaGeneracion: string;
  generadoPor: string;
  estado: ReporteEstado;
  paginas: number;
  tamanio: string;
}

@Component({
  selector: 'app-analisis-reportes',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <!-- Acciones rápidas -->
      <div class="grid gap-2 sm:grid-cols-3">
        @for (accion of accionesRapidas; track accion.titulo) {
          <button
            type="button"
            class="group flex items-center gap-3 rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:shadow-md"
            [class]="accion.borderClass"
          >
            <span [class]="accion.iconClass" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
              <span class="material-symbols-outlined text-[22px]">{{ accion.icon }}</span>
            </span>
            <div class="min-w-0">
              <p class="font-black text-slate-800 text-sm">{{ accion.titulo }}</p>
              <p class="text-[11px] text-slate-400">{{ accion.subtitulo }}</p>
            </div>
            <span class="material-symbols-outlined ml-auto text-[16px] text-slate-300 transition-transform group-hover:translate-x-0.5">chevron_right</span>
          </button>
        }
      </div>

      <!-- Filtros -->
      <header class="flex flex-wrap items-center gap-2">
        @for (f of filtros; track f.key) {
          <button type="button" (click)="filtroActivo.set(f.key)" [class]="filtroClass(f.key)">
            {{ f.label }}
          </button>
        }
        <span class="ml-auto text-[11px] font-semibold text-slate-400">{{ reportesFiltrados().length }} reportes</span>
      </header>

      <!-- Lista de reportes -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
        @for (reporte of reportesFiltrados(); track reporte.id) {
          <div class="flex items-center gap-4 px-4 py-3.5 hover:bg-slate-50/60 transition-colors">

            <!-- Icono tipo -->
            <span [class]="tipoIconClass(reporte.tipo)" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <span class="material-symbols-outlined text-[18px]">{{ tipoIcon(reporte.tipo) }}</span>
            </span>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <p class="font-black text-slate-800 text-sm truncate">{{ reporte.titulo }}</p>
                <span [class]="estadoClass(reporte.estado)" class="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide shrink-0">
                  {{ estadoLabel(reporte.estado) }}
                </span>
              </div>
              <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                <span>{{ reporte.periodo }}</span>
                <span>·</span>
                <span>{{ reporte.paginas }} pág. · {{ reporte.tamanio }}</span>
                <span>·</span>
                <span>{{ reporte.generadoPor }}</span>
              </div>
            </div>

            <div class="shrink-0 text-right">
              <p class="font-mono text-[11px] text-slate-500">{{ reporte.fechaGeneracion }}</p>
              <div class="mt-1.5 flex items-center justify-end gap-1">
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                  aria-label="Previsualizar reporte"
                >
                  <span class="material-symbols-outlined text-[15px]" aria-hidden="true">visibility</span>
                </button>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                  aria-label="Descargar PDF"
                >
                  <span class="material-symbols-outlined text-[15px]" aria-hidden="true">download</span>
                </button>
              </div>
            </div>

          </div>
        } @empty {
          <div class="px-6 py-12 text-center">
            <span class="material-symbols-outlined text-4xl text-slate-300">description</span>
            <p class="mt-2 text-sm font-semibold text-slate-400">Sin reportes con estos filtros</p>
          </div>
        }
      </section>

      <!-- Footer -->
      <div class="flex items-center justify-between px-1">
        <p class="text-[11px] text-slate-400">Los reportes PDF se generan automáticamente al cierre de cada período.</p>
        <button type="button" class="inline-flex items-center gap-1 text-[12px] font-bold text-cyan-700 hover:underline">
          <span class="material-symbols-outlined text-[14px]">history</span>
          Ver todo el historial
        </button>
      </div>

    </div>
  `,
})
export class AnalisisReportesComponent {
  readonly filtroActivo = signal<ReporteTipo>('todos');

  readonly filtros: { key: ReporteTipo; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'dga', label: 'DGA' },
    { key: 'operacional', label: 'Operacionales' },
    { key: 'mantenciones', label: 'Mantenciones' },
    { key: 'incidencias', label: 'Incidencias' },
  ];

  readonly accionesRapidas = [
    { titulo: 'Reporte DGA mensual', subtitulo: 'Mayo 2026 — pendiente', icon: 'shield', iconClass: 'bg-rose-50 text-rose-600', borderClass: 'border-rose-100' },
    { titulo: 'Reporte operacional', subtitulo: 'Mayo 2026 — en curso', icon: 'summarize', iconClass: 'bg-cyan-50 text-cyan-600', borderClass: 'border-cyan-100' },
    { titulo: 'Reporte de mantenciones', subtitulo: 'Abril 2026 — listo', icon: 'build_circle', iconClass: 'bg-amber-50 text-amber-600', borderClass: 'border-amber-100' },
  ];

  readonly reportes: Reporte[] = [
    { id: '1', titulo: 'Reporte DGA — Abril 2026', tipo: 'dga', periodo: 'Abr 2026', fechaGeneracion: '01/05/2026', generadoPor: 'Sistema (auto)', estado: 'liberado', paginas: 8, tamanio: '1.2 MB' },
    { id: '2', titulo: 'Reporte operacional — Abril 2026', tipo: 'operacional', periodo: 'Abr 2026', fechaGeneracion: '02/05/2026', generadoPor: 'L. Pérez', estado: 'liberado', paginas: 12, tamanio: '2.1 MB' },
    { id: '3', titulo: 'Informe de incidencias Q1', tipo: 'incidencias', periodo: 'Ene–Mar 2026', fechaGeneracion: '05/04/2026', generadoPor: 'L. Pérez', estado: 'revisado', paginas: 6, tamanio: '0.8 MB' },
    { id: '4', titulo: 'Reporte mantenciones — Mar 2026', tipo: 'mantenciones', periodo: 'Mar 2026', fechaGeneracion: '01/04/2026', generadoPor: 'Sistema (auto)', estado: 'liberado', paginas: 4, tamanio: '0.5 MB' },
    { id: '5', titulo: 'Reporte DGA — Mar 2026', tipo: 'dga', periodo: 'Mar 2026', fechaGeneracion: '01/04/2026', generadoPor: 'Sistema (auto)', estado: 'liberado', paginas: 8, tamanio: '1.1 MB' },
    { id: '6', titulo: 'Reporte operacional — Mar 2026', tipo: 'operacional', periodo: 'Mar 2026', fechaGeneracion: '03/04/2026', generadoPor: 'M. Torres', estado: 'liberado', paginas: 11, tamanio: '1.9 MB' },
    { id: '7', titulo: 'Borrador — Reporte DGA Mayo', tipo: 'dga', periodo: 'May 2026', fechaGeneracion: '10/05/2026', generadoPor: 'Sistema (auto)', estado: 'borrador', paginas: 8, tamanio: '1.2 MB' },
  ];

  readonly reportesFiltrados = computed(() => {
    const f = this.filtroActivo();
    return f === 'todos' ? this.reportes : this.reportes.filter((r) => r.tipo === f);
  });

  tipoIcon(tipo: ReporteTipo): string {
    const map: Record<ReporteTipo, string> = {
      todos: 'description', dga: 'shield', operacional: 'summarize',
      mantenciones: 'build_circle', incidencias: 'report_problem',
    };
    return map[tipo];
  }

  tipoIconClass(tipo: ReporteTipo): string {
    const map: Record<ReporteTipo, string> = {
      todos: 'bg-slate-100 text-slate-600', dga: 'bg-rose-50 text-rose-600',
      operacional: 'bg-cyan-50 text-cyan-600', mantenciones: 'bg-amber-50 text-amber-600',
      incidencias: 'bg-orange-50 text-orange-600',
    };
    return map[tipo];
  }

  estadoLabel(e: ReporteEstado): string {
    return e === 'liberado' ? 'Liberado' : e === 'revisado' ? 'Revisado' : 'Borrador';
  }

  estadoClass(e: ReporteEstado): string {
    return e === 'liberado' ? 'bg-emerald-50 text-emerald-700' : e === 'revisado' ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-500';
  }

  filtroClass(key: ReporteTipo): string {
    const active = this.filtroActivo() === key;
    return ['rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all', active ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'].join(' ');
  }
}
