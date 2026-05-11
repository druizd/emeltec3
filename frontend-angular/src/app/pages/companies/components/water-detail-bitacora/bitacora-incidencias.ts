import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

type IncidenciaOrigen = 'terreno' | 'remota';
type IncidenciaCategoria = 'sensor' | 'comunicacion' | 'mecanico' | 'electrico' | 'otro';
type IncidenciaGravedad = 'leve' | 'media' | 'critica';
type IncidenciaEstado = 'abierta' | 'en_progreso' | 'resuelta' | 'cerrada';

interface Incidencia {
  id: string;
  titulo: string;
  origen: IncidenciaOrigen;
  categoria: IncidenciaCategoria;
  gravedad: IncidenciaGravedad;
  estado: IncidenciaEstado;
  fecha: string;
  tecnico: string;
  descripcion: string;
  adjuntos: number;
  alertaVinculada?: string;
}

@Component({
  selector: 'app-bitacora-incidencias',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <!-- Filtros -->
      <header class="flex flex-wrap items-center gap-2">
        <div class="flex flex-wrap gap-1.5">
          @for (f of filtrosOrigen; track f.key) {
            <button type="button" (click)="filtroOrigen.set(f.key)" [class]="filtroOrigenClass(f.key)">
              <span class="material-symbols-outlined text-[14px]">{{ f.icon }}</span>
              {{ f.label }}
            </button>
          }
        </div>
        <span class="text-slate-300">|</span>
        <div class="flex flex-wrap gap-1.5">
          @for (f of filtrosEstado; track f.key) {
            <button type="button" (click)="filtroEstado.set(f.key)" [class]="filtroEstadoClass(f.key)">
              {{ f.label }}
            </button>
          }
        </div>
        <span class="ml-auto text-[11px] font-semibold text-slate-400">{{ incidenciasFiltradas().length }} incidencias</span>
      </header>

      <!-- Timeline -->
      <div class="space-y-2">
        @for (inc of incidenciasFiltradas(); track inc.id) {
          <article
            class="group rounded-2xl border bg-white shadow-sm transition-all"
            [class]="tarjetaClass(inc)"
          >
            <div class="flex items-start gap-3 p-4">

              <!-- Icono origen -->
              <span [class]="origenIconClass(inc.origen)" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <span class="material-symbols-outlined text-[18px]">{{ origenIcon(inc.origen) }}</span>
              </span>

              <div class="min-w-0 flex-1">
                <!-- Fila superior -->
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="font-black text-slate-800">{{ inc.titulo }}</p>
                    <div class="mt-1 flex flex-wrap items-center gap-2">
                      <span [class]="gravedadClass(inc.gravedad)" class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">
                        <span [class]="gravedadDotClass(inc.gravedad)" class="h-1.5 w-1.5 rounded-full"></span>
                        {{ gravedadLabel(inc.gravedad) }}
                      </span>
                      <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                        {{ categoriaLabel(inc.categoria) }}
                      </span>
                      @if (inc.alertaVinculada) {
                        <span class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                          <span class="material-symbols-outlined text-[12px]">notifications_active</span>
                          Alerta vinculada
                        </span>
                      }
                    </div>
                  </div>
                  <span [class]="estadoClass(inc.estado)" class="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold">
                    <span [class]="estadoDotClass(inc.estado)" class="h-1.5 w-1.5 rounded-full"></span>
                    {{ estadoLabel(inc.estado) }}
                  </span>
                </div>

                <!-- Descripción -->
                <p class="mt-2 text-[12px] leading-relaxed text-slate-500">{{ inc.descripcion }}</p>

                <!-- Pie de tarjeta -->
                <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                  <span class="flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                    {{ inc.fecha }}
                  </span>
                  <span class="flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">person</span>
                    {{ inc.tecnico }}
                  </span>
                  @if (inc.adjuntos > 0) {
                    <span class="flex items-center gap-1">
                      <span class="material-symbols-outlined text-[14px]">attach_file</span>
                      {{ inc.adjuntos }} adjunto{{ inc.adjuntos > 1 ? 's' : '' }}
                    </span>
                  }
                </div>
              </div>
            </div>
          </article>
        } @empty {
          <div class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <span class="material-symbols-outlined text-4xl text-slate-300">checklist</span>
            <p class="mt-2 text-sm font-semibold text-slate-400">Sin incidencias con estos filtros</p>
          </div>
        }
      </div>

    </div>
  `,
})
export class BitacoraIncidenciasComponent {
  readonly filtroOrigen = signal<IncidenciaOrigen | 'todos'>('todos');
  readonly filtroEstado = signal<IncidenciaEstado | 'todos'>('todos');

  readonly filtrosOrigen: { key: IncidenciaOrigen | 'todos'; label: string; icon: string }[] = [
    { key: 'todos', label: 'Todos', icon: 'list' },
    { key: 'terreno', label: 'Terreno', icon: 'construction' },
    { key: 'remota', label: 'Remota', icon: 'wifi' },
  ];

  readonly filtrosEstado: { key: IncidenciaEstado | 'todos'; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'abierta', label: 'Abierta' },
    { key: 'en_progreso', label: 'En progreso' },
    { key: 'resuelta', label: 'Resuelta' },
    { key: 'cerrada', label: 'Cerrada' },
  ];

  readonly incidencias: Incidencia[] = [
    { id: '1', titulo: 'Sensor de nivel sin lectura — posible obstrucción', origen: 'remota', categoria: 'sensor', gravedad: 'critica', estado: 'cerrada', fecha: '28/04/2026 09:15', tecnico: 'L. Pérez', descripcion: 'El sensor VEGAPULS dejó de enviar lecturas. Se revisó conexión Modbus y se encontró cable dañado por humedad. Reemplazado en terreno.', adjuntos: 3, alertaVinculada: 'ALT-0041' },
    { id: '2', titulo: 'Bomba sumergible con caudal reducido', origen: 'terreno', categoria: 'mecanico', gravedad: 'media', estado: 'resuelta', fecha: '15/04/2026 14:30', tecnico: 'L. Pérez', descripcion: 'Caudal bajó 30% en 2 semanas. Inspección reveló filtro obstruido con sedimentos. Se limpió y se calibró caudalímetro.', adjuntos: 5 },
    { id: '3', titulo: 'Falla en comunicación GPRS', origen: 'remota', categoria: 'comunicacion', gravedad: 'leve', estado: 'cerrada', fecha: '02/04/2026 11:00', tecnico: 'M. Torres', descripcion: 'El dispositivo dejó de reportar por 3 horas. Reinicio remoto del módem resolvió el problema. Sin pérdida de datos.', adjuntos: 0 },
    { id: '4', titulo: 'Tablero eléctrico con sobrecalentamiento', origen: 'terreno', categoria: 'electrico', gravedad: 'media', estado: 'en_progreso', fecha: '06/05/2026 10:00', tecnico: 'L. Pérez', descripcion: 'El operador reportó temperatura alta en tablero. Técnico revisó ventilación y conexiones. Pendiente reemplazo de disipador térmico.', adjuntos: 2 },
    { id: '5', titulo: 'Revisión preventiva mensual', origen: 'terreno', categoria: 'otro', gravedad: 'leve', estado: 'cerrada', fecha: '01/05/2026 09:00', tecnico: 'M. Torres', descripcion: 'Inspección rutinaria mensual. Todos los componentes en estado normal. Limpieza general del sitio y revisión de sellados.', adjuntos: 1 },
  ];

  readonly incidenciasFiltradas = computed(() => {
    let lista = this.incidencias;
    const origen = this.filtroOrigen();
    const estado = this.filtroEstado();
    if (origen !== 'todos') lista = lista.filter((i) => i.origen === origen);
    if (estado !== 'todos') lista = lista.filter((i) => i.estado === estado);
    return lista;
  });

  origenIcon(origen: IncidenciaOrigen): string {
    return origen === 'terreno' ? 'construction' : 'wifi';
  }

  origenIconClass(origen: IncidenciaOrigen): string {
    return origen === 'terreno'
      ? 'bg-orange-50 text-orange-600'
      : 'bg-blue-50 text-blue-600';
  }

  gravedadLabel(g: IncidenciaGravedad): string {
    return g === 'critica' ? 'Crítica' : g === 'media' ? 'Media' : 'Leve';
  }

  gravedadClass(g: IncidenciaGravedad): string {
    return g === 'critica' ? 'bg-rose-50 text-rose-600' : g === 'media' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500';
  }

  gravedadDotClass(g: IncidenciaGravedad): string {
    return g === 'critica' ? 'bg-rose-500' : g === 'media' ? 'bg-amber-500' : 'bg-slate-400';
  }

  categoriaLabel(c: IncidenciaCategoria): string {
    const map: Record<IncidenciaCategoria, string> = {
      sensor: 'Sensor', comunicacion: 'Comunicación', mecanico: 'Mecánico', electrico: 'Eléctrico', otro: 'Otro',
    };
    return map[c];
  }

  estadoLabel(e: IncidenciaEstado): string {
    const map: Record<IncidenciaEstado, string> = {
      abierta: 'Abierta', en_progreso: 'En progreso', resuelta: 'Resuelta', cerrada: 'Cerrada',
    };
    return map[e];
  }

  estadoClass(e: IncidenciaEstado): string {
    const map: Record<IncidenciaEstado, string> = {
      abierta: 'bg-rose-50 text-rose-600', en_progreso: 'bg-amber-50 text-amber-700',
      resuelta: 'bg-cyan-50 text-cyan-700', cerrada: 'bg-slate-100 text-slate-500',
    };
    return map[e];
  }

  estadoDotClass(e: IncidenciaEstado): string {
    const map: Record<IncidenciaEstado, string> = {
      abierta: 'bg-rose-500', en_progreso: 'bg-amber-500', resuelta: 'bg-cyan-500', cerrada: 'bg-slate-400',
    };
    return map[e];
  }

  tarjetaClass(inc: Incidencia): string {
    if (inc.estado === 'abierta') return 'border-rose-200 shadow-rose-50';
    if (inc.estado === 'en_progreso') return 'border-amber-200 shadow-amber-50';
    return 'border-slate-200';
  }

  filtroOrigenClass(key: IncidenciaOrigen | 'todos'): string {
    const active = this.filtroOrigen() === key;
    return [
      'inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all',
      active ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  filtroEstadoClass(key: IncidenciaEstado | 'todos'): string {
    const active = this.filtroEstado() === key;
    return [
      'rounded-xl px-2.5 py-1.5 text-[12px] font-bold transition-all',
      active ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }
}
