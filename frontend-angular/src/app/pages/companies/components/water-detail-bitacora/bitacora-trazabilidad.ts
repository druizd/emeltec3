import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';

type AuditRecurso = 'sitio' | 'sensor' | 'alerta' | 'usuario' | 'documento' | 'incidencia';

interface AuditEntry {
  id: string;
  fecha: string;
  usuario: string;
  rolUsuario: string;
  accion: string;
  recurso: AuditRecurso;
  detalle: string;
}

@Component({
  selector: 'app-bitacora-trazabilidad',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <!-- Filtro por recurso -->
      <header class="flex flex-wrap items-center gap-2">
        @for (f of filtrosRecurso; track f.key) {
          <button type="button" (click)="filtroRecurso.set(f.key)" [class]="filtroClass(f.key)">
            <span class="material-symbols-outlined text-[14px]">{{ f.icon }}</span>
            {{ f.label }}
          </button>
        }
        <span class="ml-auto text-[11px] font-semibold text-slate-400"
          >{{ entradasFiltradas().length }} registros</span
        >
      </header>

      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="w-full min-w-[680px] text-left text-sm">
            <thead>
              <tr class="border-b border-slate-100 bg-slate-50">
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Fecha y hora
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Usuario
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Acción
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Recurso
                </th>
                <th
                  class="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-slate-400"
                >
                  Detalle
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (entry of entradasFiltradas(); track entry.id) {
                <tr class="hover:bg-slate-50/60">
                  <td class="px-4 py-3 font-mono text-[12px] text-slate-500">{{ entry.fecha }}</td>
                  <td class="px-4 py-3">
                    <p class="font-semibold text-slate-800">{{ entry.usuario }}</p>
                    <p class="text-[10px] uppercase tracking-wide text-slate-400">
                      {{ entry.rolUsuario }}
                    </p>
                  </td>
                  <td class="px-4 py-3">
                    <span
                      [class]="accionClass(entry.accion)"
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                    >
                      {{ entry.accion }}
                    </span>
                  </td>
                  <td class="px-4 py-3">
                    <span
                      [class]="recursoClass(entry.recurso)"
                      class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
                    >
                      <span class="material-symbols-outlined text-[12px]">{{
                        recursoIcon(entry.recurso)
                      }}</span>
                      {{ recursoLabel(entry.recurso) }}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-[12px] text-slate-500">{{ entry.detalle }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="px-4 py-10 text-center">
                    <span class="material-symbols-outlined text-3xl text-slate-300"
                      >fact_check</span
                    >
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
          <p class="text-[11px] text-slate-400">Registro automático — solo lectura</p>
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
export class BitacoraAuditLogComponent {
  readonly filtroRecurso = signal<AuditRecurso | 'todos'>('todos');

  readonly filtrosRecurso: { key: AuditRecurso | 'todos'; label: string; icon: string }[] = [
    { key: 'todos', label: 'Todos', icon: 'list' },
    { key: 'sitio', label: 'Sitio', icon: 'settings' },
    { key: 'sensor', label: 'Sensor', icon: 'sensors' },
    { key: 'alerta', label: 'Alertas', icon: 'notifications' },
    { key: 'documento', label: 'Documentos', icon: 'folder' },
    { key: 'incidencia', label: 'Incidencias', icon: 'history' },
  ];

  readonly entradas: AuditEntry[] = [
    {
      id: '1',
      fecha: '06/05/2026 10:43',
      usuario: 'Luis Pérez',
      rolUsuario: 'SuperAdmin',
      accion: 'Creó',
      recurso: 'incidencia',
      detalle: 'Incidencia #INC-0018: Tablero eléctrico con sobrecalentamiento',
    },
    {
      id: '2',
      fecha: '05/05/2026 16:20',
      usuario: 'María Torres',
      rolUsuario: 'SuperAdmin',
      accion: 'Cargó',
      recurso: 'documento',
      detalle: 'Cert. calibración caudalímetro — 2025 (v1.0)',
    },
    {
      id: '3',
      fecha: '01/05/2026 09:55',
      usuario: 'María Torres',
      rolUsuario: 'SuperAdmin',
      accion: 'Cerró',
      recurso: 'incidencia',
      detalle: 'Incidencia #INC-0017: Revisión preventiva mensual',
    },
    {
      id: '4',
      fecha: '28/04/2026 14:10',
      usuario: 'admin@emeltec.cl',
      rolUsuario: 'Admin',
      accion: 'Modificó',
      recurso: 'alerta',
      detalle: 'Umbral de caudal mínimo: 2.5 → 2.0 L/s',
    },
    {
      id: '5',
      fecha: '28/04/2026 09:42',
      usuario: 'Luis Pérez',
      rolUsuario: 'SuperAdmin',
      accion: 'Cerró',
      recurso: 'incidencia',
      detalle: 'Incidencia #INC-0016: Sensor de nivel sin lectura',
    },
    {
      id: '6',
      fecha: '22/04/2026 11:00',
      usuario: 'admin@emeltec.cl',
      rolUsuario: 'Admin',
      accion: 'Modificó',
      recurso: 'sitio',
      detalle: 'Profundidad del pozo actualizada: 48 → 51.3 m',
    },
    {
      id: '7',
      fecha: '15/04/2026 17:05',
      usuario: 'Luis Pérez',
      rolUsuario: 'SuperAdmin',
      accion: 'Marcó resuelta',
      recurso: 'incidencia',
      detalle: 'Incidencia #INC-0015: Bomba con caudal reducido',
    },
    {
      id: '8',
      fecha: '08/04/2026 09:30',
      usuario: 'c.rojas@clienteejemplo.cl',
      rolUsuario: 'Cliente',
      accion: 'Consultó',
      recurso: 'documento',
      detalle: 'Descargó: Ficha técnica bomba sumergible (v2.1)',
    },
  ];

  readonly entradasFiltradas = computed(() => {
    const f = this.filtroRecurso();
    return f === 'todos' ? this.entradas : this.entradas.filter((e) => e.recurso === f);
  });

  recursoLabel(r: AuditRecurso): string {
    const map: Record<AuditRecurso, string> = {
      sitio: 'Sitio',
      sensor: 'Sensor',
      alerta: 'Alerta',
      usuario: 'Usuario',
      documento: 'Documento',
      incidencia: 'Incidencia',
    };
    return map[r];
  }

  recursoIcon(r: AuditRecurso): string {
    const map: Record<AuditRecurso, string> = {
      sitio: 'settings',
      sensor: 'sensors',
      alerta: 'notifications',
      usuario: 'person',
      documento: 'folder',
      incidencia: 'history',
    };
    return map[r];
  }

  recursoClass(r: AuditRecurso): string {
    const map: Record<AuditRecurso, string> = {
      sitio: 'bg-slate-100 text-slate-600',
      sensor: 'bg-cyan-50 text-cyan-700',
      alerta: 'bg-amber-50 text-amber-700',
      usuario: 'bg-violet-50 text-violet-700',
      documento: 'bg-emerald-50 text-emerald-700',
      incidencia: 'bg-orange-50 text-orange-700',
    };
    return map[r];
  }

  accionClass(accion: string): string {
    if (accion.startsWith('Cerró') || accion.startsWith('Marcó'))
      return 'bg-emerald-50 text-emerald-700';
    if (accion.startsWith('Creó')) return 'bg-cyan-50 text-cyan-700';
    if (accion.startsWith('Modificó')) return 'bg-amber-50 text-amber-700';
    return 'bg-slate-100 text-slate-600';
  }

  filtroClass(key: AuditRecurso | 'todos'): string {
    const active = this.filtroRecurso() === key;
    return [
      'inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[12px] font-bold transition-all',
      active
        ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }
}
