import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

type DocTipo = 'ficha_tecnica' | 'datasheet' | 'certificado' | 'manual' | 'plano';

interface Documento {
  id: string;
  nombre: string;
  tipo: DocTipo;
  version: string;
  fechaVigencia: string | null;
  fechaCarga: string;
  cargadoPor: string;
  tamano: string;
  historialVersiones: number;
}

@Component({
  selector: 'app-bitacora-documentos',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap gap-2">
          @for (tipo of tiposFiltro; track tipo.key) {
            <button
              type="button"
              (click)="filtroActivo.set(tipo.key)"
              [class]="filtroClass(tipo.key)"
            >
              {{ tipo.label }}
              <span
                class="ml-1 rounded-full px-1.5 text-[10px] font-black"
                [class]="filtroBadgeClass(tipo.key)"
              >
                {{ contarPorTipo(tipo.key) }}
              </span>
            </button>
          }
        </div>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[12px] font-bold text-cyan-700 transition-colors hover:bg-cyan-100"
        >
          <span class="material-symbols-outlined text-[16px]">upload_file</span>
          Subir documento
        </button>
      </header>

      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[700px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Documento
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Tipo
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Versión
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Estado
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Cargado
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (doc of documentosFiltrados(); track doc.id) {
                <tr class="group hover:bg-slate-50/60">
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                      <span
                        [class]="tipoIconClass(doc.tipo)"
                        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[16px]"
                      >
                        <span class="material-symbols-outlined text-[18px]">{{
                          tipoIcon(doc.tipo)
                        }}</span>
                      </span>
                      <div class="min-w-0">
                        <p class="truncate font-semibold text-slate-800">{{ doc.nombre }}</p>
                        <p class="text-[11px] text-slate-400">{{ doc.tamano }}</p>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <span
                      [class]="tipoLabelClass(doc.tipo)"
                      class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    >
                      {{ tipoLabel(doc.tipo) }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <div>
                      <span class="font-mono text-slate-700">v{{ doc.version }}</span>
                      @if (doc.historialVersiones > 1) {
                        <p class="text-[11px] text-slate-400">
                          {{ doc.historialVersiones }} versiones
                        </p>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    @if (esVigente(doc)) {
                      <span
                        class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-600"
                      >
                        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>Vigente
                      </span>
                    } @else {
                      <div>
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500"
                        >
                          <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>No vigente
                        </span>
                        @if (doc.fechaVigencia) {
                          <p class="mt-0.5 text-[10px] text-slate-400">
                            Venció {{ doc.fechaVigencia }}
                          </p>
                        }
                      </div>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <div>
                      <p class="font-mono text-[12px] text-slate-600">{{ doc.fechaCarga }}</p>
                      <p class="text-[11px] text-slate-400">{{ doc.cargadoPor }}</p>
                    </div>
                  </td>
                  <td class="px-4 py-3">
                    <div
                      class="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <button
                        type="button"
                        class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-cyan-700"
                        aria-label="Descargar"
                      >
                        <span class="material-symbols-outlined text-[16px]">download</span>
                      </button>
                      <button
                        type="button"
                        class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Ver versiones"
                      >
                        <span class="material-symbols-outlined text-[16px]">history</span>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="px-4 py-12 text-center">
                    <span class="material-symbols-outlined text-4xl text-slate-300"
                      >folder_open</span
                    >
                    <p class="mt-2 text-sm font-semibold text-slate-400">
                      No hay documentos en esta categoría
                    </p>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `,
})
export class BitacoraDocumentosComponent {
  readonly filtroActivo = signal<DocTipo | 'todos'>('todos');

  readonly tiposFiltro: { key: DocTipo | 'todos'; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'ficha_tecnica', label: 'Fichas técnicas' },
    { key: 'datasheet', label: 'Datasheets' },
    { key: 'certificado', label: 'Certificados' },
    { key: 'manual', label: 'Manuales' },
    { key: 'plano', label: 'Planos' },
  ];

  readonly documentos: Documento[] = [
    {
      id: '1',
      nombre: 'Ficha técnica bomba sumergible Grundfos SP17-10',
      tipo: 'ficha_tecnica',
      version: '2.1',
      fechaVigencia: null,
      fechaCarga: '12/03/2025',
      cargadoPor: 'L. Pérez',
      tamano: '2.4 MB',
      historialVersiones: 3,
    },
    {
      id: '2',
      nombre: 'Datasheet sensor de nivel VEGAPULS 64',
      tipo: 'datasheet',
      version: '1.0',
      fechaVigencia: null,
      fechaCarga: '05/01/2025',
      cargadoPor: 'M. Torres',
      tamano: '1.1 MB',
      historialVersiones: 1,
    },
    {
      id: '3',
      nombre: 'Certificado de calibración caudalímetro — 2024',
      tipo: 'certificado',
      version: '1.0',
      fechaVigencia: '31/12/2024',
      fechaCarga: '10/01/2024',
      cargadoPor: 'L. Pérez',
      tamano: '0.8 MB',
      historialVersiones: 2,
    },
    {
      id: '4',
      nombre: 'Certificado de calibración caudalímetro — 2025',
      tipo: 'certificado',
      version: '1.0',
      fechaVigencia: '31/12/2025',
      fechaCarga: '08/01/2025',
      cargadoPor: 'L. Pérez',
      tamano: '0.8 MB',
      historialVersiones: 1,
    },
    {
      id: '5',
      nombre: 'Manual de operación PLCcio XG5000',
      tipo: 'manual',
      version: '3.0',
      fechaVigencia: null,
      fechaCarga: '22/08/2024',
      cargadoPor: 'M. Torres',
      tamano: '5.2 MB',
      historialVersiones: 1,
    },
    {
      id: '6',
      nombre: 'Plano de instalación eléctrica tablero pozo',
      tipo: 'plano',
      version: '1.2',
      fechaVigencia: null,
      fechaCarga: '14/06/2024',
      cargadoPor: 'L. Pérez',
      tamano: '3.7 MB',
      historialVersiones: 2,
    },
  ];

  readonly documentosFiltrados = computed(() => {
    const f = this.filtroActivo();
    return f === 'todos' ? this.documentos : this.documentos.filter((d) => d.tipo === f);
  });

  contarPorTipo(tipo: DocTipo | 'todos'): number {
    return tipo === 'todos'
      ? this.documentos.length
      : this.documentos.filter((d) => d.tipo === tipo).length;
  }

  esVigente(doc: Documento): boolean {
    if (!doc.fechaVigencia) return true;
    const partes = doc.fechaVigencia.split('/');
    const fecha = new Date(+partes[2], +partes[1] - 1, +partes[0]);
    return fecha >= new Date();
  }

  tipoIcon(tipo: DocTipo): string {
    const map: Record<DocTipo, string> = {
      ficha_tecnica: 'description',
      datasheet: 'quick_reference',
      certificado: 'verified',
      manual: 'menu_book',
      plano: 'architecture',
    };
    return map[tipo];
  }

  tipoIconClass(tipo: DocTipo): string {
    const map: Record<DocTipo, string> = {
      ficha_tecnica: 'bg-cyan-50 text-cyan-600',
      datasheet: 'bg-violet-50 text-violet-600',
      certificado: 'bg-emerald-50 text-emerald-600',
      manual: 'bg-amber-50 text-amber-600',
      plano: 'bg-slate-100 text-slate-600',
    };
    return map[tipo];
  }

  tipoLabel(tipo: DocTipo): string {
    const map: Record<DocTipo, string> = {
      ficha_tecnica: 'Ficha técnica',
      datasheet: 'Datasheet',
      certificado: 'Certificado',
      manual: 'Manual',
      plano: 'Plano',
    };
    return map[tipo];
  }

  tipoLabelClass(tipo: DocTipo): string {
    const map: Record<DocTipo, string> = {
      ficha_tecnica: 'bg-cyan-50 text-cyan-700',
      datasheet: 'bg-violet-50 text-violet-700',
      certificado: 'bg-emerald-50 text-emerald-700',
      manual: 'bg-amber-50 text-amber-700',
      plano: 'bg-slate-100 text-slate-600',
    };
    return map[tipo];
  }

  filtroClass(key: DocTipo | 'todos'): string {
    const active = this.filtroActivo() === key;
    return [
      'inline-flex items-center rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all',
      active
        ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  filtroBadgeClass(key: DocTipo | 'todos'): string {
    return this.filtroActivo() === key
      ? 'bg-cyan-100 text-cyan-700'
      : 'bg-slate-100 text-slate-500';
  }
}
