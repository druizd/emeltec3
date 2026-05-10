import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';

type SugerenciaPrioridad = 'alta' | 'media' | 'baja';
type SugerenciaCategoria = 'mantencion' | 'configuracion' | 'riesgo' | 'eficiencia';

interface Sugerencia {
  id: string;
  titulo: string;
  descripcion: string;
  prioridad: SugerenciaPrioridad;
  categoria: SugerenciaCategoria;
  origen: string;
  descartada: boolean;
}

@Component({
  selector: 'app-analisis-sugerencias',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <!-- Header informativo -->
      <div class="flex items-start gap-3 rounded-2xl border border-cyan-100 bg-cyan-50/60 px-4 py-3">
        <span class="material-symbols-outlined mt-0.5 text-[20px] text-cyan-600 shrink-0">auto_awesome</span>
        <div>
          <p class="font-black text-cyan-800 text-sm">Sugerencias basadas en el historial del sitio</p>
          <p class="text-[12px] text-cyan-700 mt-0.5">Estas recomendaciones son generadas automáticamente a partir del comportamiento histórico de alertas, mantenciones y lecturas del sitio.</p>
        </div>
      </div>

      <!-- Filtros prioridad -->
      <div class="flex flex-wrap gap-1.5">
        @for (f of filtros; track f.key) {
          <button type="button" (click)="filtroActivo.set(f.key)" [class]="filtroClass(f.key)">
            {{ f.label }}
          </button>
        }
        <span class="ml-auto self-center text-[11px] font-semibold text-slate-400">
          {{ activas().length }} activas
        </span>
      </div>

      <!-- Lista sugerencias activas -->
      <div class="space-y-2">
        @for (s of visibles(); track s.id) {
          <article class="rounded-2xl border bg-white shadow-sm" [class]="prioridadBorde(s.prioridad)">
            <div class="p-4">
              <div class="flex items-start gap-3">

                <!-- Icono categoría -->
                <span [class]="categoriaIconClass(s.categoria)" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                  <span class="material-symbols-outlined text-[20px]">{{ categoriaIcon(s.categoria) }}</span>
                </span>

                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div class="flex flex-wrap items-center gap-2">
                        <span [class]="prioridadBadgeClass(s.prioridad)" class="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">
                          {{ prioridadLabel(s.prioridad) }}
                        </span>
                        <span [class]="categoriaBadgeClass(s.categoria)" class="rounded-full px-2 py-0.5 text-[10px] font-semibold">
                          {{ categoriaLabel(s.categoria) }}
                        </span>
                      </div>
                      <p class="mt-1 font-black text-slate-800">{{ s.titulo }}</p>
                      <p class="mt-0.5 text-[12px] text-slate-500">{{ s.descripcion }}</p>
                    </div>
                  </div>

                  <!-- Origen -->
                  <p class="mt-2 text-[11px] text-slate-400">
                    <span class="font-semibold">Basado en:</span> {{ s.origen }}
                  </p>

                  <!-- Acciones -->
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[12px] font-bold text-cyan-700 hover:bg-cyan-100"
                    >
                      <span class="material-symbols-outlined text-[14px]">add_task</span>
                      Crear mantención
                    </button>
                    <button
                      type="button"
                      (click)="descartar(s)"
                      class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-500 hover:bg-slate-50"
                    >
                      <span class="material-symbols-outlined text-[14px]">close</span>
                      Descartar
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </article>
        } @empty {
          <div class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <span class="material-symbols-outlined text-4xl text-slate-300">check_circle</span>
            <p class="mt-2 text-sm font-semibold text-slate-400">Sin sugerencias pendientes</p>
          </div>
        }
      </div>

      <!-- Descartadas -->
      @if (descartadas().length > 0) {
        <div>
          <button type="button" (click)="mostrarDescartadas.set(!mostrarDescartadas())" class="flex items-center gap-1 text-[12px] font-bold text-slate-400 hover:text-slate-600">
            <span class="material-symbols-outlined text-[16px]">{{ mostrarDescartadas() ? 'expand_less' : 'expand_more' }}</span>
            {{ descartadas().length }} sugerencia(s) descartada(s)
          </button>
          @if (mostrarDescartadas()) {
            <div class="mt-2 space-y-1.5">
              @for (s of descartadas(); track s.id) {
                <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 opacity-60">
                  <p class="text-[12px] font-semibold text-slate-500 line-through">{{ s.titulo }}</p>
                  <button type="button" (click)="restaurar(s)" class="shrink-0 text-[11px] font-bold text-cyan-600 hover:underline">Restaurar</button>
                </div>
              }
            </div>
          }
        </div>
      }

    </div>
  `,
})
export class AnalisisSugerenciasComponent {
  readonly filtroActivo = signal<SugerenciaPrioridad | 'todas'>('todas');
  readonly mostrarDescartadas = signal(false);

  readonly filtros: { key: SugerenciaPrioridad | 'todas'; label: string }[] = [
    { key: 'todas', label: 'Todas' },
    { key: 'alta', label: 'Alta prioridad' },
    { key: 'media', label: 'Media' },
    { key: 'baja', label: 'Baja' },
  ];

  sugerencias: Sugerencia[] = [
    {
      id: '1',
      titulo: 'Revisión de UPS — batería al 18%',
      descripcion: 'La batería de respaldo lleva 3 semanas por debajo del 25%. Se recomienda revisión o reemplazo preventivo antes del próximo corte.',
      prioridad: 'alta',
      categoria: 'riesgo',
      origen: 'Alerta ALT-0042 activa hace 6 horas, histórico de batería desde abr 2026',
      descartada: false,
    },
    {
      id: '2',
      titulo: 'Calibración del caudalímetro',
      descripcion: 'El caudalímetro MAG 5100W tiene su última calibración hace 11 meses. El certificado vence el 14/05/2026.',
      prioridad: 'alta',
      categoria: 'mantencion',
      origen: 'Vencimiento acreditación detectado en calendario (14/05/2026)',
      descartada: false,
    },
    {
      id: '3',
      titulo: 'Revisar umbral de alerta de caudal mínimo',
      descripcion: 'El umbral actual (2.0 L/s) genera falsas alarmas en horarios nocturnos. Evaluar ajuste a 1.5 L/s fuera de horario operacional.',
      prioridad: 'media',
      categoria: 'configuracion',
      origen: 'ALT-0043 reconocida sin incidencia vinculada; patrón en últimas 3 alertas de caudal',
      descartada: false,
    },
    {
      id: '4',
      titulo: 'Mantenimiento preventivo bomba — 5 meses sin revisión',
      descripcion: 'La última revisión de bomba fue el 08/12/2025. El plan considera mantención cada 6 meses.',
      prioridad: 'media',
      categoria: 'mantencion',
      origen: 'Historial de mantenciones del sitio',
      descartada: false,
    },
    {
      id: '5',
      titulo: 'Limpiar datos duplicados en serie de nivel freático',
      descripcion: 'Se detectaron 12 registros duplicados en el sensor de nivel entre el 02/04 y 03/04, coincidiendo con el gap GPRS.',
      prioridad: 'baja',
      categoria: 'eficiencia',
      origen: 'Gap de comunicación GPRS del 02/04/2026 — análisis de calidad de datos',
      descartada: false,
    },
  ];

  activas(): Sugerencia[] {
    return this.sugerencias.filter((s) => !s.descartada);
  }

  descartadas(): Sugerencia[] {
    return this.sugerencias.filter((s) => s.descartada);
  }

  visibles(): Sugerencia[] {
    const f = this.filtroActivo();
    return this.activas().filter((s) => f === 'todas' || s.prioridad === f);
  }

  descartar(s: Sugerencia): void {
    s.descartada = true;
  }

  restaurar(s: Sugerencia): void {
    s.descartada = false;
  }

  prioridadLabel(p: SugerenciaPrioridad): string {
    return p === 'alta' ? 'Alta' : p === 'media' ? 'Media' : 'Baja';
  }

  prioridadBorde(p: SugerenciaPrioridad): string {
    return p === 'alta' ? 'border-rose-200' : p === 'media' ? 'border-amber-200' : 'border-slate-200';
  }

  prioridadBadgeClass(p: SugerenciaPrioridad): string {
    return p === 'alta' ? 'bg-rose-50 text-rose-600' : p === 'media' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500';
  }

  categoriaIcon(c: SugerenciaCategoria): string {
    const map: Record<SugerenciaCategoria, string> = {
      mantencion: 'build', configuracion: 'tune', riesgo: 'warning', eficiencia: 'speed',
    };
    return map[c];
  }

  categoriaIconClass(c: SugerenciaCategoria): string {
    const map: Record<SugerenciaCategoria, string> = {
      mantencion: 'bg-cyan-50 text-cyan-600', configuracion: 'bg-violet-50 text-violet-600',
      riesgo: 'bg-rose-50 text-rose-600', eficiencia: 'bg-emerald-50 text-emerald-600',
    };
    return map[c];
  }

  categoriaLabel(c: SugerenciaCategoria): string {
    const map: Record<SugerenciaCategoria, string> = {
      mantencion: 'Mantención', configuracion: 'Configuración', riesgo: 'Riesgo', eficiencia: 'Eficiencia',
    };
    return map[c];
  }

  categoriaBadgeClass(c: SugerenciaCategoria): string {
    const map: Record<SugerenciaCategoria, string> = {
      mantencion: 'bg-cyan-50 text-cyan-700', configuracion: 'bg-violet-50 text-violet-700',
      riesgo: 'bg-rose-50 text-rose-700', eficiencia: 'bg-emerald-50 text-emerald-700',
    };
    return map[c];
  }

  filtroClass(key: SugerenciaPrioridad | 'todas'): string {
    const active = this.filtroActivo() === key;
    return ['rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all', active ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'].join(' ');
  }
}
