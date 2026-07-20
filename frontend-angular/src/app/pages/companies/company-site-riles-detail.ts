import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CompanyNode, SiteDashboardData } from '@emeltec/shared';
import { type SiteContext, findAccessibleSite } from '../../shared/site-context';
import { CompanyService, type TelemetryHistoryRow } from '../../services/company.service';
import { SkeletonComponent } from '../../components/ui/skeleton';
import { SiteVariableSettingsPanelComponent } from './components/site-variable-settings-panel';
import {
  TelemetryLineChartCardComponent,
  type TelemetryLineChart,
} from './components/telemetry-line-chart-card';

interface RilesMonth {
  id: string;
  label: string;
  volume: string;
  unit: string;
  shortVolume: string;
  tag: string;
  status: 'active' | 'idle';
  quality: string;
  range: string;
  band: string;
}

interface RilesKpi {
  label: string;
  value: string;
  unit: string;
  helper: string;
  icon: string;
  tone: 'primary' | 'success' | 'warning' | 'neutral';
}

interface RilesChart extends TelemetryLineChart {
  wide?: boolean;
}

type RilesTab = 'dashboard' | 'configurar';
type RilesMissingMode = 'gap' | 'zero' | 'carry';

const RILES_REALTIME_WINDOW_MS = 3 * 60 * 60 * 1000;
const RILES_BUCKET_MINUTES = 1;
const RILES_RECENT_DATA_MS = 24 * 60 * 60 * 1000;

