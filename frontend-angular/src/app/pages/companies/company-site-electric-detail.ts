import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CompanyNode, SiteDashboardData, SiteRecord, SubCompanyNode } from '@emeltec/shared';
import { CompanyService } from '../../services/company.service';
import { SiteVariableSettingsPanelComponent } from './components/site-variable-settings-panel';

interface SiteContext {
  company: CompanyNode;
  subCompany: SubCompanyNode;
  site: SiteRecord;
}

interface ElectricKpi {
  label: string;
  role: string;
  fallback: string;
  unit: string;
  tone: 'primary' | 'danger' | 'success' | 'neutral';
  icon: string;
  helper?: string;
}

interface ElectricChart {
  title: string;
  subtitle: string;
  legend: { label: string; color: string; points: string }[];
  note?: string;
  half?: boolean;
}

type ElectricTab = 'dashboard' | 'reportes' | 'bne' | 'configurar';

@Component({
  selector: 'app-company-site-electric-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, SiteVariableSettingsPanelComponent],
  template: `
    <div class="min-h-full bg-[#f4f7fa] pb-8 text-slate-700">
      @if (siteContext(); as context) {
        <section class="border-b border-slate-200 bg-white">
          <div class="mx-auto max-w-[1540px] px-6 py-4">
            <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div class="flex min-w-0 items-center gap-3">
                <a
                  routerLink="/companies"
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 transition-colors hover:bg-orange-100"
                  aria-label="Volver a instalaciones"
                >
                  <span class="material-symbols-outlined text-[24px]">bolt</span>
                </a>
                <div class="min-w-0">
                  <h1 class="truncate text-xl font-black text-slate-900">
                    {{ siteName(context) }}
                  </h1>
                  <p class="truncate text-sm font-semibold text-slate-500">
                    Panel de monitoreo electrico
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span
                  class="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-emerald-700"
                >
                  <span class="material-symbols-outlined text-[17px]">schedule</span>
                  <span class="grid leading-tight">
                    <span class="text-[10px] font-black">Ultimo dato en dashboard</span>
                    <span>{{ latestDashboardAge() }}</span>
                  </span>
                </span>
                <span
                  class="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-blue-700"
                >
                  <span class="material-symbols-outlined text-[17px]">sensors</span>
                  <span class="grid leading-tight">
                    <span class="text-[10px] font-black">Ultimo dato desde el equipo</span>
                    <span>{{ latestDeviceLabel() }}</span>
                  </span>
                </span>

                <label
                  class="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3"
                >
                  <span class="text-slate-500">Desde</span>
                  <input
                    type="date"
                    min="2020-01-01"
                    [ngModel]="dateFrom()"
                    (ngModelChange)="dateFrom.set($event)"
                    class="bg-transparent font-black text-slate-700 outline-none"
                  />
                </label>
                <label
                  class="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3"
                >
                  <span class="text-slate-500">Hasta</span>
                  <input
                    type="date"
                    min="2020-01-01"
                    [ngModel]="dateTo()"
                    (ngModelChange)="dateTo.set($event)"
                    class="bg-transparent font-black text-slate-700 outline-none"
                  />
                </label>
                <button
                  type="button"
                  (click)="refreshDashboard()"
                  class="inline-flex h-10 items-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 text-sm font-black text-cyan-700 transition-colors hover:bg-cyan-100"
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  (click)="setTab('configurar')"
                  class="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-orange-200 hover:bg-orange-50 hover:text-orange-600"
                  aria-label="Configurar variables electricas"
                >
                  <span class="material-symbols-outlined text-[20px]">settings</span>
                </button>
              </div>
            </div>
          </div>
          <div class="h-1 bg-orange-500"></div>
        </section>

        <main class="mx-auto max-w-[1540px] px-6 py-6">
          <section class="border border-slate-200 bg-white">
            <nav class="flex h-16 items-center gap-7 border-b border-slate-200 px-6" role="tablist">
              @for (tab of tabs; track tab.id) {
                <button
                  type="button"
                  (click)="setTab(tab.id)"
                  [class]="tabClass(tab.id)"
                  role="tab"
                  [attr.aria-selected]="activeTab() === tab.id"
                >
                  <span class="material-symbols-outlined text-[18px]">{{ tab.icon }}</span>
                  {{ tab.label }}
                  @if (tab.badge) {
                    <span class="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                      {{ tab.badge }}
                    </span>
                  }
                </button>
              }
            </nav>

            @if (activeTab() === 'configurar') {
              <div class="bg-[#f8fafc] p-5">
                <app-site-variable-settings-panel
                  [siteId]="context.site.id"
                  [site]="context.site"
                  accentColor="#f97316"
                  accentSoft="rgba(249,115,22,0.10)"
                />
              </div>
            } @else if (activeTab() === 'dashboard') {
              <div class="space-y-6 bg-[#f8fafc] p-5">
                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  @for (kpi of kpis; track kpi.label) {
                    <article [class]="kpiCardClass(kpi.tone)">
                      <div>
                        <p [class]="kpiLabelClass(kpi.tone)">{{ kpi.label }}</p>
                        <p class="mt-2 text-3xl font-black leading-none text-slate-900">
                          {{ metricValue(kpi.role, kpi.fallback) }}
                        </p>
                        <p class="mt-1 text-xs font-black" [class]="kpiHelperClass(kpi.tone)">
                          {{ kpi.helper || kpi.unit }}
                        </p>
                      </div>
                      <span [class]="kpiIconClass(kpi.tone)">
                        <span class="material-symbols-outlined text-[22px]">{{ kpi.icon }}</span>
                      </span>
                    </article>
                  }
                </div>

                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  @for (metric of secondaryMetrics; track metric.label) {
                    <article class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <p class="flex items-center gap-2 text-xs font-black text-slate-400">
                        <span class="h-2 w-2 rounded-full" [style.background]="metric.color"></span>
                        {{ metric.label }}
                      </p>
                      <p class="mt-3 text-2xl font-black text-slate-900">
                        {{ metricValue(metric.role, metric.fallback) }}
                      </p>
                    </article>
                  }
                </div>

                <div class="grid gap-5 xl:grid-cols-2">
                  @for (chart of charts; track chart.title) {
                    <article
                      class="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                      [ngClass]="chart.half ? '' : 'xl:col-span-2'"
                    >
                      <div class="mb-5 flex items-start justify-between gap-3">
                        <div>
                          <h2 class="text-base font-black text-slate-800">{{ chart.title }}</h2>
                          <p class="mt-1 text-xs font-bold text-slate-400">{{ chart.subtitle }}</p>
                        </div>
                        @if (chart.note) {
                          <p class="text-xs font-bold text-slate-400">{{ chart.note }}</p>
                        }
                      </div>

                      <div class="relative h-[230px] overflow-hidden rounded-md bg-white">
                        <svg viewBox="0 0 900 230" class="h-full w-full" preserveAspectRatio="none">
                          <g stroke="#e5e7eb" stroke-width="1">
                            <line x1="48" y1="25" x2="870" y2="25" />
                            <line x1="48" y1="75" x2="870" y2="75" />
                            <line x1="48" y1="125" x2="870" y2="125" />
                            <line x1="48" y1="175" x2="870" y2="175" />
                            <line x1="48" y1="210" x2="870" y2="210" />
                            <line x1="48" y1="25" x2="48" y2="210" />
                          </g>
                          @for (serie of chart.legend; track serie.label) {
                            <polyline
                              [attr.points]="serie.points"
                              fill="none"
                              [attr.stroke]="serie.color"
                              stroke-width="3"
                              stroke-linejoin="round"
                              stroke-linecap="round"
                            />
                          }
                        </svg>
                        <div
                          class="pointer-events-none absolute bottom-1 left-14 right-8 flex justify-between text-[11px] font-semibold text-slate-400"
                        >
                          <span>17</span>
                          <span>21</span>
                          <span>25</span>
                          <span>29</span>
                          <span>May</span>
                          <span>5</span>
                          <span>9</span>
                          <span>13</span>
                        </div>
                      </div>

                      <div
                        class="mt-4 flex flex-wrap justify-center gap-5 text-xs font-semibold text-slate-500"
                      >
                        @for (serie of chart.legend; track serie.label) {
                          <span class="inline-flex items-center gap-1.5">
                            <span
                              class="h-2 w-2 rounded-full"
                              [style.background]="serie.color"
                            ></span>
                            {{ serie.label }}
                          </span>
                        }
                      </div>
                    </article>
                  }
                </div>
              </div>
            } @else {
              <div class="grid min-h-[360px] place-items-center bg-[#f8fafc] p-8 text-center">
                <div class="max-w-md">
                  <span
                    class="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-orange-600"
                  >
                    <span class="material-symbols-outlined text-[30px]">construction</span>
                  </span>
                  <h2 class="mt-4 text-xl font-black text-slate-900">Proximamente</h2>
                  <p class="mt-2 text-sm font-semibold text-slate-500">
                    Esta seccion queda preparada para reportes y calculadoras electricas.
                  </p>
                </div>
              </div>
            }
          </section>
        </main>
      } @else {
        <div class="grid min-h-[420px] place-items-center">
          <span class="material-symbols-outlined animate-spin text-[34px] text-orange-500"
            >progress_activity</span
          >
        </div>
      }
    </div>
  `,
})
export class CompanySiteElectricDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly companyService = inject(CompanyService);

  siteContext = signal<SiteContext | null>(null);
  dashboardData = signal<SiteDashboardData | null>(null);
  loading = signal(false);
  activeTab = signal<ElectricTab>('dashboard');
  dateFrom = signal(this.toDateInputValue(this.addDays(new Date(), -1)));
  dateTo = signal(this.toDateInputValue(new Date()));

  readonly tabs: { id: ElectricTab; label: string; icon: string; badge?: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'layers' },
    { id: 'reportes', label: 'Reportes', icon: 'assignment' },
    { id: 'bne', label: 'BNE', icon: 'verified_user', badge: 'Beta' },
    { id: 'configurar', label: 'Configurar', icon: 'build' },
  ];

  readonly kpis: ElectricKpi[] = [
    {
      label: 'Consumo Total',
      role: 'energia_activa_kwh',
      fallback: '171,935',
      unit: 'kWh este periodo',
      tone: 'primary',
      icon: 'bolt',
    },
    {
      label: 'Cargo FP',
      role: 'cargo_factor_potencia',
      fallback: '1,974,382',
      unit: 'penalizacion',
      tone: 'danger',
      icon: 'paid',
      helper: 'penalizacion',
    },
    {
      label: 'Cargo Total',
      role: 'cargo_total',
      fallback: '12,288,768',
      unit: 'estimado del periodo',
      tone: 'success',
      icon: 'payments',
    },
    {
      label: 'Factor Potencia',
      role: 'factor_potencia_total',
      fallback: '0.74',
      unit: 'promedio meta >=0.93',
      tone: 'danger',
      icon: 'query_stats',
    },
  ];

  readonly secondaryMetrics = [
    { label: 'FP Actual', role: 'factor_potencia_total', fallback: '0.393', color: '#10b981' },
    { label: 'Cumplimiento FP', role: 'cumplimiento_fp', fallback: '58.1%', color: '#3b82f6' },
    { label: 'Promedio FP', role: 'factor_potencia_promedio', fallback: '0.739', color: '#8b5cf6' },
    { label: 'Aumento Factura', role: 'aumento_factura', fallback: '19.1%', color: '#f97316' },
  ];

  readonly charts: ElectricChart[] = [
    {
      title: 'Consumo de Energia (kWh)',
      subtitle: 'Kilovatios hora',
      legend: [
        {
          label: 'Energia Activa',
          color: '#3b63d9',
          points: '50,82 130,82 210,81 290,82 370,81 450,80 530,81 610,80 690,79 770,78 860,77',
        },
        {
          label: 'Energia Reactiva',
          color: '#77c66e',
          points:
            '50,208 130,207 210,208 290,208 370,207 450,207 530,208 610,207 690,207 770,207 860,206',
        },
      ],
    },
    {
      title: 'Factor de Potencia',
      subtitle: 'Relacion potencia activa / aparente (cos phi)',
      note: 'Linea roja: meta 0.93',
      legend: [
        {
          label: 'Factor Potencia A',
          color: '#4f7cf3',
          points: '50,75 130,76 210,76 290,75 370,150 450,152 530,68 610,82 690,120 770,78 860,92',
        },
        {
          label: 'Factor Potencia B',
          color: '#86c76f',
          points: '50,72 130,72 210,73 290,72 370,142 450,146 530,70 610,86 690,116 770,76 860,88',
        },
        {
          label: 'Factor Potencia C',
          color: '#f5bd32',
          points: '50,70 130,71 210,72 290,70 370,132 450,136 530,66 610,92 690,104 770,75 860,84',
        },
        {
          label: 'Factor Potencia Total',
          color: '#ff5a57',
          points:
            '50,68 130,70 210,125 290,72 370,165 450,168 530,72 610,155 690,160 770,73 860,155',
        },
      ],
    },
    {
      title: 'THD Corriente (%)',
      subtitle: 'Total Harmonic Distortion',
      note: 'Recomendado: <8%',
      legend: [
        {
          label: 'THD Corriente L1',
          color: '#4f7cf3',
          points: '50,207 130,207 210,207 290,207 370,207 450,207 530,207 610,207 690,207 860,207',
        },
        {
          label: 'THD Corriente L2',
          color: '#86c76f',
          points: '50,209 130,209 210,209 290,209 370,209 450,209 530,209 610,209 690,209 860,209',
        },
        {
          label: 'THD Corriente L3',
          color: '#f5bd32',
          points: '50,208 130,208 210,208 290,208 370,208 450,208 530,208 610,208 690,208 860,208',
        },
      ],
    },
    {
      title: 'Voltajes (V)',
      subtitle: 'Tension electrica entre fases',
      half: true,
      legend: [
        {
          label: 'Voltaje A',
          color: '#4f7cf3',
          points: '50,100 130,96 210,104 290,91 370,98 450,92 530,100 610,95 690,102 770,97 860,94',
        },
        {
          label: 'Voltaje B',
          color: '#86c76f',
          points:
            '50,104 130,98 210,101 290,95 370,102 450,96 530,105 610,99 690,96 770,101 860,98',
        },
        {
          label: 'Voltaje C',
          color: '#f5bd32',
          points: '50,95 130,101 210,99 290,88 370,96 450,90 530,101 610,92 690,103 770,96 860,92',
        },
      ],
    },
    {
      title: 'Corriente (A)',
      subtitle: 'Amperios - Flujo de carga por fase',
      half: true,
      legend: [
        {
          label: 'Corriente L1',
          color: '#4f7cf3',
          points: '50,80 130,150 210,92 290,84 370,180 450,182 530,86 610,78 690,185 770,80 860,86',
        },
        {
          label: 'Corriente L2',
          color: '#86c76f',
          points: '50,88 130,152 210,96 290,90 370,176 450,178 530,88 610,84 690,182 770,84 860,90',
        },
        {
          label: 'Corriente L3',
          color: '#f5bd32',
          points: '50,75 130,160 210,89 290,82 370,185 450,184 530,82 610,76 690,188 770,78 860,84',
        },
      ],
    },
  ];

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');
    if (!siteId) {
      this.router.navigate(['/companies']);
      return;
    }

    this.loading.set(true);
    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        this.loading.set(false);
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
        this.companyService.selectedSiteModuleKey.set('Electrico');
        this.companyService.selectedSiteTypeFilter.set(['electrico']);
        this.siteContext.set(match);
        this.refreshDashboard();
      },
      error: () => {
        this.loading.set(false);
        this.router.navigate(['/companies']);
      },
    });
  }

  setTab(tab: ElectricTab): void {
    this.activeTab.set(tab);
  }

  refreshDashboard(): void {
    const siteId = this.siteContext()?.site.id;
    if (!siteId) return;

    this.companyService.getSiteDashboardData(siteId).subscribe({
      next: (res) => {
        if (res.ok) {
          this.dashboardData.set(res.data);
        }
      },
      error: () => undefined,
    });
  }

  siteName(context: SiteContext): string {
    return context.site.descripcion || context.subCompany.nombre || 'Linea electrica';
  }

  latestDashboardAge(): string {
    return this.dashboardData()?.server_time ? 'hace unos segundos' : 'sin datos';
  }

  latestDeviceLabel(): string {
    const time =
      this.dashboardData()?.ultima_lectura?.timestamp_completo ||
      this.dashboardData()?.ultima_lectura?.time ||
      null;
    if (!time) return 'Sin registros';

    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(time));
  }

  metricValue(role: string, fallback: string): string {
    const entry = this.dashboardData()?.resumen?.[role];
    if (entry?.valor === null || entry?.valor === undefined || entry?.valor === '') {
      return fallback;
    }

    if (typeof entry.valor === 'number') {
      return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 3 }).format(entry.valor);
    }

    return String(entry.valor);
  }

  tabClass(tab: ElectricTab): string {
    const active = this.activeTab() === tab;
    const base =
      'relative inline-flex h-full items-center gap-2 border-b-2 text-sm font-black transition-colors';
    return active
      ? `${base} border-orange-500 text-orange-600`
      : `${base} border-transparent text-slate-500 hover:text-slate-800`;
  }

  kpiCardClass(tone: ElectricKpi['tone']): string {
    const base = 'flex min-h-[98px] items-center justify-between rounded-lg border p-4 shadow-sm';
    if (tone === 'primary') return `${base} border-orange-200 bg-orange-500 text-white`;
    return `${base} border-slate-200 bg-white`;
  }

  kpiLabelClass(tone: ElectricKpi['tone']): string {
    return tone === 'primary'
      ? 'text-xs font-black text-orange-50'
      : 'text-xs font-black text-slate-400';
  }

  kpiHelperClass(tone: ElectricKpi['tone']): string {
    if (tone === 'primary') return 'text-orange-50';
    if (tone === 'danger') return 'text-red-500';
    if (tone === 'success') return 'text-emerald-500';
    return 'text-slate-400';
  }

  kpiIconClass(tone: ElectricKpi['tone']): string {
    const base = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg';
    if (tone === 'primary') return `${base} bg-white/20 text-white`;
    if (tone === 'danger') return `${base} bg-red-100 text-red-500`;
    if (tone === 'success') return `${base} bg-emerald-100 text-emerald-600`;
    return `${base} bg-slate-100 text-slate-500`;
  }

  private findAccessibleSite(tree: CompanyNode[], siteId: string): SiteContext | null {
    for (const company of tree) {
      for (const subCompany of company.subCompanies || []) {
        const site = (subCompany.sites || []).find((item) => item.id === siteId);
        if (site) return { company, subCompany, site };
      }
    }

    return null;
  }

  private toDateInputValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addDays(value: Date, days: number): Date {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
  }
}
