import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Chart, registerables } from 'chart.js';
import type { CompanyNode, SiteRecord } from '@emeltec/shared';
import { CompanyService } from '../../services/company.service';
import { SiteVariableSettingsPanelComponent } from '../companies/components/site-variable-settings-panel';
import { VentisquerosService } from './ventisqueros.service';
import {
  Sensor,
  TapKey,
  fmtHum,
  fmtTemp,
  humColor,
  tapColorFor,
  tapIndexFromKey,
  tapKeyFor,
  tempColor,
} from './ventisqueros-data';

Chart.register(...registerables);

type DetailTab = 'resumen' | 'configuracion';

@Component({
  selector: 'app-ventisqueros-tap-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, SiteVariableSettingsPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style="background:#F0F2F5;">
      <!-- Header -->
      <div
        class="flex flex-wrap items-center gap-3 border-t border-b border-[#E2E8F0] px-5 py-2.5"
        style="background:#F8FAFC; border-bottom-color:#0284C7; border-bottom-width:2px;"
      >
        <button
          type="button"
          [routerLink]="backLink()"
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-slate-500 transition-colors hover:text-sky-600"
          aria-label="Volver a instalaciones"
        >
          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>
        </button>
        <div
          class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg"
          [style.background]="tapColor() + '1A'"
          [style.border]="'1px solid ' + tapColor() + '40'"
        >
          <span class="material-symbols-outlined text-[18px]" [style.color]="tapColor()">memory</span>
        </div>
        <div class="min-w-0">
          <div class="tap-title truncate">
            {{ siteName() }} · {{ tapId() }}
          </div>
          <div class="mt-0.5 text-[11px] text-slate-400">
            {{ sensors().length }} sensores THM
          </div>
        </div>
        <span
          class="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
          [style.color]="serviceError() ? '#B91C1C' : '#64748B'"
          [title]="liveLabel()"
        >
          <span
            class="inline-block h-1.5 w-1.5 rounded-full"
            [style.background]="serviceError() ? '#EF4444' : '#22c55e'"
          ></span>
          {{ liveLabel() }}
        </span>
        <button
          type="button"
          class="ml-2 flex h-9 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:text-sky-600"
          [class.tap-config-btn--active]="tab() === 'configuracion'"
          (click)="tab.set(tab() === 'configuracion' ? 'resumen' : 'configuracion')"
          [title]="tab() === 'configuracion' ? 'Volver al resumen' : 'Configurar variables'"
          [attr.aria-pressed]="tab() === 'configuracion'"
          [attr.aria-label]="tab() === 'configuracion' ? 'Volver al resumen' : 'Configurar variables'"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">
            {{ tab() === 'configuracion' ? 'arrow_back' : 'tune' }}
          </span>
          {{ tab() === 'configuracion' ? 'Resumen' : 'Configurar' }}
        </button>
      </div>

      <!-- Content -->
      <div class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
        @if (tab() === 'resumen') {
            <!-- KPI strip -->
            <div class="kpi-strip mb-7 flex flex-wrap items-end gap-8">
              <div class="kpi-hero">
                <div
                  class="kpi-hero-value"
                  [style.color]="stats().alerts > 0 ? '#DC2626' : tapColor()"
                >
                  {{ stats().alerts > 0 ? stats().alerts : stats().count }}
                </div>
                <div class="kpi-hero-label">
                  {{ stats().alerts === 1 ? 'sensor en alerta' : stats().alerts > 0 ? 'sensores en alerta' : 'sensores en operación' }}
                </div>
              </div>
              <div class="kpi-meta flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span>Temp prom <strong>{{ stats().avgT }}°C</strong></span>
                <span>HR prom <strong>{{ stats().avgH }}%</strong></span>
                <span class="kpi-meta-tap">{{ tapId() }}</span>
              </div>
            </div>

            <!-- Alertas destacadas -->
            @if (alertedSensors().length > 0) {
              <section class="mb-6">
                <h3 class="section-title mb-2 text-rose-700">
                  Sensores en alerta
                  <span class="section-count">{{ alertedSensors().length }}</span>
                </h3>
                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  @for (s of alertedSensors(); track s.id) {
                    <article class="alert-card">
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <div class="flex items-center gap-1.5">
                            <span class="sensor-id-chip">{{ s.id }}</span>
                            <span class="sensor-alert-chip">ALERTA</span>
                          </div>
                          <div class="sensor-area mt-1.5 truncate">{{ s.area }}</div>
                        </div>
                        <div
                          class="h-2.5 w-2.5 shrink-0 rounded-full"
                          [style.background]="tempColor(s.t)"
                          [style.box-shadow]="'0 0 0 4px rgba(239,68,68,0.20)'"
                        ></div>
                      </div>
                      <div class="mt-3 flex items-baseline gap-4">
                        <div>
                          <div class="sensor-metric-val text-rose-700">{{ fmtTemp(s.t) }}</div>
                          <div class="sensor-metric-lbl">temperatura</div>
                        </div>
                        <div>
                          <div class="sensor-metric-val text-slate-700">{{ fmtHum(s.h) }}</div>
                          <div class="sensor-metric-lbl">humedad</div>
                        </div>
                      </div>
                      <svg viewBox="0 0 120 32" class="mt-2 h-8 w-full">
                        <path
                          [attr.d]="sparkPath(s.hist)"
                          fill="none"
                          [attr.stroke]="tempColor(s.t)"
                          stroke-width="1.5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </article>
                  }
                </div>
              </section>
            }

            <!-- Operación normal: lista densa -->
            <section class="mb-6">
              <h3 class="section-title mb-2">
                Operación normal
                <span class="section-count">{{ normalSensors().length }}</span>
              </h3>
              @if (normalSensors().length > 0) {
                <div class="sensor-table" role="table" aria-label="Sensores en operación normal">
                  <div class="sensor-table-head" role="row">
                    <span role="columnheader">Sensor</span>
                    <span role="columnheader">Ubicación</span>
                    <span class="text-right" role="columnheader">Temp</span>
                    <span class="text-right" role="columnheader">HR</span>
                    <span role="columnheader">Tendencia 24h</span>
                  </div>
                  @for (s of normalSensors(); track s.id) {
                    <div class="sensor-row" [title]="s.area" role="row">
                      <span class="sensor-id-chip" role="cell">{{ s.id }}</span>
                      <span class="sensor-row-area truncate" role="cell">{{ s.area }}</span>
                      <span class="sensor-row-temp text-right" role="cell">{{ fmtTemp(s.t) }}</span>
                      <span class="sensor-row-hum text-right" role="cell">{{ fmtHum(s.h) }}</span>
                      <svg viewBox="0 0 120 18" class="sensor-row-spark" role="cell" [attr.aria-label]="'Tendencia ' + s.id">
                        <path
                          [attr.d]="sparkPathTight(s.hist)"
                          fill="none"
                          [attr.stroke]="tempColor(s.t)"
                          stroke-width="1.4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    </div>
                  }
                </div>
              } @else if (sensors().length === 0 && isLoading()) {
                <div class="sensor-table" aria-label="Cargando sensores">
                  <div class="sensor-table-head">
                    <span>Sensor</span>
                    <span>Ubicación</span>
                    <span class="text-right">Temp</span>
                    <span class="text-right">HR</span>
                    <span>Tendencia 24h</span>
                  </div>
                  @for (_ of [1,2,3,4,5]; track $index) {
                    <div class="skeleton-row" aria-hidden="true">
                      <span class="skeleton-bar" style="width:48px"></span>
                      <span class="skeleton-bar" style="width:60%"></span>
                      <span class="skeleton-bar" style="width:56px; margin-left:auto"></span>
                      <span class="skeleton-bar" style="width:40px; margin-left:auto"></span>
                      <span class="skeleton-bar" style="width:100%"></span>
                    </div>
                  }
                </div>
              } @else if (sensors().length === 0) {
                <div class="empty-block">
                  <span class="material-symbols-outlined text-[28px] text-slate-300" aria-hidden="true">sensors_off</span>
                  <div class="mt-2 text-[13px] font-medium text-slate-500">
                    Sin sensores en {{ tapId() }}
                  </div>
                </div>
              }
            </section>

            <!-- Histórico chart -->
            @if (sensors().length > 0) {
              <section>
                <div class="mb-3 flex items-baseline justify-between gap-3">
                  <h3 class="section-title">Histórico de temperatura</h3>
                  <span class="section-meta">últimas 24 lecturas</span>
                </div>
                <div class="chart-shell">
                  <div class="h-[280px]">
                    <canvas #chartCanvas></canvas>
                  </div>
                </div>
              </section>
            }
        }

        @if (tab() === 'configuracion') {
          @if (siteId()) {
            <app-site-variable-settings-panel
              [siteId]="siteId()"
              [site]="siteRecord()"
              [showPozoConfig]="false"
              accentColor="#0284C7"
              accentSoft="rgba(2,132,199,0.10)"
            />
          } @else {
            <div
              class="flex items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white py-16"
            >
              <span class="text-[12px] text-slate-400">Sin site seleccionado</span>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .tap-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .tap-h3 {
        font-family: 'DM Sans', sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.01em;
      }
      .tap-config-btn--active {
        background: rgba(2, 132, 199, 0.08);
        color: #0284c7;
        border-color: rgba(2, 132, 199, 0.30);
      }

      /* Focus visible (a11y) */
      button:focus-visible,
      a:focus-visible {
        outline: 2px solid #0284c7;
        outline-offset: 2px;
        border-radius: 8px;
      }
      .sensor-row:focus-visible {
        outline: 2px solid #0284c7;
        outline-offset: -2px;
      }

      .kpi-strip {
        padding-left: 2px;
      }
      .kpi-hero-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 44px;
        font-weight: 600;
        line-height: 0.95;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }
      .kpi-hero-label {
        font-family: 'DM Sans', sans-serif;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #94a3b8;
        margin-top: 6px;
      }
      .kpi-meta {
        font-family: 'DM Sans', sans-serif;
        font-size: 12.5px;
        color: #64748b;
        padding-bottom: 4px;
      }
      .kpi-meta strong {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .kpi-meta-tap {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .section-title {
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #475569;
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .section-count {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        color: #94a3b8;
        font-weight: 500;
        letter-spacing: 0;
        text-transform: none;
      }
      .section-meta {
        font-family: 'DM Sans', sans-serif;
        font-size: 11px;
        color: #94a3b8;
      }

      .alert-card {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.05), transparent 70%);
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 14px;
        padding: 14px 16px;
      }

      .sensor-id-chip {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10.5px;
        font-weight: 600;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 1px 5px;
        color: #475569;
      }
      .sensor-alert-chip {
        font-family: 'JetBrains Mono', monospace;
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.04em;
        background: rgba(239, 68, 68, 0.10);
        border: 1px solid rgba(239, 68, 68, 0.25);
        color: #b91c1c;
        border-radius: 4px;
        padding: 1px 5px;
      }
      .sensor-area {
        font-family: 'DM Sans', sans-serif;
        font-size: 13px;
        color: #1e293b;
      }
      .sensor-metric-val {
        font-family: 'JetBrains Mono', monospace;
        font-size: 20px;
        font-weight: 600;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .sensor-metric-lbl {
        font-family: 'DM Sans', sans-serif;
        font-size: 10.5px;
        color: #94a3b8;
        margin-top: 3px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      /* Dense sensor table */
      .sensor-table {
        border-top: 1px solid #e2e8f0;
      }
      .sensor-table-head,
      .sensor-row {
        display: grid;
        grid-template-columns: 60px minmax(0, 1fr) 84px 64px 120px;
        align-items: center;
        gap: 14px;
        padding: 8px 4px;
        border-bottom: 1px solid #e2e8f0;
      }
      .sensor-table-head {
        font-family: 'DM Sans', sans-serif;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
        padding-top: 10px;
        padding-bottom: 10px;
        background: transparent;
      }
      .sensor-row {
        font-family: 'DM Sans', sans-serif;
        font-size: 13px;
        color: #1e293b;
        transition: background 0.12s ease;
      }
      .sensor-row:hover {
        background: rgba(2, 132, 199, 0.03);
      }
      .sensor-row-area {
        color: #475569;
      }
      .sensor-row-temp {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .sensor-row-hum {
        font-family: 'JetBrains Mono', monospace;
        color: #64748b;
        font-variant-numeric: tabular-nums;
      }
      .sensor-row-spark {
        height: 18px;
        width: 100%;
      }

      .empty-block {
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
        padding: 28px;
        text-align: center;
      }

      .chart-shell {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 18px 18px 8px;
      }

      /* Skeleton loading */
      .skeleton-row {
        display: grid;
        grid-template-columns: 60px minmax(0, 1fr) 84px 64px 120px;
        align-items: center;
        gap: 14px;
        padding: 10px 4px;
        border-bottom: 1px solid #e2e8f0;
      }
      .skeleton-bar {
        height: 12px;
        border-radius: 4px;
        background: linear-gradient(
          90deg,
          rgba(148, 163, 184, 0.10),
          rgba(148, 163, 184, 0.22),
          rgba(148, 163, 184, 0.10)
        );
        background-size: 200% 100%;
        animation: skelShimmer 1.4s linear infinite;
      }
      @keyframes skelShimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }

      @media (prefers-reduced-motion: reduce) {
        .skeleton-bar {
          animation: none;
        }
      }

      .kpi-hero-value {
        max-width: 240px;
        overflow: hidden;
        text-overflow: clip;
      }
    `,
  ],
})
export class VentisquerosTapDetailComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly service = inject(VentisquerosService);
  private readonly companyService = inject(CompanyService);

  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  readonly tab = signal<DetailTab>('resumen');
  readonly siteId = computed(() => this.params().get('siteId') || '');
  readonly siteRecord = signal<SiteRecord | null>(null);
  readonly now = signal<number>(Date.now());

  readonly backLink = computed(() => ['/companies']);

  readonly tapId = computed<TapKey>(() => {
    const rawParam = this.params().get('tapId');
    if (rawParam) {
      const decoded = decodeURIComponent(rawParam).toUpperCase().replace(/-/g, ' ').trim();
      const match = decoded.match(/TAP\s*(\d+)/);
      if (match) return tapKeyFor(Number(match[1]) - 1);
    }
    return tapKeyFor(0);
  });

  readonly tapColor = computed(() => tapColorFor(tapIndexFromKey(this.tapId())));

  readonly siteName = computed(() => this.siteRecord()?.descripcion || 'Sitio');

  private readonly allSensors = toSignal(this.service.sensors$, {
    initialValue: [] as Sensor[],
  });
  readonly sensors = computed(() => this.allSensors().filter((s) => s.tap === this.tapId()));

  readonly lastUpdate = toSignal(this.service.lastUpdate$, { initialValue: null as Date | null });
  readonly serviceError = toSignal(this.service.error$, { initialValue: null as string | null });
  readonly isLoading = toSignal(this.service.loading$, { initialValue: false });

  readonly liveLabel = computed(() => {
    if (this.serviceError()) return 'Sin conexión';
    const last = this.lastUpdate();
    if (!last) return this.isLoading() ? 'Cargando…' : 'Esperando lectura';
    const diff = Math.max(0, Math.floor((this.now() - last.getTime()) / 1000));
    if (diff < 60) return `En vivo · hace ${diff}s`;
    return `En vivo · hace ${Math.floor(diff / 60)}m`;
  });

  readonly stats = computed(() => {
    const list = this.sensors();
    if (list.length === 0) return { count: 0, avgT: '—', avgH: 0, alerts: 0 };
    const ts = list.map((s) => s.t);
    const hs = list.map((s) => s.h);
    return {
      count: list.length,
      avgT: (ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1),
      avgH: Math.round(hs.reduce((a, b) => a + b, 0) / hs.length),
      alerts: list.filter((s) => s.alerted).length,
    };
  });

  readonly alertedSensors = computed(() => this.sensors().filter((s) => s.alerted));
  readonly normalSensors = computed(() => this.sensors().filter((s) => !s.alerted));

  private chart: Chart | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const currentTab = this.tab();
      if (currentTab !== 'resumen') {
        this.destroyChart();
        return;
      }
      const list = this.sensors().map((s) => ({ id: s.id, hist: s.hist, t: s.t }));
      if (list.length === 0) {
        this.destroyChart();
        return;
      }
      queueMicrotask(() => this.renderChartFor(list));
    });
  }

  ngOnInit(): void {
    const id = this.siteId();
    if (!id) {
      this.router.navigate(['/companies']);
      return;
    }
    this.intervalId = setInterval(() => this.now.set(Date.now()), 5_000);

    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        if (!res.ok) {
          this.service.startPolling([{ siteId: id, tap: null }]);
          return;
        }
        const site = this.findSite(res.data, id);
        if (site) this.siteRecord.set(site);
        const tap = this.tapId();
        this.service.startPolling([{ siteId: id, tap }]);
      },
      error: () => {
        this.service.startPolling([{ siteId: id, tap: null }]);
      },
    });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      const list = this.sensors().map((s) => ({ id: s.id, hist: s.hist, t: s.t }));
      this.renderChartFor(list);
    });
  }

  ngOnDestroy(): void {
    this.service.stopPolling();
    this.destroyChart();
    if (this.intervalId !== null) clearInterval(this.intervalId);
  }

  fmtTemp = fmtTemp;
  fmtHum = fmtHum;
  tempColor = tempColor;
  humColor = humColor;

  sparkPath(hist: number[]): string {
    return this.buildSparkPath(hist, 32);
  }

  sparkPathTight(hist: number[]): string {
    return this.buildSparkPath(hist, 18);
  }

  private buildSparkPath(hist: number[], height: number): string {
    if (!hist || hist.length === 0) return '';
    const min = Math.min(...hist);
    const max = Math.max(...hist);
    const range = max - min || 1;
    const stepX = 120 / Math.max(hist.length - 1, 1);
    const pad = 2;
    return hist
      .map((v, i) => {
        const x = i * stepX;
        const y = pad + (1 - (v - min) / range) * (height - pad * 2);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  private findSite(tree: CompanyNode[], siteId: string): SiteRecord | null {
    for (const c of tree) {
      for (const sub of c.subCompanies || []) {
        const s = (sub.sites || []).find((x) => x.id === siteId);
        if (s) return s;
      }
    }
    return null;
  }

  private renderChartFor(sensors: Array<{ id: string; hist: number[]; t: number }>): void {
    if (!this.chartCanvas?.nativeElement || sensors.length === 0) return;
    this.destroyChart();
    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const labels = Array.from({ length: 24 }, (_, i) => `-${23 - i}h`);
    const palette = ['#0EA5E9', '#6366F1', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: sensors.map((s, i) => ({
          label: s.id,
          data: s.hist || [],
          borderColor: palette[i % palette.length],
          backgroundColor: palette[i % palette.length] + '20',
          borderWidth: 1.8,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0.3,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${(ctx.parsed.y as number).toFixed(1)}°C`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#94A3B8' } },
          y: {
            grid: { color: 'rgba(148,163,184,0.15)' },
            ticks: {
              font: { size: 10 },
              color: '#94A3B8',
              callback: (v) => `${v}°C`,
            },
          },
        },
      },
    });
  }

  private destroyChart(): void {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }
}
