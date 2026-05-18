import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { VentisquerosFloorMapComponent } from './ventisqueros-floor-map';
import {
  AlertMode,
  MetricKey,
  Sensor,
  TAPS,
  TAP_COLORS,
  TapKey,
  buildLiveData,
  fmtHum,
  fmtTemp,
  humColor,
  tempColor,
} from './ventisqueros-data';

interface KpiDef {
  label: string;
  icon: string;
  value: string;
  unit: string;
  sub: string;
  accent: string;
  accentBg: string;
  highlight: boolean;
}

type TabKey = 'general' | 'taps' | 'eventos' | 'contacts';

interface SubTab {
  key: TabKey;
  icon: string;
  label: string;
  badge?: number;
}

interface TapAggregate {
  tap: TapKey;
  color: string;
  count: number;
  alerts: number;
  avgT: string;
  avgH: number;
  minT: string;
  maxT: string;
  sensors: Sensor[];
}

interface MetricOption {
  v: MetricKey;
  icon: string;
  label: string;
}

@Component({
  selector: 'app-ventisqueros',
  standalone: true,
  imports: [CommonModule, RouterLink, VentisquerosFloorMapComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vs-page flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Site header -->
      <div class="vs-site-header flex flex-wrap items-center gap-3 px-5 py-2.5">
        <div class="vs-module-icon flex h-[38px] w-[38px] shrink-0 items-center justify-center">
          <span class="material-symbols-outlined text-[18px] text-[#6366F1]">factory</span>
        </div>
        <div>
          <div class="vs-site-title">Ventisqueros · Planta Castro</div>
          <div class="vs-site-subtitle">
            Variables de Proceso · {{ sensors().length }} sensores THM activos
          </div>
        </div>
        <div class="ml-3 flex gap-1.5">
          <div class="vs-chip-live flex items-center gap-1">
            <span class="vs-chip-live-dot"></span>
            En vivo
          </div>
          <div class="vs-chip-time flex items-center gap-1">
            <span class="material-symbols-outlined text-[10px]">schedule</span>
            {{ nowLabel() }}
          </div>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          <span class="vs-range-label">Desde</span>
          <div class="vs-range-chip flex items-center gap-[5px]">
            <span class="material-symbols-outlined text-[12px]">calendar_today</span>
            {{ rangeFrom }}
          </div>
          <span class="vs-range-label">Hasta</span>
          <div class="vs-range-chip flex items-center gap-[5px]">
            <span class="material-symbols-outlined text-[12px]">calendar_today</span>
            {{ rangeTo }}
          </div>
          <button class="vs-apply-btn">Aplicar</button>
        </div>
      </div>

      <!-- Sub-tabs -->
      <div class="vs-tabs-bar flex shrink-0 items-center gap-0">
        @for (t of subTabs(); track t.key) {
          <button
            class="vs-tab-btn flex items-center gap-1.5"
            [class.vs-tab-btn--active]="activeTab() === t.key"
            (click)="activeTab.set(t.key)"
          >
            <span class="material-symbols-outlined text-[13px]">{{ t.icon }}</span>
            {{ t.label }}
            @if (t.badge) {
              <span class="vs-tab-badge">{{ t.badge }}</span>
            }
          </button>
        }
        <div class="flex-1"></div>
        <div class="flex items-center gap-2">
          <span class="vs-live-indicator">
            <span class="vs-live-indicator-dot"></span>
            En vivo · hace 0:32
          </span>
        </div>
      </div>

      <!-- Scrollable content -->
      <div class="vs-content min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        @if (activeTab() === 'general') {
          <!-- Title strip -->
          <div class="mb-3 flex flex-wrap items-end justify-between gap-3.5">
            <div>
              <div class="vs-h1">Monitoreo de Cámaras</div>
              <div class="vs-h1-sub">
                Temperatura, humedad relativa y alertas térmicas en vivo
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="vs-metric-toggle flex gap-[2px]">
                @for (o of metricOptions; track o.v) {
                  <button
                    class="vs-metric-btn flex items-center gap-1.5"
                    [class.vs-metric-btn--active]="metric() === o.v"
                    (click)="metric.set(o.v)"
                  >
                    <span class="material-symbols-outlined text-[13px]">{{ o.icon }}</span>
                    {{ o.label }}
                  </button>
                }
              </div>
              <button class="vs-ghost-btn inline-flex items-center gap-[5px]">
                <span class="material-symbols-outlined text-[13px]">download</span>
                Exportar
              </button>
            </div>
          </div>

          <!-- Alert banner -->
          @if (alerts().length) {
            <div class="mb-3">
              <div class="vs-alert-banner relative flex items-center gap-3.5 overflow-hidden">
                <div class="vs-alert-icon relative shrink-0">
                  <div class="vs-alert-icon-pulse"></div>
                  <div class="vs-alert-icon-core flex items-center justify-center text-white">
                    <span class="material-symbols-outlined text-[10px]">warning</span>
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <div class="vs-alert-title">
                    {{ alerts().length }}
                    {{ alerts().length === 1 ? 'alerta activa' : 'alertas activas' }}
                  </div>
                  <div class="vs-alert-body">
                    Variables fuera de rango detectadas en
                    @for (a of alertSnippet(); track a.id; let last = $last) {
                      <button class="vs-alert-link" (click)="selectedId.set(a.id)">
                        {{ a.area }} ({{ a.id }})</button
                      >{{ last ? '' : ', ' }}
                    }
                    @if (extraAlerts() > 0) {
                      y {{ extraAlerts() }} más.
                    }
                  </div>
                </div>
                <div class="flex gap-1.5">
                  @for (a of alerts().slice(0, 4); track a.id) {
                    <span class="vs-alert-chip">{{ a.id }}</span>
                  }
                </div>
                <button class="vs-alert-btn flex items-center gap-1.5">
                  <span class="material-symbols-outlined text-[11px]">notifications_active</span>
                  Ver eventos
                </button>
              </div>
            </div>
          }

          <!-- KPI strip -->
          <div class="vs-kpi-grid mb-3.5 grid gap-2.5">
            @for (k of kpis(); track k.label) {
              <div
                class="vs-kpi-card relative overflow-hidden"
                [class.vs-kpi-card--highlight]="k.highlight"
                [style.background]="
                  k.highlight
                    ? 'linear-gradient(135deg, ' + k.accentBg + ' 0%, #FFFFFF 75%)'
                    : '#FFFFFF'
                "
                [style.border-color]="k.highlight ? k.accent + '55' : '#E2E8F0'"
                [style.box-shadow]="
                  k.highlight
                    ? '0 0 0 1px ' + k.accent + '1A, 0 2px 10px rgba(15,23,42,0.05)'
                    : '0 1px 2px rgba(15,23,42,0.04)'
                "
              >
                <div class="flex items-center gap-1.5">
                  <div
                    class="vs-kpi-icon flex shrink-0 items-center justify-center"
                    [style.background]="k.accentBg"
                    [style.border-color]="k.accent + '33'"
                  >
                    <span class="material-symbols-outlined text-[12px]" [style.color]="k.accent">{{
                      k.icon
                    }}</span>
                  </div>
                  <div class="vs-kpi-label truncate">{{ k.label }}</div>
                </div>
                <div class="mt-[2px] flex items-baseline gap-1">
                  <span class="vs-kpi-value" [style.color]="k.accent">{{ k.value }}</span>
                  @if (k.unit) {
                    <span class="vs-kpi-unit">{{ k.unit }}</span>
                  }
                </div>
                @if (k.sub) {
                  <div class="vs-kpi-sub">{{ k.sub }}</div>
                }
              </div>
            }
          </div>

          <!-- Map + sensor rail -->
          <div class="vs-map-grid grid gap-3">
            <app-ventisqueros-floor-map
              [sensors]="sensors()"
              [metric]="metric()"
              [selectedId]="selectedId()"
              [hiddenSensors]="hiddenSensors()"
              [hasAlerts]="alerts().length > 0"
              (selectSensor)="selectedId.set($event)"
            ></app-ventisqueros-floor-map>

            <!-- Sensor rail -->
            <div class="vs-rail flex h-full min-w-0 shrink-0 flex-col gap-3 overflow-hidden">
              @if (focusSensor(); as focus) {
                <div class="vs-focus-card shrink-0">
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="vs-id-chip">{{ focus.id }}</span>
                        <span class="vs-tap-chip">{{ focus.tap }}</span>
                        @if (focus.alerted) {
                          <span class="vs-alert-mini-chip">EN ALERTA</span>
                        }
                      </div>
                      <div class="vs-focus-area">{{ focus.area }}</div>
                    </div>
                    <button class="vs-focus-open-btn flex">
                      <span class="material-symbols-outlined text-[13px]">open_in_new</span>
                    </button>
                  </div>

                  <div class="mt-3 grid grid-cols-2 gap-2.5">
                    <div class="vs-stat-card">
                      <div class="vs-stat-label">Temperatura</div>
                      <div class="mt-1 flex items-baseline gap-[3px]">
                        <span
                          class="vs-stat-value"
                          [style.color]="focus.alerted ? '#B91C1C' : '#1E293B'"
                          >{{ focus.t.toFixed(1) }}</span
                        >
                        <span class="vs-stat-unit">°C</span>
                      </div>
                      <div class="mt-1.5">
                        <svg
                          [attr.width]="120"
                          [attr.height]="28"
                          class="vs-spark-svg"
                        >
                          <defs>
                            <linearGradient
                              [attr.id]="'sparkFill-' + focus.id"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="0%"
                                [attr.stop-color]="sparkColor(focus)"
                                stop-opacity="0.28"
                              />
                              <stop
                                offset="100%"
                                [attr.stop-color]="sparkColor(focus)"
                                stop-opacity="0"
                              />
                            </linearGradient>
                          </defs>
                          <path
                            [attr.d]="sparkFill(focus, 120, 28)"
                            [attr.fill]="'url(#sparkFill-' + focus.id + ')'"
                          />
                          <path
                            [attr.d]="sparkPath(focus, 120, 28)"
                            fill="none"
                            [attr.stroke]="sparkColor(focus)"
                            stroke-width="1.5"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                          <circle
                            [attr.cx]="sparkLast(focus, 120, 28).x"
                            [attr.cy]="sparkLast(focus, 120, 28).y"
                            r="2.2"
                            fill="#fff"
                            [attr.stroke]="sparkColor(focus)"
                            stroke-width="1.2"
                          />
                        </svg>
                      </div>
                    </div>
                    <div class="vs-stat-card">
                      <div class="vs-stat-label">Humedad</div>
                      <div class="mt-1 flex items-baseline gap-[3px]">
                        <span class="vs-stat-value text-[#1E293B]">{{ focus.h }}</span>
                        <span class="vs-stat-unit">%</span>
                      </div>
                      <div class="vs-h-bar-track">
                        <div
                          class="vs-h-bar-fill"
                          [style.width]="focus.h + '%'"
                          [style.background]="humBarGradient(focus.h)"
                        ></div>
                      </div>
                      <div class="vs-h-bar-scale mt-1 flex justify-between">
                        <span>40%</span><span>100%</span>
                      </div>
                    </div>
                  </div>

                  <div class="vs-focus-footer mt-2.5 flex items-center justify-between pt-2.5">
                    <span class="flex items-center gap-1">
                      <span class="material-symbols-outlined text-[11px]">schedule</span>
                      hace 32 s
                    </span>
                    <span class="vs-focus-base">Base: {{ fmtTemp(focus.baseT) }}</span>
                  </div>
                </div>
              }

              <div class="vs-tap-panel flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                <div class="vs-tap-panel-head flex items-center justify-between">
                  <div class="vs-tap-panel-title">TAP</div>
                  <span class="vs-tap-panel-meta">
                    {{ sensors().length }} sensores · {{ taps.length }} TAP
                  </span>
                </div>
                <div class="flex-1 overflow-y-auto overflow-x-hidden pr-1">
                  @for (tap of taps; track tap) {
                    @if ((groupedSensors()[tap] || []).length > 0) {
                      <div class="mb-2">
                        <div class="vs-tap-group-head flex items-center justify-between">
                          <span>{{ tap }}</span>
                          <span class="vs-tap-group-count">
                            {{ groupedSensors()[tap]?.length || 0 }}
                          </span>
                        </div>
                        <div class="flex flex-col gap-[2px]">
                          @for (s of groupedSensors()[tap] || []; track s.id) {
                            <div
                              class="vs-sensor-row grid cursor-pointer items-center gap-2.5"
                              [style.background]="rowBg(s)"
                              [style.border]="rowBorder(s)"
                              (click)="selectedId.set(s.id)"
                            >
                              <span
                                class="vs-sensor-dot"
                                [style.background]="
                                  metric() === 'H' ? humColor(s.h) : tempColor(s.t)
                                "
                                [style.box-shadow]="
                                  s.alerted ? '0 0 0 3px rgba(239,68,68,0.25)' : 'none'
                                "
                              ></span>
                              <div class="min-w-0">
                                <div class="flex items-center gap-1.5">
                                  <span class="vs-id-chip">{{ s.id }}</span>
                                  @if (s.alerted) {
                                    <span class="vs-sensor-alert-chip inline-flex items-center gap-[3px]">
                                      <span class="vs-sensor-alert-dot"></span>
                                      ALERTA
                                    </span>
                                  }
                                </div>
                                <div class="vs-sensor-area truncate">{{ s.area }}</div>
                              </div>
                              <div class="text-right">
                                <div
                                  class="vs-sensor-temp"
                                  [style.color]="s.alerted ? '#B91C1C' : '#1E293B'"
                                >
                                  {{ fmtTemp(s.t) }}
                                </div>
                                <div class="vs-sensor-hum">{{ fmtHum(s.h) }}</div>
                              </div>
                            </div>
                          }
                        </div>
                      </div>
                    }
                  }
                </div>
              </div>
            </div>
          </div>

          <!-- Sensor visibility panel -->
          <div class="vs-visibility mt-3.5">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div class="vs-visibility-title">Visibilidad en plano</div>
                <div class="vs-visibility-sub">
                  Oculta sensores individuales o grupos completos (TAP) sin perder su lectura
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="vs-visibility-count">
                  {{ sensors().length - hiddenSensors().size }}/{{ sensors().length }} visibles
                </span>
                <button
                  (click)="showAll()"
                  [disabled]="hiddenSensors().size === 0"
                  class="vs-visibility-btn flex items-center gap-1"
                  [style.opacity]="hiddenSensors().size === 0 ? 0.5 : 1"
                >
                  <span class="material-symbols-outlined text-[12px]">visibility</span>
                  Mostrar todos
                </button>
                <button
                  (click)="hideAll()"
                  [disabled]="hiddenSensors().size === sensors().length"
                  class="vs-visibility-btn flex items-center gap-1"
                  [style.opacity]="hiddenSensors().size === sensors().length ? 0.5 : 1"
                >
                  <span class="material-symbols-outlined text-[12px]">visibility_off</span>
                  Ocultar todos
                </button>
              </div>
            </div>

            <div class="vs-tap-card-grid grid gap-2.5">
              @for (tap of taps; track tap) {
                @if ((groupedSensors()[tap] || []).length > 0) {
                  <div class="vs-tap-card-wrap">
                    <button (click)="toggleTap(tap)" class="vs-tap-card-head flex w-full items-center justify-between gap-2">
                      <div class="flex items-center gap-2">
                        <span
                          class="vs-tap-color-dot"
                          [style.background]="tapColors[tap]"
                          [style.box-shadow]="'0 0 0 3px ' + tapColors[tap] + '22'"
                        ></span>
                        <span class="vs-tap-card-title">{{ tap }}</span>
                        <span class="vs-tap-card-meta">
                          {{ (groupedSensors()[tap] || []).length }} sensores
                        </span>
                      </div>
                      <span class="vs-tap-card-toggle flex items-center gap-1">
                        <span
                          class="material-symbols-outlined text-[16px]"
                          [style.color]="
                            isTapHidden(tap)
                              ? '#94A3B8'
                              : isTapPartiallyHidden(tap)
                                ? '#F59E0B'
                                : '#0DAFBD'
                          "
                        >
                          {{
                            isTapHidden(tap)
                              ? 'visibility_off'
                              : isTapPartiallyHidden(tap)
                                ? 'visibility'
                                : 'visibility'
                          }}
                        </span>
                      </span>
                    </button>
                    <div class="vs-tap-card-body flex flex-col">
                      @for (s of groupedSensors()[tap] || []; track s.id) {
                        <label
                          class="vs-row flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
                          [style.opacity]="isSensorHidden(s.id) ? 0.55 : 1"
                        >
                          <input
                            type="checkbox"
                            class="vs-check"
                            [checked]="!isSensorHidden(s.id)"
                            (change)="toggleSensor(s.id)"
                          />
                          <span class="vs-id-chip">{{ s.id }}</span>
                          <span class="vs-check-area flex-1 truncate">{{ s.area }}</span>
                          @if (s.alerted) {
                            <span class="vs-check-alert-dot"></span>
                          }
                          <span class="vs-check-temp">{{ fmtTemp(s.t) }}</span>
                        </label>
                      }
                    </div>
                  </div>
                }
              }
            </div>
          </div>
        }

        @if (activeTab() === 'taps') {
          <!-- TAPS view: compact, site-card pattern, navegable -->
          <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="vs-h1 text-slate-800">Concentradores TAP</h2>
              <p class="mt-1 text-[12px] text-slate-500">
                {{ taps.length }} instalaciones · {{ sensors().length }} sensores THM · click para
                ver detalle
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="activeTab.set('general')"
              >
                <span class="material-symbols-outlined text-[14px]">map</span>
                Ver plano
              </button>
            </div>
          </div>

          <div class="vs-taps-grid grid gap-3">
            @for (t of tapAggregates(); track t.tap) {
              <button
                type="button"
                [routerLink]="['/ventisqueros/tap', t.tap.replace(' ', '-')]"
                class="vs-tap-summary group flex w-full cursor-pointer flex-col rounded-2xl border bg-white px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5"
                [style.border-color]="t.alerts > 0 ? 'rgba(239,68,68,0.30)' : '#E2E8F0'"
                [style.box-shadow]="
                  t.alerts > 0
                    ? '0 6px 18px rgba(239,68,68,0.10)'
                    : '0 6px 18px rgba(15,23,42,0.05)'
                "
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex min-w-0 items-start gap-3">
                    <div
                      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      [style.background]="t.color + '1A'"
                      [style.border]="'1px solid ' + t.color + '40'"
                    >
                      <span class="material-symbols-outlined text-[18px]" [style.color]="t.color">{{
                        t.count === 0 ? 'hub' : 'memory'
                      }}</span>
                    </div>
                    <div class="min-w-0">
                      <h3 class="vs-tap-summary-title truncate text-slate-800">{{ t.tap }}</h3>
                      <p class="truncate text-[11px] text-slate-400">
                        @if (t.count === 0) {
                          Concentrador maestro
                        } @else {
                          {{ t.count }} {{ t.count === 1 ? 'sensor' : 'sensores' }} THM
                        }
                      </p>
                    </div>
                  </div>
                  <span
                    class="material-symbols-outlined text-base text-slate-300 transition-all group-hover:translate-x-0.5"
                    [style.color]="t.color"
                    >chevron_right</span
                  >
                </div>

                <div class="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
                  <div>
                    <p class="vs-stat-mini-label">Prom.</p>
                    <p class="vs-stat-mini-val text-slate-800">
                      {{ t.avgT }}<span class="text-[10px] text-slate-500">°C</span>
                    </p>
                  </div>
                  <div>
                    <p class="vs-stat-mini-label">Mín</p>
                    <p class="vs-stat-mini-val text-primary">
                      {{ t.minT }}<span class="text-[10px] text-slate-500">°C</span>
                    </p>
                  </div>
                  <div>
                    <p class="vs-stat-mini-label">Máx</p>
                    <p
                      class="vs-stat-mini-val"
                      [style.color]="t.alerts > 0 ? '#EF4444' : '#475569'"
                    >
                      {{ t.maxT }}<span class="text-[10px] text-slate-500">°C</span>
                    </p>
                  </div>
                </div>

                <div class="mt-3 flex items-center justify-between">
                  @if (t.count === 0) {
                    <span
                      class="inline-flex items-center gap-1.5 text-[11px] font-medium"
                      [style.color]="t.color"
                    >
                      <span class="material-symbols-outlined text-[12px]">hub</span>
                      Hub · {{ sensors().length }} sensores
                    </span>
                  } @else if (t.alerts > 0) {
                    <span
                      class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-rose-600"
                    >
                      <span class="vs-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-rose-500"></span>
                      {{ t.alerts }} en alerta
                    </span>
                  } @else {
                    <span
                      class="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600"
                    >
                      <span class="material-symbols-outlined text-[12px]">sensors</span>
                      Transmisión activa
                    </span>
                  }
                  @if (t.count > 0) {
                    <span class="vs-tap-summary-hr text-slate-400">HR {{ t.avgH }}%</span>
                  }
                </div>
              </button>
            }
          </div>
        }

        @if (activeTab() === 'eventos') {
          <div class="vs-placeholder flex items-center justify-center">
            Eventos — vista por implementar
          </div>
        }

        @if (activeTab() === 'contacts') {
          <div class="vs-placeholder flex items-center justify-center">
            Contactos — vista por implementar
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      @keyframes vsPulse {
        0% {
          transform: scale(0.85);
          opacity: 1;
        }
        100% {
          transform: scale(2.2);
          opacity: 0;
        }
      }

      :host {
        display: block;
        height: 100%;
      }

      /* Layout shell */
      .vs-page {
        background: #f0f2f5;
      }
      .vs-site-header {
        border-top: 1px solid #e2e8f0;
        border-bottom: 2px solid var(--color-primary);
        background: #f8fafc;
      }
      .vs-module-icon {
        border-radius: 9px;
        background: rgba(99, 102, 241, 0.1);
        border: 1px solid rgba(99, 102, 241, 0.25);
      }
      .vs-site-title {
        font-family: var(--font-josefin);
        font-size: 16px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
        line-height: 1.1;
      }
      .vs-site-subtitle {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .vs-chip-live {
        background: #f0fdf4;
        border: 1px solid #bbf7d0;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 11px;
        font-weight: 500;
        color: #16a34a;
      }
      .vs-chip-live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #22c55e;
        display: inline-block;
      }
      .vs-chip-time {
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 11px;
        color: #2563eb;
      }
      .vs-range-label {
        font-size: 12px;
        color: #94a3b8;
      }
      .vs-range-chip {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 12px;
        color: #475569;
      }
      .vs-apply-btn {
        background: var(--color-primary);
        border: none;
        border-radius: 4px;
        padding: 5px 14px;
        font-size: 11px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
        font-family: var(--font-josefin);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        transition: background 0.12s ease;
      }
      .vs-apply-btn:hover {
        background: var(--color-primary-container);
      }

      /* Sub-tabs */
      .vs-tabs-bar {
        background: #ffffff;
        border-bottom: 1px solid #e2e8f0;
        padding: 0 20px;
      }
      .vs-tab-btn {
        padding: 12px 14px;
        font-size: 13px;
        font-weight: 500;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        cursor: pointer;
        font-family: var(--font-body);
        color: #64748b;
        transition: color 0.12s ease, border-color 0.12s ease;
      }
      .vs-tab-btn--active {
        color: var(--color-primary-container);
        border-bottom-color: var(--color-primary);
      }
      .vs-tab-badge {
        margin-left: 4px;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        background: #ef4444;
        color: #fff;
        border-radius: 999px;
        padding: 1px 6px;
      }
      .vs-live-indicator {
        font-size: 11px;
        color: #94a3b8;
        font-family: var(--font-mono);
      }
      .vs-live-indicator-dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #22c55e;
        margin-right: 5px;
        vertical-align: middle;
      }

      /* Content */
      .vs-content {
        padding: 14px 18px 18px;
      }
      .vs-h1 {
        font-family: var(--font-josefin);
        font-size: 22px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
        line-height: 1.1;
      }
      .vs-h1-sub {
        font-size: 12px;
        color: #64748b;
        margin-top: 4px;
      }

      /* Metric toggle */
      .vs-metric-toggle {
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 3px;
      }
      .vs-metric-btn {
        padding: 6px 12px;
        border: none;
        border-radius: 7px;
        font-family: var(--font-body);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.12s;
        background: transparent;
        color: #64748b;
        font-weight: 500;
      }
      .vs-metric-btn--active {
        background: #ffffff;
        color: var(--color-primary-container);
        font-weight: 600;
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.1);
      }
      .vs-ghost-btn {
        padding: 7px 12px;
        border-radius: 8px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        font-family: var(--font-body);
        font-size: 12px;
        color: #475569;
        cursor: pointer;
        transition: background 0.12s ease;
      }
      .vs-ghost-btn:hover {
        background: #f8fafc;
      }

      /* Alert banner */
      .vs-alert-banner {
        background: linear-gradient(
          90deg,
          rgba(239, 68, 68, 0.1) 0%,
          rgba(239, 68, 68, 0.04) 80%
        );
        border: 1px solid rgba(239, 68, 68, 0.3);
        border-radius: 12px;
        padding: 10px 14px;
      }
      .vs-alert-icon {
        width: 28px;
        height: 28px;
      }
      .vs-alert-icon-pulse {
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.18);
        animation: vsPulse 1.6s ease-out infinite;
      }
      .vs-alert-icon-core {
        position: absolute;
        inset: 6px;
        border-radius: 50%;
        background: #ef4444;
      }
      .vs-alert-title {
        font-family: var(--font-josefin);
        font-size: 13px;
        font-weight: 600;
        color: #991b1b;
        letter-spacing: 0.02em;
      }
      .vs-alert-body {
        font-size: 12px;
        color: #7f1d1d;
        opacity: 0.85;
        margin-top: 1px;
      }
      .vs-alert-link {
        background: transparent;
        border: none;
        padding: 0;
        color: #7f1d1d;
        cursor: pointer;
        font-weight: 600;
        text-decoration: underline dotted;
        font-family: inherit;
        font-size: inherit;
      }
      .vs-alert-chip {
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        background: #ffffff;
        color: #b91c1c;
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 6px;
        padding: 3px 7px;
      }
      .vs-alert-btn {
        background: #ef4444;
        border: none;
        border-radius: 6px;
        padding: 6px 12px;
        color: #fff;
        font-family: var(--font-body);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.12s ease;
      }
      .vs-alert-btn:hover {
        background: #dc2626;
      }

      /* KPI strip */
      .vs-kpi-grid {
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      }
      .vs-kpi-card {
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        border: 1px solid #e2e8f0;
        background: #ffffff;
      }
      .vs-kpi-icon {
        width: 22px;
        height: 22px;
        border-radius: 6px;
        border: 1px solid transparent;
      }
      .vs-kpi-value {
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 600;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .vs-kpi-unit {
        font-family: var(--font-mono);
        font-size: 12px;
        color: #64748b;
      }
      .vs-kpi-sub {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
      }

      /* Map + rail */
      .vs-map-grid {
        grid-template-columns: minmax(0, 1fr) 320px;
        height: min(760px, calc(100vh - 360px));
        min-height: 540px;
      }
      .vs-rail {
        width: 320px;
        min-width: 320px;
      }

      /* Focus card */
      .vs-focus-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px 14px 12px;
        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
      }
      .vs-tap-chip {
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 600;
        color: var(--color-primary-container);
        background: rgba(13, 175, 189, 0.1);
        border-radius: 4px;
        padding: 2px 6px;
        letter-spacing: 0.06em;
        border: 1px solid rgba(13, 175, 189, 0.25);
      }
      .vs-alert-mini-chip {
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 600;
        color: #b91c1c;
        background: rgba(239, 68, 68, 0.1);
        border-radius: 4px;
        padding: 2px 6px;
        border: 1px solid rgba(239, 68, 68, 0.25);
        letter-spacing: 0.06em;
      }
      .vs-focus-area {
        font-family: var(--font-josefin);
        font-size: 17px;
        font-weight: 600;
        color: #1e293b;
        margin-top: 6px;
        letter-spacing: 0.02em;
      }
      .vs-focus-open-btn {
        background: none;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 4px;
        cursor: pointer;
        color: #64748b;
        transition: background 0.12s ease;
      }
      .vs-focus-open-btn:hover {
        background: #f8fafc;
      }
      .vs-stat-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px;
      }
      .vs-stat-value {
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 600;
        line-height: 1;
      }
      .vs-stat-unit {
        font-family: var(--font-mono);
        font-size: 12px;
        color: #64748b;
      }
      .vs-spark-svg {
        display: block;
        overflow: visible;
      }
      .vs-h-bar-track {
        margin-top: 8px;
        height: 6px;
        background: #e2e8f0;
        border-radius: 999px;
        overflow: hidden;
      }
      .vs-h-bar-fill {
        height: 100%;
        border-radius: 999px;
      }
      .vs-h-bar-scale {
        font-size: 9px;
        color: #94a3b8;
        font-family: var(--font-mono);
      }
      .vs-focus-footer {
        border-top: 1px dashed #e2e8f0;
        font-size: 11px;
        color: #64748b;
      }
      .vs-focus-base {
        font-family: var(--font-mono);
        font-size: 11px;
      }

      /* TAP panel (rail) */
      .vs-tap-panel {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 10px;
      }
      .vs-tap-panel-head {
        padding: 0 4px 4px;
      }
      .vs-tap-panel-title {
        font-family: var(--font-josefin);
        font-size: 12px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.04em;
      }
      .vs-tap-panel-meta {
        font-size: 10px;
        color: #94a3b8;
        font-family: var(--font-mono);
      }
      .vs-tap-group-head {
        padding: 6px 8px 4px;
        font-size: 10px;
        font-weight: 600;
        color: #94a3b8;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }
      .vs-tap-group-count {
        font-family: var(--font-mono);
        color: #cbd5e1;
      }
      .vs-sensor-row {
        grid-template-columns: 8px 1fr auto;
        padding: 8px 10px;
        border-radius: 8px;
        transition: background 0.12s, border-color 0.12s;
      }
      .vs-sensor-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .vs-sensor-alert-chip {
        border-radius: 4px;
        border: 1px solid rgba(239, 68, 68, 0.25);
        background: rgba(239, 68, 68, 0.1);
        padding: 1px 5px;
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: #b91c1c;
      }
      .vs-sensor-alert-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: #ef4444;
        animation: vsPulse 1.4s ease-out infinite;
      }
      .vs-sensor-area {
        font-family: var(--font-body);
        font-size: 12.5px;
        color: #1e293b;
        margin-top: 2px;
      }
      .vs-sensor-temp {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        line-height: 1;
      }
      .vs-sensor-hum {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: #64748b;
        margin-top: 2px;
      }

      /* Visibility panel */
      .vs-visibility {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.04);
      }
      .vs-visibility-title {
        font-family: var(--font-josefin);
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .vs-visibility-sub {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .vs-visibility-count {
        font-size: 11px;
        color: #64748b;
        font-family: var(--font-mono);
      }
      .vs-visibility-btn {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 11px;
        color: #475569;
        font-family: var(--font-body);
        cursor: pointer;
        transition: background 0.12s ease;
      }
      .vs-visibility-btn:hover:not(:disabled) {
        background: #f8fafc;
      }

      /* TAP card grid (visibility) */
      .vs-tap-card-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }
      .vs-tap-card-wrap {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        overflow: hidden;
        background: #ffffff;
      }
      .vs-tap-card-head {
        padding: 10px 12px;
        background: #f8fafc;
        border: none;
        border-bottom: 1px solid #e2e8f0;
        cursor: pointer;
        font-family: var(--font-body);
      }
      .vs-tap-color-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .vs-tap-card-title {
        font-family: var(--font-josefin);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: #1e293b;
      }
      .vs-tap-card-meta {
        font-family: var(--font-mono);
        font-size: 10px;
        color: #94a3b8;
      }
      .vs-tap-card-toggle {
        font-size: 11px;
        color: #475569;
      }
      .vs-tap-card-body {
        padding: 6px;
      }
      .vs-check {
        width: 14px;
        height: 14px;
        accent-color: var(--color-primary);
        cursor: pointer;
      }
      .vs-check-area {
        font-family: var(--font-body);
        font-size: 12px;
        color: #1e293b;
      }
      .vs-check-alert-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ef4444;
        box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25);
      }
      .vs-check-temp {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: #64748b;
      }

      /* TAPS tab grid */
      .vs-taps-grid {
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      }
      .vs-tap-summary-title {
        font-family: var(--font-josefin);
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .vs-stat-mini-label {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .vs-stat-mini-val {
        font-family: var(--font-mono);
        font-size: 14px;
        font-weight: 600;
      }
      .vs-pulse-dot {
        animation: vsPulse 1.4s ease-out infinite;
      }
      .vs-tap-summary-hr {
        font-size: 10px;
        font-family: var(--font-mono);
      }

      /* Reusable chips/labels */
      .vs-id-chip {
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 600;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 1px 5px;
        color: #475569;
      }
      .vs-kpi-label {
        font-family: var(--font-body);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .vs-stat-label {
        font-family: var(--font-body);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .vs-placeholder {
        height: 320px;
        background: #ffffff;
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
        color: #94a3b8;
        font-family: var(--font-body);
        font-size: 13px;
      }
      .vs-row:hover {
        background: #f8fafc;
      }

      @media (prefers-reduced-motion: reduce) {
        .vs-alert-icon-pulse,
        .vs-sensor-alert-dot,
        .vs-pulse-dot {
          animation: none !important;
        }
      }
    `,
  ],
})
export class VentisquerosComponent implements OnInit, OnDestroy {
  readonly alertMode = signal<AlertMode>('multi');
  readonly refreshSeed = signal(0);
  readonly metric = signal<MetricKey>('T');
  readonly selectedId = signal<string>('STH-13');
  readonly now = signal<number>(Date.now());
  readonly hiddenSensors = signal<Set<string>>(new Set<string>());
  readonly activeTab = signal<TabKey>('general');

  readonly taps = TAPS;
  readonly tapColors = TAP_COLORS;
  readonly rangeFrom = '01-05-2026';
  readonly rangeTo = '02-05-2026';

  readonly metricOptions: MetricOption[] = [
    { v: 'T', icon: 'thermostat', label: 'Temperatura' },
    { v: 'H', icon: 'water_drop', label: 'Humedad' },
    { v: 'A', icon: 'gpp_maybe', label: 'Alertas' },
  ];

  readonly sensors = computed<Sensor[]>(() => {
    // refreshSeed is read so the signal recomputes on demand
    this.refreshSeed();
    return buildLiveData(this.alertMode());
  });

  readonly alerts = computed(() => this.sensors().filter((s) => s.alerted));
  readonly alertSnippet = computed(() => this.alerts().slice(0, 2));
  readonly extraAlerts = computed(() => Math.max(0, this.alerts().length - 2));

  readonly groupedSensors = computed<Record<string, Sensor[]>>(() => {
    const out: Record<string, Sensor[]> = {};
    for (const s of this.sensors()) {
      (out[s.tap] = out[s.tap] || []).push(s);
    }
    return out;
  });

  readonly focusSensor = computed(() => this.sensors().find((s) => s.id === this.selectedId()));

  readonly stats = computed(() => {
    const ts = this.sensors().map((s) => s.t);
    const hs = this.sensors().map((s) => s.h);
    const alerts = this.alerts();
    const maxDev = this.sensors().reduce<{ sensor: Sensor | null; dev: number }>(
      (best, s) => {
        const dev = Math.abs(s.t - s.baseT);
        return dev > best.dev ? { sensor: s, dev } : best;
      },
      { sensor: null, dev: 0 },
    );
    return {
      active: this.sensors().length,
      total: this.sensors().length,
      avgT: (ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1),
      avgH: Math.round(hs.reduce((a, b) => a + b, 0) / hs.length),
      alerts,
      maxDev,
    };
  });

  readonly kpis = computed<KpiDef[]>(() => {
    const s = this.stats();
    return [
      {
        label: 'Sensores activos',
        icon: 'memory',
        value: `${s.active}`,
        unit: `/ ${s.total}`,
        sub: 'monitoreo activo',
        accent: '#0DAFBD',
        accentBg: 'rgba(13,175,189,0.08)',
        highlight: true,
      },
      {
        label: 'Temperatura prom.',
        icon: 'thermostat',
        value: s.avgT,
        unit: '°C',
        sub: 'planta completa',
        accent: '#16A34A',
        accentBg: 'rgba(22,163,74,0.08)',
        highlight: false,
      },
      {
        label: 'Humedad prom.',
        icon: 'water_drop',
        value: `${s.avgH}`,
        unit: '%',
        sub: 'planta completa',
        accent: '#2563EB',
        accentBg: 'rgba(37,99,235,0.08)',
        highlight: false,
      },
      {
        label: 'Última act.',
        icon: 'schedule',
        value: '00:32',
        unit: 's',
        sub: 'sondeo automático',
        accent: '#7C3AED',
        accentBg: 'rgba(124,58,237,0.08)',
        highlight: false,
      },
      {
        label: s.maxDev.sensor ? `Mayor desv. · ${s.maxDev.sensor.id}` : 'Mayor desv.',
        icon: 'trending_up',
        value: s.maxDev.sensor ? `±${s.maxDev.dev.toFixed(1)}` : '—',
        unit: '°C',
        sub: s.maxDev.sensor ? s.maxDev.sensor.area : 'sin desviaciones',
        accent: s.maxDev.dev > 4 ? '#EF4444' : '#F59E0B',
        accentBg: s.maxDev.dev > 4 ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
        highlight: s.maxDev.dev > 4,
      },
      {
        label: 'Desde últ. alerta',
        icon: 'verified_user',
        value: s.alerts.length > 0 ? 'AHORA' : '14h 22m',
        unit: '',
        sub: s.alerts.length > 0 ? `${s.alerts.length} en curso` : 'planta sin alertas',
        accent: s.alerts.length > 0 ? '#EF4444' : '#22C55E',
        accentBg: s.alerts.length > 0 ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
        highlight: s.alerts.length > 0,
      },
    ];
  });

  readonly subTabs = computed<SubTab[]>(() => [
    { key: 'general', icon: 'grid_view', label: 'General' },
    { key: 'taps', icon: 'dashboard', label: 'TAPS' },
    {
      key: 'eventos',
      icon: 'notifications',
      label: 'Eventos',
      badge: this.alerts().length || undefined,
    },
    { key: 'contacts', icon: 'group', label: 'Contactos' },
  ]);

  readonly tapAggregates = computed<TapAggregate[]>(() =>
    TAPS.map((tap) => {
      const sensors = this.sensors().filter((s) => s.tap === tap);
      const ts = sensors.map((s) => s.t);
      const hs = sensors.map((s) => s.h);
      return {
        tap,
        color: TAP_COLORS[tap],
        count: sensors.length,
        alerts: sensors.filter((s) => s.alerted).length,
        avgT: sensors.length ? (ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1) : '—',
        avgH: sensors.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : 0,
        minT: sensors.length ? Math.min(...ts).toFixed(1) : '—',
        maxT: sensors.length ? Math.max(...ts).toFixed(1) : '—',
        sensors,
      };
    }),
  );

  readonly nowLabel = computed(() => {
    const d = new Date(this.now());
    const day = String(d.getDate()).padStart(2, '0');
    const months = [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sep',
      'oct',
      'nov',
      'dic',
    ];
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${day} ${months[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
  });

  private intervalId: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.intervalId = setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
    }
  }

  fmtTemp = fmtTemp;
  fmtHum = fmtHum;
  tempColor = tempColor;
  humColor = humColor;

  isSensorHidden(id: string): boolean {
    return this.hiddenSensors().has(id);
  }

  toggleSensor(id: string): void {
    const next = new Set(this.hiddenSensors());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.hiddenSensors.set(next);
  }

  isTapHidden(tap: TapKey): boolean {
    const group = this.sensors().filter((s) => s.tap === tap);
    return group.length > 0 && group.every((s) => this.hiddenSensors().has(s.id));
  }

  isTapPartiallyHidden(tap: TapKey): boolean {
    const group = this.sensors().filter((s) => s.tap === tap);
    const hidden = group.filter((s) => this.hiddenSensors().has(s.id)).length;
    return hidden > 0 && hidden < group.length;
  }

  toggleTap(tap: TapKey): void {
    const group = this.sensors().filter((s) => s.tap === tap);
    const next = new Set(this.hiddenSensors());
    if (this.isTapHidden(tap)) {
      group.forEach((s) => next.delete(s.id));
    } else {
      group.forEach((s) => next.add(s.id));
    }
    this.hiddenSensors.set(next);
  }

  showAll(): void {
    this.hiddenSensors.set(new Set());
  }

  hideAll(): void {
    this.hiddenSensors.set(new Set(this.sensors().map((s) => s.id)));
  }

  rowBg(s: Sensor): string {
    if (this.selectedId() === s.id) return 'rgba(13,175,189,0.07)';
    if (s.alerted) return 'rgba(239,68,68,0.04)';
    return 'transparent';
  }

  rowBorder(s: Sensor): string {
    if (this.selectedId() === s.id) return '1px solid rgba(13,175,189,0.35)';
    if (s.alerted) return '1px solid rgba(239,68,68,0.20)';
    return '1px solid transparent';
  }

  humBarGradient(h: number): string {
    return `linear-gradient(90deg, ${humColor(40)}, ${humColor(h)})`;
  }

  sparkColor(s: Sensor): string {
    return s.alerted ? '#EF4444' : tempColor(s.t);
  }

  private sparkCoords(s: Sensor, width: number, height: number): Array<[number, number]> {
    const points = s.hist;
    if (!points || points.length === 0) return [];
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const step = width / (points.length - 1);
    return points.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2]);
  }

  sparkPath(s: Sensor, width: number, height: number): string {
    const coords = this.sparkCoords(s, width, height);
    if (!coords.length) return '';
    return 'M ' + coords.map(([x, y]) => `${x},${y}`).join(' L ');
  }

  sparkFill(s: Sensor, width: number, height: number): string {
    const coords = this.sparkCoords(s, width, height);
    if (!coords.length) return '';
    return `M 0,${height} L ${coords.map(([x, y]) => `${x},${y}`).join(' L ')} L ${width},${height} Z`;
  }

  sparkLast(s: Sensor, width: number, height: number): { x: number; y: number } {
    const coords = this.sparkCoords(s, width, height);
    if (!coords.length) return { x: 0, y: 0 };
    const [x, y] = coords[coords.length - 1];
    return { x, y };
  }
}
