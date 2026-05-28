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
  ConcentratorState,
  Sensor,
  SensorBackup,
  TAPS,
  TAP_COLORS,
  TapKey,
  fmtHum,
  fmtTemp,
  humColor,
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
        >
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
        </button>
        <div
          class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg"
          [style.background]="tapColor() + '1A'"
          [style.border]="'1px solid ' + tapColor() + '40'"
        >
          <span class="material-symbols-outlined text-[18px]" [style.color]="tapColor()">
            {{ isConcentrator() ? 'hub' : 'memory' }}
          </span>
        </div>
        <div class="min-w-0">
          <div class="tap-title truncate">{{ siteName() }} · {{ tapId() }}</div>
          <div class="mt-0.5 text-[11px] text-slate-400">
            @if (isConcentrator()) {
              Concentrador maestro · redundancia y alertas
            } @else {
              {{ sensors().length }} sensores THM
            }
          </div>
        </div>
        <span
          class="ml-3 flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium"
          [style.background]="serviceError() ? '#FEF2F2' : '#F0FDF4'"
          [style.border-color]="serviceError() ? 'rgba(239,68,68,0.30)' : '#bbf7d0'"
          [style.color]="serviceError() ? '#B91C1C' : '#16a34a'"
        >
          <span
            class="inline-block h-1.5 w-1.5 rounded-full"
            [style.background]="serviceError() ? '#EF4444' : '#22c55e'"
          ></span>
          {{ liveLabel() }}
        </span>
      </div>

      <!-- Sub-tabs -->
      <div class="tap-tabs-bar flex shrink-0 items-center gap-0">
        <button
          type="button"
          class="tap-tab-btn flex items-center gap-1.5"
          [class.tap-tab-btn--active]="tab() === 'resumen'"
          (click)="tab.set('resumen')"
        >
          <span class="material-symbols-outlined text-[13px]">dashboard</span>
          Resumen
        </button>
        <button
          type="button"
          class="tap-tab-btn flex items-center gap-1.5"
          [class.tap-tab-btn--active]="tab() === 'configuracion'"
          (click)="tab.set('configuracion')"
        >
          <span class="material-symbols-outlined text-[13px]">tune</span>
          Configuración
        </button>
      </div>

      <!-- Content -->
      <div class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-5">
        @if (tab() === 'resumen') {
          @if (isConcentrator()) {
            <!-- TAP 1 concentrador: redundancia THM + alertas físicas -->
            <div
              class="mb-4 flex items-center justify-between gap-3 rounded-2xl border bg-white px-5 py-4 shadow-sm"
              [style.border-color]="concentrator().alerted ? 'rgba(239,68,68,0.30)' : '#E2E8F0'"
            >
              <div class="flex items-center gap-3 min-w-0">
                <div
                  class="flex h-10 w-10 items-center justify-center rounded-xl"
                  [style.background]="
                    concentrator().alerted ? 'rgba(239,68,68,0.12)' : tapColor() + '1A'
                  "
                  [style.border]="
                    '1px solid ' +
                    (concentrator().alerted ? 'rgba(239,68,68,0.35)' : tapColor() + '40')
                  "
                >
                  <span
                    class="material-symbols-outlined text-[20px]"
                    [style.color]="concentrator().alerted ? '#DC2626' : tapColor()"
                  >
                    {{ concentrator().alerted ? 'gpp_maybe' : 'hub' }}
                  </span>
                </div>
                <div class="min-w-0">
                  <h2 class="tap-h3">Estado del concentrador maestro</h2>
                  <p class="text-[11.5px] text-slate-500 mt-0.5 truncate">
                    Redundancia THM · {{ backup().length }} sensores con lectura física
                  </p>
                </div>
              </div>
              <span
                class="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-widest"
                [style.background]="concentrator().alerted ? '#FEF2F2' : '#F0FDF4'"
                [style.color]="concentrator().alerted ? '#B91C1C' : '#15803D'"
                [style.border-color]="
                  concentrator().alerted ? 'rgba(239,68,68,0.30)' : 'rgba(34,197,94,0.30)'
                "
              >
                <span
                  class="h-2 w-2 rounded-full"
                  [style.background]="concentrator().alerted ? '#EF4444' : '#22C55E'"
                ></span>
                {{ concentrator().alerted ? 'EN ALERTA' : 'OK' }}
              </span>
            </div>

            <!-- KPIs backup -->
            <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div class="kpi-card">
                <div class="kpi-label">SENSORES BACKUP</div>
                <div class="kpi-value" [style.color]="tapColor()">{{ backupStats().count }}</div>
                <div class="kpi-sub">canal redundante TAP 1</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">TEMP PROMEDIO</div>
                <div class="kpi-value text-slate-800">
                  {{ backupStats().avgT }}<span class="kpi-unit">°C</span>
                </div>
                <div class="kpi-sub">lectura redundante</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">HUMEDAD PROM.</div>
                <div class="kpi-value text-slate-800">
                  {{ backupStats().avgH }}<span class="kpi-unit">%</span>
                </div>
                <div class="kpi-sub">HR promedio</div>
              </div>
              <div
                class="kpi-card"
                [style.border-color]="backupStats().alerts > 0 ? 'rgba(239,68,68,0.30)' : '#E2E8F0'"
              >
                <div class="kpi-label">ALERTAS FÍSICAS</div>
                <div
                  class="kpi-value"
                  [style.color]="backupStats().alerts > 0 ? '#DC2626' : '#15803D'"
                >
                  {{ backupStats().alerts }}
                </div>
                <div class="kpi-sub">
                  {{ backupStats().alerts > 0 ? 'contactos secos activos' : 'sin alertas físicas' }}
                </div>
              </div>
            </div>

            <!-- Grid sensores backup -->
            <div class="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              @for (b of backup(); track b.id) {
                <div
                  class="sensor-card flex flex-col gap-3"
                  [class.sensor-card--alert]="b.alertaFisica"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="sensor-id-chip">{{ b.id }}</span>
                        @if (b.alertaFisica) {
                          <span class="sensor-alert-chip">ALERTA FÍSICA</span>
                        }
                      </div>
                      <div class="sensor-area mt-1.5 truncate">{{ b.area }}</div>
                    </div>
                    <div
                      class="h-2.5 w-2.5 shrink-0 rounded-full"
                      [style.background]="tempColor(b.t)"
                      [style.box-shadow]="
                        b.alertaFisica ? '0 0 0 4px rgba(239,68,68,0.20)' : 'none'
                      "
                    ></div>
                  </div>
                  <div class="flex items-baseline gap-3">
                    <div>
                      <div
                        class="sensor-metric-val"
                        [style.color]="b.alertaFisica ? '#B91C1C' : '#1E293B'"
                      >
                        {{ fmtTemp(b.t) }}
                      </div>
                      <div class="sensor-metric-lbl">T° respaldo</div>
                    </div>
                    <div>
                      <div class="sensor-metric-val text-slate-700">{{ fmtHum(b.h) }}</div>
                      <div class="sensor-metric-lbl">HR respaldo</div>
                    </div>
                  </div>
                  <svg viewBox="0 0 120 32" class="h-8 w-full">
                    <path
                      [attr.d]="sparkPath(b.hist)"
                      fill="none"
                      [attr.stroke]="tempColor(b.t)"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
              }
              @if (backup().length === 0) {
                <div
                  class="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center"
                >
                  <span class="material-symbols-outlined text-[28px] text-slate-300"
                    >sensors_off</span
                  >
                  <div class="mt-2 text-[13px] font-semibold text-slate-500">
                    Sin lectura redundante disponible
                  </div>
                </div>
              }
            </div>

            <!-- Histórico chart backup -->
            @if (backup().length > 0) {
              <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div class="mb-3 flex items-center justify-between">
                  <div>
                    <h3 class="tap-h3">Histórico de temperatura (canal redundante)</h3>
                    <p class="mt-0.5 text-[11.5px] text-slate-500">
                      Últimas 24 lecturas por sensor desde TAP 1
                    </p>
                  </div>
                </div>
                <div class="h-[260px]">
                  <canvas #chartCanvas></canvas>
                </div>
              </div>
            }
          } @else {
            <!-- KPIs -->
            <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div class="kpi-card">
                <div class="kpi-label">SENSORES</div>
                <div class="kpi-value" [style.color]="tapColor()">{{ stats().count }}</div>
                <div class="kpi-sub">activos en {{ tapId() }}</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">TEMP PROMEDIO</div>
                <div class="kpi-value text-slate-800">
                  {{ stats().avgT }}<span class="kpi-unit">°C</span>
                </div>
                <div class="kpi-sub">últimos {{ stats().count }} sensores</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">HUMEDAD PROM.</div>
                <div class="kpi-value text-slate-800">
                  {{ stats().avgH }}<span class="kpi-unit">%</span>
                </div>
                <div class="kpi-sub">HR media del TAP</div>
              </div>
              <div
                class="kpi-card"
                [style.border-color]="stats().alerts > 0 ? 'rgba(239,68,68,0.30)' : '#E2E8F0'"
              >
                <div class="kpi-label">ALERTAS</div>
                <div class="kpi-value" [style.color]="stats().alerts > 0 ? '#DC2626' : '#15803D'">
                  {{ stats().alerts }}
                </div>
                <div class="kpi-sub">
                  {{ stats().alerts > 0 ? 'sensores fuera de rango' : 'todos en rango' }}
                </div>
              </div>
            </div>

            <!-- Grid sensores -->
            <div class="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              @for (s of sensors(); track s.id) {
                <div class="sensor-card flex flex-col gap-3" [class.sensor-card--alert]="s.alerted">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="sensor-id-chip">{{ s.id }}</span>
                        @if (s.alerted) {
                          <span class="sensor-alert-chip">ALERTA</span>
                        }
                      </div>
                      <div class="sensor-area mt-1.5 truncate">{{ s.area }}</div>
                    </div>
                    <div
                      class="h-2.5 w-2.5 shrink-0 rounded-full"
                      [style.background]="tempColor(s.t)"
                      [style.box-shadow]="s.alerted ? '0 0 0 4px rgba(239,68,68,0.20)' : 'none'"
                    ></div>
                  </div>
                  <div class="flex items-baseline gap-3">
                    <div>
                      <div
                        class="sensor-metric-val"
                        [style.color]="s.alerted ? '#B91C1C' : '#1E293B'"
                      >
                        {{ fmtTemp(s.t) }}
                      </div>
                      <div class="sensor-metric-lbl">temperatura</div>
                    </div>
                    <div>
                      <div class="sensor-metric-val text-slate-700">{{ fmtHum(s.h) }}</div>
                      <div class="sensor-metric-lbl">humedad</div>
                    </div>
                  </div>
                  <svg viewBox="0 0 120 32" class="h-8 w-full">
                    <path
                      [attr.d]="sparkPath(s.hist)"
                      fill="none"
                      [attr.stroke]="tempColor(s.t)"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </div>
              }
              @if (sensors().length === 0) {
                <div
                  class="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white py-10 text-center"
                >
                  <span class="material-symbols-outlined text-[28px] text-slate-300"
                    >sensors_off</span
                  >
                  <div class="mt-2 text-[13px] font-semibold text-slate-500">
                    Sin sensores en {{ tapId() }}
                  </div>
                </div>
              }
            </div>

            <!-- Histórico chart -->
            @if (sensors().length > 0) {
              <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div class="mb-3 flex items-center justify-between">
                  <div>
                    <h3 class="tap-h3">Histórico de temperatura</h3>
                    <p class="mt-0.5 text-[11.5px] text-slate-500">
                      Últimas 24 lecturas por sensor
                    </p>
                  </div>
                </div>
                <div class="h-[260px]">
                  <canvas #chartCanvas></canvas>
                </div>
              </div>
            }
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
      .tap-h2 {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 18px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .tap-h3 {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .tap-tabs-bar {
        background: #ffffff;
        border-bottom: 1px solid #e2e8f0;
        padding: 0 20px;
      }
      .tap-tab-btn {
        padding: 12px 14px;
        font-size: 13px;
        font-weight: 500;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        color: #64748b;
        transition:
          color 0.12s ease,
          border-color 0.12s ease;
      }
      .tap-tab-btn--active {
        color: #0284c7;
        border-bottom-color: #0284c7;
      }
      .kpi-card {
        border-radius: 12px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        padding: 14px 16px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .kpi-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #94a3b8;
      }
      .kpi-value {
        font-family: 'JetBrains Mono', monospace;
        font-size: 24px;
        font-weight: 600;
        line-height: 1.1;
        margin-top: 4px;
      }
      .kpi-unit {
        font-size: 12px;
        color: #64748b;
        margin-left: 2px;
      }
      .kpi-sub {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 4px;
      }
      .sensor-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px 16px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
      }
      .sensor-card--alert {
        border-color: rgba(239, 68, 68, 0.3);
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.04), #ffffff 70%);
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
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.25);
        color: #b91c1c;
        border-radius: 4px;
        padding: 1px 5px;
      }
      .sensor-area {
        font-size: 13px;
        color: #1e293b;
      }
      .sensor-metric-val {
        font-family: 'JetBrains Mono', monospace;
        font-size: 18px;
        font-weight: 600;
        line-height: 1;
      }
      .sensor-metric-lbl {
        font-size: 10.5px;
        color: #94a3b8;
        margin-top: 3px;
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
      const match = TAPS.find((t) => t === decoded || t.replace(' ', '-') === decoded);
      if (match) return match;
    }
    const site = this.siteRecord();
    if (site) {
      const desc = (site.descripcion || '').toUpperCase().replace(/-/g, ' ').trim();
      const matchFromSite = TAPS.find((t) => desc.includes(t));
      if (matchFromSite) return matchFromSite;
    }
    return TAPS[0];
  });

  readonly tapColor = computed(() => TAP_COLORS[this.tapId()]);
  readonly isConcentrator = computed(() => this.tapId() === 'TAP 1');

  readonly siteName = computed(() => this.siteRecord()?.descripcion || 'Sitio');

  private readonly allSensors = toSignal(this.service.sensors$, {
    initialValue: [] as Sensor[],
  });
  readonly sensors = computed(() => this.allSensors().filter((s) => s.tap === this.tapId()));

  readonly backup = toSignal(this.service.backup$, {
    initialValue: [] as SensorBackup[],
  });

  readonly concentrator = toSignal(this.service.concentrator$, {
    initialValue: { alerted: false, lastSeen: null } as ConcentratorState,
  });

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

  readonly backupStats = computed(() => {
    const list = this.backup();
    if (list.length === 0) return { count: 0, avgT: '—', avgH: 0, alerts: 0 };
    const ts = list.map((s) => s.t);
    const hs = list.map((s) => s.h);
    return {
      count: list.length,
      avgT: (ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1),
      avgH: Math.round(hs.reduce((a, b) => a + b, 0) / hs.length),
      alerts: list.filter((s) => s.alertaFisica).length,
    };
  });

  private chart: Chart | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const currentTab = this.tab();
      if (currentTab !== 'resumen') {
        this.destroyChart();
        return;
      }
      const list = this.isConcentrator()
        ? this.backup().map((b) => ({ id: b.id, hist: b.hist, t: b.t }))
        : this.sensors().map((s) => ({ id: s.id, hist: s.hist, t: s.t }));
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
      const list = this.isConcentrator()
        ? this.backup().map((b) => ({ id: b.id, hist: b.hist, t: b.t }))
        : this.sensors().map((s) => ({ id: s.id, hist: s.hist, t: s.t }));
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
    if (!hist || hist.length === 0) return '';
    const min = Math.min(...hist);
    const max = Math.max(...hist);
    const range = max - min || 1;
    const stepX = 120 / Math.max(hist.length - 1, 1);
    const pad = 2;
    return hist
      .map((v, i) => {
        const x = i * stepX;
        const y = pad + (1 - (v - min) / range) * (32 - pad * 2);
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
