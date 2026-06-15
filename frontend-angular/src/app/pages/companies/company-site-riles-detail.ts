import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CompanyNode, SiteDashboardData, SiteRecord, SubCompanyNode } from '@emeltec/shared';
import { CompanyService, type TelemetryHistoryRow } from '../../services/company.service';
import { SkeletonComponent } from '../../components/ui/skeleton';
import { SiteVariableSettingsPanelComponent } from './components/site-variable-settings-panel';

interface SiteContext {
  company: CompanyNode;
  subCompany: SubCompanyNode;
  site: SiteRecord;
}

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

interface RilesChart {
  title: string;
  subtitle: string;
  heightClass: string;
  series: { label: string; color: string; points: string }[];
  labels?: string[];
}

type RilesTab = 'dashboard' | 'configurar';

interface DailyBar {
  day: string;
  main: number;
  min: number;
  max: number;
}

@Component({
  selector: 'app-company-site-riles-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, SkeletonComponent, SiteVariableSettingsPanelComponent],
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
                  <span class="material-symbols-outlined text-[24px]">waves</span>
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
                  class="inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-700 bg-cyan-700 px-4 text-body-sm font-semibold text-white transition-colors hover:bg-cyan-800"
                >
                  <span class="material-symbols-outlined text-[18px]">download</span>
                  Descargar mes activo (.xlsx)
                </button>
                <button
                  type="button"
                  (click)="setTab(activeTab() === 'configurar' ? 'dashboard' : 'configurar')"
                  class="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                  aria-label="Configurar variables RILES"
                >
                  <span class="material-symbols-outlined text-[20px]">settings</span>
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
                  <span class="material-symbols-outlined text-[18px]">{{ tab.icon }}</span>
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
                    <article class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div class="mb-4">
                        <h2 class="text-h6 font-semibold text-slate-900">{{ chart.title }}</h2>
                        <p class="text-body-sm font-semibold text-slate-500">
                          {{ chart.subtitle }}
                        </p>
                      </div>
                      <div [class]="chart.heightClass">
                        <svg viewBox="0 0 900 260" class="h-full w-full" preserveAspectRatio="none">
                          <g stroke="#e2e8f0" stroke-width="1">
                            <line x1="46" y1="28" x2="872" y2="28" />
                            <line x1="46" y1="82" x2="872" y2="82" />
                            <line x1="46" y1="136" x2="872" y2="136" />
                            <line x1="46" y1="190" x2="872" y2="190" />
                            <line x1="46" y1="232" x2="872" y2="232" />
                            <line x1="46" y1="28" x2="46" y2="232" />
                          </g>
                          @for (serie of chart.series; track serie.label) {
                            <polyline
                              [attr.points]="serie.points"
                              fill="none"
                              [attr.stroke]="serie.color"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="3"
                            />
                          }
                        </svg>
                        <div
                          class="pointer-events-none absolute bottom-2 left-14 right-8 flex justify-between text-[11px] font-semibold text-slate-400"
                        >
                          @for (label of chart.labels || defaultChartLabels; track $index) {
                            <span>{{ label }}</span>
                          }
                        </div>
                      </div>
                      <div
                        class="mt-4 flex flex-wrap justify-center gap-5 text-caption font-semibold text-slate-500"
                      >
                        @for (serie of chart.series; track serie.label) {
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

                  <article
                    class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2"
                  >
                    <div class="mb-5">
                      <h2 class="text-h6 font-semibold text-slate-900">Consumo diario</h2>
                      <p class="text-body-sm font-semibold text-slate-500">
                        Volumen diario simulado, central y banda de incertidumbre.
                      </p>
                    </div>
                    <div class="relative h-[280px] overflow-hidden rounded-lg bg-white">
                      <div
                        class="absolute inset-x-10 bottom-10 top-6 grid grid-cols-12 items-end gap-2"
                      >
                        @for (bar of dailyBars(); track bar.day) {
                          <div class="flex h-full flex-col justify-end gap-1">
                            <div
                              class="rounded-t bg-blue-500"
                              [style.height.%]="bar.main"
                              [attr.aria-label]="bar.day"
                            ></div>
                            <div
                              class="h-1 rounded bg-emerald-400"
                              [style.opacity]="bar.min / 100"
                            ></div>
                            <div
                              class="h-1 rounded bg-amber-400"
                              [style.opacity]="bar.max / 100"
                            ></div>
                          </div>
                        }
                      </div>
                      <div class="absolute inset-x-10 bottom-9 border-t border-slate-200"></div>
                      <div class="absolute left-10 top-6 h-[210px] border-l border-slate-200"></div>
                    </div>
                    <div
                      class="mt-4 flex flex-wrap justify-center gap-5 text-caption font-semibold text-slate-500"
                    >
                      <span class="inline-flex items-center gap-1.5">
                        <span class="h-2 w-2 rounded-full bg-blue-500"></span>
                        Vol. diario (m3)
                      </span>
                      <span class="inline-flex items-center gap-1.5">
                        <span class="h-2 w-2 rounded-full bg-emerald-400"></span>
                        Vol. diario min (m3)
                      </span>
                      <span class="inline-flex items-center gap-1.5">
                        <span class="h-2 w-2 rounded-full bg-amber-400"></span>
                        Vol. diario max (m3)
                      </span>
                    </div>
                  </article>
                </section>

                <p
                  class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-caption font-semibold leading-5 text-slate-500 shadow-sm"
                >
                  Nota: caudal y volumen se calculan con ecuacion de Manning para flujo parcial en
                  tuberia de descarga. La banda refleja incertidumbre por rugosidad real de la
                  tuberia. Para eliminarla, se requiere aforo manual de calibracion en planta.
                </p>
              </main>
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
  activeTab = signal<RilesTab>('dashboard');
  activeMonthId = signal('abril');
  readonly defaultChartLabels = ['Abr', '5', '9', '13', '17', '21', '25', 'May'];
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

  readonly fallbackMonths: RilesMonth[] = [
    {
      id: 'abril',
      label: 'Abril 2026',
      volume: '1.420,13',
      unit: 'm3',
      shortVolume: '1.420 m3',
      tag: 'Con flujo',
      status: 'active',
      quality: '55,7%',
      range: '2026-04-01 -> 2026-04-30',
      band: '1.183,44 - 1.936,54 m3',
    },
    {
      id: 'mayo',
      label: 'Mayo 2026',
      volume: '0',
      unit: 'm3',
      shortVolume: 'sin flujo',
      tag: 'Sin flujo',
      status: 'idle',
      quality: '87,5%',
      range: '2026-05-01 -> 2026-05-30',
      band: '0 - 0 m3',
    },
    {
      id: 'junio',
      label: 'Junio 2026',
      volume: '0',
      unit: 'm3',
      shortVolume: 'sin flujo',
      tag: 'Sin flujo',
      status: 'idle',
      quality: '99,9%',
      range: '2026-06-01 -> 2026-06-05',
      band: '0 - 0 m3',
    },
  ];

  readonly months = computed<RilesMonth[]>(() => this.buildMonths());

  selectedMonth = computed<RilesMonth>(
    () =>
      this.months().find((month) => month.id === this.activeMonthId()) ||
      this.months()[0] ||
      this.fallbackMonths[0]!,
  );

  readonly kpis = computed<RilesKpi[]>(() => {
    const month = this.selectedMonth();
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

  readonly fallbackCharts: RilesChart[] = [
    {
      title: 'Nivel camara',
      subtitle: 'Nivel del agua en camara RILES (m), mes activo.',
      heightClass: 'relative h-[320px] overflow-hidden rounded-lg bg-white',
      series: [
        {
          label: 'Nivel (m)',
          color: '#4f73d9',
          points:
            '55,230 86,80 112,202 141,70 170,214 198,74 229,78 258,226 288,90 318,88 348,230 430,230 512,230 595,230 650,92 680,206 713,228 742,205 775,230 806,214 840,229',
        },
      ],
    },
    {
      title: 'Caudal descarga',
      subtitle: 'Central + banda incertidumbre Manning, L/s.',
      heightClass: 'relative h-[320px] overflow-hidden rounded-lg bg-white',
      series: [
        {
          label: 'Caudal (L/s)',
          color: '#4f73d9',
          points:
            '55,232 92,232 120,78 145,214 173,62 204,225 232,80 262,232 295,66 325,230 355,70 385,232 435,218 468,223 530,232 650,232 710,232 758,126 805,232 850,232',
        },
        {
          label: 'Caudal min (L/s)',
          color: '#77c66e',
          points:
            '55,232 92,232 120,116 145,223 173,110 204,230 232,118 262,232 295,115 325,232 355,120 385,232 435,224 468,228 530,232 650,232 710,232 758,170 805,232 850,232',
        },
        {
          label: 'Caudal max (L/s)',
          color: '#f4b847',
          points:
            '55,232 92,232 120,40 145,198 173,34 204,218 232,43 262,232 295,37 325,220 355,42 385,232 435,214 468,218 530,232 650,232 710,232 758,90 805,232 850,232',
        },
      ],
    },
  ];

  readonly charts = computed<RilesChart[]>(() => {
    const rows = this.orderedHistoryRows();
    if (rows.length < 2) return this.fallbackCharts;
    const labels = this.axisLabels(rows);
    return [
      {
        title: 'Nivel camara',
        subtitle: 'Nivel del agua en camara RILES (m), mes activo.',
        heightClass: 'relative h-[320px] overflow-hidden rounded-lg bg-white',
        labels,
        series: [
          {
            label: 'Nivel (m)',
            color: '#4f73d9',
            points: this.linePoints(rows, 'nivel', {
              min: 0,
              max: 0.25,
              fallback: this.fallbackPoint(0, 0),
            }),
          },
        ],
      },
      {
        title: 'Caudal descarga',
        subtitle: 'Central + banda incertidumbre Manning, L/s.',
        heightClass: 'relative h-[320px] overflow-hidden rounded-lg bg-white',
        labels,
        series: [
          {
            label: 'Caudal (L/s)',
            color: '#4f73d9',
            points: this.linePoints(rows, 'caudal', {
              min: 0,
              fallback: this.fallbackPoint(1, 0),
            }),
          },
          {
            label: 'Caudal min (L/s)',
            color: '#77c66e',
            points: this.linePoints(rows, 'caudal', {
              min: 0,
              scale: 0.78,
              fallback: this.fallbackPoint(1, 1),
            }),
          },
          {
            label: 'Caudal max (L/s)',
            color: '#f4b847',
            points: this.linePoints(rows, 'caudal', {
              min: 0,
              scale: 1.22,
              fallback: this.fallbackPoint(1, 2),
            }),
          },
        ],
      },
    ];
  });

  readonly fallbackDailyBars: DailyBar[] = [
    { day: '29', main: 0, min: 15, max: 25 },
    { day: '30', main: 62, min: 45, max: 75 },
    { day: '1', main: 95, min: 65, max: 92 },
    { day: '2', main: 88, min: 60, max: 90 },
    { day: '3', main: 48, min: 35, max: 58 },
    { day: '4', main: 0, min: 15, max: 20 },
    { day: '5', main: 73, min: 52, max: 84 },
    { day: '6', main: 98, min: 68, max: 95 },
    { day: '7', main: 82, min: 59, max: 88 },
    { day: '8', main: 17, min: 21, max: 31 },
    { day: '9', main: 0, min: 15, max: 18 },
    { day: '10', main: 0, min: 15, max: 18 },
  ];

  readonly dailyBars = computed<DailyBar[]>(() => this.buildDailyBars());

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

    if (!context.site.id_serial) return;
    this.companyService
      .getTelemetryPreset(context.site.id_serial, {
        preset: '30d',
        keys: this.telemetryKeys,
        limit: 1200,
      })
      .subscribe({
        next: (res) => {
          if (res.ok) this.historyRows.set(res.data || []);
        },
        error: () => undefined,
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
      'relative inline-flex h-full items-center gap-2 border-b-2 text-body-sm font-semibold transition-colors';
    return this.activeTab() === tab
      ? `${base} border-emerald-500 text-emerald-700`
      : `${base} border-transparent text-slate-500 hover:text-slate-800`;
  }

  monthButtonClass(monthId: string): string {
    const base =
      'inline-flex h-10 items-center gap-2 rounded-lg px-3 text-body-sm font-semibold transition-colors';
    return this.activeMonthId() === monthId || this.selectedMonth().id === monthId
      ? `${base} bg-cyan-700 text-white shadow-sm`
      : `${base} bg-slate-100 text-slate-600 hover:bg-slate-200`;
  }

  monthCardClass(monthId: string): string {
    const base =
      'rounded-xl border bg-white p-4 text-left shadow-sm transition-colors hover:border-cyan-300';
    return this.activeMonthId() === monthId || this.selectedMonth().id === monthId
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

  private numericValue(row: TelemetryHistoryRow, key: string): number | null {
    const value = row.data?.[key];
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private fallbackPoint(chartIndex: number, serieIndex: number): string {
    return this.fallbackCharts[chartIndex]?.series[serieIndex]?.points || '';
  }

  private linePoints(
    rows: TelemetryHistoryRow[],
    key: string,
    options: { min?: number; max?: number; scale?: number; fallback: string },
  ): string {
    const scale = options.scale ?? 1;
    const series = rows
      .map((row, index) => {
        const value = this.numericValue(row, key);
        return { index, value: value === null ? null : value * scale };
      })
      .filter((point): point is { index: number; value: number } => point.value !== null);
    if (series.length < 2) return options.fallback;

    const values = series.map((point) => point.value);
    let min = options.min ?? Math.min(...values);
    let max = options.max ?? Math.max(...values);
    if (max === min) {
      max += 1;
      min -= 1;
    }

    const xMin = 55;
    const xMax = 850;
    const yMin = 28;
    const yMax = 232;
    const lastIndex = Math.max(1, rows.length - 1);

    return series
      .map((point) => {
        const x = xMin + (point.index / lastIndex) * (xMax - xMin);
        const normalized = Math.min(1, Math.max(0, (point.value - min) / (max - min)));
        const y = yMax - normalized * (yMax - yMin);
        return `${Math.round(x)},${Math.round(y)}`;
      })
      .join(' ');
  }

  private axisLabels(rows: TelemetryHistoryRow[]): string[] {
    if (!rows.length) return this.defaultChartLabels;
    const labels: string[] = [];
    const count = Math.min(8, rows.length);
    for (let i = 0; i < count; i++) {
      const index = Math.round((i / Math.max(1, count - 1)) * (rows.length - 1));
      const row = rows[index];
      labels.push(this.shortDateLabel(row?.timestamp_completo || row?.fecha || ''));
    }
    return labels;
  }

  private shortDateLabel(value: string): string {
    const date = value.includes(' ') ? value.split(' ')[0] : value;
    const parts = date.split('-');
    if (parts.length !== 3) return '';
    return `${Number(parts[2])}/${Number(parts[1])}`;
  }

  private buildDailyBars(): DailyBar[] {
    const rows = this.orderedHistoryRows();
    if (rows.length < 2) return this.fallbackDailyBars;

    const byDay = new Map<string, number[]>();
    for (const row of rows) {
      const day = this.dateKey(row);
      const totalizer = this.numericValue(row, 'totalizador');
      if (!day || totalizer === null) continue;
      const bucket = byDay.get(day) || [];
      bucket.push(totalizer);
      byDay.set(day, bucket);
    }

    const deltas = Array.from(byDay.entries())
      .map(([day, values]) => {
        const min = Math.min(...values);
        const max = Math.max(...values);
        return { day, delta: Math.max(0, max - min) };
      })
      .slice(-12);
    const maxDelta = Math.max(...deltas.map((item) => item.delta), 0);
    if (maxDelta <= 0) return this.fallbackDailyBars;

    return deltas.map((item) => ({
      day: String(Number(item.day.slice(-2))),
      main: Math.max(4, Math.round((item.delta / maxDelta) * 100)),
      min: 45,
      max: 82,
    }));
  }

  private buildMonths(): RilesMonth[] {
    const rows = this.orderedHistoryRows();
    if (rows.length < 2) return this.fallbackMonths;

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
    return months.length ? months : this.fallbackMonths;
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
    for (const company of tree) {
      for (const subCompany of company.subCompanies || []) {
        const site = (subCompany.sites || []).find((item) => item.id === siteId);
        if (site) return { company, subCompany, site };
      }
    }

    return null;
  }
}
