import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../../../../services/auth.service';

interface MetricaServicio {
  label: string;
  valor: string;
  delta?: string;
  deltaPositivo?: boolean;
  subtext: string;
  icon: string;
}

interface TecnicoMetrica {
  nombre: string;
  visitas: number;
  horasPromedio: string;
  resolucionPrimer: string;
  incidencias: number;
}

interface MetricaMensual {
  mes: string;
  visitas: number;
  uptime: number;
  incidencias: number;
}

@Component({
  selector: 'app-analisis-metricas',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <!-- KPIs servicio -->
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        @for (m of metricas; track m.label) {
          <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
              <span class="material-symbols-outlined text-[20px]">{{ m.icon }}</span>
            </span>
            <p class="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">{{ m.label }}</p>
            <div class="mt-0.5 flex items-end gap-2">
              <p class="text-2xl font-black text-slate-800">{{ m.valor }}</p>
              @if (m.delta) {
                <span class="mb-0.5 text-[11px] font-bold" [class]="m.deltaPositivo ? 'text-emerald-600' : 'text-rose-500'">
                  {{ m.deltaPositivo ? '▲' : '▼' }} {{ m.delta }}
                </span>
              }
            </div>
            <p class="text-[11px] text-slate-400">{{ m.subtext }}</p>
          </article>
        }
      </div>

      <div class="grid gap-3 xl:grid-cols-2">

        <!-- Tendencia mensual (mini tabla) -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span class="material-symbols-outlined text-[16px]">trending_up</span>
            Tendencia mensual
          </h3>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-sm">
              <thead>
                <tr class="border-b border-slate-100">
                  <th class="pb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">Mes</th>
                  <th class="pb-2 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Visitas</th>
                  <th class="pb-2 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Uptime</th>
                  <th class="pb-2 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Incidencias</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-50">
                @for (row of tendencia; track row.mes) {
                  <tr class="group hover:bg-slate-50/60">
                    <td class="py-2.5 font-semibold text-slate-700 text-[12px]">{{ row.mes }}</td>
                    <td class="py-2.5 font-mono text-[12px] text-slate-600 text-right">{{ row.visitas }}</td>
                    <td class="py-2.5 text-right">
                      <span class="font-mono text-[12px]" [class]="row.uptime >= 99 ? 'text-emerald-600' : row.uptime >= 97 ? 'text-amber-600' : 'text-rose-600'">
                        {{ row.uptime }}%
                      </span>
                    </td>
                    <td class="py-2.5 font-mono text-[12px] text-slate-600 text-right">{{ row.incidencias }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        <!-- Rendimiento por técnico (solo interno) -->
        @if (isInternal()) {
          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <span class="material-symbols-outlined text-[16px]">engineering</span>
              Rendimiento técnicos
            </h3>
            <div class="space-y-2">
              @for (tec of tecnicos; track tec.nombre) {
                <div class="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2.5">
                      <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-[12px] font-black text-cyan-700">
                        {{ iniciales(tec.nombre) }}
                      </span>
                      <span class="font-semibold text-slate-800 text-sm">{{ tec.nombre }}</span>
                    </div>
                    <span class="text-[11px] font-bold text-slate-400">{{ tec.incidencias }} incid.</span>
                  </div>
                  <div class="mt-2 grid grid-cols-3 gap-2">
                    <div class="text-center">
                      <p class="font-mono text-base font-black text-slate-800">{{ tec.visitas }}</p>
                      <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Visitas</p>
                    </div>
                    <div class="text-center">
                      <p class="font-mono text-base font-black text-slate-800">{{ tec.horasPromedio }}</p>
                      <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">H promedio</p>
                    </div>
                    <div class="text-center">
                      <p class="font-mono text-base font-black" [class]="resolucionColor(tec.resolucionPrimer)">{{ tec.resolucionPrimer }}</p>
                      <p class="text-[9px] font-black uppercase tracking-widest text-slate-400">Resolución 1ra</p>
                    </div>
                  </div>
                </div>
              }
            </div>
          </section>
        } @else {
          <!-- Vista cliente: SLA simplificado -->
          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 class="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <span class="material-symbols-outlined text-[16px]">handshake</span>
              Cumplimiento SLA
            </h3>
            <div class="space-y-3">
              @for (sla of slaItems; track sla.label) {
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-[12px] font-semibold text-slate-700">{{ sla.label }}</span>
                    <span class="font-mono text-[12px] font-black" [class]="sla.valor >= sla.meta ? 'text-emerald-600' : 'text-rose-500'">{{ sla.valor }}%</span>
                  </div>
                  <div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div class="h-full rounded-full" [class]="sla.valor >= sla.meta ? 'bg-emerald-400' : 'bg-rose-400'" [style.width]="sla.valor + '%'"></div>
                  </div>
                  <p class="mt-0.5 text-[10px] text-slate-400">Meta: {{ sla.meta }}%</p>
                </div>
              }
            </div>
          </section>
        }

      </div>

    </div>
  `,
})
export class AnalisisMetricasComponent {
  private readonly auth = inject(AuthService);
  readonly isInternal = computed(() => this.auth.isSuperAdmin() || this.auth.isAdmin());

  readonly metricas: MetricaServicio[] = [
    { label: 'Visitas técnicas', valor: '14', delta: '2', deltaPositivo: true, subtext: 'Últimos 6 meses', icon: 'engineering' },
    { label: 'Tiempo respuesta', valor: '3.2 h', delta: '0.8 h', deltaPositivo: true, subtext: 'Promedio ante incidencia', icon: 'timer' },
    { label: 'Resolución 1ra visita', valor: '86%', delta: '4%', deltaPositivo: true, subtext: 'Últimos 6 meses', icon: 'check_circle' },
    { label: 'Incidencias abiertas', valor: '2', subtext: 'En seguimiento activo', icon: 'report_problem' },
  ];

  readonly tendencia: MetricaMensual[] = [
    { mes: 'Dic 2025', visitas: 2, uptime: 99.8, incidencias: 0 },
    { mes: 'Ene 2026', visitas: 3, uptime: 99.1, incidencias: 1 },
    { mes: 'Feb 2026', visitas: 2, uptime: 98.7, incidencias: 1 },
    { mes: 'Mar 2026', visitas: 3, uptime: 97.5, incidencias: 2 },
    { mes: 'Abr 2026', visitas: 2, uptime: 99.2, incidencias: 1 },
    { mes: 'May 2026', visitas: 2, uptime: 99.1, incidencias: 2 },
  ];

  readonly tecnicos: TecnicoMetrica[] = [
    { nombre: 'Luis Pérez', visitas: 9, horasPromedio: '2.8 h', resolucionPrimer: '89%', incidencias: 7 },
    { nombre: 'Marco Torres', visitas: 5, horasPromedio: '3.5 h', resolucionPrimer: '80%', incidencias: 3 },
  ];

  readonly slaItems = [
    { label: 'Disponibilidad plataforma', valor: 99.1, meta: 99 },
    { label: 'Tiempo respuesta ante alerta crítica', valor: 94, meta: 90 },
    { label: 'Entrega reporte DGA en plazo', valor: 100, meta: 100 },
  ];

  iniciales(nombre: string): string {
    return nombre.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  }

  resolucionColor(val: string): string {
    const n = parseInt(val);
    return n >= 85 ? 'text-emerald-600' : n >= 70 ? 'text-amber-600' : 'text-rose-600';
  }
}
