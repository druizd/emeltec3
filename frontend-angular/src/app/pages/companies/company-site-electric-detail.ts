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
    'p_activa_kw',
    'p_reactiva_kvar',
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
    return [
      {
        title: 'Consumo de Energia (kWh)',
        subtitle: 'Kilovatios hora acumulados',
        tone: 'orange',
        timestamps,
        emptyText: 'Sin lecturas de energia para el rango seleccionado.',
        series: [
          this.chartSeries(rows, 'energia_activa_kwh', 'Energia Activa', '#3b63d9', 'kWh', 3),
          this.chartSeries(rows, 'e_reactiva_kvarh', 'Energia Reactiva', '#77c66e', 'kVArh', 3),
        ],
      },
      {
        title: 'Factor de Potencia',
        subtitle: 'Relacion potencia activa / aparente (cos phi)',
        tone: 'purple',
        timestamps,
        min: 0.65,
        max: 1,
        emptyText: 'Sin lecturas de factor de potencia para el rango seleccionado.',
        referenceLines: [{ label: 'Meta 0,93', value: 0.93, tone: 'target' }],
        series: [
          this.chartSeries(rows, 'factor_potencia_l1', 'FP L1', '#4f7cf3', '', 3),
          this.chartSeries(rows, 'factor_potencia_l2', 'FP L2', '#86c76f', '', 3),
          this.chartSeries(rows, 'factor_potencia_l3', 'FP L3', '#f5bd32', '', 3),
          this.chartSeries(rows, 'fp_total', 'FP Total', '#ff5a57', '', 3),
        ],
      },
      {
        title: 'THD Corriente (%)',
        subtitle: 'Distorsion armonica total',
        tone: 'blue',
        timestamps,
        min: 0,
        emptyText: 'Sin lecturas THD para el rango seleccionado.',
        referenceLines: [{ label: 'Recomendado <8%', value: 8, tone: 'max' }],
        series: [
          this.chartSeries(rows, 'thd_corriente_l1', 'THD L1', '#4f7cf3', '%', 2),
          this.chartSeries(rows, 'thd_corriente_l2', 'THD L2', '#86c76f', '%', 2),
          this.chartSeries(rows, 'thd_corriente_l3', 'THD L3', '#f5bd32', '%', 2),
        ],
      },
      {
        title: 'Voltajes (V)',
        subtitle: 'Tension electrica entre fases',
        tone: 'cyan',
        half: true,
        timestamps,
        emptyText: 'Sin lecturas de voltaje para el rango seleccionado.',
        series: [
          this.chartSeries(rows, 'voltaje_l1', 'Voltaje L1', '#4f7cf3', 'V', 1),
          this.chartSeries(rows, 'voltaje_l2', 'Voltaje L2', '#86c76f', 'V', 1),
          this.chartSeries(rows, 'voltaje_l3', 'Voltaje L3', '#f5bd32', 'V', 1),
        ],
      },
      {
        title: 'Corriente (A)',
        subtitle: 'Amperios - Flujo de carga por fase',
        tone: 'orange',
        half: true,
        timestamps,
        min: 0,
        emptyText: 'Sin lecturas de corriente para el rango seleccionado.',
        series: [
          this.chartSeries(rows, 'corriente_l1', 'Corriente L1', '#4f7cf3', 'A', 2),
          this.chartSeries(rows, 'corriente_l2', 'Corriente L2', '#86c76f', 'A', 2),
          this.chartSeries(rows, 'corriente_l3', 'Corriente L3', '#f5bd32', 'A', 2),
        ],
      },
      {
        title: 'Potencia Activa (kW)',
        subtitle: 'Kilovatios, trabajo real efectuado',
        tone: 'blue',
        half: true,
        timestamps,
        min: 0,
        emptyText: 'Sin lecturas de potencia activa para el rango seleccionado.',
        series: [
          this.chartSeries(rows, 'p_activa_kw', 'Potencia Activa Total', '#4f7cf3', 'kW', 2),
        ],
      },
      {
        title: 'Potencia Reactiva (kVAr)',
        subtitle: 'Kilovoltio-amperios reactivos',
        tone: 'purple',
        half: true,
        timestamps,
        emptyText: 'Sin lecturas de potencia reactiva para el rango seleccionado.',
        series: [
          this.chartSeries(
            rows,
            'p_reactiva_kvar',
            'Potencia Reactiva Total',
            '#8b5cf6',
            'kVAr',
            2,
          ),
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

  private orderedHistoryRows(): TelemetryHistoryRow[] {
    return this.historyRows()
      .filter((row) => row?.data && Object.keys(row.data).length > 0)
      .slice()
      .reverse();
  }

  private numericValue(row: TelemetryHistoryRow, key: string): number | null {
    const value = row.data?.[key];
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private chartSeries(
    rows: TelemetryHistoryRow[],
    key: string,
    label: string,
    color: string,
    unit = '',
    precision = 2,
    fill = false,
  ) {
    return {
      label,
      color,
      unit,
      precision,
      fill,
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
