import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CompanyService } from '../../services/company.service';
import { CompaniesSiteDetailSkeletonComponent } from './components/companies-site-detail-skeleton';

interface SiteContext {
  company: any;
  subCompany: any;
  site: any;
}

interface DgaRecord {
  fecha: string;
  nivel: string;
  caudal: string;
  totalizador: string;
  estado: 'Enviado' | 'Pendiente';
}

@Component({
  selector: 'app-company-site-water-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, CompaniesSiteDetailSkeletonComponent],
  template: `
    <div class="min-h-full bg-[#f4f7fb] px-3 pb-5 pt-3 text-slate-700 md:px-4 xl:px-5">
      @if (loading() && !siteContext()) {
        <app-companies-site-detail-skeleton />
      } @else if (siteContext(); as context) {
        <div class="mx-auto max-w-[1360px] space-y-3">
          <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div class="flex flex-col gap-3 border-b border-slate-100 px-3 py-2 xl:flex-row xl:items-center xl:justify-between">
              <div class="flex min-w-0 items-center gap-2.5">
                <a
                  routerLink="/companies"
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-100 bg-cyan-50 text-cyan-700 transition-colors hover:bg-cyan-100"
                  aria-label="Volver a instalaciones"
                >
                  <span class="material-symbols-outlined text-[20px]">water_drop</span>
                </a>

                <div class="min-w-0">
                  <h1 class="truncate text-lg font-black text-slate-800">{{ getSiteName(context) }}</h1>
                  <p class="truncate text-[11px] font-semibold text-slate-400">{{ context.subCompany.nombre }}</p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-emerald-700">
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                  hace 0 segundos
                </span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-blue-700">
                  <span class="material-symbols-outlined text-[15px]">schedule</span>
                  26 abr 2026, 22:23
                </span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-emerald-700">
                  <span class="material-symbols-outlined text-[15px]">verified</span>
                  Reporte DGA · Aceptado · 17:00
                </span>
                <span class="ml-2 text-slate-400">Desde</span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-600">
                  <span class="material-symbols-outlined text-[15px]">calendar_month</span>
                  25-04-2026
                </span>
                <span class="text-slate-400">Hasta</span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-600">
                  <span class="material-symbols-outlined text-[15px]">calendar_month</span>
                  26-04-2026
                </span>
                <button
                  type="button"
                  class="h-7 rounded-lg bg-cyan-600 px-3 text-[10px] font-black uppercase tracking-wide text-white transition-colors hover:bg-cyan-700"
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
                  aria-label="Configuracion"
                >
                  <span class="material-symbols-outlined text-[18px]">settings</span>
                </button>
              </div>
            </div>

            <div class="flex items-center gap-5 px-3">
              <button
                type="button"
                class="relative inline-flex h-9 items-center gap-2 text-xs font-black text-cyan-700"
              >
                <span class="material-symbols-outlined text-[18px]">layers</span>
                DGA
                <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600"></span>
              </button>
              <button
                type="button"
                class="inline-flex h-9 items-center gap-2 text-xs font-bold text-slate-500 transition-colors hover:text-slate-700"
              >
                <span class="material-symbols-outlined text-[18px]">monitoring</span>
                Operacion
              </button>
            </div>
          </section>

          <section class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            <article class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Enviados</p>
              <p class="mt-1 text-3xl font-black leading-none text-emerald-600">622</p>
              <p class="mt-1 text-xs font-semibold text-emerald-500">registros exitosos</p>
            </article>

            <article class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Último envío</p>
              <p class="mt-1 text-lg font-black leading-none text-slate-800">26 abr 2026</p>
              <p class="mt-1 text-xs font-semibold text-slate-500">21:00</p>
            </article>

            <article class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Tasa de exito</p>
              <p class="mt-1 text-3xl font-black leading-none text-slate-800">100%</p>
            </article>

            <article class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-rose-400">Rechazados</p>
              <p class="mt-1 text-3xl font-black leading-none text-rose-500">0</p>
              <p class="mt-1 text-xs font-semibold text-rose-400">por la DGA</p>
            </article>
          </section>

          <section class="grid grid-cols-1 gap-3 xl:grid-cols-[520px_minmax(0,1fr)]">
            <article class="rounded-xl border border-cyan-200 bg-white p-3 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]">
              <p class="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Diagrama del pozo</p>

              <div class="grid grid-cols-[minmax(0,1fr)_128px] gap-5">
                <div class="relative h-[300px] overflow-hidden rounded-lg border border-slate-100 bg-[#eee7d8]">
                  <div class="absolute inset-0 opacity-40" style="background-image: radial-gradient(#c6b58f 1px, transparent 1px); background-size: 8px 8px;"></div>
                  <div class="absolute left-[31%] top-8 h-[238px] w-[12px] rounded-sm bg-slate-300"></div>
                  <div class="absolute left-[38%] top-8 h-[238px] w-[112px] border-x-4 border-slate-500 bg-white/80"></div>
                  <div class="dga-water-column absolute bottom-0 left-[38%] h-[178px] w-[112px] overflow-hidden border-x-4 border-slate-500 bg-gradient-to-b from-cyan-300 via-cyan-500 to-cyan-800">
                    <div class="dga-water-wave dga-water-wave-a"></div>
                    <div class="dga-water-wave dga-water-wave-b"></div>
                    <div class="dga-water-shine"></div>
                  </div>
                  <div class="absolute left-[16%] top-[112px] w-[215px] border-t-2 border-dashed border-cyan-600"></div>
                  <div class="absolute left-5 top-[100px] text-[10px] font-black text-cyan-700">Nivel<br>Freatico</div>
                  <div class="absolute bottom-[116px] left-[57%] z-10 text-2xl font-black text-white drop-shadow-sm">82%</div>
                  <div class="absolute right-4 top-8 text-[10px] font-bold text-slate-500">Superficie</div>
                  <div class="absolute bottom-7 right-5 flex items-center gap-1 text-[10px] font-bold text-orange-500">
                    <span class="h-2.5 w-2.5 rounded-sm bg-orange-500"></span>
                    Sensor
                  </div>
                </div>

                <div class="space-y-3">
                  <div class="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
                    <p class="text-[10px] font-black uppercase tracking-widest text-cyan-500">Nivel freatico</p>
                    <p class="mt-1 text-2xl font-black leading-none text-cyan-700">14.7<span class="text-base"> m</span></p>
                    <p class="mt-1 text-[10px] font-semibold text-cyan-500">desde superficie</p>
                  </div>

                  <div class="rounded-xl border border-slate-200 bg-white p-3">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Llenado</p>
                    <p class="mt-1 text-2xl font-black leading-none text-slate-800">82%</p>
                    <div class="mt-2 h-1.5 rounded-full bg-slate-100">
                      <div class="h-full w-[82%] rounded-full bg-cyan-600"></div>
                    </div>
                  </div>

                  <div class="rounded-xl border border-slate-200 bg-white p-3">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Prof. total</p>
                    <p class="mt-1 text-2xl font-black leading-none text-slate-800">18<span class="text-base"> m</span></p>
                  </div>

                  <div class="rounded-xl border border-orange-200 bg-orange-50 p-3">
                    <p class="text-[10px] font-black uppercase tracking-widest text-orange-500">Sensor</p>
                    <p class="mt-1 text-2xl font-black leading-none text-slate-800">16.5<span class="text-base"> m</span></p>
                  </div>
                </div>
              </div>
            </article>

            <div class="space-y-3">
              <article class="rounded-xl border border-cyan-200 bg-white p-4 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]">
                <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Caudal actual</p>
                <div class="mt-2 flex flex-wrap items-end gap-2">
                  <span class="font-mono text-3xl font-black leading-none text-cyan-600">0.00</span>
                  <span class="mb-1 text-lg font-bold text-slate-500">L/s</span>
                </div>
                <p class="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                  <span class="material-symbols-outlined text-[15px]">check_circle</span>
                  Limite DGA: 250 L/s
                </p>

                <div class="mt-2 h-[48px]">
                  <svg viewBox="0 0 560 90" class="h-full w-full text-cyan-500">
                    <path d="M0 70 L70 70 L140 48 L210 18 L280 42 L350 70 L560 70" fill="none" stroke="currentColor" stroke-width="3" />
                    <path d="M0 70 L70 70 L140 48 L210 18 L280 42 L350 70 L560 70 L560 90 L0 90 Z" fill="currentColor" opacity="0.10" />
                  </svg>
                </div>
              </article>

              <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p class="mb-2 text-sm font-black text-slate-700">Acciones Rápidas</p>
                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                  @for (action of quickActions; track action.title) {
                    <button
                      type="button"
                      class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-all hover:border-cyan-200 hover:bg-white hover:shadow-sm"
                    >
                      <span [class]="'material-symbols-outlined text-[20px] ' + action.color">{{ action.icon }}</span>
                      <p class="mt-0.5 text-sm font-black text-slate-800">{{ action.title }}</p>
                      <p class="text-xs font-medium text-slate-400">{{ action.subtitle }}</p>
                    </button>
                  }
                </div>
              </article>
            </div>
          </section>

          <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
              <h2 class="text-sm font-black text-slate-800">Detalle de Registros</h2>
              <p class="text-xs font-semibold text-slate-400">720 registros en el periodo</p>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full min-w-[820px] text-left text-xs">
                <thead class="bg-slate-50">
                  <tr class="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
                    <th class="px-4 py-2.5">Fecha</th>
                    <th class="px-4 py-2.5">Nv. freatico [m]</th>
                    <th class="px-4 py-2.5">Caudal [L/s]</th>
                    <th class="px-4 py-2.5">Totalizador [m³]</th>
                    <th class="px-4 py-2.5">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of records; track row.fecha) {
                    <tr class="border-t border-slate-100 font-mono text-[12px] text-slate-600">
                      <td class="px-4 py-2">{{ row.fecha }}</td>
                      <td class="px-4 py-2">{{ row.nivel }}</td>
                      <td class="px-4 py-2">{{ row.caudal }}</td>
                      <td class="px-4 py-2">{{ row.totalizador }}</td>
                      <td class="px-4 py-2">
                        <span [class]="getRecordStatusClass(row.estado)">
                          <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
                          {{ row.estado }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-400">
              <span>Filas por pagina: 10 · 1-10 de 720</span>
              <div class="flex gap-2">
                <button type="button" class="h-7 w-8 rounded-lg border border-slate-200 bg-white text-slate-500">←</button>
                <button type="button" class="h-7 w-8 rounded-lg border border-slate-200 bg-white text-slate-500">→</button>
              </div>
            </div>
          </section>
        </div>
      } @else {
        <div class="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          No se encontro la instalacion solicitada.
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes dga-wave-drift {
      from { transform: translateX(-28%) rotate(0deg); }
      to { transform: translateX(2%) rotate(0deg); }
    }

    @keyframes dga-wave-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(4px); }
    }

    @keyframes dga-shine {
      0% { transform: translateX(-110%); opacity: 0; }
      35% { opacity: 0.35; }
      70% { opacity: 0.12; }
      100% { transform: translateX(130%); opacity: 0; }
    }

    .dga-water-column {
      animation: dga-wave-bob 4.2s ease-in-out infinite;
    }

    .dga-water-wave {
      position: absolute;
      left: -42%;
      top: -18px;
      width: 184%;
      height: 36px;
      border-radius: 48%;
      pointer-events: none;
    }

    .dga-water-wave-a {
      background: rgba(165, 243, 252, 0.82);
      animation: dga-wave-drift 5.6s linear infinite;
    }

    .dga-water-wave-b {
      top: -11px;
      background: rgba(34, 211, 238, 0.34);
      animation: dga-wave-drift 4.1s linear infinite reverse;
    }

    .dga-water-shine {
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.38) 48%, transparent 76%);
      animation: dga-shine 5.8s ease-in-out infinite;
      pointer-events: none;
    }
  `],
})
export class CompanySiteWaterDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly companyService = inject(CompanyService);

  siteContext = signal<SiteContext | null>(null);
  loading = signal(true);

  readonly quickActions = [
    { icon: 'database', title: 'Datos Historicos', subtitle: 'Ver registros', color: 'text-cyan-600' },
    { icon: 'download', title: 'Descargar', subtitle: 'Exportar Excel', color: 'text-emerald-600' },
    { icon: 'open_in_new', title: 'Ver en DGA', subtitle: 'Portal oficial', color: 'text-blue-600' },
    { icon: 'description', title: 'Reporte DGA', subtitle: 'Formato oficial', color: 'text-violet-600' },
  ];

  readonly records: DgaRecord[] = [
    { fecha: '31/03/2026 21:00', nivel: '3.2', caudal: '19.75', totalizador: '530.806,375', estado: 'Enviado' },
    { fecha: '31/03/2026 22:00', nivel: '3.5', caudal: '19.75', totalizador: '530.858,938', estado: 'Enviado' },
    { fecha: '31/03/2026 23:00', nivel: '3.4', caudal: '19.75', totalizador: '530.900,188', estado: 'Enviado' },
    { fecha: '01/04/2026 00:00', nivel: '1.5', caudal: '0', totalizador: '530.921,625', estado: 'Enviado' },
    { fecha: '01/04/2026 01:00', nivel: '3.1', caudal: '19.88', totalizador: '530.956,188', estado: 'Enviado' },
    { fecha: '01/04/2026 02:00', nivel: '3.4', caudal: '19.63', totalizador: '530.986,75', estado: 'Enviado' },
    { fecha: '01/04/2026 03:00', nivel: '3.3', caudal: '19.75', totalizador: '531.009,375', estado: 'Enviado' },
    { fecha: '01/04/2026 04:00', nivel: '1.5', caudal: '0', totalizador: '531.038,375', estado: 'Enviado' },
    { fecha: '01/04/2026 05:00', nivel: '3.3', caudal: '19.75', totalizador: '531.060,063', estado: 'Pendiente' },
    { fecha: '01/04/2026 06:00', nivel: '1.6', caudal: '0', totalizador: '531.100', estado: 'Enviado' },
  ];

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');

    if (!siteId) {
      this.router.navigate(['/companies']);
      return;
    }

    this.companyService.fetchHierarchy().subscribe({
      next: (res: any) => {
        if (!res.ok) {
          this.router.navigate(['/companies']);
          return;
        }

        const match = this.findAccessibleSite(res.data, siteId);

        if (!match) {
          this.router.navigate(['/companies']);
          return;
        }

        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.loadHydratedSite(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  getSiteName(context: SiteContext): string {
    return context.site?.descripcion || context.subCompany?.nombre || 'Instalacion de agua';
  }

  getRecordStatusClass(status: DgaRecord['estado']): string {
    const base = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black';
    return status === 'Enviado'
      ? `${base} bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200`
      : `${base} bg-amber-50 text-amber-700 ring-1 ring-amber-200`;
  }

  private loadHydratedSite(match: SiteContext): void {
    this.companyService.getSites(match.subCompany.id).subscribe({
      next: (json: any) => {
        const hydratedSite = json.ok
          ? (json.data || []).find((site: any) => site.id === match.site.id)
          : null;

        this.siteContext.set({
          ...match,
          site: {
            ...match.site,
            ...(hydratedSite || {}),
          },
        });
        this.loading.set(false);
      },
      error: () => {
        this.siteContext.set(match);
        this.loading.set(false);
      },
    });
  }

  private findAccessibleSite(tree: any[], siteId: string): SiteContext | null {
    for (const company of tree || []) {
      for (const subCompany of company.subCompanies || []) {
        const site = (subCompany.sites || []).find((item: any) => item.id === siteId);
        if (site) {
          return { company, subCompany, site };
        }
      }
    }

    return null;
  }
}
