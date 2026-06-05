import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  ColdRoomService,
  type ColdRoomConcentratorChannel,
  type ColdRoomSensor,
} from '../../services/cold-room.service';
import {
  ColdRoomThresholdsService,
  type SalaThreshold,
} from '../../services/cold-room-thresholds.service';
import { ColdRoomDeviationsService } from '../../services/cold-room-deviations.service';
import {
  ColdRoomDefrostService,
  type DefrostWindow,
} from '../../services/cold-room-defrost.service';
import {
  ColdRoomAuditService,
  type ColdRoomAuditEntry,
  type ColdRoomAuditCategory,
} from '../../services/cold-room-audit.service';
import {
  MetricKey,
  Sensor,
  TapKey,
  buildTapColors,
  buildTapKeys,
  fmtHum,
  fmtTemp,
  humColor,
  tapKeyFor,
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

type TabKey = 'general' | 'salas' | 'compliance' | 'taps' | 'eventos' | 'contacts';

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

interface SalaAggregate {
  area: string;
  slug: string;
  count: number;
  alerts: number;
  actualT: string;
  actualTNum: number;
  avgT: string;
  avgTNum: number;
  avgH: number;
  minT: string;
  minTNum: number;
  maxT: string;
  maxTNum: number;
  taps: TapKey[];
  sensors: Sensor[];
  thresholdMax: number | null;
  /** Aggregated alert level. */
  level: 'ok' | 'info' | 'warn' | 'crit' | 'severe' | 'unknown';
  /** Coarse status mapping for legacy CSS bindings: ok|warn|crit|unknown. */
  status: 'ok' | 'warn' | 'crit' | 'unknown';
  spark: number[];
  outOfBandMin: number;
  reportingCount: number;
  deviationsOpenCount: number;
  deviationsOngoing: number;
}

type TapTechStatus = 'online' | 'degraded' | 'offline' | 'unknown';

interface TapDiagnostic {
  tap: TapKey;
  color: string;
  status: TapTechStatus;
  channels: ColdRoomConcentratorChannel[];
  channelsOnline: number;
  channelsTotal: number;
  channelsStale: number;
  oldestSeenIso: string | null;
  oldestSeenMs: number | null;
  avgRssi: number | null;
  worstRssi: { ch: ColdRoomConcentratorChannel; rssi: number } | null;
  bestRssi: { ch: ColdRoomConcentratorChannel; rssi: number } | null;
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
    FormsModule,
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

          <!-- KPI strip: hero + meta inline -->
          <div class="vs-kpi-strip mb-5 flex flex-wrap items-end gap-6">
            <div class="vs-kpi-hero">
              <div
                class="vs-kpi-hero-value"
                [style.color]="alerts().length ? '#DC2626' : '#0DAFBD'"
              >
                {{ alerts().length || stats().active }}
              </div>
              <div class="vs-kpi-hero-label">
                {{
                  alerts().length === 1
                    ? 'alerta activa'
                    : alerts().length
                      ? 'alertas activas'
                      : 'sensores activos'
                }}
              </div>
            </div>
            <div class="vs-kpi-meta flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span
                >Temp prom <strong>{{ stats().avgT }}°C</strong></span
              >
              <span
                >HR prom <strong>{{ stats().avgH }}%</strong></span
              >
              @if (stats().maxDev.sensor; as devSensor) {
                <span>
                  Mayor desv
                  <strong>±{{ stats().maxDev.dev.toFixed(1) }}°C</strong>
                  ({{ devSensor.id }})
                </span>
              }
              <span
                >Última lectura <strong>{{ liveLabel() }}</strong></span
              >
            </div>
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
                      Esperando primera transmisión de los equipos
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
                    {{ sensors().length }} sensores · {{ taps().length }} TAP
                  </span>
                </div>
                <div class="flex-1 overflow-y-auto overflow-x-hidden pr-1">
                  @for (tap of taps(); track tap) {
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
            [taps]="taps()"
            [tapColors]="tapColors()"
            (hiddenChange)="hiddenSensors.set($event)"
          ></app-ventisqueros-visibility-panel>
        }

        @if (effectiveTab() === 'salas') {
          <!-- Salas view: agrupado por area, vista operativa -->
          <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="vs-h1 text-slate-800">Salas</h2>
              <p class="mt-1 text-[12px] text-slate-500">
                {{ salaAggregates().length }} salas · {{ sensors().length }} sensores · click para
                ver histórico
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="umbralesOpen.set(true)"
                title="Configurar temperatura máxima por sala"
              >
                <span class="material-symbols-outlined text-[14px]">tune</span>
                Umbrales
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="defrostOpen.set(true)"
                title="Programar ventanas defrost por sala"
              >
                <span class="material-symbols-outlined text-[14px]">ac_unit</span>
                Defrost
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="auditOpen.set(true)"
                title="Registro auditoría HACCP"
              >
                <span class="material-symbols-outlined text-[14px]">fact_check</span>
                Auditoría
                @if (auditEntries().length > 0) {
                  <span class="audit-count-badge">{{ auditEntries().length }}</span>
                }
              </button>
            </div>
          </div>

          <div class="vs-salas-grid grid gap-3">
            @for (sa of salaAggregates(); track sa.slug) {
              <button
                type="button"
                [routerLink]="salaRouterLink(sa.area)"
                class="sala-card group"
                [attr.data-status]="sa.status"
              >
                <header class="sala-card-head">
                  <div
                    class="sala-card-icon"
                    [style.background]="
                      sa.status === 'crit'
                        ? 'rgba(239,68,68,0.10)'
                        : sa.status === 'warn'
                          ? 'rgba(245,158,11,0.10)'
                          : 'rgba(13,175,189,0.10)'
                    "
                    [style.border-color]="
                      sa.status === 'crit'
                        ? 'rgba(239,68,68,0.30)'
                        : sa.status === 'warn'
                          ? 'rgba(245,158,11,0.30)'
                          : 'rgba(13,175,189,0.30)'
                    "
                  >
                    <span
                      class="material-symbols-outlined text-[18px]"
                      [style.color]="
                        sa.status === 'crit'
                          ? '#DC2626'
                          : sa.status === 'warn'
                            ? '#D97706'
                            : '#0D99A5'
                      "
                      >thermostat</span
                    >
                  </div>
                  <div class="min-w-0 flex-1">
                    <h3 class="sala-card-title truncate">{{ sa.area }}</h3>
                    <p class="sala-card-sub truncate">
                      {{ sa.count }} {{ sa.count === 1 ? 'sensor' : 'sensores' }} ·
                      {{ sa.taps.join(' / ') || '—' }}
                    </p>
                  </div>
                  <span class="sala-card-chev material-symbols-outlined">chevron_right</span>
                </header>

                <div class="sala-card-hero">
                  <div class="sala-actual">
                    <div
                      class="sala-actual-val"
                      [style.color]="sa.status === 'crit' ? '#DC2626' : tempColor(sa.actualTNum)"
                    >
                      {{ sa.actualT }}<span class="sala-actual-unit">°C</span>
                    </div>
                    <div class="sala-actual-lbl">Actual</div>
                  </div>
                  @if (sa.thresholdMax !== null) {
                    <div class="sala-threshold-chip" [attr.data-status]="sa.status">
                      <span class="sala-threshold-lbl">Umbral máx</span>
                      <span class="sala-threshold-val">{{ sa.thresholdMax }}°C</span>
                    </div>
                  } @else {
                    <div class="sala-threshold-chip" data-status="unset">
                      <span class="sala-threshold-lbl">Umbral</span>
                      <span class="sala-threshold-val">sin config</span>
                    </div>
                  }
                </div>

                @if (sa.spark.length > 1) {
                  <div class="sala-spark-wrap" (mouseleave)="onSparkLeave()">
                    <svg
                      viewBox="0 0 120 32"
                      class="sala-spark"
                      preserveAspectRatio="none"
                      (mousemove)="onSparkMove($event, sa)"
                    >
                      <defs>
                        <linearGradient [attr.id]="'spark-' + sa.slug" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            [attr.stop-color]="
                              sa.status === 'crit'
                                ? '#EF4444'
                                : sa.status === 'warn'
                                  ? '#F59E0B'
                                  : '#0DAFBD'
                            "
                            stop-opacity="0.30"
                          />
                          <stop offset="100%" stop-color="#fff" stop-opacity="0" />
                        </linearGradient>
                      </defs>
                      @if (sa.thresholdMax !== null) {
                        <line
                          [attr.x1]="0"
                          [attr.x2]="120"
                          [attr.y1]="thresholdYPos(sa.spark, sa.thresholdMax, 32)"
                          [attr.y2]="thresholdYPos(sa.spark, sa.thresholdMax, 32)"
                          stroke="rgba(239, 68, 68, 0.45)"
                          stroke-width="0.8"
                          stroke-dasharray="3 2"
                        />
                      }
                      <path
                        [attr.d]="sparkAreaPath(sa.spark, 120, 32)"
                        [attr.fill]="'url(#spark-' + sa.slug + ')'"
                      />
                      <path
                        [attr.d]="sparkPath(sa.spark, 120, 32)"
                        fill="none"
                        [attr.stroke]="
                          sa.status === 'crit'
                            ? '#EF4444'
                            : sa.status === 'warn'
                              ? '#F59E0B'
                              : '#0DAFBD'
                        "
                        stroke-width="1.4"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                      @if (sparkHoverSlug() === sa.slug) {
                        <line
                          [attr.x1]="sparkHoverXPct(sa) * 1.2"
                          [attr.x2]="sparkHoverXPct(sa) * 1.2"
                          y1="0"
                          y2="32"
                          stroke="rgba(15, 23, 42, 0.45)"
                          stroke-width="0.6"
                        />
                      }
                    </svg>
                    @if (sparkHoverSlug() === sa.slug && sparkHoverValue(sa) !== null) {
                      <div
                        class="sala-spark-tooltip"
                        [style.left.%]="sparkHoverXPct(sa)"
                        [style.transform]="
                          sparkHoverXPct(sa) > 70
                            ? 'translate(-100%, -100%)'
                            : sparkHoverXPct(sa) < 30
                              ? 'translate(0, -100%)'
                              : 'translate(-50%, -100%)'
                        "
                      >
                        <strong>{{ sparkHoverValue(sa)!.toFixed(1) }}°C</strong>
                        <span>{{ sparkHoverTime(sa) }}</span>
                      </div>
                    }
                    <div class="sala-spark-axis">
                      <span>hace 24h</span>
                      <span>12h</span>
                      <span>ahora</span>
                    </div>
                  </div>
                } @else {
                  <div class="sala-spark-empty">
                    <span class="material-symbols-outlined text-[14px]">timeline</span>
                    <span>Sin histórico aún</span>
                  </div>
                }

                <div class="sala-stats-row">
                  <span class="sala-stat">
                    <span class="sala-stat-lbl">Mín</span>
                    <span class="sala-stat-val" [style.color]="tempColor(sa.minTNum)">
                      {{ sa.minT }}°C
                    </span>
                  </span>
                  <span class="sala-stat-divider"></span>
                  <span class="sala-stat">
                    <span class="sala-stat-lbl">Prom</span>
                    <span class="sala-stat-val" [style.color]="tempColor(sa.avgTNum)">
                      {{ sa.avgT }}°C
                    </span>
                  </span>
                  <span class="sala-stat-divider"></span>
                  <span class="sala-stat">
                    <span class="sala-stat-lbl">Máx</span>
                    <span
                      class="sala-stat-val"
                      [style.color]="sa.status === 'crit' ? '#DC2626' : tempColor(sa.maxTNum)"
                      >{{ sa.maxT }}°C</span
                    >
                  </span>
                </div>

                <div class="sala-ops-row">
                  <span
                    class="sala-op-pill"
                    [class.sala-op-pill--bad]="sa.outOfBandMin > 0"
                    [title]="'Tiempo total sobre umbral en 24h (sample 1min, max entre sensores)'"
                  >
                    <span class="material-symbols-outlined text-[11px]">schedule</span>
                    <span class="sala-op-lbl">Sobre umbral 24h</span>
                    <strong>{{ fmtMinutes(sa.outOfBandMin) }}</strong>
                  </span>
                  <span
                    class="sala-op-pill"
                    [class.sala-op-pill--bad]="sa.deviationsOpenCount > 0"
                    title="Desviaciones abiertas (no resueltas) en 24h"
                  >
                    <span class="material-symbols-outlined text-[11px]">flag</span>
                    <span class="sala-op-lbl">Desviaciones</span>
                    <strong>{{ sa.deviationsOpenCount }}</strong>
                  </span>
                  <span
                    class="sala-op-pill"
                    [class.sala-op-pill--bad]="sa.reportingCount < sa.count"
                    [class.sala-op-pill--empty]="
                      sa.count === 0 || (sa.reportingCount === 0 && sa.count > 0)
                    "
                    [title]="
                      'Sensores con lectura ≤ 60s vs total de la sala. ' +
                      (sa.reportingCount === 0
                        ? 'Ninguno reportando: sin lectura reciente o canal offline.'
                        : sa.reportingCount < sa.count
                          ? 'Algunos sensores stale (>60s sin transmitir).'
                          : 'Todos transmitiendo OK.')
                    "
                  >
                    <span class="material-symbols-outlined text-[11px]">sensors</span>
                    <span class="sala-op-lbl">Reportando</span>
                    <strong>{{ sa.reportingCount }}/{{ sa.count }}</strong>
                  </span>
                </div>

                <footer class="sala-card-foot">
                  @switch (sa.level) {
                    @case ('severe') {
                      <span class="sala-status sala-status--severe">
                        <span
                          class="vs-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-rose-700"
                        ></span>
                        Crítico sostenido · {{ fmtMinutes(longestOngoingMin(sa)) }}
                      </span>
                    }
                    @case ('crit') {
                      <span class="sala-status sala-status--crit">
                        <span
                          class="vs-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-rose-500"
                        ></span>
                        Desviación sostenida · {{ fmtMinutes(longestOngoingMin(sa)) }}
                      </span>
                    }
                    @case ('warn') {
                      <span class="sala-status sala-status--warn">
                        <span class="material-symbols-outlined text-[12px]">warning</span>
                        Desviación activa
                      </span>
                    }
                    @case ('info') {
                      <span class="sala-status sala-status--info">
                        <span class="material-symbols-outlined text-[12px]">trending_up</span>
                        Cerca del umbral
                      </span>
                    }
                    @case ('ok') {
                      <span class="sala-status sala-status--ok">
                        <span class="material-symbols-outlined text-[12px]">check_circle</span>
                        Bajo umbral
                      </span>
                    }
                    @default {
                      <span class="sala-status sala-status--unknown">
                        <span class="material-symbols-outlined text-[12px]">help</span>
                        Sin umbral
                      </span>
                    }
                  }
                  <span class="sala-hr" title="Humedad Relativa (promedio sensores)">
                    <span class="material-symbols-outlined text-[12px]">water_drop</span>
                    <span class="sala-hr-lbl">HR</span>
                    {{ sa.avgH }}%
                  </span>
                </footer>
              </button>
            }
            @if (salaAggregates().length === 0 && !isLoading()) {
              <div class="vs-empty-overlay col-span-full">
                <span class="material-symbols-outlined text-[28px] text-slate-400"
                  >sensors_off</span
                >
                <div class="vs-empty-title">Sin salas con datos</div>
                <div class="vs-empty-sub">Esperando lectura de los sensores.</div>
              </div>
            }
          </div>
        }

        @if (effectiveTab() === 'compliance') {
          <!-- Compliance HACCP dashboard -->
          @if (complianceMetrics(); as cm) {
            <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 class="vs-h1 text-slate-800">Compliance HACCP</h2>
                <p class="mt-1 text-[12px] text-slate-500">
                  Reporte de cumplimiento cadena de frío · {{ cm.periodLabel }} ·
                  {{ cm.sensorCount }} sensores
                </p>
              </div>
              <div class="comp-period-pills">
                <button
                  type="button"
                  class="comp-pill"
                  [class.comp-pill--active]="compliancePeriod() === '24h'"
                  (click)="setCompliancePeriod('24h')"
                >
                  24h
                </button>
                <button
                  type="button"
                  class="comp-pill"
                  [class.comp-pill--active]="compliancePeriod() === '7d'"
                  (click)="setCompliancePeriod('7d')"
                >
                  7d
                </button>
              </div>
            </div>

            <!-- Hero KPI -->
            <div class="comp-hero">
              <div class="comp-hero-main">
                <div
                  class="comp-hero-pct"
                  [style.color]="compliancePctColor(cm.globalCompliancePct)"
                >
                  {{ cm.globalCompliancePct.toFixed(2) }}<span class="comp-hero-pct-unit">%</span>
                </div>
                <div class="comp-hero-lbl">Compliance global</div>
                <div
                  class="comp-hero-tag"
                  [style.color]="compliancePctColor(cm.globalCompliancePct)"
                  [style.borderColor]="compliancePctColor(cm.globalCompliancePct)"
                >
                  {{ compliancePctLabel(cm.globalCompliancePct) }}
                </div>
              </div>
              <div class="comp-hero-meta">
                <div class="comp-hero-meta-item">
                  <div class="comp-hero-meta-lbl">Tiempo fuera banda</div>
                  <div class="comp-hero-meta-val">{{ fmtComplianceMin(cm.globalOutMin) }}</div>
                </div>
                <div class="comp-hero-meta-item">
                  <div class="comp-hero-meta-lbl">Desviaciones</div>
                  <div class="comp-hero-meta-val">{{ cm.devsTotal }}</div>
                  <div class="comp-hero-meta-sub">
                    {{ cm.devsOpen }} abiertas · {{ cm.devsClosed }} cerradas
                  </div>
                </div>
                <div class="comp-hero-meta-item">
                  <div class="comp-hero-meta-lbl">MTTR resolución</div>
                  <div class="comp-hero-meta-val">
                    {{ cm.mttrMin !== null ? fmtComplianceMin(cm.mttrMin) : '—' }}
                  </div>
                </div>
              </div>
            </div>

            <!-- Severity breakdown -->
            <div class="comp-section">
              <h3 class="comp-section-title">Severidad de desviaciones</h3>
              <div class="comp-severity-row">
                <div class="comp-severity-card comp-severity-card--info">
                  <div class="comp-severity-val">{{ cm.devsByLevel.info }}</div>
                  <div class="comp-severity-lbl">Defrost / esperadas</div>
                </div>
                <div class="comp-severity-card comp-severity-card--warn">
                  <div class="comp-severity-val">{{ cm.devsByLevel.warn }}</div>
                  <div class="comp-severity-lbl">Breves &lt; 5min</div>
                </div>
                <div class="comp-severity-card comp-severity-card--crit">
                  <div class="comp-severity-val">{{ cm.devsByLevel.crit }}</div>
                  <div class="comp-severity-lbl">Sostenidas ≥ 5min</div>
                </div>
                <div class="comp-severity-card comp-severity-card--severe">
                  <div class="comp-severity-val">{{ cm.devsByLevel.severe }}</div>
                  <div class="comp-severity-lbl">Severas ≥ 30min</div>
                </div>
              </div>
            </div>

            <!-- Trend -->
            <div class="comp-section">
              <h3 class="comp-section-title">
                Tendencia compliance
                <span class="comp-section-meta">{{ cm.periodLabel }}</span>
              </h3>
              <div class="comp-trend">
                @for (b of cm.hourlyTrend; track $index) {
                  <div class="comp-trend-col">
                    <div
                      class="comp-trend-bar"
                      [style.height.px]="trendBarHeight(b.pct, 80)"
                      [style.background]="trendBarColor(b.pct)"
                      [title]="b.label + ' — ' + b.pct.toFixed(1) + '%'"
                    ></div>
                    <div class="comp-trend-lbl">{{ b.label }}</div>
                  </div>
                }
              </div>
            </div>

            <!-- Ranking -->
            <div class="comp-section">
              <h3 class="comp-section-title">
                Ranking salas
                <span class="comp-section-meta">por minutos fuera banda</span>
              </h3>
              <div class="comp-ranking">
                @for (sa of cm.salas; track sa.slug) {
                  <div class="comp-rank-row">
                    <span class="comp-rank-name truncate">{{ sa.area }}</span>
                    <span
                      class="comp-rank-pct"
                      [style.color]="compliancePctColor(sa.compliancePct)"
                    >
                      {{ sa.compliancePct.toFixed(2) }}%
                    </span>
                    <span class="comp-rank-bar-wrap">
                      <span
                        class="comp-rank-bar"
                        [style.width.%]="sa.compliancePct"
                        [style.background]="compliancePctColor(sa.compliancePct)"
                      ></span>
                    </span>
                    <span class="comp-rank-out">{{ fmtComplianceMin(sa.outMin) }}</span>
                    <span class="comp-rank-devs">
                      {{ sa.devs }} {{ sa.devs === 1 ? 'desv' : 'desvs' }}
                    </span>
                  </div>
                }
                @if (cm.salas.length === 0) {
                  <div class="comp-empty">Sin datos de salas en este período.</div>
                }
              </div>
            </div>

            <!-- Causas distribution -->
            <div class="comp-section">
              <h3 class="comp-section-title">
                Distribución por causa
                <span class="comp-section-meta">clasificación HACCP</span>
              </h3>
              @if (cm.causes.length === 0) {
                <div class="comp-empty">Sin desviaciones para clasificar.</div>
              } @else {
                <div class="comp-causes">
                  <div class="comp-cause-bar">
                    @for (c of cm.causes; track c.key) {
                      <span
                        class="comp-cause-seg"
                        [style.width.%]="c.pct"
                        [style.background]="c.color"
                        [title]="c.label + ' — ' + c.count + ' (' + c.pct.toFixed(1) + '%)'"
                      ></span>
                    }
                  </div>
                  <div class="comp-cause-legend">
                    @for (c of cm.causes; track c.key) {
                      <span class="comp-cause-item">
                        <span class="comp-cause-dot" [style.background]="c.color"></span>
                        {{ c.label }}
                        <strong>{{ c.count }}</strong>
                        <span class="comp-cause-pct">{{ c.pct.toFixed(1) }}%</span>
                      </span>
                    }
                  </div>
                </div>
              }
            </div>

            <div class="comp-footer-meta">
              <span class="material-symbols-outlined text-[14px]">info</span>
              Datos derivados de muestreo {{ compliancePeriod() === '24h' ? '1 min' : '1 h' }} ·
              SERNAPESCA Res. 3160/2016 · Codex Alimentarius CAC/RCP 1-1969
            </div>
          }
        }

        @if (effectiveTab() === 'taps') {
          <!-- TAP technical / NOC view -->
          <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="vs-h1 text-slate-800">Diagnóstico TAP</h2>
              <p class="mt-1 text-[12px] text-slate-500">
                Estado de red, señal y transmisión por concentrador
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="fetchConcentratorManual()"
              >
                <span class="material-symbols-outlined text-[14px]">sync</span>
                Actualizar
              </button>
            </div>
          </div>

          <!-- Diag KPI strip -->
          <div class="vs-diag-kpi mb-4">
            <div class="vs-diag-kpi-card vs-diag-kpi-card--ok">
              <div class="vs-diag-kpi-val">{{ diagKpis().online }}</div>
              <div class="vs-diag-kpi-lbl">Online</div>
            </div>
            <div class="vs-diag-kpi-card vs-diag-kpi-card--warn">
              <div class="vs-diag-kpi-val">{{ diagKpis().degraded }}</div>
              <div class="vs-diag-kpi-lbl">Degradado</div>
            </div>
            <div class="vs-diag-kpi-card vs-diag-kpi-card--err">
              <div class="vs-diag-kpi-val">{{ diagKpis().offline }}</div>
              <div class="vs-diag-kpi-lbl">Offline</div>
            </div>
            <div class="vs-diag-kpi-card">
              <div class="vs-diag-kpi-val">
                {{ diagKpis().avgRssi !== null ? diagKpis().avgRssi + ' dBm' : '—' }}
              </div>
              <div class="vs-diag-kpi-lbl">RSSI prom.</div>
            </div>
            <div class="vs-diag-kpi-card">
              <div
                class="vs-diag-kpi-val"
                [style.color]="diagKpis().stale > 0 ? '#DC2626' : '#1E293B'"
              >
                {{ diagKpis().stale }}
              </div>
              <div class="vs-diag-kpi-lbl">Canales sin señal &gt;60s</div>
            </div>
          </div>

          <!-- Toolbar: filter + sort -->
          <div class="vs-diag-toolbar mb-3">
            <div class="vs-diag-filter">
              <span class="vs-diag-filter-lbl">Filtrar</span>
              <button
                type="button"
                class="vs-diag-pill"
                [class.vs-diag-pill--active]="diagFilter() === 'all'"
                (click)="diagFilter.set('all')"
              >
                Todos
              </button>
              <button
                type="button"
                class="vs-diag-pill"
                [class.vs-diag-pill--active]="diagFilter() === 'online'"
                (click)="diagFilter.set('online')"
              >
                Online
              </button>
              <button
                type="button"
                class="vs-diag-pill"
                [class.vs-diag-pill--active]="diagFilter() === 'degraded'"
                (click)="diagFilter.set('degraded')"
              >
                Degradado
              </button>
              <button
                type="button"
                class="vs-diag-pill"
                [class.vs-diag-pill--active]="diagFilter() === 'offline'"
                (click)="diagFilter.set('offline')"
              >
                Offline
              </button>
            </div>
            <div class="vs-diag-sort">
              <span class="vs-diag-filter-lbl">Ordenar</span>
              <select
                class="vs-diag-select"
                [ngModel]="diagSort()"
                (ngModelChange)="diagSort.set($event)"
                aria-label="Ordenar"
              >
                <option value="tap">TAP</option>
                <option value="lastSeen">Último visto (más viejo primero)</option>
                <option value="rssi">RSSI (más débil primero)</option>
              </select>
            </div>
          </div>

          <div class="vs-taps-grid grid gap-3">
            @for (d of tapDiagFiltered(); track d.tap) {
              <button
                type="button"
                [routerLink]="tapDiagRouterLink(d.tap)"
                class="vs-tap-diag group flex w-full cursor-pointer flex-col rounded-2xl border bg-white px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5"
                [attr.data-status]="d.status"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="flex min-w-0 items-start gap-3">
                    <div
                      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                      [style.background]="d.color + '1A'"
                      [style.border]="'1px solid ' + d.color + '40'"
                    >
                      <span class="material-symbols-outlined text-[18px]" [style.color]="d.color"
                        >memory</span
                      >
                    </div>
                    <div class="min-w-0">
                      <h3 class="vs-tap-summary-title truncate text-slate-800">{{ d.tap }}</h3>
                      <p class="truncate text-[11px] text-slate-400">
                        Último visto {{ relativeMs(d.oldestSeenMs) }} · ID concentrador
                      </p>
                    </div>
                  </div>
                  <span class="vs-status-pill" [attr.data-status]="d.status">
                    <span class="vs-status-dot"></span>
                    {{
                      d.status === 'online'
                        ? 'Online'
                        : d.status === 'degraded'
                          ? 'Degradado'
                          : d.status === 'offline'
                            ? 'Offline'
                            : '—'
                    }}
                  </span>
                </div>

                <!-- Channels online / total -->
                <div class="mt-3 vs-diag-channels">
                  <div class="vs-diag-channels-row">
                    <span class="vs-diag-channels-lbl">Canales online</span>
                    <span class="vs-diag-channels-val">
                      {{ d.channelsOnline }} / {{ d.channelsTotal }}
                      @if (d.channelsStale > 0) {
                        <span class="vs-diag-stale">· {{ d.channelsStale }} stale</span>
                      }
                    </span>
                  </div>
                  <div class="vs-diag-channels-bar">
                    <div
                      class="vs-diag-channels-fill"
                      [style.width.%]="
                        d.channelsTotal > 0 ? (d.channelsOnline / d.channelsTotal) * 100 : 0
                      "
                      [style.background]="
                        d.status === 'online'
                          ? '#22C55E'
                          : d.status === 'degraded'
                            ? '#F59E0B'
                            : '#EF4444'
                      "
                    ></div>
                  </div>
                </div>

                <!-- RSSI -->
                <div class="mt-3 vs-diag-rssi">
                  <div class="vs-diag-rssi-head">
                    <span class="vs-diag-channels-lbl">RSSI promedio</span>
                    <span class="vs-diag-rssi-val">
                      {{ d.avgRssi !== null ? d.avgRssi + ' dBm' : '—' }}
                      <span class="vs-diag-rssi-tag">{{ rssiLabel(d.avgRssi) }}</span>
                    </span>
                  </div>
                  <div class="vs-diag-rssi-bar">
                    <div class="vs-diag-rssi-fill" [style.width.%]="rssiBarPct(d.avgRssi)"></div>
                  </div>
                  @if (d.worstRssi && d.bestRssi) {
                    <div class="vs-diag-rssi-meta">
                      <span
                        >Peor: <strong>{{ d.worstRssi.rssi }} dBm</strong> ({{
                          d.worstRssi.ch.id
                        }})</span
                      >
                      <span
                        >Mejor: <strong>{{ d.bestRssi.rssi }} dBm</strong> ({{
                          d.bestRssi.ch.id
                        }})</span
                      >
                    </div>
                  }
                </div>

                <div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
                  <span class="text-[10.5px] text-slate-400 font-mono">
                    {{ d.channelsTotal === 0 ? 'Sin canales' : 'Diagnóstico →' }}
                  </span>
                  <span
                    class="material-symbols-outlined text-base text-slate-300 transition-all group-hover:translate-x-0.5"
                    [style.color]="d.color"
                    >chevron_right</span
                  >
                </div>
              </button>
            }
            @if (tapDiagFiltered().length === 0) {
              <div class="vs-empty-overlay col-span-full">
                <span class="material-symbols-outlined text-[28px] text-slate-400"
                  >network_check</span
                >
                <div class="vs-empty-title">Sin TAPs con ese filtro</div>
                <div class="vs-empty-sub">Cambia el filtro o espera la próxima lectura.</div>
              </div>
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

      <!-- Umbrales drawer -->
      @if (umbralesOpen()) {
        <div class="vs-drawer-backdrop" (click)="umbralesOpen.set(false)" aria-hidden="true"></div>
        <aside class="vs-drawer" role="dialog" aria-modal="true" aria-label="Umbrales por sala">
          <header class="vs-drawer-head">
            <div class="min-w-0">
              <div class="vs-drawer-title">Umbrales por sala</div>
              <div class="vs-drawer-sub">Temperatura máxima permitida por área (°C). Editable.</div>
            </div>
            <button
              type="button"
              class="vs-drawer-close"
              (click)="umbralesOpen.set(false)"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </header>
          <div class="vs-drawer-body">
            <div class="vs-thresholds-list">
              @for (t of thresholdsList(); track t.area) {
                <article
                  class="vs-thresholds-card"
                  [class.vs-thresholds-card--missing]="isNaN(t.tMax)"
                >
                  <header class="vs-thresholds-card-head">
                    <span class="vs-thresholds-name truncate" [title]="t.area">{{ t.area }}</span>
                    <span class="vs-thresholds-card-meta">
                      @if (isNaN(t.tMax)) {
                        <span class="vs-thresholds-pending">sin config</span>
                      } @else if (t.updatedAt) {
                        Actualizado {{ relativeIso(t.updatedAt) }}
                        @if (t.updatedBy) {
                          · {{ t.updatedBy }}
                        }
                      }
                    </span>
                    <button
                      type="button"
                      class="vs-thresholds-remove"
                      (click)="removeThreshold(t.area)"
                      title="Quitar"
                      aria-label="Quitar umbral"
                      [disabled]="isNaN(t.tMax)"
                    >
                      <span class="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  </header>

                  <div class="vs-thresholds-fields">
                    <label class="vs-thresholds-field">
                      <span class="vs-thresholds-field-lbl">T máx (°C)</span>
                      <input
                        type="number"
                        step="0.5"
                        class="vs-thresholds-input"
                        [value]="isNaN(t.tMax) ? '' : t.tMax"
                        placeholder="—"
                        (change)="onThresholdMaxChange(t.area, $event)"
                      />
                    </label>
                    <label class="vs-thresholds-field">
                      <span class="vs-thresholds-field-lbl">T mín (°C)</span>
                      <input
                        type="number"
                        step="0.5"
                        class="vs-thresholds-input"
                        [value]="t.tMin ?? ''"
                        placeholder="—"
                        (change)="onThresholdMinChange(t.area, $event)"
                      />
                    </label>
                  </div>

                  <label class="vs-thresholds-field vs-thresholds-field--full">
                    <span class="vs-thresholds-field-lbl">Motivo</span>
                    <input
                      type="text"
                      class="vs-thresholds-input vs-thresholds-input--text"
                      [value]="t.note ?? ''"
                      placeholder="Justificación HACCP…"
                      (change)="onThresholdNoteChange(t.area, $event)"
                    />
                  </label>
                </article>
              }
            </div>

            <div class="vs-thresholds-footer">
              <button
                type="button"
                class="vs-thresholds-reset"
                (click)="resetThresholds()"
                title="Restaurar valores por defecto del cliente"
              >
                <span class="material-symbols-outlined text-[14px]">restart_alt</span>
                Restaurar defaults cliente
              </button>
              <span class="vs-thresholds-hint"> Cambios se guardan automáticamente (local). </span>
            </div>
          </div>
        </aside>
      }

      <!-- Defrost drawer -->
      @if (defrostOpen()) {
        <div class="vs-drawer-backdrop" (click)="defrostOpen.set(false)" aria-hidden="true"></div>
        <aside
          class="vs-drawer vs-drawer--wide"
          role="dialog"
          aria-modal="true"
          aria-label="Ventanas defrost"
        >
          <header class="vs-drawer-head">
            <div class="min-w-0">
              <div class="vs-drawer-title">Ventanas defrost</div>
              <div class="vs-drawer-sub">
                Programá ciclos de descongelado por sala. Desviaciones dentro de la ventana se
                marcan como esperadas (no cuentan como crítico HACCP).
              </div>
            </div>
            <button
              type="button"
              class="vs-drawer-close"
              (click)="defrostOpen.set(false)"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </header>
          <div class="vs-drawer-body vs-defrost-body">
            <div class="vs-defrost-sidebar">
              @for (sa of defrostSchedules(); track sa.slug) {
                <button
                  type="button"
                  class="vs-defrost-sala-btn"
                  [class.vs-defrost-sala-btn--active]="defrostSelectedSlug() === sa.slug"
                  (click)="selectDefrostSala(sa.slug)"
                >
                  <div class="vs-defrost-sala-name truncate">{{ sa.area }}</div>
                  <div class="vs-defrost-sala-meta">{{ defrostSummary(sa.windows) }}</div>
                </button>
              }
            </div>

            <div class="vs-defrost-detail">
              @if (defrostSelected(); as ds) {
                <div class="vs-defrost-detail-head">
                  <div class="vs-defrost-detail-name">{{ ds.area }}</div>
                  <button
                    type="button"
                    class="vs-defrost-add-btn"
                    (click)="addDefrostWindow(ds.area)"
                  >
                    <span class="material-symbols-outlined text-[14px]">add</span>
                    Agregar ventana
                  </button>
                </div>

                @if (ds.windows.length === 0) {
                  <div class="vs-defrost-empty">
                    Sin ventanas configuradas. Click "Agregar ventana" para empezar.
                  </div>
                } @else {
                  @for (w of ds.windows; track w.id) {
                    <article
                      class="vs-defrost-window"
                      [class.vs-defrost-window--disabled]="!w.enabled"
                    >
                      <header class="vs-defrost-window-head">
                        <label class="vs-defrost-toggle">
                          <input
                            type="checkbox"
                            [checked]="w.enabled"
                            (change)="updateDefrostWindowField(ds.area, w.id, 'enabled', $event)"
                          />
                          <span>{{ w.enabled ? 'Activa' : 'Pausada' }}</span>
                        </label>
                        <button
                          type="button"
                          class="vs-defrost-remove"
                          (click)="removeDefrostWindow(ds.area, w.id)"
                          aria-label="Quitar ventana"
                        >
                          <span class="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      </header>

                      <div class="vs-defrost-fields">
                        <div class="vs-defrost-field">
                          <span class="vs-defrost-field-lbl">Inicio</span>
                          <input
                            type="time"
                            class="vs-defrost-input"
                            [value]="w.startHHmm"
                            (change)="updateDefrostWindowField(ds.area, w.id, 'startHHmm', $event)"
                          />
                        </div>
                        <div class="vs-defrost-field">
                          <span class="vs-defrost-field-lbl">Duración (min)</span>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            class="vs-defrost-input vs-defrost-input--num"
                            [value]="w.durationMin"
                            (change)="
                              updateDefrostWindowField(ds.area, w.id, 'durationMin', $event)
                            "
                          />
                        </div>
                      </div>

                      <div class="vs-defrost-days">
                        <span class="vs-defrost-field-lbl">Días</span>
                        <div class="vs-defrost-days-row">
                          @for (d of daysOfWeekChoices; track d.n) {
                            <button
                              type="button"
                              class="vs-defrost-day"
                              [class.vs-defrost-day--active]="hasDefrostDay(ds.area, w.id, d.n)"
                              (click)="toggleDefrostDay(ds.area, w.id, d.n)"
                            >
                              {{ d.lbl }}
                            </button>
                          }
                        </div>
                      </div>
                    </article>
                  }
                }
              } @else {
                <div class="vs-defrost-empty">
                  Selecciona una sala a la izquierda para configurar sus ventanas defrost.
                </div>
              }
            </div>
          </div>
        </aside>
      }

      <!-- Audit log drawer -->
      @if (auditOpen()) {
        <div class="vs-drawer-backdrop" (click)="auditOpen.set(false)" aria-hidden="true"></div>
        <aside
          class="vs-drawer vs-drawer--wide"
          role="dialog"
          aria-modal="true"
          aria-label="Audit log"
        >
          <header class="vs-drawer-head">
            <div class="min-w-0">
              <div class="vs-drawer-title">Auditoría HACCP</div>
              <div class="vs-drawer-sub">
                Registro de cambios: umbrales, defrost schedules, desviaciones. Trazabilidad
                SERNAPESCA.
              </div>
            </div>
            <button
              type="button"
              class="vs-drawer-close"
              (click)="auditOpen.set(false)"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </header>
          <div class="vs-drawer-body vs-audit-body">
            <div class="vs-audit-toolbar">
              <select
                class="vs-audit-filter"
                [value]="auditFilterCategory()"
                (change)="setAuditCategory($event)"
                aria-label="Categoría"
              >
                <option value="">Todas las categorías</option>
                <option value="threshold">Umbrales</option>
                <option value="defrost">Defrost</option>
                <option value="deviation">Desviaciones</option>
              </select>
              <input
                type="date"
                class="vs-audit-filter vs-audit-filter--date"
                [value]="auditFilterFrom()"
                (change)="setAuditFrom($event)"
                aria-label="Desde"
                title="Desde"
              />
              <input
                type="date"
                class="vs-audit-filter vs-audit-filter--date"
                [value]="auditFilterTo()"
                (change)="setAuditTo($event)"
                aria-label="Hasta"
                title="Hasta"
              />
              <input
                type="search"
                class="vs-audit-filter vs-audit-filter--search"
                placeholder="Buscar actor, objetivo, nota…"
                [value]="auditFilterQuery()"
                (input)="setAuditQuery($any($event.target).value)"
                aria-label="Búsqueda"
              />
              <button
                type="button"
                class="vs-audit-btn vs-audit-btn--primary"
                [disabled]="auditFiltered().length === 0"
                (click)="exportAuditCsv()"
                title="Exportar CSV"
              >
                <span class="material-symbols-outlined text-[14px]">download</span>
                CSV
              </button>
              <button
                type="button"
                class="vs-audit-btn vs-audit-btn--danger"
                (click)="clearAudit()"
                [disabled]="auditEntries().length === 0"
                title="Borrar log local"
              >
                <span class="material-symbols-outlined text-[14px]">delete</span>
              </button>
            </div>

            <div class="vs-audit-meta">
              {{ auditFiltered().length }} de {{ auditEntries().length }} entradas
            </div>

            @if (auditFiltered().length === 0) {
              <div class="vs-audit-empty">
                <span class="material-symbols-outlined text-[28px] text-slate-300">history</span>
                <div class="mt-2 text-[13px] font-medium text-slate-500">
                  {{
                    auditEntries().length === 0
                      ? 'Sin registros aún'
                      : 'Sin resultados con esos filtros'
                  }}
                </div>
              </div>
            } @else {
              <div class="vs-audit-list">
                @for (e of auditFiltered(); track e.id) {
                  <article class="vs-audit-row" [attr.data-category]="e.category">
                    <div class="vs-audit-row-head">
                      <span class="vs-audit-cat" [attr.data-category]="e.category">
                        {{ auditCategoryLabel(e.category) }}
                      </span>
                      <span class="vs-audit-action">{{ auditActionLabel(e.action) }}</span>
                      <span class="vs-audit-target" [title]="e.target">{{ e.target }}</span>
                      <span class="vs-audit-ts">{{ auditFmtTs(e.ts) }}</span>
                    </div>
                    <div class="vs-audit-row-body">
                      <span class="vs-audit-actor">
                        <span class="material-symbols-outlined text-[12px]">person</span>
                        {{ e.actor }}
                        @if (e.actorRole) {
                          <span class="vs-audit-role">{{ e.actorRole }}</span>
                        }
                      </span>
                      @if (e.prev !== undefined && e.prev !== null) {
                        <span class="vs-audit-change">
                          <span class="vs-audit-prev">{{ auditFmtValue(e.prev) }}</span>
                          <span class="material-symbols-outlined text-[12px]">arrow_right_alt</span>
                          <span class="vs-audit-next">{{ auditFmtValue(e.next) }}</span>
                        </span>
                      } @else if (e.next !== undefined && e.next !== null) {
                        <span class="vs-audit-change">
                          <span class="vs-audit-next">{{ auditFmtValue(e.next) }}</span>
                        </span>
                      }
                      @if (e.note) {
                        <span class="vs-audit-note">"{{ e.note }}"</span>
                      }
                    </div>
                  </article>
                }
              </div>
            }
          </div>
        </aside>
      }
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
        font-family: var(--font-body);
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

      /* KPI strip: hero + meta inline */
      .vs-kpi-strip {
        padding-left: 2px;
      }
      .vs-kpi-hero-value {
        font-family: var(--font-mono);
        font-size: 44px;
        font-weight: 600;
        line-height: 0.95;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }
      .vs-kpi-hero-label {
        font-family: var(--font-body);
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #94a3b8;
        margin-top: 6px;
      }
      .vs-kpi-meta {
        font-family: var(--font-body);
        font-size: 12.5px;
        color: #64748b;
        padding-bottom: 4px;
      }
      .vs-kpi-meta strong {
        font-family: var(--font-mono);
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
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
        font-family: var(--font-body);
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

      /* Umbrales drawer */
      .vs-drawer-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.42);
        z-index: 40;
        animation: vsFadeIn 0.18s ease;
      }
      .vs-drawer {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(540px, 96vw);
        background: #ffffff;
        border-left: 1px solid #e2e8f0;
        box-shadow: -10px 0 30px rgba(15, 23, 42, 0.1);
        z-index: 41;
        display: flex;
        flex-direction: column;
        animation: vsSlideIn 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes vsFadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes vsSlideIn {
        from {
          transform: translateX(24px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      .vs-drawer-head {
        padding: 14px 16px;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .vs-drawer-title {
        font-family: var(--font-josefin);
        font-size: 15px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .vs-drawer-sub {
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #64748b;
        margin-top: 2px;
      }
      .vs-drawer-close {
        margin-left: auto;
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        color: #64748b;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .vs-drawer-close:hover {
        color: #1e293b;
        background: #f1f5f9;
      }
      .vs-drawer-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }

      .vs-thresholds-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .vs-thresholds-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .vs-thresholds-card--missing {
        background: rgba(251, 191, 36, 0.04);
        border-color: rgba(251, 191, 36, 0.4);
      }
      .vs-thresholds-card-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .vs-thresholds-name {
        font-family: var(--font-josefin);
        font-size: 13.5px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
        flex: 1;
        min-width: 0;
      }
      .vs-thresholds-card-meta {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
      }
      .vs-thresholds-fields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .vs-thresholds-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .vs-thresholds-field--full {
        grid-column: span 2;
      }
      .vs-thresholds-field-lbl {
        font-family: var(--font-dm);
        font-size: 9.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .vs-thresholds-input {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        text-align: right;
        padding: 6px 8px;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        background: #ffffff;
        color: #1e293b;
        width: 100%;
        font-variant-numeric: tabular-nums;
      }
      .vs-thresholds-input--text {
        font-family: var(--font-dm);
        font-weight: 400;
        text-align: left;
        font-size: 12px;
      }
      .vs-thresholds-input:focus {
        outline: 2px solid #0d99a5;
        outline-offset: 1px;
        border-color: #0d99a5;
      }
      .vs-thresholds-card--missing .vs-thresholds-input {
        border-color: rgba(251, 191, 36, 0.4);
      }
      .vs-thresholds-pending {
        font-family: var(--font-mono);
        font-size: 10px;
        color: #b45309;
        background: rgba(251, 191, 36, 0.12);
        border: 1px solid rgba(251, 191, 36, 0.3);
        border-radius: 4px;
        padding: 1px 5px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .vs-thresholds-remove {
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        color: #94a3b8;
        background: transparent;
      }
      .vs-thresholds-remove:hover {
        color: #dc2626;
        background: rgba(239, 68, 68, 0.08);
      }
      .vs-thresholds-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 14px;
        gap: 10px;
      }
      .vs-thresholds-reset {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 500;
      }
      .vs-thresholds-reset:hover {
        color: #0d99a5;
        background: rgba(13, 175, 189, 0.06);
      }
      .vs-thresholds-hint {
        font-family: var(--font-dm);
        font-size: 11px;
        color: #94a3b8;
      }

      /* Defrost drawer */
      .vs-drawer--wide {
        width: min(720px, 96vw);
      }
      .vs-defrost-body {
        display: grid;
        grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
        gap: 14px;
        padding: 14px;
      }
      .vs-defrost-sidebar {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 70vh;
        overflow-y: auto;
        padding-right: 4px;
      }
      .vs-defrost-sala-btn {
        text-align: left;
        padding: 8px 10px;
        border-radius: 9px;
        border: 1px solid transparent;
        background: transparent;
        font-family: var(--font-dm);
        transition:
          background 0.15s ease,
          border-color 0.15s ease;
      }
      .vs-defrost-sala-btn:hover {
        background: #f1f5f9;
      }
      .vs-defrost-sala-btn--active {
        background: rgba(13, 175, 189, 0.1);
        border-color: rgba(13, 175, 189, 0.3);
      }
      .vs-defrost-sala-name {
        font-size: 12.5px;
        font-weight: 600;
        color: #1e293b;
      }
      .vs-defrost-sala-meta {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .vs-defrost-detail {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .vs-defrost-detail-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 8px;
      }
      .vs-defrost-detail-name {
        font-family: var(--font-josefin);
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .vs-defrost-add-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 8px;
        background: #0d99a5;
        color: #ffffff;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 600;
        border: 1px solid #0d99a5;
      }
      .vs-defrost-add-btn:hover {
        background: #0a7d87;
        border-color: #0a7d87;
      }
      .vs-defrost-empty {
        padding: 28px 16px;
        text-align: center;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #94a3b8;
        background: #f8fafc;
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
      }
      .vs-defrost-window {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #ffffff;
      }
      .vs-defrost-window--disabled {
        opacity: 0.55;
        background: #f8fafc;
      }
      .vs-defrost-window-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .vs-defrost-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 600;
        color: #475569;
        cursor: pointer;
      }
      .vs-defrost-toggle input {
        accent-color: #0d99a5;
      }
      .vs-defrost-remove {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        background: transparent;
        color: #94a3b8;
        border: 0;
      }
      .vs-defrost-remove:hover {
        color: #dc2626;
        background: rgba(239, 68, 68, 0.08);
      }

      .vs-defrost-fields {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .vs-defrost-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .vs-defrost-field-lbl {
        font-family: var(--font-dm);
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .vs-defrost-input {
        font-family: var(--font-mono);
        font-size: 12.5px;
        padding: 6px 8px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        background: #ffffff;
        color: #1e293b;
      }
      .vs-defrost-input--num {
        width: 90px;
      }
      .vs-defrost-input:focus {
        outline: 2px solid #0d99a5;
        outline-offset: 1px;
        border-color: #0d99a5;
      }

      .vs-defrost-days {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .vs-defrost-days-row {
        display: flex;
        gap: 4px;
      }
      .vs-defrost-day {
        width: 30px;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 7px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        color: #94a3b8;
        cursor: pointer;
      }
      .vs-defrost-day:hover {
        color: #475569;
      }
      .vs-defrost-day--active {
        background: rgba(13, 175, 189, 0.1);
        border-color: rgba(13, 175, 189, 0.4);
        color: #0d99a5;
      }

      /* Compliance dashboard */
      .comp-period-pills {
        display: inline-flex;
        gap: 4px;
        padding: 3px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 9px;
      }
      .comp-pill {
        font-family: var(--font-mono);
        font-size: 11.5px;
        font-weight: 600;
        padding: 5px 12px;
        border-radius: 6px;
        color: #64748b;
        background: transparent;
      }
      .comp-pill:hover {
        color: #1e293b;
      }
      .comp-pill--active {
        background: rgba(13, 175, 189, 0.1);
        color: #0d99a5;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
      }

      .comp-hero {
        display: grid;
        grid-template-columns: minmax(260px, 320px) 1fr;
        gap: 20px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        padding: 22px 24px;
        margin-bottom: 16px;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
      }
      @media (max-width: 720px) {
        .comp-hero {
          grid-template-columns: 1fr;
        }
      }
      .comp-hero-main {
        border-right: 1px solid #f1f5f9;
        padding-right: 20px;
      }
      @media (max-width: 720px) {
        .comp-hero-main {
          border-right: 0;
          padding-right: 0;
        }
      }
      .comp-hero-pct {
        font-family: var(--font-mono);
        font-size: 56px;
        font-weight: 600;
        line-height: 0.95;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .comp-hero-pct-unit {
        font-size: 28px;
        font-weight: 500;
        color: #94a3b8;
        margin-left: 2px;
      }
      .comp-hero-lbl {
        font-family: var(--font-dm);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #94a3b8;
        margin-top: 6px;
      }
      .comp-hero-tag {
        display: inline-block;
        margin-top: 10px;
        padding: 3px 10px;
        border: 1px solid;
        border-radius: 999px;
        font-family: var(--font-dm);
        font-size: 11px;
        font-weight: 600;
      }
      .comp-hero-meta {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        align-items: start;
      }
      @media (max-width: 720px) {
        .comp-hero-meta {
          grid-template-columns: 1fr;
        }
      }
      .comp-hero-meta-lbl {
        font-family: var(--font-dm);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #94a3b8;
      }
      .comp-hero-meta-val {
        font-family: var(--font-mono);
        font-size: 26px;
        font-weight: 600;
        color: #1e293b;
        margin-top: 4px;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .comp-hero-meta-sub {
        font-family: var(--font-dm);
        font-size: 11px;
        color: #64748b;
        margin-top: 4px;
      }

      .comp-section {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 16px 18px;
        margin-bottom: 12px;
      }
      .comp-section-title {
        font-family: var(--font-dm);
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #475569;
        margin: 0 0 12px;
        display: flex;
        align-items: baseline;
        gap: 8px;
      }
      .comp-section-meta {
        font-family: var(--font-dm);
        font-size: 10.5px;
        text-transform: none;
        letter-spacing: 0;
        color: #94a3b8;
        font-weight: 500;
      }

      .comp-severity-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
      }
      .comp-severity-card {
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid;
      }
      .comp-severity-card--info {
        background: rgba(56, 189, 248, 0.06);
        border-color: rgba(14, 165, 233, 0.25);
      }
      .comp-severity-card--warn {
        background: rgba(245, 158, 11, 0.06);
        border-color: rgba(245, 158, 11, 0.28);
      }
      .comp-severity-card--crit {
        background: rgba(239, 68, 68, 0.06);
        border-color: rgba(239, 68, 68, 0.28);
      }
      .comp-severity-card--severe {
        background: rgba(185, 28, 28, 0.08);
        border-color: rgba(185, 28, 28, 0.35);
      }
      .comp-severity-val {
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 600;
        color: #1e293b;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .comp-severity-lbl {
        font-family: var(--font-dm);
        font-size: 11px;
        color: #475569;
        margin-top: 5px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .comp-trend {
        display: flex;
        gap: 6px;
        align-items: flex-end;
        height: 110px;
        padding: 4px 2px;
      }
      .comp-trend-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }
      .comp-trend-bar {
        width: 100%;
        max-width: 28px;
        border-radius: 4px 4px 0 0;
        transition:
          height 0.25s ease,
          background 0.25s ease;
      }
      .comp-trend-lbl {
        font-family: var(--font-mono);
        font-size: 9.5px;
        color: #94a3b8;
      }

      .comp-ranking {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .comp-rank-row {
        display: grid;
        grid-template-columns: minmax(0, 1.4fr) 70px minmax(120px, 1fr) 70px 70px;
        align-items: center;
        gap: 12px;
        padding: 8px 4px;
        border-bottom: 1px solid #f1f5f9;
      }
      .comp-rank-row:last-child {
        border-bottom: 0;
      }
      .comp-rank-name {
        font-family: var(--font-dm);
        font-size: 12.5px;
        color: #1e293b;
      }
      .comp-rank-pct {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .comp-rank-bar-wrap {
        height: 6px;
        background: #f1f5f9;
        border-radius: 3px;
        overflow: hidden;
      }
      .comp-rank-bar {
        display: block;
        height: 100%;
        transition: width 0.3s ease;
      }
      .comp-rank-out,
      .comp-rank-devs {
        font-family: var(--font-mono);
        font-size: 11px;
        color: #64748b;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .comp-causes {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .comp-cause-bar {
        display: flex;
        height: 18px;
        border-radius: 999px;
        overflow: hidden;
        background: #f1f5f9;
      }
      .comp-cause-seg {
        display: block;
        height: 100%;
        transition: width 0.3s ease;
      }
      .comp-cause-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }
      .comp-cause-item {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #475569;
      }
      .comp-cause-dot {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 3px;
      }
      .comp-cause-item strong {
        font-family: var(--font-mono);
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .comp-cause-pct {
        color: #94a3b8;
        font-family: var(--font-mono);
        font-size: 10.5px;
      }

      .comp-empty {
        padding: 16px;
        text-align: center;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #94a3b8;
      }
      .comp-footer-meta {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-top: 6px;
        padding: 6px 10px;
        background: #f8fafc;
        border-radius: 8px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #64748b;
      }

      /* Audit log drawer */
      .audit-count-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 16px;
        padding: 0 5px;
        border-radius: 999px;
        background: rgba(13, 175, 189, 0.15);
        color: #0d99a5;
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 700;
      }
      .vs-audit-body {
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .vs-audit-toolbar {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
      }
      .vs-audit-filter {
        font-family: var(--font-dm);
        font-size: 11.5px;
        padding: 6px 10px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        color: #1e293b;
      }
      .vs-audit-filter:focus {
        outline: 2px solid #0d99a5;
        outline-offset: 1px;
        border-color: #0d99a5;
      }
      .vs-audit-filter--search {
        flex: 1;
        min-width: 200px;
      }
      .vs-audit-filter--date {
        width: 140px;
      }
      .vs-audit-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .vs-audit-btn:hover {
        background: #f8fafc;
      }
      .vs-audit-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .vs-audit-btn--primary {
        background: #0d99a5;
        color: #ffffff;
        border-color: #0d99a5;
      }
      .vs-audit-btn--primary:hover {
        background: #0a7d87;
      }
      .vs-audit-btn--danger {
        color: #94a3b8;
      }
      .vs-audit-btn--danger:hover {
        color: #dc2626;
        background: rgba(239, 68, 68, 0.08);
      }

      .vs-audit-meta {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .vs-audit-empty {
        padding: 36px 16px;
        text-align: center;
        background: #f8fafc;
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
      }

      .vs-audit-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 55vh;
        overflow-y: auto;
        padding-right: 4px;
      }
      .vs-audit-row {
        padding: 10px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #ffffff;
      }
      .vs-audit-row[data-category='threshold'] {
        border-left: 3px solid #0d99a5;
      }
      .vs-audit-row[data-category='defrost'] {
        border-left: 3px solid #0ea5e9;
      }
      .vs-audit-row[data-category='deviation'] {
        border-left: 3px solid #ef4444;
      }
      .vs-audit-row-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .vs-audit-cat {
        font-family: var(--font-mono);
        font-size: 9.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 6px;
        border-radius: 999px;
      }
      .vs-audit-cat[data-category='threshold'] {
        background: rgba(13, 175, 189, 0.1);
        color: #0d99a5;
      }
      .vs-audit-cat[data-category='defrost'] {
        background: rgba(14, 165, 233, 0.1);
        color: #0369a1;
      }
      .vs-audit-cat[data-category='deviation'] {
        background: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
      }
      .vs-audit-action {
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 600;
        color: #1e293b;
      }
      .vs-audit-target {
        font-family: var(--font-mono);
        font-size: 11.5px;
        color: #475569;
        background: #f1f5f9;
        border-radius: 4px;
        padding: 1px 6px;
        max-width: 280px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .vs-audit-ts {
        margin-left: auto;
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: #94a3b8;
      }
      .vs-audit-row-body {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #475569;
      }
      .vs-audit-actor {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .vs-audit-role {
        font-family: var(--font-mono);
        font-size: 9.5px;
        color: #94a3b8;
        background: #f1f5f9;
        border-radius: 4px;
        padding: 1px 5px;
        margin-left: 4px;
      }
      .vs-audit-change {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-mono);
        font-size: 11px;
      }
      .vs-audit-prev {
        color: #94a3b8;
        text-decoration: line-through;
      }
      .vs-audit-next {
        color: #0d99a5;
      }
      .vs-audit-note {
        font-style: italic;
        color: #64748b;
      }

      /* TAPS tab grid */
      .vs-taps-grid {
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      }
      .vs-salas-grid {
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      }
      .vs-tap-summary-title {
        font-family: var(--font-josefin);
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.02em;
      }
      .vs-sala-summary-hr {
        font-size: 10px;
        font-family: var(--font-mono);
      }

      /* Sala card (new layout) */
      .sala-card {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 14px;
        width: 100%;
        padding: 16px;
        text-align: left;
        cursor: pointer;
        border-radius: 16px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
        transition:
          transform 0.18s ease,
          box-shadow 0.18s ease,
          border-color 0.15s ease;
      }
      .sala-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
      }
      .sala-card[data-status='crit'] {
        border-color: rgba(239, 68, 68, 0.3);
        box-shadow: 0 6px 18px rgba(239, 68, 68, 0.1);
      }
      .sala-card[data-status='crit']:hover {
        box-shadow: 0 12px 30px rgba(239, 68, 68, 0.15);
      }
      .sala-card[data-status='warn'] {
        border-color: rgba(245, 158, 11, 0.32);
        box-shadow: 0 6px 18px rgba(245, 158, 11, 0.1);
      }
      .sala-card[data-status='ok']::before {
        content: '';
        position: absolute;
        left: 0;
        top: 16px;
        bottom: 16px;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, #22c55e, #16a34a);
        opacity: 0.85;
      }
      .sala-card[data-status='crit']::before {
        content: '';
        position: absolute;
        left: 0;
        top: 16px;
        bottom: 16px;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, #ef4444, #b91c1c);
      }
      .sala-card[data-status='warn']::before {
        content: '';
        position: absolute;
        left: 0;
        top: 16px;
        bottom: 16px;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, #f59e0b, #d97706);
      }

      .sala-card-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .sala-card-icon {
        display: flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        border-radius: 11px;
        border: 1px solid;
        flex-shrink: 0;
      }
      .sala-card-title {
        font-family: var(--font-josefin);
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.02em;
        color: #1e293b;
        line-height: 1.1;
        margin: 0;
      }
      .sala-card-sub {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
        margin-top: 2px;
        line-height: 1.15;
      }
      .sala-card-chev {
        font-size: 22px;
        color: #cbd5e1;
        transition:
          transform 0.18s ease,
          color 0.15s ease;
      }
      .sala-card:hover .sala-card-chev {
        transform: translateX(2px);
        color: #475569;
      }

      .sala-card-hero {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        padding: 4px 2px 0;
      }
      .sala-actual-val {
        font-family: var(--font-mono);
        font-size: 34px;
        font-weight: 600;
        line-height: 1;
        letter-spacing: -0.02em;
        font-variant-numeric: tabular-nums;
      }
      .sala-actual-unit {
        font-size: 18px;
        font-weight: 500;
        color: #94a3b8;
        margin-left: 1px;
      }
      .sala-actual-lbl {
        font-family: var(--font-dm);
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #94a3b8;
        margin-top: 4px;
      }

      .sala-threshold-chip {
        display: inline-flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 1px;
        padding: 6px 10px;
        border-radius: 10px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .sala-threshold-chip[data-status='crit'] {
        background: rgba(239, 68, 68, 0.06);
        border-color: rgba(239, 68, 68, 0.22);
      }
      .sala-threshold-chip[data-status='warn'] {
        background: rgba(245, 158, 11, 0.08);
        border-color: rgba(245, 158, 11, 0.25);
      }
      .sala-threshold-chip[data-status='unset'] {
        border-style: dashed;
        background: transparent;
      }
      .sala-threshold-lbl {
        font-family: var(--font-dm);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #94a3b8;
      }
      .sala-threshold-val {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .sala-threshold-chip[data-status='unset'] .sala-threshold-val {
        font-size: 10px;
        font-weight: 500;
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .sala-stats-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        padding: 8px 4px;
        border-top: 1px solid #f1f5f9;
        border-bottom: 1px solid #f1f5f9;
      }
      .sala-stat {
        display: flex;
        flex-direction: column;
        gap: 1px;
        align-items: center;
        flex: 1;
        min-width: 0;
      }
      .sala-stat-lbl {
        font-family: var(--font-dm);
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: #94a3b8;
      }
      .sala-stat-val {
        font-family: var(--font-mono);
        font-size: 12.5px;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .sala-stat-divider {
        width: 1px;
        height: 22px;
        background: #e2e8f0;
      }

      .sala-card-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: auto;
        padding-top: 8px;
        border-top: 1px solid #f1f5f9;
      }
      .sala-status {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-family: var(--font-dm);
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 999px;
      }
      .sala-status--crit {
        background: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
        border: 1px solid rgba(239, 68, 68, 0.22);
      }
      .sala-status--warn {
        background: rgba(245, 158, 11, 0.1);
        color: #b45309;
        border: 1px solid rgba(245, 158, 11, 0.25);
      }
      .sala-status--ok {
        background: rgba(34, 197, 94, 0.1);
        color: #15803d;
        border: 1px solid rgba(34, 197, 94, 0.22);
      }
      .sala-status--unknown {
        background: #f1f5f9;
        color: #64748b;
        border: 1px solid #e2e8f0;
      }
      .sala-status--info {
        background: rgba(56, 189, 248, 0.12);
        color: #0369a1;
        border: 1px solid rgba(14, 165, 233, 0.3);
      }
      .sala-status--severe {
        background: #b91c1c;
        color: #ffffff;
        border: 1px solid #991b1b;
        animation: salaSeverePulse 1.4s ease-in-out infinite;
      }
      @keyframes salaSeverePulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(185, 28, 28, 0.55);
        }
        70% {
          box-shadow: 0 0 0 6px rgba(185, 28, 28, 0);
        }
      }
      .sala-card[data-status='crit'] .sala-status--severe {
        color: #fff;
      }
      .sala-hr {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 9px;
        border-radius: 999px;
        background: rgba(14, 165, 233, 0.1);
        color: #0369a1;
        border: 1px solid rgba(14, 165, 233, 0.3);
        font-family: var(--font-mono);
        font-size: 11.5px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        cursor: help;
      }
      .sala-hr-lbl {
        font-family: var(--font-dm);
        font-size: 9.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        opacity: 0.75;
      }

      .sala-spark-wrap {
        position: relative;
        margin-top: -2px;
      }
      .sala-spark {
        width: 100%;
        height: 32px;
        cursor: crosshair;
        display: block;
      }
      .sala-spark-axis {
        display: flex;
        justify-content: space-between;
        margin-top: 1px;
        font-family: var(--font-dm);
        font-size: 9px;
        color: #cbd5e1;
        letter-spacing: 0.04em;
      }
      .sala-spark-tooltip {
        position: absolute;
        top: -2px;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 4px 7px;
        border-radius: 6px;
        background: #1e293b;
        color: #f8fafc;
        font-family: var(--font-dm);
        font-size: 10px;
        line-height: 1.2;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.2);
        z-index: 3;
      }
      .sala-spark-tooltip strong {
        font-family: var(--font-mono);
        font-size: 11.5px;
        font-weight: 700;
      }
      .sala-spark-tooltip span {
        font-size: 9px;
        opacity: 0.7;
        margin-top: 1px;
      }
      .sala-spark-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        height: 32px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #cbd5e1;
        font-style: italic;
      }
      .sala-spark-empty .material-symbols-outlined {
        color: #cbd5e1;
      }

      .sala-ops-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .sala-op-pill {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 8px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #475569;
      }
      .sala-op-pill .sala-op-lbl {
        color: #94a3b8;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-size: 9.5px;
      }
      .sala-op-pill strong {
        font-family: var(--font-mono);
        font-size: 11.5px;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .sala-op-pill .material-symbols-outlined {
        color: #94a3b8;
      }
      .sala-op-pill--bad {
        background: rgba(239, 68, 68, 0.06);
        border-color: rgba(239, 68, 68, 0.22);
      }
      .sala-op-pill--bad strong {
        color: #b91c1c;
      }
      .sala-op-pill--bad .sala-op-lbl {
        color: #b91c1c;
        opacity: 0.7;
      }
      .sala-op-pill--bad .material-symbols-outlined {
        color: #b91c1c;
      }
      .sala-op-pill--empty {
        background: rgba(148, 163, 184, 0.08);
        border-style: dashed;
      }

      /* Diag KPI strip */
      .vs-diag-kpi {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 10px;
      }
      .vs-diag-kpi-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px 12px;
      }
      .vs-diag-kpi-card--ok {
        border-color: rgba(34, 197, 94, 0.25);
        background: rgba(34, 197, 94, 0.04);
      }
      .vs-diag-kpi-card--warn {
        border-color: rgba(251, 191, 36, 0.3);
        background: rgba(251, 191, 36, 0.05);
      }
      .vs-diag-kpi-card--err {
        border-color: rgba(239, 68, 68, 0.3);
        background: rgba(239, 68, 68, 0.05);
      }
      .vs-diag-kpi-val {
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 600;
        color: #1e293b;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .vs-diag-kpi-lbl {
        font-family: var(--font-dm);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
        margin-top: 5px;
      }

      /* Toolbar */
      .vs-diag-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 14px;
        padding: 8px 10px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }
      .vs-diag-filter,
      .vs-diag-sort {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .vs-diag-filter-lbl {
        font-family: var(--font-dm);
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .vs-diag-pill {
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        transition:
          background 0.15s ease,
          color 0.15s ease,
          border-color 0.15s ease;
      }
      .vs-diag-pill:hover {
        color: #1e293b;
      }
      .vs-diag-pill--active {
        background: rgba(2, 132, 199, 0.1);
        color: #0284c7;
        border-color: rgba(2, 132, 199, 0.3);
      }
      .vs-diag-select {
        font-family: var(--font-dm);
        font-size: 11.5px;
        padding: 4px 8px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        color: #475569;
      }

      /* TAP diag card */
      .vs-tap-diag {
        position: relative;
        text-align: left;
        box-shadow: 0 4px 14px rgba(15, 23, 42, 0.04);
        border-color: #e2e8f0;
      }
      .vs-tap-diag[data-status='offline'] {
        border-color: rgba(239, 68, 68, 0.3);
        box-shadow: 0 6px 18px rgba(239, 68, 68, 0.08);
      }
      .vs-tap-diag[data-status='degraded'] {
        border-color: rgba(251, 191, 36, 0.3);
        box-shadow: 0 6px 18px rgba(251, 191, 36, 0.08);
      }
      .vs-status-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px;
        border-radius: 999px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        font-weight: 600;
        background: rgba(34, 197, 94, 0.1);
        color: #15803d;
        border: 1px solid rgba(34, 197, 94, 0.22);
      }
      .vs-status-pill[data-status='degraded'] {
        background: rgba(251, 191, 36, 0.12);
        color: #b45309;
        border-color: rgba(251, 191, 36, 0.3);
      }
      .vs-status-pill[data-status='offline'] {
        background: rgba(239, 68, 68, 0.12);
        color: #b91c1c;
        border-color: rgba(239, 68, 68, 0.3);
      }
      .vs-status-pill[data-status='unknown'] {
        background: #f1f5f9;
        color: #64748b;
        border-color: #e2e8f0;
      }
      .vs-status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .vs-tap-diag[data-status='online'] .vs-status-dot {
        animation: vsLivePulse 1.6s ease-in-out infinite;
      }
      @keyframes vsLivePulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }

      .vs-diag-channels-row,
      .vs-diag-rssi-head {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 4px;
      }
      .vs-diag-channels-lbl {
        font-family: var(--font-dm);
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94a3b8;
      }
      .vs-diag-channels-val,
      .vs-diag-rssi-val {
        font-family: var(--font-mono);
        font-size: 12.5px;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .vs-diag-stale {
        color: #dc2626;
        font-size: 10.5px;
        font-weight: 500;
      }
      .vs-diag-channels-bar,
      .vs-diag-rssi-bar {
        height: 6px;
        background: #f1f5f9;
        border-radius: 3px;
        overflow: hidden;
      }
      .vs-diag-channels-fill,
      .vs-diag-rssi-fill {
        height: 100%;
        transition: width 0.3s ease;
      }
      .vs-diag-rssi-fill {
        background: linear-gradient(90deg, #ef4444, #f59e0b 40%, #22c55e 75%);
      }
      .vs-diag-rssi-tag {
        font-family: var(--font-dm);
        font-size: 10px;
        font-weight: 500;
        color: #64748b;
        margin-left: 4px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .vs-diag-rssi-meta {
        display: flex;
        justify-content: space-between;
        margin-top: 5px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #64748b;
      }
      .vs-diag-rssi-meta strong {
        font-family: var(--font-mono);
        color: #1e293b;
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
  private readonly coldRoom = inject(ColdRoomService);
  private readonly thresholdsSvc = inject(ColdRoomThresholdsService);
  private readonly deviationsSvc = inject(ColdRoomDeviationsService);
  private readonly defrostSvc = inject(ColdRoomDefrostService);
  private readonly auditSvc = inject(ColdRoomAuditService);

  readonly siteId = input.required<string>();
  readonly siteName = input<string>('');
  readonly companyName = input<string>('');
  readonly coldRoomSites = input<SiteRecord[]>([]);
  readonly embedded = input<boolean>(false);
  readonly view = input<
    'full' | 'general' | 'salas' | 'compliance' | 'taps' | 'eventos' | 'contacts'
  >('full');

  readonly tapSiteMap = computed<Record<TapKey, string>>(() => {
    const sites = this.coldRoomSites();
    const map: Record<TapKey, string> = {};
    sites.forEach((site, i) => {
      map[tapKeyFor(i)] = site.id;
    });
    return map;
  });

  tapRouterLink(tap: TapKey): string[] {
    const tapSiteId = this.tapSiteMap()[tap] ?? this.siteId();
    return ['/companies', tapSiteId, 'tap', tap.replace(' ', '-')];
  }

  tapDiagRouterLink(tap: TapKey): string[] {
    const tapSiteId = this.tapSiteMap()[tap] ?? this.siteId();
    return ['/companies', tapSiteId, 'tap', tap.replace(' ', '-'), 'diag'];
  }

  readonly siteTitle = computed(() => {
    const name = this.siteName().trim();
    const company = this.companyName().trim();
    if (company && name) return `${company} · ${name}`;
    return name || company || 'Cámara frío';
  });

  readonly effectiveTab = computed<TabKey>(() => {
    const v = this.view();
    if (
      v === 'general' ||
      v === 'salas' ||
      v === 'compliance' ||
      v === 'taps' ||
      v === 'eventos' ||
      v === 'contacts'
    )
      return v;
    return this.activeTab();
  });

  readonly metric = signal<MetricKey>('T');
  readonly selectedId = signal<string | null>(null);
  readonly now = signal<number>(Date.now());
  readonly hiddenSensors = signal<Set<string>>(new Set<string>());
  readonly activeTab = signal<TabKey>('salas');

  readonly taps = computed<TapKey[]>(() => {
    const sites = this.coldRoomSites();
    return buildTapKeys(Math.max(sites.length, 1));
  });
  readonly tapColors = computed<Record<TapKey, string>>(() => {
    const sites = this.coldRoomSites();
    return buildTapColors(Math.max(sites.length, 1));
  });
  readonly metricOptions: MetricOption[] = [
    { v: 'T', icon: 'thermostat', label: 'Temperatura' },
    { v: 'H', icon: 'water_drop', label: 'Humedad' },
    { v: 'A', icon: 'gpp_maybe', label: 'Alertas' },
  ];

  readonly sensors = toSignal(this.service.sensors$, { initialValue: [] as Sensor[] });
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
    { key: 'salas', icon: 'space_dashboard', label: 'Salas' },
    { key: 'compliance', icon: 'verified', label: 'Compliance HACCP' },
    { key: 'taps', icon: 'memory', label: 'TAP (técnico)' },
  ]);

  salaSlug(area: string): string {
    return area
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  salaRouterLink(area: string): string[] {
    return ['/companies', this.siteId(), 'sala', this.salaSlug(area)];
  }

  // Rich data (with histPoints + lastSeen). Fed when Salas tab active.
  readonly coldRoomSensors = signal<ColdRoomSensor[]>([]);
  private coldRoomPollTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly STALE_MS = 60_000;

  readonly salaAggregates = computed<SalaAggregate[]>(() => {
    this.thresholdsSvc.thresholds();
    this.now();
    const rich = this.coldRoomSensors();

    // Primary grouping by ColdRoom data (authoritative source for area names).
    const byArea = new Map<string, ColdRoomSensor[]>();
    for (const r of rich) {
      const key = (r.area || '—').trim();
      const list = byArea.get(key) || [];
      list.push(r);
      byArea.set(key, list);
    }
    // Fallback: si ColdRoom polling no activo, usar VentisquerosService sensors
    // mapeados a shape compatible (sin histPoints/lastSeen).
    if (byArea.size === 0) {
      for (const s of this.sensors()) {
        const key = (s.area || '—').trim();
        const list = byArea.get(key) || [];
        list.push({
          id: s.id,
          tap: s.tap,
          area: s.area,
          cx: s.cx,
          cy: s.cy,
          r: s.r,
          t: s.t,
          h: s.h,
          alerted: s.alerted,
          setpoint: 0,
          tMin: -100,
          tMax: 100,
          lastSeen: '',
          hist: s.hist || [],
          histPoints: [],
        } as ColdRoomSensor);
        byArea.set(key, list);
      }
    }

    const out: SalaAggregate[] = [];
    for (const [area, sensors] of byArea) {
      const ts = sensors.map((s) => s.t);
      const hs = sensors.map((s) => s.h);
      const taps = Array.from(new Set(sensors.map((s) => s.tap))).sort();
      const maxTNum = sensors.length ? Math.max(...ts) : 0;
      const th = this.thresholdsSvc.get(area);
      const alerts = sensors.filter((s) =>
        th ? this.thresholdsSvc.isSensorOutOfBand(area, s.t) : s.alerted,
      ).length;
      const actualNum = sensors.length ? ts.reduce((a, b) => a + b, 0) / ts.length : 0;
      const allHist = sensors.flatMap((s) => s.hist || []);
      const histAvg = allHist.length
        ? allHist.reduce((a, b) => a + b, 0) / allHist.length
        : actualNum;
      const { spark, outOfBandMin } = this.computeSparkAndOutOfBand(sensors, th?.tMax ?? null);
      const reportingCount = this.computeReportingCount(sensors);
      const deviations = this.deviationsSvc.detect(sensors);
      const ongoing = deviations.filter((e) => e.ongoing);
      const open = deviations.filter((e) => this.deviationsSvc.isOpen(e));
      const longestOngoing = ongoing.reduce((m, e) => Math.max(m, e.durationMin), 0);
      const level =
        sensors.length === 0
          ? 'unknown'
          : this.thresholdsSvc.evaluateLevel(area, maxTNum, longestOngoing);
      const status: SalaAggregate['status'] =
        level === 'severe' || level === 'crit'
          ? 'crit'
          : level === 'warn' || level === 'info'
            ? 'warn'
            : level === 'ok'
              ? 'ok'
              : 'unknown';
      // Sensors aggregate keeps minimal shape needed by SalaAggregate (Sensor[] type).
      const sensorsAsLegacy: Sensor[] = sensors.map((s) => ({
        id: s.id,
        tap: s.tap,
        area: s.area,
        cx: s.cx,
        cy: s.cy,
        r: s.r,
        t: s.t,
        h: s.h,
        hist: s.hist,
        alerted: s.alerted,
      }));
      const minTNum = sensors.length ? Math.min(...ts) : 0;
      out.push({
        area,
        slug: this.salaSlug(area),
        count: sensors.length,
        alerts,
        actualT: sensors.length ? actualNum.toFixed(1) : '—',
        actualTNum: actualNum,
        avgT: sensors.length ? histAvg.toFixed(1) : '—',
        avgTNum: histAvg,
        avgH: sensors.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : 0,
        minT: sensors.length ? minTNum.toFixed(1) : '—',
        minTNum,
        maxT: sensors.length ? maxTNum.toFixed(1) : '—',
        maxTNum,
        taps,
        sensors: sensorsAsLegacy,
        thresholdMax: th?.tMax ?? null,
        level,
        status,
        spark,
        outOfBandMin,
        reportingCount,
        deviationsOpenCount: open.length,
        deviationsOngoing: ongoing.length,
      });
    }
    out.sort((a, b) => {
      const rank = (l: SalaAggregate['level']) =>
        l === 'severe'
          ? 0
          : l === 'crit'
            ? 1
            : l === 'warn'
              ? 2
              : l === 'info'
                ? 3
                : l === 'unknown'
                  ? 4
                  : 5;
      if (rank(a.level) !== rank(b.level)) return rank(a.level) - rank(b.level);
      return a.area.localeCompare(b.area);
    });
    return out;
  });

  // === Compliance dashboard ===
  readonly compliancePeriod = signal<'24h' | '7d'>('24h');

  readonly complianceMetrics = computed(() => {
    this.thresholdsSvc.thresholds();
    this.now();
    const sensors = this.coldRoomSensors();
    const devsAll = this.deviationsSvc.detect(sensors);
    const period = this.compliancePeriod();

    // Sample-based computation: each histPoint is 1min (24h) or 1h (7d).
    let sampleIntervalMin = 1;
    let pointsPerSensor = 0;
    if (sensors.length > 0 && sensors[0].histPoints?.length) {
      const pts = sensors[0].histPoints;
      pointsPerSensor = pts.length;
      if (pts.length >= 2) {
        const a = new Date(pts[0].t).getTime();
        const b = new Date(pts[1].t).getTime();
        if (b > a) sampleIntervalMin = (b - a) / 60000;
      }
    }
    const totalMinPerSensor = pointsPerSensor * sampleIntervalMin;

    // Group sensors by area for per-sala compliance.
    const byArea = new Map<string, typeof sensors>();
    for (const s of sensors) {
      const list = byArea.get(s.area) || [];
      list.push(s);
      byArea.set(s.area, list);
    }

    let globalOutMin = 0;
    let globalTotalMin = 0;
    const salaMetrics: Array<{
      area: string;
      slug: string;
      outMin: number;
      compliancePct: number;
      devs: number;
      level: 'ok' | 'warn' | 'crit' | 'severe' | 'unknown';
    }> = [];

    for (const [area, list] of byArea) {
      const th = this.thresholdsSvc.get(area);
      let outMin = 0;
      if (th && list[0]?.histPoints?.length) {
        const N = list[0].histPoints.length;
        for (let i = 0; i < N; i++) {
          let maxV = -Infinity;
          for (const s of list) {
            const v = s.histPoints?.[i]?.v;
            if (typeof v === 'number' && v > maxV) maxV = v;
          }
          if (maxV > th.tMax) outMin += sampleIntervalMin;
        }
      }
      const totalMin = totalMinPerSensor;
      const compliancePct = totalMin > 0 ? ((totalMin - outMin) / totalMin) * 100 : 100;
      const devsCount = devsAll.filter((d) => d.area === area).length;
      const longest = devsAll
        .filter((d) => d.area === area && d.ongoing)
        .reduce((m, d) => Math.max(m, d.durationMin), 0);
      const level =
        list.length === 0
          ? ('unknown' as const)
          : (() => {
              const maxT = Math.max(...list.map((s) => s.t));
              const l = this.thresholdsSvc.evaluateLevel(area, maxT, longest);
              return l === 'info' ? 'ok' : l;
            })();
      salaMetrics.push({
        area,
        slug: this.salaSlug(area),
        outMin,
        compliancePct,
        devs: devsCount,
        level,
      });
      globalOutMin += outMin;
      globalTotalMin += totalMin;
    }
    salaMetrics.sort((a, b) => b.outMin - a.outMin || b.devs - a.devs);

    const globalCompliancePct =
      globalTotalMin > 0 ? ((globalTotalMin - globalOutMin) / globalTotalMin) * 100 : 100;

    // Deviations breakdown.
    const devsByLevel = { warn: 0, crit: 0, severe: 0, info: 0 };
    let devsOpen = 0;
    let devsClosed = 0;
    let mttrSum = 0;
    let mttrCount = 0;
    for (const d of devsAll) {
      if (d.level === 'warn') devsByLevel.warn++;
      else if (d.level === 'crit') devsByLevel.crit++;
      else if (d.level === 'severe') devsByLevel.severe++;
      else if (d.level === 'info') devsByLevel.info++;
      if (this.deviationsSvc.isOpen(d)) devsOpen++;
      else devsClosed++;
      const ack = this.deviationsSvc.getAck(d.id);
      if (ack?.resolved && ack?.resolvedAt) {
        const dur = new Date(ack.resolvedAt).getTime() - new Date(d.startTs).getTime();
        if (dur >= 0 && isFinite(dur)) {
          mttrSum += dur;
          mttrCount++;
        }
      }
    }
    const mttrMin = mttrCount > 0 ? Math.round(mttrSum / mttrCount / 60000) : null;

    // Causes distribution.
    const causeStats = new Map<string, number>();
    for (const d of devsAll) {
      const eff = this.deviationsSvc.effectiveCause(d);
      const key = eff ? eff.cause : 'unclassified';
      causeStats.set(key, (causeStats.get(key) || 0) + 1);
    }
    const totalDevs = devsAll.length || 1;
    const CAUSE_META: Record<string, { label: string; color: string }> = {
      defrost: { label: 'Defrost', color: '#0EA5E9' },
      'door-open': { label: 'Apertura puerta', color: '#A855F7' },
      'load-unload': { label: 'Carga/descarga', color: '#F59E0B' },
      cleaning: { label: 'Limpieza/mantención', color: '#14B8A6' },
      other: { label: 'Otra', color: '#94A3B8' },
      unclassified: { label: 'Sin clasificar', color: '#EF4444' },
    };
    const causes: Array<{ key: string; label: string; count: number; pct: number; color: string }> =
      [];
    for (const [key, count] of causeStats) {
      const meta = CAUSE_META[key] || { label: key, color: '#64748B' };
      causes.push({
        key,
        label: meta.label,
        color: meta.color,
        count,
        pct: (count / totalDevs) * 100,
      });
    }
    causes.sort((a, b) => b.count - a.count);

    // Hourly/daily trend: bucketize sample points and compute % in-band per bucket.
    const trendBuckets = period === '24h' ? 24 : 7;
    const hourlyTrend: Array<{ label: string; pct: number }> = [];
    if (pointsPerSensor > 0) {
      const ptsPerBucket = Math.max(1, Math.floor(pointsPerSensor / trendBuckets));
      for (let b = 0; b < trendBuckets; b++) {
        const startIdx = b * ptsPerBucket;
        const endIdx = Math.min(pointsPerSensor, startIdx + ptsPerBucket);
        let totalSamples = 0;
        let outSamples = 0;
        for (const [area, list] of byArea) {
          const th = this.thresholdsSvc.get(area);
          if (!th) continue;
          for (let i = startIdx; i < endIdx; i++) {
            let maxV = -Infinity;
            for (const s of list) {
              const v = s.histPoints?.[i]?.v;
              if (typeof v === 'number' && v > maxV) maxV = v;
            }
            if (maxV > -Infinity) {
              totalSamples++;
              if (maxV > th.tMax) outSamples++;
            }
          }
        }
        const pct = totalSamples > 0 ? ((totalSamples - outSamples) / totalSamples) * 100 : 100;
        const label = period === '24h' ? `${String(b).padStart(2, '0')}h` : `d-${trendBuckets - b}`;
        hourlyTrend.push({ label, pct });
      }
    }

    return {
      periodLabel: period === '24h' ? 'últimas 24h' : 'últimos 7d',
      windowMin: globalTotalMin,
      sensorCount: sensors.length,
      globalCompliancePct,
      globalOutMin,
      devsTotal: devsAll.length,
      devsOpen,
      devsClosed,
      devsByLevel,
      mttrMin,
      salas: salaMetrics,
      causes,
      hourlyTrend,
    };
  });

  setCompliancePeriod(p: '24h' | '7d'): void {
    if (this.compliancePeriod() === p) return;
    this.compliancePeriod.set(p);
    // Re-fetch coldRoom data for new range (24h is current default).
    // 7d would require extending fetchColdRoomSensors to accept range param.
  }

  compliancePctColor(pct: number): string {
    if (pct >= 99.5) return '#15803D';
    if (pct >= 98) return '#16A34A';
    if (pct >= 95) return '#D97706';
    return '#DC2626';
  }

  compliancePctLabel(pct: number): string {
    if (pct >= 99.5) return 'Excelente';
    if (pct >= 98) return 'Aceptable';
    if (pct >= 95) return 'En riesgo';
    return 'No conforme';
  }

  trendBarHeight(pct: number, maxH: number): number {
    const clamped = Math.max(0, Math.min(100, pct));
    return Math.max(2, (clamped / 100) * maxH);
  }

  trendBarColor(pct: number): string {
    if (pct >= 99.5) return '#22C55E';
    if (pct >= 98) return '#84CC16';
    if (pct >= 95) return '#F59E0B';
    return '#EF4444';
  }

  fmtComplianceMin(min: number): string {
    if (!min) return '0m';
    if (min < 60) return `${Math.round(min)}m`;
    const h = Math.floor(min / 60);
    const m = Math.round(min - h * 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  // === Umbrales drawer ===
  readonly umbralesOpen = signal<boolean>(false);

  // === Spark hover interactivo ===
  readonly sparkHoverSlug = signal<string | null>(null);
  readonly sparkHoverIdx = signal<number>(0);

  onSparkMove(ev: MouseEvent, sa: SalaAggregate): void {
    if (sa.spark.length < 2) return;
    const target = ev.currentTarget as SVGElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = ev.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    const idx = Math.round(pct * (sa.spark.length - 1));
    this.sparkHoverSlug.set(sa.slug);
    this.sparkHoverIdx.set(idx);
  }

  onSparkLeave(): void {
    this.sparkHoverSlug.set(null);
  }

  sparkHoverValue(sa: SalaAggregate): number | null {
    if (this.sparkHoverSlug() !== sa.slug || sa.spark.length === 0) return null;
    const idx = Math.max(0, Math.min(sa.spark.length - 1, this.sparkHoverIdx()));
    return sa.spark[idx];
  }

  sparkHoverTime(sa: SalaAggregate): string {
    if (this.sparkHoverSlug() !== sa.slug || sa.spark.length === 0) return '';
    const idx = Math.max(0, Math.min(sa.spark.length - 1, this.sparkHoverIdx()));
    // 24h preset = 1 sample/min. Newer = higher idx.
    const minutesAgo = sa.spark.length - 1 - idx;
    if (minutesAgo < 1) return 'ahora';
    if (minutesAgo < 60) return `hace ${minutesAgo}m`;
    const h = Math.floor(minutesAgo / 60);
    const m = minutesAgo % 60;
    return m === 0 ? `hace ${h}h` : `hace ${h}h ${m}m`;
  }

  sparkHoverXPct(sa: SalaAggregate): number {
    if (this.sparkHoverSlug() !== sa.slug || sa.spark.length === 0) return 0;
    const idx = Math.max(0, Math.min(sa.spark.length - 1, this.sparkHoverIdx()));
    return (idx / (sa.spark.length - 1)) * 100;
  }
  readonly thresholdsList = computed(() => {
    this.thresholdsSvc.thresholds();
    // Merge live sensor areas with stored thresholds. Missing ones show empty.
    const stored = this.thresholdsSvc.list();
    const storedSlugs = new Set(stored.map((t) => this.salaSlug(t.area)));
    const liveAreas = Array.from(new Set(this.sensors().map((s) => (s.area || '').trim()))).filter(
      (a) => a && !storedSlugs.has(this.salaSlug(a)),
    );
    const extras: SalaThreshold[] = liveAreas.map((area) => ({
      area,
      tMax: NaN,
      updatedAt: '',
    }));
    return [...stored, ...extras].sort((a, b) => a.area.localeCompare(b.area));
  });

  onThresholdMaxChange(area: string, ev: Event): void {
    const input = ev.target as HTMLInputElement | null;
    if (!input) return;
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    const cur = this.thresholdsSvc.get(area);
    this.thresholdsSvc.set(area, v, cur?.tMin, cur?.note);
  }

  onThresholdMinChange(area: string, ev: Event): void {
    const input = ev.target as HTMLInputElement | null;
    if (!input) return;
    const raw = input.value.trim();
    const v = raw === '' ? undefined : Number(raw);
    if (raw !== '' && !Number.isFinite(v as number)) return;
    const cur = this.thresholdsSvc.get(area);
    if (!cur) return;
    this.thresholdsSvc.set(area, cur.tMax, v as number | undefined, cur.note);
  }

  onThresholdNoteChange(area: string, ev: Event): void {
    const input = ev.target as HTMLInputElement | null;
    if (!input) return;
    const cur = this.thresholdsSvc.get(area);
    if (!cur) return;
    this.thresholdsSvc.set(area, cur.tMax, cur.tMin, input.value.trim());
  }

  removeThreshold(area: string): void {
    this.thresholdsSvc.remove(area);
  }

  resetThresholds(): void {
    this.thresholdsSvc.resetToDefaults();
  }

  isNaN = Number.isNaN;

  // === Defrost drawer ===
  readonly defrostOpen = signal<boolean>(false);
  readonly defrostSelectedSlug = signal<string | null>(null);
  readonly daysOfWeekChoices: Array<{ n: number; lbl: string }> = [
    { n: 1, lbl: 'L' },
    { n: 2, lbl: 'M' },
    { n: 3, lbl: 'X' },
    { n: 4, lbl: 'J' },
    { n: 5, lbl: 'V' },
    { n: 6, lbl: 'S' },
    { n: 7, lbl: 'D' },
  ];

  readonly defrostSchedules = computed(() => {
    this.defrostSvc.schedules();
    return this.salaAggregates().map((sa) => ({
      area: sa.area,
      slug: sa.slug,
      windows: this.defrostSvc.list(sa.area),
    }));
  });

  defrostSelected(): { area: string; slug: string; windows: DefrostWindow[] } | null {
    const slug = this.defrostSelectedSlug();
    if (!slug) return null;
    return this.defrostSchedules().find((d) => d.slug === slug) || null;
  }

  selectDefrostSala(slug: string): void {
    this.defrostSelectedSlug.set(slug);
  }

  addDefrostWindow(area: string): void {
    this.defrostSvc.addWindow(area, {
      startHHmm: '02:00',
      durationMin: 20,
      daysOfWeek: [1, 2, 3, 4, 5],
      enabled: true,
    });
  }

  removeDefrostWindow(area: string, id: string): void {
    this.defrostSvc.removeWindow(area, id);
  }

  updateDefrostWindowField(area: string, id: string, field: keyof DefrostWindow, ev: Event): void {
    const target = ev.target as HTMLInputElement | null;
    if (!target) return;
    let value: string | number | boolean = target.value;
    if (field === 'durationMin') value = Math.max(1, Number(target.value) || 0);
    if (field === 'enabled') value = target.checked;
    this.defrostSvc.updateWindow(area, id, { [field]: value } as Partial<DefrostWindow>);
  }

  toggleDefrostDay(area: string, id: string, day: number): void {
    const sched = this.defrostSvc.list(area);
    const w = sched.find((x) => x.id === id);
    if (!w) return;
    const set = new Set(w.daysOfWeek);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    this.defrostSvc.updateWindow(area, id, { daysOfWeek: [...set].sort((a, b) => a - b) });
  }

  hasDefrostDay(area: string, id: string, day: number): boolean {
    const w = this.defrostSvc.list(area).find((x) => x.id === id);
    return w ? w.daysOfWeek.includes(day) : false;
  }

  // === Audit log drawer ===
  readonly auditOpen = signal<boolean>(false);
  readonly auditFilterCategory = signal<ColdRoomAuditCategory | ''>('');
  readonly auditFilterQuery = signal<string>('');
  readonly auditFilterFrom = signal<string>('');
  readonly auditFilterTo = signal<string>('');

  readonly auditEntries = computed(() => this.auditSvc.entries());

  readonly auditFiltered = computed(() => {
    return this.auditSvc.filter({
      category: this.auditFilterCategory() || undefined,
      from: this.auditFilterFrom() || undefined,
      to: this.auditFilterTo() || undefined,
      query: this.auditFilterQuery() || undefined,
    });
  });

  setAuditCategory(ev: Event): void {
    const target = ev.target as HTMLSelectElement | null;
    this.auditFilterCategory.set((target?.value as ColdRoomAuditCategory) || '');
  }

  setAuditQuery(value: string): void {
    this.auditFilterQuery.set(value);
  }

  setAuditFrom(ev: Event): void {
    const target = ev.target as HTMLInputElement | null;
    this.auditFilterFrom.set(target?.value || '');
  }

  setAuditTo(ev: Event): void {
    const target = ev.target as HTMLInputElement | null;
    this.auditFilterTo.set(target?.value || '');
  }

  exportAuditCsv(): void {
    const blob = this.auditSvc.exportCsv(this.auditFiltered());
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cold-room-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  clearAudit(): void {
    if (!confirm('¿Borrar todo el audit log local? Esta acción no se puede deshacer.')) return;
    this.auditSvc.clear();
  }

  auditCategoryLabel(c: ColdRoomAuditCategory): string {
    return c === 'threshold' ? 'Umbral' : c === 'defrost' ? 'Defrost' : 'Desviación';
  }

  auditActionLabel(a: ColdRoomAuditEntry['action']): string {
    switch (a) {
      case 'create':
        return 'Creó';
      case 'update':
        return 'Modificó';
      case 'delete':
        return 'Eliminó';
      case 'reset':
        return 'Restableció';
      case 'ack':
        return 'Reconoció';
      case 'resolve':
        return 'Resolvió';
      case 'classify-cause':
        return 'Clasificó causa';
      case 'clear-cause':
        return 'Quitó causa';
      case 'note':
        return 'Anotó';
    }
  }

  auditFmtValue(v: unknown): string {
    if (v === undefined || v === null) return '—';
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  auditFmtTs(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  defrostSummary(windows: DefrostWindow[]): string {
    if (windows.length === 0) return 'Sin ventanas';
    const enabled = windows.filter((w) => w.enabled).length;
    return `${enabled} / ${windows.length} activa${windows.length === 1 ? '' : 's'}`;
  }

  relativeIso(iso: string): string {
    if (!iso) return '—';
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    if (diff < 60_000) return 'recién';
    if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`;
    return `hace ${Math.floor(diff / 86_400_000)}d`;
  }

  // === TAP technical diagnostics (derived from concentrator channels) ===
  readonly concentratorChannels = signal<ColdRoomConcentratorChannel[]>([]);
  readonly diagFilter = signal<'all' | 'online' | 'degraded' | 'offline'>('all');
  readonly diagSort = signal<'lastSeen' | 'rssi' | 'tap'>('tap');

  readonly tapDiagnostics = computed<TapDiagnostic[]>(() => {
    const channels = this.concentratorChannels();
    const colors = this.tapColors();
    const taps = this.taps();
    const now = Date.now();
    return taps.map((tap) => {
      const tapChannels = channels.filter((c) => c.tap === tap);
      const online = tapChannels.filter((c) => c.online);
      const lastSeenTimes = tapChannels
        .map((c) => (c.lastSeen ? new Date(c.lastSeen).getTime() : null))
        .filter((n): n is number => n !== null);
      const oldest = lastSeenTimes.length ? Math.min(...lastSeenTimes) : null;
      const oldestMs = oldest !== null ? Math.max(0, now - oldest) : null;
      const stale = lastSeenTimes.filter((t) => now - t > 60_000).length;
      const rssis = tapChannels.map((c) => c.rssi).filter((r) => typeof r === 'number');
      const avgRssi = rssis.length
        ? Math.round(rssis.reduce((a, b) => a + b, 0) / rssis.length)
        : null;
      let worst: { ch: ColdRoomConcentratorChannel; rssi: number } | null = null;
      let best: { ch: ColdRoomConcentratorChannel; rssi: number } | null = null;
      for (const ch of tapChannels) {
        if (typeof ch.rssi !== 'number') continue;
        if (!worst || ch.rssi < worst.rssi) worst = { ch, rssi: ch.rssi };
        if (!best || ch.rssi > best.rssi) best = { ch, rssi: ch.rssi };
      }
      let status: TapTechStatus = 'unknown';
      if (tapChannels.length === 0) status = 'unknown';
      else if (online.length === 0) status = 'offline';
      else if (online.length < tapChannels.length || stale > 0) status = 'degraded';
      else status = 'online';
      return {
        tap,
        color: colors[tap],
        status,
        channels: tapChannels,
        channelsOnline: online.length,
        channelsTotal: tapChannels.length,
        channelsStale: stale,
        oldestSeenIso: oldest !== null ? new Date(oldest).toISOString() : null,
        oldestSeenMs: oldestMs,
        avgRssi,
        worstRssi: worst,
        bestRssi: best,
      };
    });
  });

  readonly tapDiagFiltered = computed<TapDiagnostic[]>(() => {
    const list = [...this.tapDiagnostics()];
    const f = this.diagFilter();
    const filtered = f === 'all' ? list : list.filter((d) => d.status === f);
    const sort = this.diagSort();
    filtered.sort((a, b) => {
      if (sort === 'lastSeen') {
        return (b.oldestSeenMs ?? -1) - (a.oldestSeenMs ?? -1);
      }
      if (sort === 'rssi') {
        return (a.avgRssi ?? 0) - (b.avgRssi ?? 0);
      }
      return a.tap.localeCompare(b.tap);
    });
    return filtered;
  });

  readonly diagKpis = computed(() => {
    const list = this.tapDiagnostics();
    const online = list.filter((d) => d.status === 'online').length;
    const degraded = list.filter((d) => d.status === 'degraded').length;
    const offline = list.filter((d) => d.status === 'offline').length;
    const allRssis: number[] = [];
    for (const d of list) {
      if (d.avgRssi !== null) allRssis.push(d.avgRssi);
    }
    const avgRssi = allRssis.length
      ? Math.round(allRssis.reduce((a, b) => a + b, 0) / allRssis.length)
      : null;
    const stale = list.reduce((a, d) => a + d.channelsStale, 0);
    return { online, degraded, offline, total: list.length, avgRssi, stale };
  });

  rssiLabel(rssi: number | null): string {
    if (rssi === null) return '—';
    if (rssi > -60) return 'Excelente';
    if (rssi > -75) return 'Bueno';
    if (rssi > -85) return 'Regular';
    return 'Pobre';
  }

  rssiBarPct(rssi: number | null): number {
    if (rssi === null) return 0;
    const clamped = Math.max(-100, Math.min(-30, rssi));
    return Math.round(((clamped + 100) / 70) * 100);
  }

  relativeMs(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return 'recién';
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    return `${Math.floor(ms / 3_600_000)}h`;
  }

  readonly tapAggregates = computed<TapAggregate[]>(() => {
    const taps = this.taps();
    const colors = this.tapColors();
    return taps.map((tap) => {
      const sensors = this.sensors().filter((s) => s.tap === tap);
      const ts = sensors.map((s) => s.t);
      const hs = sensors.map((s) => s.h);
      return {
        tap,
        color: colors[tap],
        count: sensors.length,
        alerts: sensors.filter((s) => s.alerted).length,
        avgT: sensors.length ? (ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1) : '—',
        avgH: sensors.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : 0,
        minT: sensors.length ? Math.min(...ts).toFixed(1) : '—',
        maxT: sensors.length ? Math.max(...ts).toFixed(1) : '—',
        sensors,
      };
    });
  });

  readonly liveLabel = computed(() => {
    if (this.serviceError()) return 'Sin conexión · reintentando';
    const last = this.lastUpdate();
    if (!last) return this.isLoading() ? 'Cargando…' : 'Esperando primera lectura';
    const diff = Math.max(0, Math.floor((this.now() - last.getTime()) / 1000));
    if (diff < 60) return `En vivo · hace ${diff}s`;
    const mins = Math.floor(diff / 60);
    return `En vivo · hace ${mins}m`;
  });

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private concIntervalId: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const sites = this.coldRoomSites();
      if (sites.length > 0) {
        const specs = sites.map((s, i) => ({ siteId: s.id, tap: tapKeyFor(i) }));
        this.service.startPolling(specs);
        return;
      }
      const id = this.siteId();
      if (id) this.service.startPolling(id);
    });

    effect(() => {
      // Fetch concentrator only when TAP tab active to avoid extra traffic.
      const tab = this.effectiveTab();
      if (tab === 'taps') this.startConcentratorPolling();
      else this.stopConcentratorPolling();
    });

    effect(() => {
      // Rich cold-room data when Salas or Compliance tab active.
      const tab = this.effectiveTab();
      if (tab === 'salas' || tab === 'compliance') this.startColdRoomPolling();
      else this.stopColdRoomPolling();
    });
  }

  ngOnInit(): void {
    this.intervalId = setInterval(() => this.now.set(Date.now()), 1000);
    const sid = this.siteId();
    if (sid) {
      this.thresholdsSvc.setSiteId(sid);
      this.defrostSvc.setSiteId(sid);
      this.deviationsSvc.setSiteId(sid);
      this.auditSvc.setSiteId(sid);
    }
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
    }
    this.stopConcentratorPolling();
    this.stopColdRoomPolling();
    this.service.stopPolling();
  }

  // === Cold room rich data (Salas tab) ===
  private startColdRoomPolling(): void {
    if (this.coldRoomPollTimer !== null) return;
    this.fetchColdRoomSensors();
    this.coldRoomPollTimer = setInterval(() => this.fetchColdRoomSensors(), 30_000);
  }

  private stopColdRoomPolling(): void {
    if (this.coldRoomPollTimer !== null) {
      clearInterval(this.coldRoomPollTimer);
      this.coldRoomPollTimer = null;
    }
  }

  private fetchColdRoomSensors(): void {
    const id = this.siteId();
    if (!id) return;
    this.coldRoom.getSensors(id, null, '24h').subscribe({
      next: (res) => {
        if (res.ok) this.coldRoomSensors.set(res.data || []);
      },
      error: () => {
        /* keep last known */
      },
    });
  }

  private computeSparkAndOutOfBand(
    sensors: ColdRoomSensor[],
    threshold: number | null,
  ): { spark: number[]; outOfBandMin: number } {
    if (sensors.length === 0) return { spark: [], outOfBandMin: 0 };
    const first = sensors[0];
    const points = first.hist?.length || 0;
    if (points === 0) return { spark: [], outOfBandMin: 0 };

    // Interval ms derived from first sensor histPoints.
    let intervalMs = 15 * 60 * 1000; // default 24h preset
    const pts = first.histPoints;
    if (pts && pts.length >= 2) {
      const a = new Date(pts[0].t).getTime();
      const b = new Date(pts[1].t).getTime();
      if (isFinite(a) && isFinite(b) && b > a) intervalMs = b - a;
    }

    const spark: number[] = [];
    let outOfBandPts = 0;
    for (let i = 0; i < points; i++) {
      let sum = 0;
      let count = 0;
      let maxV = -Infinity;
      for (const s of sensors) {
        const v = s.hist[i];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        sum += v;
        count++;
        if (v > maxV) maxV = v;
      }
      spark.push(count > 0 ? sum / count : 0);
      if (threshold !== null && maxV > threshold) outOfBandPts++;
    }
    return { spark, outOfBandMin: Math.round((outOfBandPts * intervalMs) / 60000) };
  }

  private computeReportingCount(sensors: ColdRoomSensor[]): number {
    if (sensors.length === 0) return 0;
    const now = Date.now();
    return sensors.filter((s) => {
      if (!s.lastSeen) return false;
      return now - new Date(s.lastSeen).getTime() < this.STALE_MS;
    }).length;
  }

  sparkPath(values: number[], width: number, height: number): string {
    if (!values || values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);
    const pad = 2;
    return values
      .map((v, i) => {
        const x = i * stepX;
        const y = pad + (1 - (v - min) / range) * (height - pad * 2);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  }

  sparkAreaPath(values: number[], width: number, height: number): string {
    if (!values || values.length < 2) return '';
    const line = this.sparkPath(values, width, height);
    return `${line} L ${width} ${height} L 0 ${height} Z`;
  }

  thresholdYPos(values: number[], threshold: number, height: number): number {
    if (!values || values.length === 0) return height / 2;
    const min = Math.min(...values, threshold);
    const max = Math.max(...values, threshold);
    const range = max - min || 1;
    const pad = 2;
    return pad + (1 - (threshold - min) / range) * (height - pad * 2);
  }

  longestOngoingMin(sa: SalaAggregate): number {
    const rich = this.coldRoomSensors().filter((s) => s.area === sa.area);
    const exs = this.deviationsSvc.detect(rich).filter((e) => e.ongoing);
    return exs.reduce((m, e) => Math.max(m, e.durationMin), 0);
  }

  fmtMinutes(min: number): string {
    if (!min || min === 0) return '0m';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  private startConcentratorPolling(): void {
    if (this.concIntervalId !== null) return;
    this.fetchConcentrator();
    this.concIntervalId = setInterval(() => this.fetchConcentrator(), 10_000);
  }

  private stopConcentratorPolling(): void {
    if (this.concIntervalId !== null) {
      clearInterval(this.concIntervalId);
      this.concIntervalId = null;
    }
  }

  fetchConcentratorManual(): void {
    this.fetchConcentrator();
  }

  private fetchConcentrator(): void {
    const id = this.siteId();
    if (!id) return;
    this.coldRoom.getConcentrator(id).subscribe({
      next: (res) => {
        if (res.ok) this.concentratorChannels.set(res.data?.channels || []);
      },
      error: () => {
        // keep last known channels
      },
    });
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
