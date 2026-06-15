import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CompanyNode, SiteDashboardData, SiteRecord, SubCompanyNode } from '@emeltec/shared';
import { CompanyService, type TelemetryHistoryRow } from '../../services/company.service';
import { KpiCardComponent } from '../../components/ui/kpi-card';
import { SiteVariableSettingsPanelComponent } from './components/site-variable-settings-panel';
import { KpiStripSkeletonComponent } from '../../components/ui/kpi-strip-skeleton';
import { ChartSkeletonComponent } from '../../components/ui/chart-skeleton';
import {
  TelemetryLineChartCardComponent,
  type TelemetryLineChart,
} from './components/telemetry-line-chart-card';

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

interface ElectricChart extends TelemetryLineChart {
  half?: boolean;
}

type ElectricTab = 'dashboard' | 'reportes' | 'bne' | 'configurar';

@Component({
  selector: 'app-company-site-electric-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    KpiCardComponent,
    SiteVariableSettingsPanelComponent,
    KpiStripSkeletonComponent,
    ChartSkeletonComponent,
    TelemetryLineChartCardComponent,
  ],
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
                  <h1 class="truncate text-h5 font-semibold text-slate-900">
                    {{ siteName(context) }}
                  </h1>
                  <p class="truncate text-body-sm font-semibold text-slate-500">
                    Panel de monitoreo electrico
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2 text-caption font-bold">
                <span
                  class="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-emerald-700"
                >
                  <span class="material-symbols-outlined text-[17px]">schedule</span>
                  <span class="grid leading-tight">
                    <span class="text-[10px] font-semibold">Ultimo dato en dashboard</span>
                    <span>{{ latestDashboardAge() }}</span>
                  </span>
                </span>
                <span
                  class="inline-flex h-10 items-center gap-2 rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-3 text-on-surface-variant"
                >
                  <span class="material-symbols-outlined text-[17px]">sensors</span>
                  <span class="grid leading-tight">
                    <span class="text-[10px] font-semibold">Ultimo dato desde el equipo</span>
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
                    class="bg-transparent font-semibold text-slate-700 outline-none"
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
                    class="bg-transparent font-semibold text-slate-700 outline-none"
                  />
                </label>
                <button
                  type="button"
                  (click)="refreshDashboard()"
                  class="inline-flex h-10 items-center rounded-xl border border-cyan-200 bg-cyan-50 px-4 text-body-sm font-semibold text-cyan-700 transition-colors hover:bg-cyan-100"
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
            <nav
              class="flex h-16 items-center gap-7 border-b border-slate-200 px-6"
              role="tablist"
              aria-label="Pestañas del sitio eléctrico"
              (keydown.arrowright)="cycleTab(1); $event.preventDefault()"
              (keydown.arrowleft)="cycleTab(-1); $event.preventDefault()"
              (keydown.home)="cycleTab(0, 'first'); $event.preventDefault()"
              (keydown.end)="cycleTab(0, 'last'); $event.preventDefault()"
            >
              @for (tab of tabs; track tab.id) {
                <button
                  type="button"
                  (click)="setTab(tab.id)"
                  [class]="tabClass(tab.id)"
                  role="tab"
                  [attr.aria-selected]="activeTab() === tab.id"
                  [attr.tabindex]="activeTab() === tab.id ? 0 : -1"
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
                    <app-kpi-card
                      [label]="kpi.label"
                      [value]="metricValue(kpi.role, kpi.fallback)"
                      [unit]="kpi.unit"
                      [helper]="kpi.helper || ''"
                      [icon]="kpi.icon"
                      [tone]="kpi.tone"
                    />
                  }
                </div>

                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  @for (metric of secondaryMetrics; track metric.label) {
                    <article class="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                      <p class="flex items-center gap-2 text-caption font-semibold text-slate-400">
                        <span class="h-2 w-2 rounded-full" [style.background]="metric.color"></span>
                        {{ metric.label }}
                      </p>
                      <p class="mt-3 text-h4 font-semibold text-slate-900">
                        {{ metricValue(metric.role, metric.fallback) }}
                      </p>
                    </article>
                  }
                </div>

                <div class="grid gap-5 xl:grid-cols-2">
                  @for (chart of charts(); track chart.title) {
                    <app-telemetry-line-chart-card
                      [chart]="chart"
                      [ngClass]="chart.half ? '' : 'xl:col-span-2'"
                    />
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
                  <h2 class="mt-4 text-h5 font-semibold text-slate-900">Proximamente</h2>
                  <p class="mt-2 text-body-sm font-semibold text-slate-500">
                    Esta seccion queda preparada para reportes y calculadoras electricas.
                  </p>
                </div>
              </div>
            }
          </section>
        </main>
      } @else {
        <div class="mx-auto max-w-[1540px] space-y-6 px-6 py-6">
          <app-kpi-strip-skeleton />
          <div class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <app-chart-skeleton [bars]="14" [height]="220" />
          </div>
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
  historyRows = signal<TelemetryHistoryRow[]>([]);
  loading = signal(false);
  activeTab = signal<ElectricTab>('dashboard');
  dateFrom = signal(this.toDateInputValue(this.addDays(new Date(), -1)));
  dateTo = signal(this.toDateInputValue(new Date()));
  readonly telemetryKeys = [
    'energia_activa_kwh',
    'e_reactiva_kvarh',
    'factor_potencia_l1',
    'factor_potencia_l2',
    'factor_potencia_l3',
    'fp_total',
    'voltaje_l1',
    'voltaje_l2',
    'voltaje_l3',
    'corriente_l1',
    'corriente_l2',
    'corriente_l3',
    'thd_corriente_l1',
    'thd_corriente_l2',
    'thd_corriente_l3',
    'thd_tension_l1',
    'thd_tension_l2',
    'thd_tension_l3',
    'p_activa_kw',
    'p_activa_l1',
    'p_activa_l2',
    'p_activa_l3',
    'p_reactiva_kvar',
    'p_reactiva_l1',
    'p_reactiva_l2',
    'p_reactiva_l3',
  ];

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
      fallback: '0',
      unit: 'kWh este periodo',
      tone: 'primary',
      icon: 'bolt',
    },
    {
      label: 'Cargo FP',
      role: 'cargo_fp',
      fallback: '0',
      unit: 'penalizacion',
      tone: 'danger',
      icon: 'paid',
      helper: 'penalizacion',
    },
    {
      label: 'Cargo Total',
      role: 'cargo_total',
      fallback: '0',
      unit: 'estimado del periodo',
      tone: 'success',
      icon: 'payments',
    },
    {
      label: 'Factor Potencia',
      role: 'fp_total',
      fallback: '0',
      unit: 'promedio meta >=0.93',
      tone: 'danger',
      icon: 'query_stats',
    },
  ];

  readonly secondaryMetrics = [
    { label: 'FP Actual', role: 'fp_total', fallback: '0', color: '#10b981' },
    { label: 'Cumplimiento FP', role: 'cumplimiento_fp', fallback: '0%', color: '#3b82f6' },
    { label: 'Promedio FP', role: 'fp_promedio', fallback: '0', color: '#8b5cf6' },
    { label: 'Aumento Factura', role: 'aumento_factura', fallback: '0%', color: '#f97316' },
  ];

  readonly charts = computed<ElectricChart[]>(() => {
    const rows = this.orderedHistoryRows();
    const timestamps = rows.map((row) => this.rowTimestampMs(row));
    const xRange = this.selectedChartRange(timestamps);
    return [
      {
        title: 'Consumo de Energia (kWh)',
        subtitle: 'Kilovatios hora acumulados',
        tone: 'orange',
        timestamps,
        ...xRange,
        bucketMinutes: 60,
        extendToNow: true,
        emptyText: 'Sin lecturas de energia para el rango seleccionado.',
        maxVisiblePoints: 260,
        series: [
          this.chartSeries(
            rows,
            'energia_activa_kwh',
            'Energia Activa',
            '#2563eb',
            'kWh',
            3,
            false,
            'last',
          ),
          this.chartSeries(
            rows,
            'e_reactiva_kvarh',
            'Energia Reactiva',
            '#16a34a',
            'kVArh',
            3,
            false,
            'last',
          ),
        ],
      },
      {
        title: 'Factor de Potencia',
        subtitle: 'Relacion potencia activa / aparente (cos phi)',
        tone: 'purple',
        timestamps,
        ...xRange,
        bucketMinutes: 60,
        extendToNow: true,
        min: 0.65,
        max: 1,
        emptyText: 'Sin lecturas de factor de potencia para el rango seleccionado.',
        maxVisiblePoints: 260,
        referenceLines: [{ label: 'Meta 0,93', value: 0.93, tone: 'target' }],
        series: [
          this.chartSeries(rows, 'factor_potencia_l1', 'Factor Potencia A', '#2563eb', '', 3),
          this.chartSeries(rows, 'factor_potencia_l2', 'Factor Potencia B', '#16a34a', '', 3),
          this.chartSeries(rows, 'factor_potencia_l3', 'Factor Potencia C', '#d97706', '', 3),
          this.chartSeries(rows, 'fp_total', 'Factor Potencia Total', '#dc2626', '', 3),
        ],
      },
      {
        title: 'THD Corriente (%)',
        subtitle: 'Distorsion armonica total',
        tone: 'blue',
        timestamps,
        ...xRange,
        bucketMinutes: 60,
        extendToNow: true,
        min: 0,
        emptyText: 'Sin lecturas THD para el rango seleccionado.',
        maxVisiblePoints: 260,
        referenceLines: [{ label: 'Recomendado <8%', value: 8, tone: 'max' }],
        series: [
          this.chartSeries(rows, 'thd_corriente_l1', 'THD Corriente L1', '#2563eb', '%', 2),
          this.chartSeries(rows, 'thd_corriente_l2', 'THD Corriente L2', '#16a34a', '%', 2),
          this.chartSeries(rows, 'thd_corriente_l3', 'THD Corriente L3', '#d97706', '%', 2),
        ],
      },
      {
        title: 'THD Tension (%)',
        subtitle: 'Distorsion armonica de tension por fase',
        tone: 'cyan',
        half: true,
        compact: true,
        timestamps,
        ...xRange,
        bucketMinutes: 60,
        extendToNow: true,
        min: 0,
        emptyText: 'Sin lecturas THD de tension para el rango seleccionado.',
        referenceLines: [{ label: 'Recomendado <5%', value: 5, tone: 'max' }],
        series: [
          this.chartSeries(rows, 'thd_tension_l1', 'THD Tension L1', '#2563eb', '%', 2),
          this.chartSeries(rows, 'thd_tension_l2', 'THD Tension L2', '#16a34a', '%', 2),
          this.chartSeries(rows, 'thd_tension_l3', 'THD Tension L3', '#d97706', '%', 2),
        ],
      },
      {
        title: 'Voltajes (V)',
        subtitle: 'Tension electrica entre fases',
        tone: 'cyan',
        half: true,
        compact: true,
        timestamps,
        ...xRange,
        bucketMinutes: 60,
        extendToNow: true,
        emptyText: 'Sin lecturas de voltaje para el rango seleccionado.',
        series: [
          this.chartSeries(rows, 'voltaje_l1', 'Voltaje A', '#2563eb', 'V', 1),
          this.chartSeries(rows, 'voltaje_l2', 'Voltaje B', '#16a34a', 'V', 1),
          this.chartSeries(rows, 'voltaje_l3', 'Voltaje C', '#d97706', 'V', 1),
        ],
      },
      {
        title: 'Corriente (A)',
        subtitle: 'Amperios - Flujo de carga por fase',
        tone: 'orange',
        half: true,
        compact: true,
        timestamps,
        ...xRange,
        bucketMinutes: 60,
        extendToNow: true,
        min: 0,
        emptyText: 'Sin lecturas de corriente para el rango seleccionado.',
        series: [
          this.chartSeries(rows, 'corriente_l1', 'Corriente L1', '#2563eb', 'A', 2),
          this.chartSeries(rows, 'corriente_l2', 'Corriente L2', '#16a34a', 'A', 2),
          this.chartSeries(rows, 'corriente_l3', 'Corriente L3', '#d97706', 'A', 2),
        ],
      },
      {
        title: 'Potencias Activas (kW)',
        subtitle: 'Kilovatios por fase',
        tone: 'blue',
        half: true,
        compact: true,
        timestamps,
        ...xRange,
        bucketMinutes: 60,
        extendToNow: true,
        min: 0,
        emptyText: 'Sin lecturas de potencia activa para el rango seleccionado.',
        series: [
          this.chartSeries(rows, 'p_activa_l1', 'Potencia Activa A', '#2563eb', 'kW', 2),
          this.chartSeries(rows, 'p_activa_l2', 'Potencia Activa B', '#16a34a', 'kW', 2),
          this.chartSeries(rows, 'p_activa_l3', 'Potencia Activa C', '#d97706', 'kW', 2),
        ],
      },
      {
        title: 'Potencias Reactivas (kVAr)',
        subtitle: 'Kilovoltio-amperios reactivos por fase',
        tone: 'purple',
        half: true,
        compact: true,
        timestamps,
        ...xRange,
        bucketMinutes: 60,
        extendToNow: true,
        emptyText: 'Sin lecturas de potencia reactiva para el rango seleccionado.',
        series: [
          this.chartSeries(rows, 'p_reactiva_l1', 'Potencia Reactiva A', '#2563eb', 'kVAr', 2),
          this.chartSeries(rows, 'p_reactiva_l2', 'Potencia Reactiva B', '#16a34a', 'kVAr', 2),
          this.chartSeries(rows, 'p_reactiva_l3', 'Potencia Reactiva C', '#d97706', 'kVAr', 2),
        ],
      },
    ];
  });

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

  /** WAI-ARIA tablist nav: ArrowLeft/Right cyclan, Home/End first/last. */
  cycleTab(delta: 1 | -1 | 0, edge?: 'first' | 'last'): void {
    if (this.tabs.length === 0) return;
    if (edge === 'first') {
      this.setTab(this.tabs[0].id as ElectricTab);
      return;
    }
    if (edge === 'last') {
      this.setTab(this.tabs[this.tabs.length - 1].id as ElectricTab);
      return;
    }
    const idx = this.tabs.findIndex((t) => t.id === this.activeTab());
    const nextIdx = (idx + delta + this.tabs.length) % this.tabs.length;
    this.setTab(this.tabs[nextIdx].id as ElectricTab);
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

    const serialId = this.siteContext()?.site.id_serial;
    if (!serialId) return;
    this.companyService
      .getTelemetryRange(serialId, {
        from: `${this.dateFrom()} 00:00:00`,
        to: `${this.dateTo()} 23:59:59`,
        keys: this.telemetryKeys,
        limit: 2500,
      })
      .subscribe({
        next: (res) => {
          if (res.ok) this.historyRows.set(res.data || []);
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
      const value = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 3 }).format(
        entry.valor,
      );
      return ['cumplimiento_fp', 'aumento_factura'].includes(role) ? `${value}%` : value;
    }

    return String(entry.valor);
  }

  tabClass(tab: ElectricTab): string {
    const active = this.activeTab() === tab;
    const base =
      'relative inline-flex h-full items-center gap-2 border-b-2 text-body-sm font-semibold transition-colors';
    return active
      ? `${base} border-orange-500 text-orange-600`
      : `${base} border-transparent text-slate-500 hover:text-slate-800`;
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

  private selectedChartRange(timestamps: number[]): { xMin: number; xMax: number } {
    const finite = timestamps.filter(Number.isFinite).sort((a, b) => a - b);
    if (finite.length) {
      const now = Date.now();
      const minData = finite[0]!;
      const maxData = finite[finite.length - 1]!;
      const shouldEndNow = this.dateTo() === this.toDateInputValue(new Date()) && now > maxData;
      const maxPoint = shouldEndNow ? now : maxData;
      const xMin = this.floorLocalHalfDay(minData);
      const xMax = shouldEndNow ? maxPoint : this.ceilLocalHalfDay(maxPoint);
      return {
        xMin,
        xMax: xMax > xMin ? xMax : xMin + 12 * 60 * 60 * 1000,
      };
    }

    const start = new Date(`${this.dateFrom()}T00:00:00`).getTime();
    const selectedEnd = new Date(`${this.dateTo()}T23:59:59`).getTime();
    const now = Date.now();
    const end = selectedEnd >= now ? now : selectedEnd;
    const safeStart = Number.isFinite(start) ? start : now - 24 * 60 * 60 * 1000;
    const safeEnd = Number.isFinite(end) && end > safeStart ? end : safeStart + 12 * 60 * 60 * 1000;
    return { xMin: safeStart, xMax: safeEnd };
  }

  private floorLocalHalfDay(timestampMs: number): number {
    const date = new Date(timestampMs);
    const hour = date.getHours();
    date.setHours(hour < 12 ? 0 : 12, 0, 0, 0);
    return date.getTime();
  }

  private ceilLocalHalfDay(timestampMs: number): number {
    const floor = this.floorLocalHalfDay(timestampMs);
    if (floor === timestampMs) return floor;
    return floor + 12 * 60 * 60 * 1000;
  }

  private orderedHistoryRows(): TelemetryHistoryRow[] {
    return this.historyRows()
      .filter((row) => row?.data && Object.keys(row.data).length > 0)
      .slice()
      .reverse();
  }

  private numericValue(row: TelemetryHistoryRow, key: string): number | null {
    if (this.isMatheiSimulationRow(row)) {
      const derived = this.derivedSimulationValue(row, key);
      if (derived !== null) return derived;
    }

    return this.rawNumericValue(row, key);
  }

  private rawNumericValue(row: TelemetryHistoryRow, key: string): number | null {
    const value = row.data?.[key];
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private isMatheiSimulationRow(row: TelemetryHistoryRow): boolean {
    const serial = this.siteContext()?.site.id_serial || '';
    const isVirtualMathei = serial.includes('MATHEI') && serial.includes('ELECTRIC');
    return (
      isVirtualMathei ||
      (row.data?.['_simulated'] === true && row.data?.['_profile'] === 'mathei_v1')
    );
  }

  private derivedSimulationValue(row: TelemetryHistoryRow, key: string): number | null {
    const fpMap: Record<string, [number, number]> = {
      factor_potencia_l1: [0.024, 0.006],
      factor_potencia_l2: [-0.048, 0.007],
      factor_potencia_l3: [-0.014, 0.006],
    };
    if (key in fpMap) {
      const base = this.rawNumericValue(row, 'fp_total');
      if (base === null) return null;
      const [offset, wave] = fpMap[key];
      return this.round(this.clamp(base + offset + this.rowWave(row, key, wave), 0.65, 0.99), 3);
    }

    const voltageMap: Record<string, [number, number]> = {
      voltaje_l1: [2.8, 0.55],
      voltaje_l2: [-2.2, 0.5],
      voltaje_l3: [0.4, 0.45],
    };
    if (key in voltageMap) {
      const base = this.averageRaw(row, ['voltaje_l1', 'voltaje_l2', 'voltaje_l3']);
      if (base === null) return null;
      const [offset, wave] = voltageMap[key];
      return this.round(base + offset + this.rowWave(row, key, wave), 1);
    }

    const currentMap: Record<string, [number, number]> = {
      corriente_l1: [1.09, 0.018],
      corriente_l2: [0.93, 0.016],
      corriente_l3: [1.01, 0.015],
    };
    if (key in currentMap) {
      const base = this.averageRaw(row, ['corriente_l1', 'corriente_l2', 'corriente_l3']);
      if (base === null) return null;
      const [factor, wave] = currentMap[key];
      return this.round(Math.max(0, base * (factor + this.rowWave(row, key, wave))), 2);
    }

    const thdCurrentMap: Record<string, [number, number]> = {
      thd_corriente_l1: [0.35, 0.18],
      thd_corriente_l2: [-0.25, 0.15],
      thd_corriente_l3: [0.75, 0.2],
    };
    if (key in thdCurrentMap) {
      const base = this.averageRaw(row, [
        'thd_corriente_l1',
        'thd_corriente_l2',
        'thd_corriente_l3',
      ]);
      if (base === null) return null;
      const [offset, wave] = thdCurrentMap[key];
      return this.round(this.clamp(base + offset + this.rowWave(row, key, wave), 0.4, 7.8), 2);
    }

    const thdVoltageMap: Record<string, [number, number]> = {
      thd_tension_l1: [0.18, 0.08],
      thd_tension_l2: [-0.1, 0.07],
      thd_tension_l3: [0.34, 0.09],
    };
    if (key in thdVoltageMap) {
      const raw = this.rawNumericValue(row, key);
      if (raw !== null) return raw;
      const baseCurrent = this.averageRaw(row, [
        'thd_corriente_l1',
        'thd_corriente_l2',
        'thd_corriente_l3',
      ]);
      if (baseCurrent === null) return null;
      const [offset, wave] = thdVoltageMap[key];
      return this.round(
        this.clamp(baseCurrent * 0.38 + offset + this.rowWave(row, key, wave), 0.2, 4.5),
        2,
      );
    }

    const activePhaseMap: Record<string, [number, number]> = {
      p_activa_l1: [0.38, 0.018],
      p_activa_l2: [0.29, 0.015],
      p_activa_l3: [0.33, 0.016],
    };
    if (key in activePhaseMap) {
      const raw = this.rawNumericValue(row, key);
      if (raw !== null) return raw;
      const total = this.rawNumericValue(row, 'p_activa_kw');
      if (total === null) return null;
      const [share, wave] = activePhaseMap[key];
      return this.round(Math.max(0, total * (share + this.rowWave(row, key, wave))), 3);
    }

    const reactivePhaseMap: Record<string, [number, number]> = {
      p_reactiva_l1: [0.39, 0.018],
      p_reactiva_l2: [0.27, 0.015],
      p_reactiva_l3: [0.34, 0.016],
    };
    if (key in reactivePhaseMap) {
      const raw = this.rawNumericValue(row, key);
      if (raw !== null) return raw;
      const total = this.rawNumericValue(row, 'p_reactiva_kvar');
      if (total === null) return null;
      const [share, wave] = reactivePhaseMap[key];
      return this.round(Math.max(0, total * (share + this.rowWave(row, key, wave))), 3);
    }

    return null;
  }

  private averageRaw(row: TelemetryHistoryRow, keys: string[]): number | null {
    const values = keys
      .map((key) => this.rawNumericValue(row, key))
      .filter((value): value is number => value !== null);
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private rowWave(row: TelemetryHistoryRow, key: string, amplitude: number): number {
    const timestamp = this.rowTimestampMs(row);
    const seed = key.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return Math.sin(timestamp / 3_600_000 + seed) * amplitude;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private chartSeries(
    rows: TelemetryHistoryRow[],
    key: string,
    label: string,
    color: string,
    unit = '',
    precision = 2,
    fill = false,
    aggregation: 'avg' | 'last' | 'min' | 'max' = 'avg',
  ) {
    return {
      label,
      color,
      unit,
      precision,
      fill,
      aggregation,
      values: rows.map((row) => this.numericValue(row, key)),
    };
  }

  private rowTimestampMs(row: TelemetryHistoryRow): number {
    const raw = row.timestamp_completo || `${row.fecha || ''} ${row.hora || ''}`.trim();
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const parsed = new Date(normalized).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }
}