@Component({
  selector: 'app-company-site-riles-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    SkeletonComponent,
    SiteVariableSettingsPanelComponent,
    TelemetryLineChartCardComponent,
  ],
  template: `
    <div class="min-h-full bg-[#f0f2f5] px-4 pb-8 pt-4 text-slate-700 md:px-6">
      @if (siteContext(); as context) {
        <div class="mx-auto max-w-[1540px] space-y-5">
          <header class="border-b border-slate-200 bg-white">
            <div
              class="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between"
            >
              <div class="flex min-w-0 items-center gap-3">
                <a
                  routerLink="/companies"
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
                  aria-label="Volver a instalaciones"
                >
                  <span class="material-symbols-outlined text-[24px]" aria-hidden="true"
                    >waves</span
                  >
                </a>
                <div class="min-w-0">
                  <p
                    class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400"
                    style="font-family: var(--font-josefin);"
                  >
                    Generacion de Riles
                  </p>
                  <h1 class="truncate text-h5 font-semibold text-slate-900">
                    {{ siteName(context) }}
                  </h1>
                  <p class="truncate text-body-sm font-semibold text-slate-500">
                    Monitoreo continuo: nivel, caudal y totalizador historico
                  </p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-caption font-bold text-emerald-700"
                >
                  <span class="material-symbols-outlined text-[17px]">sensors</span>
                  Equipo simulado: {{ context.site.id_serial || 'RILES-DEMO-01' }}
                </span>
                <button
                  type="button"
                  class="inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-700 bg-cyan-700 px-4 text-body-sm font-semibold text-white transition-colors hover:bg-cyan-800 active:scale-[0.98]"
                >
                  <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                    >download</span
                  >
                  Descargar mes activo (.xlsx)
                </button>
                <button
                  type="button"
                  (click)="setTab(activeTab() === 'configurar' ? 'dashboard' : 'configurar')"
                  class="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95"
                  aria-label="Configurar variables RILES"
                  [attr.aria-pressed]="activeTab() === 'configurar'"
                >
                  <span class="material-symbols-outlined text-[20px]" aria-hidden="true"
                    >settings</span
                  >
                </button>
              </div>
            </div>

            <nav
              class="flex h-12 items-center gap-6 border-t border-slate-100 px-5"
              role="tablist"
              aria-label="Pestanas del sitio RILES"
            >
              @for (tab of tabs; track tab.id) {
                <button
                  type="button"
                  (click)="setTab(tab.id)"
                  [class]="tabClass(tab.id)"
                  role="tab"
                  [attr.aria-selected]="activeTab() === tab.id"
                >
                  <span class="material-symbols-outlined text-[18px]" aria-hidden="true">{{
                    tab.icon
                  }}</span>
                  {{ tab.label }}
                </button>
              }
            </nav>
            <div class="h-1 bg-emerald-500"></div>
          </header>

          @if (activeTab() === 'configurar') {
            <app-site-variable-settings-panel
              [siteId]="context.site.id"
              [site]="context.site"
              accentColor="#22c55e"
              accentSoft="rgba(34,197,94,0.10)"
            />
          } @else {
            @if (selectedMonth(); as month) {
              <main class="space-y-5">
                <section
                  class="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm lg:flex-row lg:items-center"
                  aria-label="Selector de mes"
                >
                  <p
                    class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400"
                    style="font-family: var(--font-josefin);"
                  >
                    Mes en vista
                  </p>
                  <div class="flex flex-wrap gap-2">
                    @for (item of months(); track item.id) {
                      <button
                        type="button"
                        (click)="activeMonthId.set(item.id)"
                        [class]="monthButtonClass(item.id)"
                      >
                        <span>{{ item.label }}</span>
                        <span class="text-[11px] opacity-75">{{ item.shortVolume }}</span>
                      </button>
                    }
                  </div>
                </section>

                <section
                  class="overflow-hidden rounded-xl border border-cyan-800/20 bg-cyan-800 text-white shadow-sm"
                >
                  <div
                    class="grid gap-5 px-5 py-5 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(130px,0.5fr))]"
                  >
                    <div>
                      <p
                        class="text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-100"
                        style="font-family: var(--font-josefin);"
                      >
                        Totalizador historico (toda la operacion)
                      </p>
                      <div class="mt-2 flex flex-wrap items-end gap-2">
                        <strong
                          class="text-[34px] font-semibold leading-none md:text-[40px]"
                          style="font-family: var(--font-mono);"
                        >
                          {{ month.volume }}
                        </strong>
                        <span class="pb-1 text-body font-semibold text-cyan-100">{{
                          month.unit
                        }}</span>
                      </div>
                      <p class="mt-2 text-body-sm font-semibold text-cyan-50">
                        Banda incertidumbre: {{ month.band }}
                      </p>
                    </div>

                    <div class="rounded-lg bg-white/10 p-3">
                      <p
                        class="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100"
                      >
                        Calidad
                      </p>
                      <p class="mt-2 text-h5 font-semibold" style="font-family: var(--font-mono);">
                        {{ month.quality }}
                      </p>
                    </div>
                    <div class="rounded-lg bg-white/10 p-3">
                      <p
                        class="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100"
                      >
                        Periodo
                      </p>
                      <p class="mt-2 text-body-sm font-bold text-white">{{ month.range }}</p>
                    </div>
                    <div class="rounded-lg bg-white/10 p-3">
                      <p
                        class="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100"
                      >
                        Estado
                      </p>
                      <p
                        class="mt-2 inline-flex rounded-full bg-emerald-100 px-2 py-1 text-caption font-bold text-emerald-700"
                      >
                        {{ month.tag }}
                      </p>
                    </div>
                  </div>
                </section>

                <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  @for (kpi of kpis(); track kpi.label) {
                    <article [class]="kpiCardClass(kpi.tone)">
                      <div class="min-w-0">
                        <p
                          class="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400"
                          style="font-family: var(--font-josefin);"
                        >
                          {{ kpi.label }}
                        </p>
                        <div class="mt-2 flex items-end gap-2">
                          <strong
                            class="truncate text-[28px] font-semibold leading-none text-slate-900"
                            style="font-family: var(--font-mono);"
                          >
                            {{ kpi.value }}
                          </strong>
                          <span class="pb-1 text-caption font-bold text-slate-500">
                            {{ kpi.unit }}
                          </span>
                        </div>
                        <p class="mt-2 truncate text-caption font-semibold text-slate-500">
                          {{ kpi.helper }}
                        </p>
                      </div>
                      <span [class]="kpiIconClass(kpi.tone)">
                        <span class="material-symbols-outlined text-[20px]">{{ kpi.icon }}</span>
                      </span>
                    </article>
                  }
                </section>

                <section class="space-y-3">
                  <div>
                    <h2 class="text-h6 font-semibold text-slate-900">Totalizador por mes</h2>
                    <p class="text-body-sm font-semibold text-slate-500">
                      Volumen acumulado mensual con banda Manning, click para activar.
                    </p>
                  </div>
                  <div class="grid gap-3 xl:grid-cols-3">
                    @for (item of months(); track item.id) {
                      <button
                        type="button"
                        (click)="activeMonthId.set(item.id)"
                        [class]="monthCardClass(item.id)"
                      >
                        <span class="flex items-center justify-between gap-3">
                          <span class="text-body font-semibold text-slate-900">{{
                            item.label
                          }}</span>
                          <span
                            [class]="
                              item.status === 'active'
                                ? 'rounded-md bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase text-emerald-700'
                                : 'rounded-md bg-cyan-50 px-2 py-1 text-[10px] font-bold uppercase text-cyan-700'
                            "
                          >
                            {{ item.tag }}
                          </span>
                        </span>
                        <span
                          class="mt-5 block text-left text-[28px] font-semibold leading-none text-slate-900"
                          style="font-family: var(--font-mono);"
                        >
                          {{ item.volume }}
                          <small class="text-caption font-semibold text-slate-500">{{
                            item.unit
                          }}</small>
                        </span>
                        <span
                          class="mt-3 block text-left text-caption font-semibold text-slate-500"
                        >
                          banda: {{ item.band }}
                        </span>
                        <span
                          class="mt-4 flex flex-wrap gap-4 text-caption font-semibold text-slate-500"
                        >
                          <span class="inline-flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px]"
                              >calendar_month</span
                            >
                            {{ item.range }}
                          </span>
                          <span class="inline-flex items-center gap-1">
                            <span class="material-symbols-outlined text-[14px] text-rose-500">
                              sensors
                            </span>
                            {{ item.quality }}
                          </span>
                        </span>
                      </button>
                    }
                  </div>
                </section>

                <section class="grid gap-5 xl:grid-cols-2">
                  @for (chart of charts(); track chart.title) {
                    <app-telemetry-line-chart-card
                      [chart]="chart"
                      [ngClass]="chart.wide ? 'xl:col-span-2' : ''"
                    />
                  }
                </section>

                <p
                  class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-caption font-semibold leading-5 text-slate-500 shadow-sm"
                >
                  Nota: caudal y volumen se calculan con ecuacion de Manning para flujo parcial en
                  tuberia de descarga. La banda refleja incertidumbre por rugosidad real de la
                  tuberia. Para eliminarla, se requiere aforo manual de calibracion en planta.
                </p>
              </main>
            } @else {
              @if (historyLoading()) {
                <div class="space-y-5">
                  <app-skeleton class="h-14 w-full rounded-xl" />
                  <app-skeleton class="h-28 w-full rounded-xl" />
                  <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <app-skeleton class="h-28 rounded-xl" />
                    <app-skeleton class="h-28 rounded-xl" />
                    <app-skeleton class="h-28 rounded-xl" />
                    <app-skeleton class="h-28 rounded-xl" />
                  </div>
                  <div class="grid gap-5 xl:grid-cols-2">
                    <app-skeleton class="h-[340px] rounded-xl" />
                    <app-skeleton class="h-[340px] rounded-xl" />
                  </div>
                </div>
              } @else {
                <section
                  class="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center shadow-sm"
                >
                  <span class="material-symbols-outlined text-[28px] text-slate-300">waves</span>
                  <h2 class="mt-3 text-h6 font-semibold text-slate-800">
                    Sin datos RILES para mostrar
                  </h2>
                  <p class="mt-1 text-body-sm font-semibold text-slate-500">
                    Cuando lleguen mediciones del serial configurado, el dashboard se llenara con
                    datos reales de la API.
                  </p>
                </section>
              }
            }
          }
        </div>
      } @else {
        <div class="mx-auto max-w-[1540px] space-y-5">
          <app-skeleton class="h-24 w-full rounded-xl" />
          <app-skeleton class="h-28 w-full rounded-xl" />
          <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <app-skeleton class="h-28 rounded-xl" />
            <app-skeleton class="h-28 rounded-xl" />
            <app-skeleton class="h-28 rounded-xl" />
            <app-skeleton class="h-28 rounded-xl" />
          </div>
          <div class="grid gap-5 xl:grid-cols-2">
            <app-skeleton class="h-[340px] rounded-xl" />
            <app-skeleton class="h-[340px] rounded-xl" />
          </div>
        </div>
      }
    </div>
  `,
})
export class CompanySiteRilesDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly companyService = inject(CompanyService);

  siteContext = signal<SiteContext | null>(null);
  dashboardData = signal<SiteDashboardData | null>(null);
  historyRows = signal<TelemetryHistoryRow[]>([]);
  historyLoading = signal(false);
  activeTab = signal<RilesTab>('dashboard');
  activeMonthId = signal('');
  readonly telemetryKeys = [
    'caudal',
    'totalizador',
    'nivel',
    'ph',
    'conductividad',
    'temperatura',
    'calidad_sensor_pct',
  ];

  readonly tabs: { id: RilesTab; label: string; icon: string }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: 'layers' },
    { id: 'configurar', label: 'Configurar', icon: 'build' },
  ];

  readonly months = computed<RilesMonth[]>(() => this.buildMonths());

  selectedMonth = computed<RilesMonth | null>(() => {
    const months = this.months();
    return months.find((month) => month.id === this.activeMonthId()) || months.at(-1) || null;
  });

  readonly kpis = computed<RilesKpi[]>(() => {
    const month = this.selectedMonth();
    if (!month) return [];
    const nivel = this.metricNumber('nivel');
    const caudal = this.metricNumber('caudal');
    const totalizador = this.metricNumber('totalizador');
    const calidad = this.metricNumber('calidad_sensor_pct');
    const volume = this.volumeParts(totalizador);
    return [
      {
        label: 'Nivel camara',
        value:
          nivel === null ? (month.status === 'active' ? '0,01' : '0') : this.formatNumber(nivel, 3),
        unit: 'm',
        helper: month.status === 'active' ? 'con flujo en mes activo' : 'sin flujo en mes',
        icon: 'south',
        tone: 'neutral',
      },
      {
        label: 'Caudal actual',
        value: caudal === null ? '0' : this.formatNumber(caudal, 3),
        unit: 'L/s',
        helper: month.status === 'active' ? 'descarga detectada' : 'sin flujo actual',
        icon: 'water_drop',
        tone: 'primary',
      },
      {
        label: 'Vol. mes activo',
        value: totalizador === null ? month.volume : volume.value,
        unit: totalizador === null ? month.unit : volume.unit,
        helper: `banda: ${month.band}`,
        icon: 'inventory_2',
        tone: 'success',
      },
      {
        label: 'Calidad sensor',
        value: calidad === null ? month.quality : `${this.formatNumber(calidad, 1)}%`,
        unit: '',
        helper: this.dashboardData()?.ultima_lectura
          ? 'ultima lectura: Operativo'
          : 'sin lectura real',
        icon: 'badge',
        tone: 'warning',
      },
    ];
  });

  readonly charts = computed<RilesChart[]>(() => {
    const allRows = this.orderedHistoryRows();
    const allTimestamps = allRows.map((row) => this.rowTimestampMs(row));
    const xRange = this.selectedChartRange(allTimestamps);
    const rows = allRows.filter((row) => {
      const timestamp = this.rowTimestampMs(row);
      return Number.isFinite(timestamp) && timestamp >= xRange.xMin && timestamp <= xRange.xMax;
    });
    const totalizerSeed =
      allRows
        .filter((row) => {
          const timestamp = this.rowTimestampMs(row);
          return Number.isFinite(timestamp) && timestamp < xRange.xMin;
        })
        .at(-1) ?? null;
    const totalizerRows = totalizerSeed ? [totalizerSeed, ...rows] : rows;
    const timestamps = rows.map((row) => this.rowTimestampMs(row));
    const totalizerTimestamps = totalizerRows.map((row) => this.rowTimestampMs(row));
    return [
      {
        title: 'Nivel camara',
        subtitle: 'Nivel minuto a minuto en camara RILES',
        tone: 'green',
        timestamps,
        ...xRange,
        bucketMinutes: RILES_BUCKET_MINUTES,
        extendToNow: true,
        maxVisiblePoints: 220,
        min: 0,
        emptyText: 'Sin lecturas de nivel para el rango actual.',
        series: [
          this.chartSeries(
            rows,
            'nivel',
            'Nivel camara',
            '#2563eb',
            'm',
            3,
            false,
            1,
            'avg',
            'zero',
          ),
        ],
      },
      {
        title: 'Caudal descarga',
        subtitle: 'Descarga por minuto con banda Manning, L/s',
        tone: 'cyan',
        timestamps,
        ...xRange,
        bucketMinutes: RILES_BUCKET_MINUTES,
        extendToNow: true,
        maxVisiblePoints: 220,
        min: 0,
        emptyText: 'Sin lecturas de caudal para el rango actual.',
        series: [
          this.chartSeries(
            rows,
            'caudal',
            'Caudal principal',
            '#2563eb',
            'L/s',
            3,
            false,
            1,
            'avg',
            'zero',
          ),
          this.chartSeries(
            rows,
            'caudal',
            'Caudal min',
            '#16a34a',
            'L/s',
            3,
            false,
            0.78,
            'avg',
            'zero',
          ),
          this.chartSeries(
            rows,
            'caudal',
            'Caudal max',
            '#d97706',
            'L/s',
            3,
            false,
            1.22,
            'avg',
            'zero',
          ),
        ],
      },
      {
        title: 'Volumen acumulado',
        subtitle: 'Totalizador historico del equipo RILES, m3',
        tone: 'blue',
        timestamps: totalizerTimestamps,
        ...xRange,
        bucketMinutes: RILES_BUCKET_MINUTES,
        extendToNow: true,
        maxVisiblePoints: 220,
        min: 0,
        wide: true,
        emptyText: 'Sin lecturas de totalizador para el rango actual.',
        series: [
          this.chartSeries(
            totalizerRows,
            'totalizador',
            'Totalizador',
            '#0dafbd',
            'm3',
            3,
            false,
            1,
            'last',
            'carry',
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

    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
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
        this.companyService.selectedSiteModuleKey.set('Riles');
        this.companyService.selectedSiteTypeFilter.set(['riles']);
        this.siteContext.set(match);
        this.refreshDashboard();
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  refreshDashboard(): void {
    const context = this.siteContext();
    if (!context) return;

    this.companyService.getSiteDashboardData(context.site.id).subscribe({
      next: (res) => {
        if (res.ok) this.dashboardData.set(res.data);
      },
      error: () => undefined,
    });

    if (!context.site.id_serial) {
      this.historyRows.set([]);
      this.historyLoading.set(false);
      return;
    }

    this.historyLoading.set(true);
    this.companyService
      .getTelemetryPreset(context.site.id_serial, {
        preset: '30d',
        keys: this.telemetryKeys,
        limit: 1200,
      })
      .subscribe({
        next: (res) => {
          if (res.ok) this.historyRows.set(res.data || []);
          this.historyLoading.set(false);
        },
        error: () => {
          this.historyRows.set([]);
          this.historyLoading.set(false);
        },
      });
  }

  setTab(tab: RilesTab): void {
    this.activeTab.set(tab);
  }

  siteName(context: SiteContext): string {
    return context.site.descripcion || context.subCompany.nombre || 'RILES';
  }

  tabClass(tab: RilesTab): string {
    const base =
      'relative inline-flex h-full items-center gap-2 border-b-2 text-body-sm font-semibold transition-colors active:scale-95';
    return this.activeTab() === tab
      ? `${base} border-emerald-500 text-emerald-700`
      : `${base} border-transparent text-slate-500 hover:text-slate-800`;
  }

  monthButtonClass(monthId: string): string {
    const base =
      'inline-flex h-10 items-center gap-2 rounded-lg px-3 text-body-sm font-semibold transition-colors active:scale-95';
    const selectedId = this.selectedMonth()?.id;
    return this.activeMonthId() === monthId || selectedId === monthId
      ? `${base} bg-cyan-700 text-white shadow-sm`
      : `${base} bg-slate-100 text-slate-600 hover:bg-slate-200`;
  }

  monthCardClass(monthId: string): string {
    const base =
      'rounded-xl border bg-white p-4 text-left shadow-sm transition-colors hover:border-cyan-300 active:scale-[0.98]';
    const selectedId = this.selectedMonth()?.id;
    return this.activeMonthId() === monthId || selectedId === monthId
      ? `${base} border-cyan-500 bg-cyan-50/40`
      : `${base} border-slate-200`;
  }

  kpiCardClass(tone: RilesKpi['tone']): string {
    const base =
      'flex min-h-[126px] items-start justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm';
    if (tone === 'primary') return `${base} border-cyan-200`;
    if (tone === 'success') return `${base} border-emerald-200`;
    if (tone === 'warning') return `${base} border-amber-200`;
    return `${base} border-slate-200`;
  }

  kpiIconClass(tone: RilesKpi['tone']): string {
    const base = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border';
    if (tone === 'primary') return `${base} border-cyan-200 bg-cyan-50 text-cyan-700`;
    if (tone === 'success') return `${base} border-emerald-200 bg-emerald-50 text-emerald-700`;
    if (tone === 'warning') return `${base} border-amber-200 bg-amber-50 text-amber-600`;
    return `${base} border-slate-200 bg-slate-50 text-slate-500`;
  }

  private metricNumber(role: string): number | null {
    const value = this.dashboardData()?.resumen?.[role]?.valor;
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatNumber(value: number, maximumFractionDigits = 2): string {
    return new Intl.NumberFormat('es-CL', { maximumFractionDigits }).format(value);
  }

  private volumeParts(valueM3: number | null): { value: string; unit: string } {
    if (valueM3 === null) return { value: '0', unit: 'm3' };
    if (Math.abs(valueM3) < 1) {
      return { value: this.formatNumber(valueM3 * 1000, 2), unit: 'L' };
    }
    return { value: this.formatNumber(valueM3, 3), unit: 'm3' };
  }

  private orderedHistoryRows(): TelemetryHistoryRow[] {
    return this.historyRows()
      .filter((row) => row?.data && Object.keys(row.data).length > 0)
      .slice()
      .reverse();
  }

  private selectedChartRange(timestamps: number[]): { xMin: number; xMax: number } {
    const now = Date.now();
    const latestData =
      timestamps
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
        .at(-1) ?? null;
    const hasRecentData = latestData !== null && now - latestData <= RILES_RECENT_DATA_MS;
    const xMax = hasRecentData ? now : (latestData ?? now);
    const xMin = xMax - RILES_REALTIME_WINDOW_MS;
    return {
      xMin,
      xMax: xMax > xMin ? xMax : xMin + 30 * 60 * 1000,
    };
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
    scale = 1,
    aggregation: 'avg' | 'last' | 'min' | 'max' = 'avg',
    missingValue: RilesMissingMode = 'gap',
  ) {
    return {
      label,
      color,
      unit,
      precision,
      fill,
      aggregation,
      missingValue,
      values: rows.map((row) => {
        const value = this.numericValue(row, key);
        return value === null ? null : value * scale;
      }),
    };
  }

  private rowTimestampMs(row: TelemetryHistoryRow): number {
    const raw = row.timestamp_completo || `${row.fecha || ''} ${row.hora || ''}`.trim();
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const parsed = new Date(normalized).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  }

  private buildMonths(): RilesMonth[] {
    const rows = this.orderedHistoryRows();
    if (!rows.length) return [];

    const byMonth = new Map<string, TelemetryHistoryRow[]>();
    for (const row of rows) {
      const key = this.monthKey(row);
      if (!key) continue;
      const bucket = byMonth.get(key) || [];
      bucket.push(row);
      byMonth.set(key, bucket);
    }

    const months = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-3)
      .map(([month, monthRows]) => this.monthSummary(month, monthRows));
    return months;
  }

  private monthSummary(month: string, rows: TelemetryHistoryRow[]): RilesMonth {
    const totalizers = rows
      .map((row) => this.numericValue(row, 'totalizador'))
      .filter((value): value is number => value !== null);
    const caudales = rows
      .map((row) => this.numericValue(row, 'caudal'))
      .filter((value): value is number => value !== null);
    const qualityValues = rows
      .map((row) => this.numericValue(row, 'calidad_sensor_pct'))
      .filter((value): value is number => value !== null);
    const minTotal = totalizers.length ? Math.min(...totalizers) : 0;
    const maxTotal = totalizers.length ? Math.max(...totalizers) : 0;
    const volumeM3 = Math.max(0, maxTotal - minTotal);
    const volume = this.volumeParts(volumeM3);
    const quality = qualityValues.length
      ? qualityValues.reduce((sum, value) => sum + value, 0) / qualityValues.length
      : 99;
    const active = volumeM3 > 0 || caudales.some((value) => value > 0);

    return {
      id: month,
      label: this.monthLabel(month),
      volume: volume.value,
      unit: volume.unit,
      shortVolume: active ? `${volume.value} ${volume.unit}` : 'sin flujo',
      tag: active ? 'Con flujo' : 'Sin flujo',
      status: active ? 'active' : 'idle',
      quality: `${this.formatNumber(quality, 1)}%`,
      range: this.rangeLabel(rows),
      band: this.bandLabel(volumeM3),
    };
  }

  private dateKey(row: TelemetryHistoryRow): string {
    const value = row.timestamp_completo || row.fecha || '';
    return value.includes(' ') ? value.split(' ')[0] : value.slice(0, 10);
  }

  private monthKey(row: TelemetryHistoryRow): string {
    const date = this.dateKey(row);
    return date.length >= 7 ? date.slice(0, 7) : '';
  }

  private monthLabel(month: string): string {
    const [year, rawMonth] = month.split('-');
    const names = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    const index = Number(rawMonth) - 1;
    return `${names[index] || month} ${year || ''}`.trim();
  }

  private rangeLabel(rows: TelemetryHistoryRow[]): string {
    const first = this.dateKey(rows[0] || ({} as TelemetryHistoryRow));
    const last = this.dateKey(rows[rows.length - 1] || ({} as TelemetryHistoryRow));
    return first && last ? `${first} -> ${last}` : 'sin rango';
  }

  private bandLabel(volumeM3: number): string {
    const low = volumeM3 * 0.85;
    const high = volumeM3 * 1.15;
    const base = this.volumeParts(volumeM3);
    if (base.unit === 'L') {
      return `${this.formatNumber(low * 1000, 2)} - ${this.formatNumber(high * 1000, 2)} L`;
    }
    return `${this.formatNumber(low, 3)} - ${this.formatNumber(high, 3)} m3`;
  }

  private findAccessibleSite(tree: CompanyNode[], siteId: string): SiteContext | null {
    return findAccessibleSite(tree, siteId);
  }
}
