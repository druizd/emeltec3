import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { VentisquerosFloorMapComponent } from './ventisqueros-floor-map';
import { VentisquerosVisibilityPanelComponent } from './ventisqueros-visibility-panel';
import { VentisquerosFocusCardComponent } from './ventisqueros-focus-card';
import type { SiteRecord } from '@emeltec/shared';
import { VentisquerosService } from './ventisqueros.service';
import {
  ConcentratorState,
  MetricKey,
  Sensor,
  TAPS,
  TAP_COLORS,
  TapKey,
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
  imports: [
    CommonModule,
    RouterLink,
    VentisquerosFloorMapComponent,
    VentisquerosVisibilityPanelComponent,
    VentisquerosFocusCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="vs-page flex h-full min-w-0 flex-1 flex-col overflow-hidden">
      @if (!embedded()) {
        <!-- Site header -->
        <div class="vs-site-header flex flex-wrap items-center gap-3 px-5 py-2.5">
          <a
            routerLink="/companies"
            class="vs-back-btn flex h-9 w-9 shrink-0 items-center justify-center"
            aria-label="Volver a instalaciones"
          >
            <span class="material-symbols-outlined text-[18px]">arrow_back</span>
          </a>
          <div class="vs-module-icon flex h-9.5 w-9.5 shrink-0 items-center justify-center">
            <span class="material-symbols-outlined text-[18px] text-[#6366F1]">ac_unit</span>
          </div>
          <div>
            <div class="vs-site-title">{{ siteTitle() }}</div>
            <div class="vs-site-subtitle">
              Cámara frío · {{ sensors().length }} sensores THM activos
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
            <div class="vs-range-chip flex items-center gap-1.25">
              <span class="material-symbols-outlined text-[12px]">calendar_today</span>
              {{ rangeFrom }}
            </div>
            <span class="vs-range-label">Hasta</span>
            <div class="vs-range-chip flex items-center gap-1.25">
              <span class="material-symbols-outlined text-[12px]">calendar_today</span>
              {{ rangeTo }}
            </div>
            <button class="vs-apply-btn">Aplicar</button>
          </div>
        </div>
      }

      @if (view() === 'full') {
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
              <span
                class="vs-live-indicator-dot"
                [style.background]="serviceError() ? '#EF4444' : '#22C55E'"
              ></span>
              {{ liveLabel() }}
            </span>
          </div>
        </div>
      }

      <!-- Scrollable content -->
      <div class="vs-content min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        @if (effectiveTab() === 'general') {
          <!-- Title strip -->
          <div class="mb-3 flex flex-wrap items-end justify-between gap-3.5">
            <div>
              <div class="vs-h1">Monitoreo de Cámaras</div>
              <div class="vs-h1-sub">Temperatura, humedad relativa y alertas térmicas en vivo</div>
            </div>
            <div class="flex items-center gap-2">
              <div class="vs-metric-toggle flex gap-0.5">
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
              <button class="vs-ghost-btn inline-flex items-center gap-1.25">
                <span class="material-symbols-outlined text-[13px]">download</span>
                Exportar
              </button>
            </div>
          </div>

          @if (serviceError()) {
            <div class="vs-error-banner mb-3 flex items-center gap-2.5">
              <span class="material-symbols-outlined text-[16px] text-rose-600">error</span>
              <div class="min-w-0 flex-1">
                <div class="text-[12.5px] font-semibold text-rose-700">
                  No se pudo cargar la lectura más reciente
                </div>
                <div class="text-[11.5px] text-rose-600 opacity-80">{{ serviceError() }}</div>
              </div>
              <button class="vs-error-retry" (click)="onRetry()">Reintentar</button>
            </div>
          }

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
                <div class="mt-0.5 flex items-baseline gap-1">
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
            <div class="relative min-w-0">
              <app-ventisqueros-floor-map
                [sensors]="sensors()"
                [metric]="metric()"
                [selectedId]="selectedId()"
                [hiddenSensors]="hiddenSensors()"
                [hasAlerts]="alerts().length > 0"
                (selectSensor)="selectedId.set($event)"
              ></app-ventisqueros-floor-map>
              @if (sensors().length === 0) {
                <div class="vs-empty-overlay">
                  <span class="material-symbols-outlined text-[28px] text-slate-400">
                    sensors_off
                  </span>
                  <div class="vs-empty-title">Sin lecturas disponibles</div>
                  <div class="vs-empty-sub">
                    @if (isLoading()) {
                      Cargando equipos…
                    } @else if (serviceError()) {
                      Fallo de conexión con los equipos
                    } @else {
                      Esperando primera transmisión de TAP 2 · 3 · 4
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Sensor rail -->
            <div class="vs-rail flex h-full min-w-0 shrink-0 flex-col gap-3 overflow-hidden">
              <app-ventisqueros-focus-card [focus]="focusSensor()"></app-ventisqueros-focus-card>

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
                        <div class="flex flex-col gap-0.5">
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
                                    <span
                                      class="vs-sensor-alert-chip inline-flex items-center gap-0.75"
                                    >
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
          <app-ventisqueros-visibility-panel
            class="mt-3.5 block"
            [sensors]="sensors()"
            [hidden]="hiddenSensors()"
            [taps]="taps"
            [tapColors]="tapColors"
            (hiddenChange)="hiddenSensors.set($event)"
          ></app-ventisqueros-visibility-panel>
        }

        @if (effectiveTab() === 'taps') {
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
                [routerLink]="tapRouterLink(t.tap)"
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
                      <span
                        class="vs-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-rose-500"
                      ></span>
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

        @if (effectiveTab() === 'eventos') {
          <div class="vs-placeholder flex items-center justify-center">
            Eventos — vista por implementar
          </div>
        }

        @if (effectiveTab() === 'contacts') {
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
        background: rgba(2, 132, 199, 0.1);
        border: 1px solid rgba(2, 132, 199, 0.25);
      }
      .vs-back-btn {
        border-radius: 8px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        color: #475569;
        transition:
          background 0.12s ease,
          color 0.12s ease;
      }
      .vs-back-btn:hover {
        background: #f8fafc;
        color: #0899a5;
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
        transition:
          color 0.12s ease,
          border-color 0.12s ease;
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
        background: linear-gradient(90deg, rgba(239, 68, 68, 0.1) 0%, rgba(239, 68, 68, 0.04) 80%);
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
        transition:
          background 0.12s,
          border-color 0.12s;
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

      /* Error banner */
      .vs-error-banner {
        background: #fef2f2;
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 10px;
        padding: 8px 12px;
      }
      .vs-error-retry {
        background: #ef4444;
        border: none;
        border-radius: 6px;
        padding: 5px 10px;
        color: #fff;
        font-family: var(--font-body);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .vs-error-retry:hover {
        background: #dc2626;
      }

      /* Empty state */
      .vs-empty-overlay {
        position: absolute;
        inset: 0;
        background: rgba(255, 255, 255, 0.75);
        backdrop-filter: blur(2px);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border-radius: 14px;
        pointer-events: none;
      }
      .vs-empty-title {
        font-family: var(--font-josefin);
        font-size: 14px;
        font-weight: 600;
        color: #475569;
        letter-spacing: 0.02em;
      }
      .vs-empty-sub {
        font-size: 11.5px;
        color: #94a3b8;
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
  private readonly service = inject(VentisquerosService);

  readonly siteId = input.required<string>();
  readonly siteName = input<string>('');
  readonly companyName = input<string>('');
  readonly coldRoomSites = input<SiteRecord[]>([]);
  readonly embedded = input<boolean>(false);
  readonly view = input<'full' | 'general' | 'taps' | 'eventos' | 'contacts'>('full');

  readonly tapSiteMap = computed<Record<TapKey, string | null>>(() => {
    const sites = this.coldRoomSites();
    const map: Record<TapKey, string | null> = {
      'TAP 1': null,
      'TAP 2': null,
      'TAP 3': null,
      'TAP 4': null,
    };
    for (const site of sites) {
      const desc = (site.descripcion || '').toUpperCase().replace(/-/g, ' ').trim();
      for (const key of TAPS) {
        if (desc.includes(key)) {
          map[key] = site.id;
          break;
        }
      }
    }
    return map;
  });

  tapRouterLink(tap: TapKey): string[] {
    const tapSiteId = this.tapSiteMap()[tap];
    if (tapSiteId) return ['/companies', tapSiteId, 'cold-room'];
    return ['/companies', this.siteId(), 'tap', tap.replace(' ', '-')];
  }

  readonly siteTitle = computed(() => {
    const name = this.siteName().trim();
    const company = this.companyName().trim();
    if (company && name) return `${company} · ${name}`;
    return name || company || 'Cámara frío';
  });

  readonly effectiveTab = computed<TabKey>(() => {
    const v = this.view();
    if (v === 'general' || v === 'taps' || v === 'eventos' || v === 'contacts') return v;
    return this.activeTab();
  });

  readonly metric = signal<MetricKey>('T');
  readonly selectedId = signal<string | null>(null);
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

  readonly sensors = toSignal(this.service.sensors$, { initialValue: [] as Sensor[] });
  readonly concentrator = toSignal(this.service.concentrator$, {
    initialValue: { alerted: false, lastSeen: null } as ConcentratorState,
  });
  readonly lastUpdate = toSignal(this.service.lastUpdate$, {
    initialValue: null as Date | null,
  });
  readonly serviceError = toSignal(this.service.error$, {
    initialValue: null as string | null,
  });
  readonly isLoading = toSignal(this.service.loading$, { initialValue: false });

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
    const list = this.sensors();
    const ts = list.map((s) => s.t);
    const hs = list.map((s) => s.h);
    const alerts = this.alerts();
    const maxDev = list.reduce<{ sensor: Sensor | null; dev: number }>(
      (best, s) => {
        // Sin baseline desde backend aún: comparar con promedio del TAP.
        const peers = list.filter((p) => p.tap === s.tap);
        const peerAvg = peers.reduce((a, b) => a + b.t, 0) / Math.max(peers.length, 1);
        const dev = Math.abs(s.t - peerAvg);
        return dev > best.dev ? { sensor: s, dev } : best;
      },
      { sensor: null, dev: 0 },
    );
    return {
      active: list.length,
      total: list.length,
      avgT: list.length ? (ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1) : '—',
      avgH: list.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : 0,
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

  readonly liveLabel = computed(() => {
    if (this.serviceError()) return 'Sin conexión · reintentando';
    const last = this.lastUpdate();
    if (!last) return this.isLoading() ? 'Cargando…' : 'Esperando primera lectura';
    const diff = Math.max(0, Math.floor((this.now() - last.getTime()) / 1000));
    if (diff < 60) return `En vivo · hace ${diff}s`;
    const mins = Math.floor(diff / 60);
    return `En vivo · hace ${mins}m`;
  });

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

  constructor() {
    effect(() => {
      const sites = this.coldRoomSites();
      const map = this.tapSiteMap();
      if (sites.length > 0) {
        const specs = sites.map((s) => {
          const tap = (Object.keys(map) as TapKey[]).find((k) => map[k] === s.id) ?? null;
          return { siteId: s.id, tap };
        });
        this.service.startPolling(specs);
        return;
      }
      const id = this.siteId();
      if (id) this.service.startPolling(id);
    });
  }

  ngOnInit(): void {
    this.intervalId = setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
    }
    this.service.stopPolling();
  }

  fmtTemp = fmtTemp;
  fmtHum = fmtHum;
  tempColor = tempColor;
  humColor = humColor;

  rowBg(s: Sensor): string {
    if (this.selectedId() === s.id) return 'rgba(13,175,189,0.07)';
    if (s.alerted) return 'rgba(239,68,68,0.04)';
    return 'transparent';
  }

  onRetry(): void {
    this.service.refresh();
  }

  rowBorder(s: Sensor): string {
    if (this.selectedId() === s.id) return '1px solid rgba(13,175,189,0.35)';
    if (s.alerted) return '1px solid rgba(239,68,68,0.20)';
    return '1px solid transparent';
  }
}
