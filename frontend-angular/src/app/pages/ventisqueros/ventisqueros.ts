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
import { VentisquerosDefrostDrawerComponent } from './components/ventisqueros-defrost-drawer';
import { VentisquerosUmbralesDrawerComponent } from './components/ventisqueros-umbrales-drawer';
import { VentisquerosAuditDrawerComponent } from './components/ventisqueros-audit-drawer';
import type { SiteRecord } from '@emeltec/shared';
import { VentisquerosService } from './ventisqueros.service';
import { AuthService } from '../../services/auth.service';
import {
  AlarmHistoryListComponent,
  type AlarmHistoryItem,
} from '../../components/ui/alarm-history-list';
import {
  ColdRoomAlarmRulesService,
  type AlarmEvent,
} from '../../services/cold-room-alarm-rules.service';
import {
  ColdRoomService,
  type ColdRoomExportInterval,
  type ColdRoomExportPoint,
  type ColdRoomSensor,
} from '../../services/cold-room.service';
import {
  ColdRoomThresholdsService,
  type SalaThreshold,
} from '../../services/cold-room-thresholds.service';
import {
  ColdRoomDeviationsService,
  DEVIATION_CAUSES,
} from '../../services/cold-room-deviations.service';
import {
  ColdRoomDefrostService,
  type DefrostWindow,
} from '../../services/cold-room-defrost.service';
import { ColdRoomAuditService } from '../../services/cold-room-audit.service';
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

type TabKey = 'general' | 'salas' | 'compliance' | 'taps' | 'alarmas' | 'contacts';

interface SubTab {
  key: TabKey;
  icon: string;
  label: string;
  badge?: number;
}

export interface SalaAggregate {
  area: string;
  slug: string;
  count: number;
  activeCount: number;
  defectiveCount: number;
  defectiveReasons: string[];
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
  outOfBandMin: number;
  reportingCount: number;
  deviationsOpenCount: number;
  deviationsOngoing: number;
  /** Todos los sensores físicos defective → sala sin lectura activa. */
  maintenance: boolean;
}

type TapTechStatus = 'online' | 'degraded' | 'offline' | 'unknown';

interface TapDiagnostic {
  tap: TapKey;
  color: string;
  status: TapTechStatus;
  oldestSeenIso: string | null;
  oldestSeenMs: number | null;
  coveragePct: number;
  coverageMinutes: number;
  coverageSlots: boolean[];
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
    AlarmHistoryListComponent,
    VentisquerosUmbralesDrawerComponent,
    VentisquerosDefrostDrawerComponent,
    VentisquerosAuditDrawerComponent,
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
              Cámara frío · {{ floorMapSensors().length }} sensores THM activos
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
                <button
                  class="vs-alert-btn flex items-center gap-1.5"
                  (click)="activeTab.set('alarmas')"
                >
                  <span class="material-symbols-outlined text-[11px]">notifications_active</span>
                  Ver alarmas
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
            <div class="relative h-full min-w-0">
              <app-ventisqueros-floor-map
                [sensors]="floorMapSensors()"
                [metric]="metric()"
                [selectedId]="selectedId()"
                [hiddenSensors]="hiddenSensors()"
                [hasAlerts]="alerts().length > 0"
                (selectSensor)="selectedId.set($event)"
              ></app-ventisqueros-floor-map>
              @if (focusSensor(); as fs) {
                <app-ventisqueros-focus-card
                  class="vs-focus-overlay"
                  [focus]="fs"
                  [salaLink]="salaRouterLink(fs.area)"
                  [salaQuery]="salaQueryParams()"
                ></app-ventisqueros-focus-card>
              }
              @if (floorMapSensors().length === 0) {
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
            <div class="vs-rail flex h-full shrink-0 flex-col overflow-hidden">
              <div class="vs-tap-panel flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                <div class="vs-tap-panel-head flex items-center justify-between">
                  <div class="vs-tap-panel-title">TAP</div>
                  <span class="vs-tap-panel-meta">
                    {{ floorMapSensors().length }} sensores · {{ taps().length }} TAP
                  </span>
                </div>
                <div class="flex-1 overflow-y-auto overflow-x-hidden pr-1">
                  @for (tap of taps(); track tap) {
                    @if ((groupedSensors()[tap] || []).length > 0) {
                      <div class="vs-tap-group" [style.--tap-color]="tapColors()[tap] || '#94A3B8'">
                        <div class="vs-tap-group-head flex items-center justify-between gap-2">
                          <span class="vs-tap-group-name">
                            <span class="vs-tap-group-dot"></span>
                            {{ tap }}
                          </span>
                          <span
                            class="vs-tap-group-age"
                            [class.vs-tap-group-age--stale]="isTapStale(tap)"
                            [title]="
                              tapLastSeenAgeMs()[tap] === null
                                ? 'Sin transmisión registrada'
                                : 'Última comunicación · ' + relativeMs(tapLastSeenAgeMs()[tap])
                            "
                          >
                            <span class="material-symbols-outlined text-[10px]">schedule</span>
                            {{
                              tapLastSeenAgeMs()[tap] === null
                                ? '—'
                                : relativeMs(tapLastSeenAgeMs()[tap])
                            }}
                          </span>
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
            [sensors]="floorMapSensors()"
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
                {{ salaAggregates().length }} salas · {{ coldRoomSensors().length }} sensores ·
                click para ver histórico
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-container bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="umbralesOpen.set(true)"
                [title]="
                  salasSinUmbralCount() > 0
                    ? salasSinUmbralCount() + ' sala(s) sin umbral configurado'
                    : 'Configurar temperatura máxima por sala'
                "
              >
                <span class="material-symbols-outlined text-[14px]">tune</span>
                Umbrales
                @if (salasSinUmbralCount() > 0) {
                  <span class="audit-count-badge audit-count-badge--warn">{{
                    salasSinUmbralCount()
                  }}</span>
                }
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-container bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="defrostOpen.set(true)"
                [title]="
                  defrostEnabledCount() > 0
                    ? defrostEnabledCount() + ' ventana(s) defrost activa(s)'
                    : 'Programar ventanas defrost por sala'
                "
              >
                <span class="material-symbols-outlined text-[14px]">ac_unit</span>
                Defrost
                @if (defrostEnabledCount() > 0) {
                  <span class="audit-count-badge">{{ defrostEnabledCount() }}</span>
                }
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-container bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="auditOpen.set(true)"
                title="Registro auditoría HACCP"
              >
                <span class="material-symbols-outlined text-[14px]">fact_check</span>
                Auditoría
                @if (auditEntries().length > 0) {
                  <span class="audit-count-badge">{{ auditEntries().length }}</span>
                }
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border border-surface-container bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 transition-colors hover:bg-slate-50"
                (click)="openHistoryExport()"
                title="Descargar historial Excel con rango y sensores configurables"
              >
                <span class="material-symbols-outlined text-[14px]">download</span>
                Descargar historial
              </button>
            </div>
          </div>

          @if (coldRoomSensors().length === 0) {
            <div class="vs-salas-grid grid gap-3">
              @for (i of [1, 2, 3, 4, 5, 6, 7, 8]; track i) {
                <div class="sala-card sala-card--skeleton">
                  <header class="sala-card-head">
                    <div class="sala-card-icon sala-skel-icon"></div>
                    <div class="min-w-0 flex-1">
                      <div class="sala-skel-line" style="width: 60%; height: 14px"></div>
                      <div
                        class="sala-skel-line"
                        style="width: 40%; height: 10px; margin-top: 6px"
                      ></div>
                    </div>
                  </header>
                  <div class="sala-card-hero">
                    <div class="sala-skel-line" style="width: 100px; height: 36px"></div>
                    <div class="sala-skel-line" style="width: 70px; height: 30px"></div>
                  </div>
                  <div class="sala-stats-row">
                    <div class="sala-skel-line" style="flex: 1; height: 28px"></div>
                    <div class="sala-skel-line" style="flex: 1; height: 28px"></div>
                    <div class="sala-skel-line" style="flex: 1; height: 28px"></div>
                  </div>
                </div>
              }
            </div>
            <div class="sala-skel-hint">
              <span class="material-symbols-outlined text-[14px]">cached</span>
              Cargando datos en vivo del cagg…
            </div>
          } @else {
            <div class="vs-salas-grid grid gap-3">
              @for (sa of salaAggregates(); track sa.slug) {
                <button
                  type="button"
                  [routerLink]="salaRouterLink(sa.area)"
                  [queryParams]="salaQueryParams()"
                  class="sala-card group"
                  [attr.data-status]="sa.maintenance ? 'maintenance' : sa.status"
                >
                  <header class="sala-card-head">
                    <div
                      class="sala-card-icon"
                      [style.background]="
                        sa.status === 'crit'
                          ? 'rgba(239,68,68,0.10)'
                          : sa.status === 'warn'
                            ? 'rgba(245,158,11,0.10)'
                            : 'var(--color-primary-tint-10)'
                      "
                      [style.border-color]="
                        sa.status === 'crit'
                          ? 'rgba(239,68,68,0.30)'
                          : sa.status === 'warn'
                            ? 'rgba(245,158,11,0.30)'
                            : 'var(--color-primary-tint-30)'
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
                      <div class="flex items-center gap-1.5">
                        <h3 class="sala-card-title truncate">{{ sa.area }}</h3>
                        @if (sa.maintenance) {
                          <span class="sala-maint-badge" [title]="sa.defectiveReasons.join(' · ')">
                            <span class="material-symbols-outlined text-[11px]">build</span>
                            En mantención
                          </span>
                        }
                      </div>
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

                  <div class="sala-stats-row">
                    <span class="sala-stat">
                      <span class="sala-stat-lbl">Mín</span>
                      <span class="sala-stat-val" [style.color]="tempColor(sa.minTNum)">
                        {{ sa.minT }}°C
                      </span>
                    </span>
                    <span class="sala-stat-divider"></span>
                    <span class="sala-stat" title="Promedio últimas 24h (1min sample)">
                      <span class="sala-stat-lbl">Prom 24h</span>
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
                  </div>

                  <footer class="sala-card-foot">
                    @if (sa.maintenance) {
                      <span class="sala-status sala-status--maint">
                        <span class="material-symbols-outlined text-[12px]">handyman</span>
                        En mantención · {{ sa.defectiveCount }}/{{ sa.count }} fuera de servicio
                      </span>
                    } @else {
                      @switch (sa.level) {
                        @case ('severe') {
                          <span class="sala-status sala-status--severe">
                            <span
                              class="vs-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-rose-700"
                            ></span>
                            Crítico sostenido · {{ fmtMinutes(longestOngoingMin(sa)) }}
                            @if (isSalaStale(sa)) {
                              <span
                                class="sala-status-stale"
                                title="Sensores no han transmitido recientemente; valor mostrado es la última lectura conocida"
                              >
                                · sin lectura reciente
                              </span>
                            }
                          </span>
                        }
                        @case ('crit') {
                          <span class="sala-status sala-status--crit">
                            <span
                              class="vs-pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-rose-500"
                            ></span>
                            Desviación sostenida · {{ fmtMinutes(longestOngoingMin(sa)) }}
                            @if (isSalaStale(sa)) {
                              <span
                                class="sala-status-stale"
                                title="Sensores no han transmitido recientemente; valor mostrado es la última lectura conocida"
                              >
                                · sin lectura reciente
                              </span>
                            }
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
                            Esperando lectura
                          </span>
                        }
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
                <div
                  class="comp-hero-meta-item"
                  [title]="
                    cm.mttrMin === null
                      ? 'MTTR sólo disponible cuando se cierran desviaciones manualmente (acks resueltos).'
                      : 'Tiempo medio para resolver desviaciones (basado en acks cerrados)'
                  "
                >
                  <div class="comp-hero-meta-lbl">MTTR resolución</div>
                  <div class="comp-hero-meta-val">
                    {{ cm.mttrMin !== null ? fmtComplianceMin(cm.mttrMin) : '—' }}
                  </div>
                  @if (cm.mttrMin === null) {
                    <div class="comp-hero-meta-sub">requiere cerrar desviaciones</div>
                  }
                </div>
                <div
                  class="comp-hero-meta-item"
                  [title]="
                    'Cobertura de datos: ' +
                    cm.pointsPerSensor +
                    '/' +
                    cm.expectedPoints +
                    ' muestras esperadas. Gaps cuentan como fuera-banda.'
                  "
                >
                  <div class="comp-hero-meta-lbl">Cobertura datos</div>
                  <div class="comp-hero-meta-val">
                    {{
                      cm.expectedPoints > 0
                        ? ((cm.pointsPerSensor / cm.expectedPoints) * 100).toFixed(0)
                        : '0'
                    }}%
                  </div>
                  <div class="comp-hero-meta-sub">
                    {{ cm.pointsPerSensor }}/{{ cm.expectedPoints }} muestras
                  </div>
                </div>
              </div>
            </div>

            <!-- Severity breakdown -->
            <div class="comp-section">
              <h3 class="comp-section-title">Severidad de desviaciones</h3>
              <div class="comp-severity-row">
                <div
                  class="comp-severity-card comp-severity-card--info"
                  title="Clasificadas como Defrost (causa operacional esperada). No cuentan en HACCP."
                >
                  <div class="comp-severity-val">{{ cm.devsDefrost }}</div>
                  <div class="comp-severity-lbl">Defrost (excluidas)</div>
                </div>
                <div
                  class="comp-severity-card comp-severity-card--warn"
                  title="Desviaciones < 5 minutos sostenidas"
                >
                  <div class="comp-severity-val">{{ cm.devsByLevel.warn }}</div>
                  <div class="comp-severity-lbl">Breves &lt; 5min</div>
                </div>
                <div
                  class="comp-severity-card comp-severity-card--crit"
                  title="Desviaciones sostenidas ≥ 5min"
                >
                  <div class="comp-severity-val">{{ cm.devsByLevel.crit }}</div>
                  <div class="comp-severity-lbl">Sostenidas ≥ 5min</div>
                </div>
                <div
                  class="comp-severity-card comp-severity-card--severe"
                  title="Desviaciones severas ≥ 30min"
                >
                  <div class="comp-severity-val">{{ cm.devsByLevel.severe }}</div>
                  <div class="comp-severity-lbl">Severas ≥ 30min</div>
                </div>
              </div>
            </div>

            <!-- Trend -->
            <div class="comp-section">
              <h3 class="comp-section-title">
                Tendencia compliance
                <span class="comp-section-meta">
                  {{ cm.periodLabel }} · % del tiempo dentro de umbral
                </span>
              </h3>
              <div class="comp-trend-wrap">
                <!-- Eje Y -->
                <div class="comp-trend-yaxis">
                  <span>100%</span>
                  <span>{{ trendYAxisMid() }}%</span>
                  <span>{{ trendYAxisMin() }}%</span>
                </div>
                <div class="comp-trend-chart">
                  <!-- Gridlines + referencia 99% -->
                  <div class="comp-trend-grid">
                    <span class="comp-trend-grid-line"></span>
                    <span class="comp-trend-grid-line"></span>
                    <span class="comp-trend-grid-line"></span>
                  </div>
                  <span
                    class="comp-trend-ref"
                    [style.bottom.%]="trendPctToY(99)"
                    title="Umbral aceptable HACCP 99%"
                  >
                    <span class="comp-trend-ref-lbl">99% target</span>
                  </span>
                  <!-- Barras -->
                  <div class="comp-trend-bars">
                    @for (b of cm.hourlyTrend; track $index) {
                      <div class="comp-trend-col" [title]="b.label + ': ' + b.pct.toFixed(2) + '%'">
                        <span
                          class="comp-trend-bar"
                          [style.height.%]="trendPctToY(b.pct)"
                          [style.background]="trendBarColor(b.pct)"
                        ></span>
                        <span class="comp-trend-bar-val">{{ b.pct.toFixed(0) }}</span>
                        <span class="comp-trend-lbl">{{ b.label }}</span>
                      </div>
                    }
                  </div>
                </div>
              </div>
              <div class="comp-trend-legend">
                <span class="comp-trend-legend-item">
                  <span class="comp-trend-swatch" style="background: #22C55E"></span>
                  ≥ 99.5%
                </span>
                <span class="comp-trend-legend-item">
                  <span class="comp-trend-swatch" style="background: #84CC16"></span>
                  98–99.5%
                </span>
                <span class="comp-trend-legend-item">
                  <span class="comp-trend-swatch" style="background: #F59E0B"></span>
                  95–98%
                </span>
                <span class="comp-trend-legend-item">
                  <span class="comp-trend-swatch" style="background: #EF4444"></span>
                  &lt; 95%
                </span>
                <span class="comp-trend-legend-sep">·</span>
                <span class="comp-trend-legend-item">Gaps de datos cuentan como fuera-banda</span>
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
                    @if (!sa.hasThreshold) {
                      <span class="comp-rank-pct" style="color: #94A3B8">sin umbral</span>
                    } @else {
                      <span
                        class="comp-rank-pct"
                        [style.color]="compliancePctColor(sa.compliancePct)"
                      >
                        {{ sa.compliancePct.toFixed(2) }}%
                      </span>
                    }
                    <span class="comp-rank-bar-wrap">
                      @if (sa.hasThreshold) {
                        <span
                          class="comp-rank-bar"
                          [style.width.%]="sa.compliancePct"
                          [style.background]="compliancePctColor(sa.compliancePct)"
                        ></span>
                      }
                    </span>
                    <span
                      class="comp-rank-out"
                      [title]="
                        sa.gapMin > 0
                          ? fmtComplianceMin(sa.gapMin) +
                            ' por gap de datos · ' +
                            fmtComplianceMin(sa.outMin - sa.gapMin) +
                            ' sobre umbral'
                          : 'Tiempo total fuera de banda'
                      "
                    >
                      {{ fmtComplianceMin(sa.outMin) }}
                      @if (sa.gapMin > 0) {
                        <span class="comp-rank-gap" title="Tiempo sin lectura (gap)">
                          ({{ fmtComplianceMin(sa.gapMin) }} gap)
                        </span>
                      }
                    </span>
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
                        [title]="c.label + ': ' + c.count + ' (' + c.pct.toFixed(1) + '%)'"
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
            <div class="flex items-center gap-2"></div>
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
              </select>
            </div>
          </div>

          <div class="vs-taps-grid grid gap-3">
            @for (d of tapDiagFiltered(); track d.tap) {
              <div
                class="vs-tap-diag group relative flex w-full flex-col rounded-2xl border bg-white px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5"
                [attr.data-status]="d.status"
              >
                <a
                  [routerLink]="tapRouterLink(d.tap)"
                  class="absolute inset-0 z-0 rounded-2xl"
                  [attr.aria-label]="d.tap + ': ver TAP y configurar'"
                ></a>
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
                        @if (d.oldestSeenMs !== null) {
                          Última transmisión {{ relativeMs(d.oldestSeenMs) }}
                        } @else {
                          Sin lectura registrada
                        }
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

                <!-- Cobertura 24h (cagg coverage + sparkline gaps) -->
                <div class="mt-2 vs-tap-cov">
                  <div class="vs-tap-cov-head">
                    <span class="vs-tap-cov-lbl">
                      <span class="material-symbols-outlined text-[11px]">timeline</span>
                      Cobertura 24h
                    </span>
                    <span
                      class="vs-tap-cov-val"
                      [class.vs-tap-cov-val--bad]="d.coveragePct < 95"
                      [class.vs-tap-cov-val--warn]="d.coveragePct >= 95 && d.coveragePct < 99"
                      [title]="d.coverageMinutes + ' / 1440 min con lectura'"
                    >
                      {{ d.coveragePct.toFixed(1) }}%
                    </span>
                  </div>
                  <div
                    class="vs-tap-cov-spark"
                    [title]="'Sparkline transmisión 24h · cada barra = 24min. Verde = al menos 1 lectura, gris = gap'"
                  >
                    @for (s of d.coverageSlots; track $index) {
                      <span
                        class="vs-tap-cov-slot"
                        [class.vs-tap-cov-slot--on]="s"
                        [style.background]="s ? d.color : '#E2E8F0'"
                      ></span>
                    }
                  </div>
                  <div class="vs-tap-cov-axis">
                    <span>-24h</span>
                    <span>-12h</span>
                    <span>ahora</span>
                  </div>
                </div>

                <div
                  class="relative z-10 mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-2"
                >
                  <span
                    class="inline-flex items-center gap-1 text-[10.5px] text-slate-400 font-mono"
                  >
                    Ver TAP
                    <span
                      class="material-symbols-outlined text-base text-slate-300 transition-all group-hover:translate-x-0.5"
                      [style.color]="d.color"
                      >chevron_right</span
                    >
                  </span>
                </div>
              </div>
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

        @if (effectiveTab() === 'alarmas') {
          <div class="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 class="vs-h1 text-slate-800">Alarmas</h2>
              <p class="mt-1 text-[12px] text-slate-500">
                {{
                  alarmsView() === 'activas'
                    ? 'Eventos operacionales activos · ' + alarmsCounts().total + ' total'
                    : 'Historial de alarmas disparadas'
                }}
              </p>
              <div class="vs-alarms-filter mt-2">
                <button
                  type="button"
                  class="vs-alarms-chip"
                  [class.vs-alarms-chip--active]="alarmsView() === 'activas'"
                  (click)="alarmsView.set('activas')"
                >
                  Activas
                </button>
                <button
                  type="button"
                  class="vs-alarms-chip"
                  [class.vs-alarms-chip--active]="alarmsView() === 'historial'"
                  (click)="alarmsView.set('historial')"
                >
                  Historial
                </button>
              </div>
            </div>
            @if (alarmsView() === 'activas') {
              <div class="vs-alarms-filter">
                <button
                  type="button"
                  class="vs-alarms-chip"
                  [class.vs-alarms-chip--active]="alarmsFilter() === 'all'"
                  (click)="alarmsFilter.set('all')"
                >
                  Todas <strong>{{ alarmsCounts().total }}</strong>
                </button>
                <button
                  type="button"
                  class="vs-alarms-chip vs-alarms-chip--crit"
                  [class.vs-alarms-chip--active]="alarmsFilter() === 'crit'"
                  (click)="alarmsFilter.set('crit')"
                >
                  Críticas <strong>{{ alarmsCounts().crit }}</strong>
                </button>
                <button
                  type="button"
                  class="vs-alarms-chip vs-alarms-chip--warn"
                  [class.vs-alarms-chip--active]="alarmsFilter() === 'warn'"
                  (click)="alarmsFilter.set('warn')"
                >
                  Advertencias <strong>{{ alarmsCounts().warn }}</strong>
                </button>
                <button
                  type="button"
                  class="vs-alarms-chip vs-alarms-chip--info"
                  [class.vs-alarms-chip--active]="alarmsFilter() === 'info'"
                  (click)="alarmsFilter.set('info')"
                >
                  Info <strong>{{ alarmsCounts().info }}</strong>
                </button>
              </div>
            }
          </div>

          @if (alarmsView() === 'activas') {
            <app-alarm-history-list
              [items]="alarmsActivasItems()"
              [emptyText]="alarmsEmptyText()"
            />
          } @else {
            <!-- Historial de alarmas disparadas (componente compartido) -->
            <app-alarm-history-list
              [items]="alarmHistoryItems()"
              [loading]="!alarmEventsLoaded()"
              emptyText="Sin alarmas registradas"
              [exportable]="true"
              exportTitle="Historial de alarmas Ventisqueros"
            />
          }
        }

        @if (effectiveTab() === 'contacts') {
          <div class="vs-placeholder flex items-center justify-center">
            Contactos: vista por implementar
          </div>
        }
      </div>

      <!-- Umbrales drawer -->
      <app-ventisqueros-umbrales-drawer [(open)]="umbralesOpen" [sensors]="floorMapSensors()" />

      <!-- Defrost drawer -->
      <app-ventisqueros-defrost-drawer [(open)]="defrostOpen" [salaAggregates]="salaAggregates()" />

      <!-- Audit log drawer -->
      <app-ventisqueros-audit-drawer [(open)]="auditOpen" />

      <!-- Modal Descargar historial -->
      @if (historyExportOpen()) {
        <div class="vs-hx-backdrop" (click)="closeHistoryExport()" aria-hidden="true"></div>
        <aside class="vs-hx-modal" role="dialog" aria-modal="true" aria-label="Descargar historial">
          <header class="vs-hx-head">
            <div class="vs-hx-title">Descargar historial</div>
            <button
              type="button"
              class="vs-hx-close"
              (click)="closeHistoryExport()"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </header>

          <div class="vs-hx-body">
            <!-- Rango fechas -->
            <div class="vs-hx-section">
              <div class="vs-hx-section-title">1. Rango de fechas</div>
              <div class="vs-hx-range">
                <label class="vs-hx-field">
                  <span>Desde</span>
                  <input
                    type="datetime-local"
                    [value]="historyExportFrom()"
                    (input)="setHistoryExportFrom($event)"
                  />
                </label>
                <label class="vs-hx-field">
                  <span>Hasta</span>
                  <input
                    type="datetime-local"
                    [value]="historyExportTo()"
                    (input)="setHistoryExportTo($event)"
                  />
                </label>
              </div>
              <div class="vs-hx-hint">
                La resolución base se elige automático según rango: 1min (≤2d), 5min (≤7d), 1h
                (≤30d), 1d (resto).
              </div>
            </div>

            <!-- Intervalo de agrupación (promedio / mín / máx) -->
            <div class="vs-hx-section">
              <div class="vs-hx-section-title">2. Intervalo de agrupación</div>
              <div class="flex flex-wrap gap-1.5">
                @for (opt of historyExportIntervalOptions; track opt.value) {
                  <button
                    type="button"
                    class="vs-hx-btn"
                    [class.vs-hx-btn--primary]="historyExportInterval() === opt.value"
                    (click)="historyExportInterval.set(opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                }
              </div>
              <div class="vs-hx-hint">
                Cada fila trae promedio, mínimo y máximo por intervalo. "Auto" usa la resolución
                base. No puede ser más fino que la base disponible para el rango.
              </div>
            </div>

            <!-- Variables -->
            <div class="vs-hx-section">
              <div class="vs-hx-section-title">3. Variables</div>
              <div class="flex flex-wrap gap-1.5">
                @for (opt of historyExportVarsOptions; track opt.value) {
                  <button
                    type="button"
                    class="vs-hx-btn"
                    [class.vs-hx-btn--primary]="historyExportVars() === opt.value"
                    (click)="historyExportVars.set(opt.value)"
                  >
                    {{ opt.label }}
                  </button>
                }
              </div>
            </div>

            <!-- Salas -->
            <div class="vs-hx-section">
              <div class="vs-hx-section-head">
                <div class="vs-hx-section-title">
                  4. Salas
                  <span class="vs-hx-count">
                    {{ historyExportSelectedSalas().size }} / {{ salaAggregates().length }}
                  </span>
                </div>
                <button
                  type="button"
                  class="vs-hx-toggle-all"
                  (click)="toggleExportSelectAllSalas()"
                >
                  {{
                    historyExportSelectedSalas().size === salaAggregates().length
                      ? 'Quitar todas'
                      : 'Seleccionar todas'
                  }}
                </button>
              </div>
              <div class="vs-hx-grid">
                @for (sa of salaAggregates(); track sa.slug) {
                  <label class="vs-hx-checkbox">
                    <input
                      type="checkbox"
                      [checked]="historyExportSelectedSalas().has(sa.slug)"
                      (change)="toggleExportSala(sa.slug)"
                    />
                    <span class="vs-hx-checkbox-lbl">
                      {{ sa.area }}
                      <span class="vs-hx-checkbox-meta">{{ sa.count }} sensores</span>
                    </span>
                  </label>
                }
              </div>
            </div>

            <!-- Sensores -->
            <div class="vs-hx-section">
              <div class="vs-hx-section-head">
                <div class="vs-hx-section-title">
                  5. Sensores
                  <span class="vs-hx-count">
                    {{ historyExportSelectedSensors().size }} /
                    {{ exportAvailableSensors().length }}
                  </span>
                </div>
                @if (exportAvailableSensors().length > 0) {
                  <button
                    type="button"
                    class="vs-hx-toggle-all"
                    (click)="toggleExportSelectAllSensors()"
                  >
                    {{
                      historyExportSelectedSensors().size === exportAvailableSensors().length
                        ? 'Quitar todos'
                        : 'Seleccionar todos'
                    }}
                  </button>
                }
              </div>
              @if (exportAvailableSensors().length === 0) {
                <div class="vs-hx-empty">Selecciona al menos una sala primero.</div>
              } @else {
                <div class="vs-hx-grid">
                  @for (s of exportAvailableSensors(); track s.id) {
                    <label class="vs-hx-checkbox">
                      <input
                        type="checkbox"
                        [checked]="historyExportSelectedSensors().has(s.id)"
                        (change)="toggleExportSensor(s.id)"
                      />
                      <span class="vs-hx-checkbox-lbl">
                        {{ s.id }}
                        <span class="vs-hx-checkbox-meta">{{ s.area }} · {{ s.tap }}</span>
                      </span>
                    </label>
                  }
                </div>
              }
            </div>

            @if (historyExportError(); as err) {
              <div class="vs-hx-error">
                <span class="material-symbols-outlined text-[14px]">error</span>
                {{ err }}
              </div>
            }
          </div>

          <footer class="vs-hx-foot">
            <button type="button" class="vs-hx-btn" (click)="closeHistoryExport()">Cancelar</button>
            <button
              type="button"
              class="vs-hx-btn vs-hx-btn--primary"
              [disabled]="historyExportLoading() || historyExportSelectedSensors().size === 0"
              (click)="confirmHistoryExport()"
            >
              @if (historyExportLoading()) {
                <span class="material-symbols-outlined text-[14px] animate-spin"
                  >progress_activity</span
                >
                Generando…
              } @else {
                <span class="material-symbols-outlined text-[14px]">download</span>
                Descargar Excel
              }
            </button>
          </footer>
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
        color: var(--color-success);
      }
      .vs-chip-live-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-success);
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
        color: var(--color-surface);
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
        color: var(--color-surface);
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
        background: var(--color-success);
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
        transition:
          color 0.12s,
          background 0.12s,
          border-color 0.12s;
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
        color: var(--color-surface);
        font-family: var(--font-body);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.12s ease;
      }
      .vs-alert-btn:hover {
        background: var(--color-danger);
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

      .vs-focus-overlay {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 280px;
        z-index: 5;
        pointer-events: auto;
      }

      /* Map + rail */
      .vs-map-grid {
        grid-template-columns: minmax(0, 1fr) 320px;
        grid-template-rows: 1fr;
        height: min(1040px, calc(100vh - 200px));
        min-height: 760px;
      }
      .vs-map-grid > * {
        min-height: 0;
        height: 100%;
      }
      .vs-rail {
        width: 320px;
        min-width: 320px;
        box-sizing: border-box;
      }

      /* TAP panel (rail) */
      .vs-tap-panel {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 12px 10px;
        box-sizing: border-box;
        box-shadow:
          0 1px 4px rgba(0, 0, 0, 0.04),
          inset 0 0 0 1px rgba(255, 255, 255, 0.6);
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
      .vs-tap-group {
        position: relative;
        padding: 4px 4px 8px 10px;
        margin-bottom: 6px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
      }
      .vs-tap-group-dot {
        background: var(--tap-color, #94a3b8) !important;
      }
      .vs-tap-group:hover {
        background: rgba(15, 23, 42, 0.025);
      }
      .vs-tap-group-name {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .vs-tap-group-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--tap-color, #94a3b8);
      }
      .vs-tap-group-head {
        padding: 4px 4px 6px 0;
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
      .vs-tap-group-age {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding: 1px 6px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.1);
        color: #15803d;
        border: 1px solid rgba(34, 197, 94, 0.22);
        font-family: var(--font-dm);
        font-size: 9.5px;
        font-weight: 600;
        letter-spacing: 0.02em;
        line-height: 1;
        white-space: nowrap;
      }
      .vs-tap-group-age--stale {
        background: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
        border-color: rgba(239, 68, 68, 0.25);
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

      /* Drawer shell (shared by all drawers) */
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
        background: var(--color-primary-tint-10);
        color: var(--color-primary);
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

      .comp-trend-wrap {
        display: flex;
        gap: 8px;
        align-items: stretch;
      }
      .comp-trend-yaxis {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        width: 36px;
        padding: 4px 0 20px 0;
        font-family: var(--font-mono);
        font-size: 9.5px;
        color: #94a3b8;
        text-align: right;
      }
      .comp-trend-chart {
        position: relative;
        flex: 1;
        height: 160px;
        padding: 4px 2px 20px 2px;
      }
      .comp-trend-grid {
        position: absolute;
        inset: 4px 2px 20px 2px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        pointer-events: none;
      }
      .comp-trend-grid-line {
        height: 1px;
        background: rgba(148, 163, 184, 0.2);
      }
      .comp-trend-ref {
        position: absolute;
        left: 2px;
        right: 2px;
        height: 1px;
        background: var(--color-primary-tint-55);
        border-top: 1px dashed var(--color-primary-tint-55);
        pointer-events: none;
      }
      .comp-trend-ref-lbl {
        position: absolute;
        right: 0;
        top: -14px;
        font-family: var(--font-mono);
        font-size: 9px;
        font-weight: 600;
        color: var(--color-primary);
        background: #ffffff;
        padding: 0 4px;
      }
      .comp-trend-bars {
        position: absolute;
        inset: 4px 2px 20px 2px;
        display: flex;
        gap: 6px;
        align-items: flex-end;
      }
      .comp-trend-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-end;
        height: 100%;
        min-width: 0;
        position: relative;
      }
      .comp-trend-bar {
        width: 100%;
        max-width: 28px;
        border-radius: 3px 3px 0 0;
        transition:
          height 0.25s ease,
          background 0.25s ease;
        min-height: 2px;
      }
      .comp-trend-bar-val {
        position: absolute;
        top: -14px;
        font-family: var(--font-mono);
        font-size: 8.5px;
        font-weight: 600;
        color: #475569;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .comp-trend-col:hover .comp-trend-bar-val {
        opacity: 1;
      }
      .comp-trend-lbl {
        position: absolute;
        bottom: -16px;
        font-family: var(--font-mono);
        font-size: 9.5px;
        color: #94a3b8;
      }
      .comp-trend-legend {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-top: 6px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #64748b;
      }
      .comp-trend-legend-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .comp-trend-swatch {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 2px;
      }
      .comp-trend-legend-sep {
        color: #cbd5e1;
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
      .comp-rank-gap {
        font-size: 9.5px;
        color: #b45309;
        margin-left: 4px;
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
        background: var(--color-primary-tint-15);
        color: var(--color-primary);
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 700;
      }
      .audit-count-badge--warn {
        background: rgba(245, 158, 11, 0.15);
        color: #b45309;
      }

      /* History export modal */
      .vs-hx-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.5);
        z-index: 50;
        animation: hxFadeIn 0.15s ease-out;
      }
      @keyframes hxFadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .vs-hx-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(640px, 94vw);
        max-height: 88vh;
        background: #ffffff;
        border-radius: 14px;
        border: 1px solid #e2e8f0;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.22);
        z-index: 51;
        display: flex;
        flex-direction: column;
        animation: hxScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes hxScaleIn {
        from {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.96);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }
      .vs-hx-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid #e2e8f0;
      }
      .vs-hx-title {
        font-family: var(--font-josefin), sans-serif;
        font-size: 15px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .vs-hx-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 7px;
        background: transparent;
        color: #64748b;
        border: 1px solid transparent;
      }
      .vs-hx-close:hover {
        background: rgba(15, 23, 42, 0.06);
        color: #1e293b;
      }
      .vs-hx-body {
        padding: 16px 18px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .vs-hx-section {
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 12px;
      }
      .vs-hx-section:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }
      .vs-hx-section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .vs-hx-section-title {
        font-family: var(--font-dm);
        font-size: 12px;
        font-weight: 600;
        color: #1e293b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 6px;
      }
      .vs-hx-count {
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 500;
        color: #94a3b8;
        margin-left: 6px;
        text-transform: none;
        letter-spacing: 0;
      }
      .vs-hx-toggle-all {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: var(--color-primary);
        background: transparent;
        border: none;
        font-weight: 500;
      }
      .vs-hx-toggle-all:hover {
        text-decoration: underline;
      }
      .vs-hx-range {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .vs-hx-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: var(--font-dm);
        font-size: 11px;
        color: #64748b;
      }
      .vs-hx-field input {
        padding: 7px 9px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        font-family: var(--font-mono);
        font-size: 12px;
        color: #1e293b;
        outline: none;
      }
      .vs-hx-field input:focus {
        border-color: var(--color-primary);
      }
      .vs-hx-hint {
        margin-top: 6px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
        font-style: italic;
      }
      .vs-hx-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 6px;
        max-height: 180px;
        overflow-y: auto;
        padding: 4px 2px;
      }
      .vs-hx-checkbox {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 9px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        cursor: pointer;
        transition:
          border-color 0.15s,
          background 0.15s;
      }
      .vs-hx-checkbox:hover {
        border-color: var(--color-primary-tint-30);
        background: var(--color-primary-tint-04);
      }
      .vs-hx-checkbox input {
        margin-top: 2px;
        accent-color: var(--color-primary);
      }
      .vs-hx-checkbox-lbl {
        display: flex;
        flex-direction: column;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #1e293b;
        line-height: 1.3;
      }
      .vs-hx-checkbox-meta {
        font-size: 10.5px;
        color: #94a3b8;
        font-weight: 400;
      }
      .vs-hx-empty {
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #94a3b8;
        font-style: italic;
        padding: 10px;
        text-align: center;
        background: #f8fafc;
        border-radius: 7px;
      }
      .vs-hx-error {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 8px 10px;
        background: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 7px;
        font-family: var(--font-dm);
        font-size: 11.5px;
      }
      .vs-hx-foot {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
        border-radius: 0 0 14px 14px;
      }
      .vs-hx-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 8px 14px;
        border-radius: 7px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 12px;
        font-weight: 500;
      }
      .vs-hx-btn:hover:not(:disabled) {
        background: #f1f5f9;
      }
      .vs-hx-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .vs-hx-btn--primary {
        background: var(--color-primary);
        color: #ffffff;
        border-color: var(--color-primary);
      }
      .vs-hx-btn--primary:hover:not(:disabled) {
        background: #0c8b96;
      }
      .animate-spin {
        animation: hxSpin 0.9s linear infinite;
      }
      @keyframes hxSpin {
        to {
          transform: rotate(360deg);
        }
      }

      /* Alarmas tab */
      .vs-alarms-filter {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .vs-alarms-chip {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border-radius: 999px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #64748b;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 500;
        transition:
          color 0.15s,
          border-color 0.15s,
          background 0.15s;
      }
      .vs-alarms-chip strong {
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 700;
        color: #94a3b8;
      }
      .vs-alarms-chip:hover {
        color: #1e293b;
        border-color: #cbd5e1;
      }
      .vs-alarms-chip--active {
        background: #1e293b;
        color: #ffffff;
        border-color: #1e293b;
      }
      .vs-alarms-chip--active strong {
        color: #ffffff;
      }
      .vs-alarms-chip--crit.vs-alarms-chip--active {
        background: var(--color-danger);
        border-color: var(--color-danger);
      }
      .vs-alarms-chip--warn.vs-alarms-chip--active {
        background: var(--color-warning);
        border-color: var(--color-warning);
      }
      .vs-alarms-chip--info.vs-alarms-chip--active {
        background: var(--color-primary);
        border-color: var(--color-primary);
      }
      /* TAPS tab grid */
      .vs-taps-grid {
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      }
      .vs-salas-grid {
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      }
      .sala-card--skeleton {
        pointer-events: none;
        cursor: default;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .sala-skel-icon {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        background: linear-gradient(
          90deg,
          rgba(148, 163, 184, 0.1),
          rgba(148, 163, 184, 0.22),
          rgba(148, 163, 184, 0.1)
        );
        background-size: 200% 100%;
        animation: salaSkelShimmer 1.4s linear infinite;
      }
      .sala-skel-line {
        display: inline-block;
        border-radius: 4px;
        background: linear-gradient(
          90deg,
          rgba(148, 163, 184, 0.1),
          rgba(148, 163, 184, 0.22),
          rgba(148, 163, 184, 0.1)
        );
        background-size: 200% 100%;
        animation: salaSkelShimmer 1.4s linear infinite;
      }
      @keyframes salaSkelShimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
      .sala-skel-hint {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 12px;
        padding: 6px 12px;
        background: var(--color-primary-tint-06);
        border: 1px solid var(--color-primary-tint-20);
        border-radius: 999px;
        font-family: var(--font-dm);
        font-size: 11px;
        color: var(--color-primary);
      }
      @media (prefers-reduced-motion: reduce) {
        .sala-skel-icon,
        .sala-skel-line {
          animation: none;
        }
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
      .sala-card[data-status='maintenance'] {
        border-color: #cbd5e1;
        background: #f8fafc;
        box-shadow: none;
        opacity: 0.92;
      }
      .sala-card[data-status='maintenance']:hover {
        opacity: 1;
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.05);
      }
      .sala-card[data-status='maintenance'] .sala-actual-val,
      .sala-card[data-status='maintenance'] .sala-stat-val,
      .sala-card[data-status='maintenance'] .sala-card-title {
        color: #64748b !important;
      }
      .sala-card[data-status='maintenance']::before {
        content: '';
        position: absolute;
        left: 0;
        top: 16px;
        bottom: 16px;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: repeating-linear-gradient(135deg, #94a3b8 0 4px, #cbd5e1 4px 8px);
      }
      .sala-maint-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        color: #475569;
        padding: 2px 7px 2px 5px;
        border-radius: 9999px;
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .sala-status--maint {
        background: #f1f5f9;
        border: 1px solid #cbd5e1;
        color: #475569;
        padding: 3px 8px;
        border-radius: 9999px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 500;
      }
      .sala-card[data-status='ok']::before {
        content: '';
        position: absolute;
        left: 0;
        top: 16px;
        bottom: 16px;
        width: 3px;
        border-radius: 0 3px 3px 0;
        background: linear-gradient(180deg, var(--color-success), var(--color-success));
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
        background: linear-gradient(180deg, #f59e0b, var(--color-warning));
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
      .sala-status-stale {
        font-style: italic;
        font-weight: 500;
        opacity: 0.85;
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
        color: var(--color-surface);
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
        cursor: pointer;
      }
      .vs-tap-diag:hover {
        border-color: var(--color-primary-tint-40);
      }
      .vs-tap-diag-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 9px;
        border-radius: 7px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 10.5px;
        font-weight: 600;
        line-height: 1;
        transition:
          color 0.15s ease,
          border-color 0.15s ease,
          background 0.15s ease;
      }
      .vs-tap-diag-btn:hover {
        color: #6366f1;
        border-color: rgba(99, 102, 241, 0.35);
        background: rgba(99, 102, 241, 0.06);
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
      .vs-tap-sensors-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 4px;
      }
      .vs-tap-sensors-lbl {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94a3b8;
      }
      .vs-tap-sensors-val {
        font-family: var(--font-mono);
        font-size: 12.5px;
        font-weight: 600;
        color: #15803d;
        font-variant-numeric: tabular-nums;
      }
      .vs-tap-sensors-val--bad {
        color: #b91c1c;
      }
      .vs-tap-cov {
        margin-top: 6px;
      }
      .vs-tap-cov-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 3px;
      }
      .vs-tap-cov-lbl {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94a3b8;
      }
      .vs-tap-cov-val {
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 600;
        color: #15803d;
        font-variant-numeric: tabular-nums;
      }
      .vs-tap-cov-val--warn {
        color: #b45309;
      }
      .vs-tap-cov-val--bad {
        color: #b91c1c;
      }
      .vs-tap-cov-spark {
        display: flex;
        gap: 1px;
        height: 14px;
        align-items: stretch;
        background: #f8fafc;
        padding: 1px;
        border-radius: 3px;
      }
      .vs-tap-cov-slot {
        flex: 1;
        height: 100%;
        border-radius: 1px;
        opacity: 0.4;
        transition: opacity 0.15s;
      }
      .vs-tap-cov-slot--on {
        opacity: 1;
      }
      .vs-tap-cov-axis {
        display: flex;
        justify-content: space-between;
        margin-top: 2px;
        font-family: var(--font-mono);
        font-size: 8.5px;
        color: #cbd5e1;
      }
      .vs-diag-channels-lbl {
        font-family: var(--font-dm);
        font-size: 10.5px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94a3b8;
      }
      .vs-diag-channels-val {
        font-family: var(--font-mono);
        font-size: 12.5px;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .vs-diag-stale {
        color: var(--color-danger);
        font-size: 10.5px;
        font-weight: 500;
      }
      .vs-diag-channels-bar {
        height: 6px;
        background: #f1f5f9;
        border-radius: 3px;
        overflow: hidden;
      }
      .vs-diag-channels-fill {
        height: 100%;
        transition: width 0.3s ease;
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
        color: var(--color-surface);
        font-family: var(--font-body);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .vs-error-retry:hover {
        background: var(--color-danger);
      }

      /* Empty state */
      .vs-empty-overlay {
        position: absolute;
        inset: 0;
        background: rgba(248, 250, 252, 0.92);
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
  private readonly alarmRulesSvc = inject(ColdRoomAlarmRulesService);
  private readonly auth = inject(AuthService);

  // TAP (técnico) solo para tier administrador (SuperAdmin/Admin).
  readonly canViewTap = computed(() => this.auth.isSuperAdmin() || this.auth.isAdmin());

  readonly siteId = input.required<string>();
  readonly siteName = input<string>('');
  readonly companyName = input<string>('');
  readonly coldRoomSites = input<SiteRecord[]>([]);
  readonly embedded = input<boolean>(false);
  readonly view = input<
    'full' | 'general' | 'salas' | 'compliance' | 'taps' | 'alarmas' | 'contacts'
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

  isTapStale(tap: TapKey): boolean {
    const age = this.tapLastSeenAgeMs()[tap];
    return age === null || age === undefined ? true : age > 300_000;
  }

  // Antigüedad del último bucket cagg por TAP. Toma el MÁS reciente entre
  // sensores del TAP (un sensor que reportó hace 1min implica concentrador
  // activo). null cuando ningún sensor del TAP reportó jamás.
  readonly tapLastSeenAgeMs = computed<Record<TapKey, number | null>>(() => {
    const nowMs = this.now();
    const out: Record<TapKey, number | null> = {};
    for (const s of this.coldRoomSensors()) {
      if (!(s.tap in out)) out[s.tap] = null;
      if (!s.lastSeen) continue;
      const ts = new Date(s.lastSeen).getTime();
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const age = nowMs - ts;
      const cur = out[s.tap];
      if (cur === null || age < cur) out[s.tap] = age;
    }
    return out;
  });

  readonly siteTitle = computed(() => {
    const name = this.siteName().trim();
    const company = this.companyName().trim();
    if (company && name) return `${company} · ${name}`;
    return name || company || 'Cámara frío';
  });

  readonly effectiveTab = computed<TabKey>(() => {
    const v = this.view();
    let tab: TabKey;
    if (
      v === 'general' ||
      v === 'salas' ||
      v === 'compliance' ||
      v === 'taps' ||
      v === 'alarmas' ||
      v === 'contacts'
    )
      tab = v;
    else tab = this.activeTab();
    // No-admin nunca cae en TAP (técnico) aunque quede persistido o forzado.
    if (tab === 'taps' && !this.canViewTap()) return 'salas';
    return tab;
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

  // Source unificado: prefiere ColdRoom (cagg, real) cuando disponible,
  // fallback a VentisquerosService legacy. Excluye defective de stats/alerts.
  readonly alerts = computed(() => this.floorMapSensors().filter((s) => !s.defective && s.alerted));
  readonly alertSnippet = computed(() => this.alerts().slice(0, 2));
  readonly extraAlerts = computed(() => Math.max(0, this.alerts().length - 2));

  readonly groupedSensors = computed<Record<string, Sensor[]>>(() => {
    const out: Record<string, Sensor[]> = {};
    for (const s of this.floorMapSensors()) {
      (out[s.tap] = out[s.tap] || []).push(s);
    }
    return out;
  });

  readonly focusSensor = computed(() =>
    this.floorMapSensors().find((s) => s.id === this.selectedId()),
  );

  readonly stats = computed(() => {
    const list = this.floorMapSensors().filter((s) => !s.defective);
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

  readonly subTabs = computed<SubTab[]>(() => {
    const c = this.alarmsCounts();
    const tabs: SubTab[] = [
      { key: 'general', icon: 'map', label: 'Mapa' },
      { key: 'salas', icon: 'space_dashboard', label: 'Salas' },
      { key: 'compliance', icon: 'verified', label: 'Compliance HACCP' },
      { key: 'alarmas', icon: 'notifications_active', label: 'Alarmas activas', badge: c.total },
    ];
    // TAP (técnico) solo admin.
    if (this.canViewTap()) tabs.push({ key: 'taps', icon: 'memory', label: 'TAP (técnico)' });
    return tabs;
  });

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

  // Query params para sala-detail. Pasa bundle de siteIds cold-room para que
  // el detalle no consulte solo el siteId primary (que puede no tener reg_map
  // STH-* si es concentrador maestro sin sensores propios).
  readonly salaQueryParams = computed(() => {
    const sid = this.siteId();
    const related = this.coldRoomSites().map((s) => s.id);
    const all = related.length > 0 ? [...new Set([sid, ...related])] : [sid];
    return { siteIds: all.filter(Boolean).join(',') };
  });

  // Rich data (with histPoints + lastSeen). Fed when Salas tab active.
  readonly coldRoomSensors = signal<ColdRoomSensor[]>([]);
  // Datos separados para tab Compliance cuando period=7d. Backend usa cagg
  // equipo_hourly (168 puntos) vs equipo_1min de Salas.
  readonly coldRoomSensors7d = signal<ColdRoomSensor[]>([]);
  private coldRoomPollTimer: ReturnType<typeof setTimeout> | null = null;
  private coldRoom7dPollTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Fuente unificada del floor map: prefiere ColdRoom (real, con defective)
   * cuando hay datos, cae a VentisquerosService legacy si no hay polling activo.
   * Garantiza que pin individual y card de sala usen los mismos valores T/H.
   */
  readonly floorMapSensors = computed<Sensor[]>(() => {
    const rich = this.coldRoomSensors();
    if (rich.length > 0) {
      return rich.map((s) => ({
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
        defective: s.defective,
        defectiveReason: s.defectiveReason,
      }));
    }
    return this.sensors();
  });
  // Tolerancia para considerar un sensor "reportando". 5 min cubre lag del
  // cagg equipo_1min (bucket 1min + refresh policy + propagación) + un ciclo
  // extra para casos borderline. Sensor caído real supera ampliamente este
  // umbral. Caída real de TAP visible en pocos minutos.
  private readonly STALE_MS = 300_000;

  readonly salaAggregates = computed<SalaAggregate[]>(() => {
    this.thresholdsSvc.thresholds();
    this.now();
    const rich = this.coldRoomSensors();

    // Salas usa SOLO ColdRoom data (fuente autoritativa: cagg equipo_1min +
    // reg_map). Sin fallback legacy: evita "flash" de valores distintos
    // mientras carga el primer fetch. UI muestra skeleton hasta que llegue.
    const byArea = new Map<string, ColdRoomSensor[]>();
    for (const r of rich) {
      const key = (r.area || '—').trim();
      const list = byArea.get(key) || [];
      list.push(r);
      byArea.set(key, list);
    }

    // Sensor cuenta como "activo para cómputo" si:
    //  - no está defective
    //  - reportó alguna vez (lastSeen > epoch)
    // No filtramos por staleness aquí: si el TAP cayó hace rato, mostrar la
    // última lectura conocida (mejor que "—" en blanco). Pill "Reportando" ya
    // señala visualmente cuántos están reportando reciente vs total.
    const isActiveSensor = (s: ColdRoomSensor): boolean => {
      if (s.defective) return false;
      if (!s.lastSeen) return false;
      const ts = new Date(s.lastSeen).getTime();
      return Number.isFinite(ts) && ts > 0;
    };

    const out: SalaAggregate[] = [];
    for (const [area, sensors] of byArea) {
      const active = sensors.filter(isActiveSensor);
      const defectiveSensors = sensors.filter((s) => s.defective);
      const defectiveReasons = defectiveSensors
        .map((s) => `${s.id}: ${s.defectiveReason || 'fuera de servicio'}`)
        .filter(Boolean);

      const ts = active.map((s) => s.t);
      const hs = active.map((s) => s.h);
      const taps = Array.from(new Set(sensors.map((s) => s.tap))).sort();
      const maxTNum = active.length ? Math.max(...ts) : 0;
      const minTNum = active.length ? Math.min(...ts) : 0;
      const th = this.thresholdsSvc.get(area);
      const alerts = active.filter((s) =>
        th ? this.thresholdsSvc.isSensorOutOfBand(area, s.t) : s.alerted,
      ).length;
      // Actual = peor caso (max T entre sensores activos). HACCP-relevante:
      // el sensor más caliente es el que define riesgo de la sala. Si solo
      // hay 1 sensor → max = single value (sin cambio).
      const actualNum = active.length ? maxTNum : 0;
      const allHist = active.flatMap((s) => s.hist || []);
      const histAvg = allHist.length
        ? allHist.reduce((a, b) => a + b, 0) / allHist.length
        : actualNum;
      const outOfBandMin = this.computeOutOfBandMin(active, th?.tMax ?? null);
      const reportingCount = this.computeReportingCount(active);
      const deviations = this.deviationsSvc.detect(active);
      const ongoing = deviations.filter((e) => e.ongoing);
      const open = deviations.filter((e) => this.deviationsSvc.isOpen(e));
      const longestOngoing = ongoing.reduce((m, e) => Math.max(m, e.durationMin), 0);
      const level =
        active.length === 0
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
        defective: s.defective,
        defectiveReason: s.defectiveReason,
      }));
      out.push({
        area,
        slug: this.salaSlug(area),
        count: sensors.length,
        activeCount: active.length,
        defectiveCount: defectiveSensors.length,
        defectiveReasons,
        alerts,
        actualT: active.length ? actualNum.toFixed(1) : '—',
        actualTNum: actualNum,
        avgT: active.length ? histAvg.toFixed(1) : '—',
        avgTNum: histAvg,
        avgH: active.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : 0,
        minT: active.length ? minTNum.toFixed(1) : '—',
        minTNum,
        maxT: active.length ? maxTNum.toFixed(1) : '—',
        maxTNum,
        taps,
        sensors: sensorsAsLegacy,
        thresholdMax: th?.tMax ?? null,
        level,
        status,
        outOfBandMin,
        reportingCount,
        deviationsOpenCount: open.length,
        deviationsOngoing: ongoing.length,
        maintenance: active.length === 0 && defectiveSensors.length > 0,
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
    const period = this.compliancePeriod();
    // Dataset según período. 7d viene de fetch separado (equipo_hourly cagg).
    const sensors = period === '7d' ? this.coldRoomSensors7d() : this.coldRoomSensors();
    const devsAll = this.deviationsSvc.detect(sensors);

    // Ventana FIJA según período (no derivada de histPoints). Penaliza
    // implícitamente datos faltantes: si histPoints < expected → gaps cuentan
    // como "fuera de banda" (sin lectura = no podemos verificar compliance).
    const sampleIntervalMin = period === '24h' ? 1 : 60;
    const expectedPoints = period === '24h' ? 1440 : 168;
    const windowMin = expectedPoints * sampleIntervalMin;
    let pointsPerSensor = 0;
    if (sensors.length > 0 && sensors[0].histPoints?.length) {
      pointsPerSensor = sensors[0].histPoints.length;
    }
    const totalMinPerSensor = windowMin;

    // Group sensors by area for per-sala compliance.
    const byArea = new Map<string, typeof sensors>();
    for (const s of sensors) {
      const list = byArea.get(s.area) || [];
      list.push(s);
      byArea.set(s.area, list);
    }

    let globalOutMin = 0;
    let globalTotalMin = 0;
    const salaMetrics: {
      area: string;
      slug: string;
      outMin: number;
      gapMin: number;
      compliancePct: number;
      devs: number;
      level: 'ok' | 'warn' | 'crit' | 'severe' | 'unknown';
      hasThreshold: boolean;
    }[] = [];

    for (const [area, list] of byArea) {
      const th = this.thresholdsSvc.get(area);
      let outMin = 0;
      let gapMin = 0;
      if (th) {
        const N = expectedPoints;
        // Sólo activos no defective contribuyen. Sensor defectivo = sin data.
        const active = list.filter((s) => !s.defective);
        for (let i = 0; i < N; i++) {
          let maxV = -Infinity;
          let hasReading = false;
          for (const s of active) {
            const v = s.histPoints?.[i]?.v;
            if (typeof v === 'number' && Number.isFinite(v)) {
              hasReading = true;
              if (v > maxV) maxV = v;
            }
          }
          if (!hasReading) {
            // Gap → "fuera de banda" (no podemos verificar). Compliance HACCP
            // exige registro continuo; falta de lectura = no conforme.
            gapMin += sampleIntervalMin;
            outMin += sampleIntervalMin;
          } else if (maxV > th.tMax) {
            outMin += sampleIntervalMin;
          }
        }
      } else {
        // Sin umbral configurado → sala excluida del cómputo (100% neutral).
      }
      const totalMin = totalMinPerSensor;
      const compliancePct = totalMin > 0 && th ? ((totalMin - outMin) / totalMin) * 100 : 100;
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
        gapMin,
        compliancePct,
        devs: devsCount,
        level,
        hasThreshold: !!th,
      });
      if (th) {
        globalOutMin += outMin;
        globalTotalMin += totalMin;
      }
    }
    salaMetrics.sort((a, b) => b.outMin - a.outMin || b.devs - a.devs);

    const globalCompliancePct =
      globalTotalMin > 0 ? ((globalTotalMin - globalOutMin) / globalTotalMin) * 100 : 100;

    // Deviations breakdown. devsByLevel cuenta por severidad de duración;
    // devsDefrost cuenta separado las clasificadas como defrost (causa
    // operacional esperada, no riesgo HACCP).
    const devsByLevel = { warn: 0, crit: 0, severe: 0 };
    let devsDefrost = 0;
    let devsOpen = 0;
    let devsClosed = 0;
    let mttrSum = 0;
    let mttrCount = 0;
    for (const d of devsAll) {
      const eff = this.deviationsSvc.effectiveCause(d);
      if (eff && eff.cause === 'defrost') {
        devsDefrost++;
      } else {
        if (d.level === 'warn') devsByLevel.warn++;
        else if (d.level === 'crit') devsByLevel.crit++;
        else if (d.level === 'severe') devsByLevel.severe++;
      }
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
    const causes: { key: string; label: string; count: number; pct: number; color: string }[] = [];
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

    // Hourly/daily trend: bucketize sobre VENTANA FIJA expected, no sobre
    // pointsPerSensor. Buckets sin samples cuentan como gap → fuera banda.
    const trendBuckets = period === '24h' ? 24 : 7;
    const hourlyTrend: { label: string; pct: number }[] = [];
    const ptsPerBucket = Math.max(1, Math.floor(expectedPoints / trendBuckets));
    for (let b = 0; b < trendBuckets; b++) {
      const startIdx = b * ptsPerBucket;
      const endIdx = Math.min(expectedPoints, startIdx + ptsPerBucket);
      let totalSamples = 0;
      let outSamples = 0;
      for (const [area, list] of byArea) {
        const th = this.thresholdsSvc.get(area);
        if (!th) continue;
        const activeArea = list.filter((s) => !s.defective);
        for (let i = startIdx; i < endIdx; i++) {
          totalSamples++;
          let maxV = -Infinity;
          let hasReading = false;
          for (const s of activeArea) {
            const v = s.histPoints?.[i]?.v;
            if (typeof v === 'number' && Number.isFinite(v)) {
              hasReading = true;
              if (v > maxV) maxV = v;
            }
          }
          if (!hasReading || maxV > th.tMax) outSamples++;
        }
      }
      const pct = totalSamples > 0 ? ((totalSamples - outSamples) / totalSamples) * 100 : 100;
      const label = period === '24h' ? `${String(b).padStart(2, '0')}h` : `d-${trendBuckets - b}`;
      hourlyTrend.push({ label, pct });
    }

    return {
      periodLabel: period === '24h' ? 'últimas 24h' : 'últimos 7d',
      windowMin: globalTotalMin,
      sensorCount: sensors.length,
      pointsPerSensor,
      expectedPoints,
      globalCompliancePct,
      globalOutMin,
      devsTotal: devsAll.length,
      devsOpen,
      devsClosed,
      devsByLevel,
      devsDefrost,
      mttrMin,
      salas: salaMetrics,
      causes,
      hourlyTrend,
    };
  });

  setCompliancePeriod(p: '24h' | '7d'): void {
    if (this.compliancePeriod() === p) return;
    this.compliancePeriod.set(p);
    if (p === '7d') {
      this.startColdRoom7dPolling();
    } else {
      this.stopColdRoom7dPolling();
    }
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

  // Escala Y focada: baseline en min(80, lowestPct - 5). Si todos están en
  // 95-100%, no aplasta las diferencias contra una escala 0-100%.
  trendYAxisMin(): number {
    const cm = this.complianceMetrics();
    if (!cm.hourlyTrend.length) return 0;
    const lowest = Math.min(...cm.hourlyTrend.map((b) => b.pct));
    const floor = Math.max(0, Math.min(90, Math.floor(lowest - 5)));
    return floor;
  }

  trendYAxisMid(): number {
    const min = this.trendYAxisMin();
    return Math.round((min + 100) / 2);
  }

  // Convierte pct (0-100) a posición Y en porcentaje del chart (0=bottom, 100=top)
  // usando la escala focada [yMin, 100].
  trendPctToY(pct: number): number {
    const yMin = this.trendYAxisMin();
    if (pct <= yMin) return 0;
    if (pct >= 100) return 100;
    return ((pct - yMin) / (100 - yMin)) * 100;
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

  // === Defrost drawer ===
  readonly defrostOpen = signal<boolean>(false);

  // === Audit log drawer ===
  readonly auditOpen = signal<boolean>(false);
  readonly auditEntries = computed(() => this.auditSvc.entries());

  // === Alarmas operacionales HACCP ===
  readonly alarmsList = computed(() => {
    this.now();
    const nowMs = Date.now();
    const out: {
      id: string;
      type: 'deviation' | 'sensor-down' | 'tap-down' | 'sensor-fault' | 'sin-umbral';
      severity: 'crit' | 'warn' | 'info';
      icon: string;
      title: string;
      detail: string;
      area: string | null;
      sensorId: string | null;
      tap: string | null;
      sinceMs: number | null;
      areaSlug: string | null;
    }[] = [];

    // 1. Desviaciones abiertas (sensor sobre/bajo umbral).
    const devs = this.deviationsSvc.detect(this.coldRoomSensors());
    for (const d of devs) {
      if (!this.deviationsSvc.isOpen(d)) continue;
      const sinceMs = nowMs - new Date(d.startTs).getTime();
      const sevMap: Record<string, 'crit' | 'warn'> = {
        severe: 'crit',
        crit: 'crit',
        warn: 'warn',
      };
      out.push({
        id: `dev-${d.id}`,
        type: 'deviation',
        severity: sevMap[d.level] || 'warn',
        icon: 'warning',
        title: `Desviación ${d.level === 'severe' ? 'severa' : d.level === 'crit' ? 'sostenida' : 'breve'} · ${d.sensorId}`,
        detail: `Peak ${d.peakT.toFixed(1)}°C · umbral ${d.thresholdMax.toFixed(1)}°C · ${this.fmtMinutes(d.durationMin)}`,
        area: d.area,
        sensorId: d.sensorId,
        tap: d.tap,
        sinceMs,
        areaSlug: this.salaSlug(d.area),
      });
    }

    // 2. TAP caído (>5min sin transmitir).
    const ageMap = this.tapLastSeenAgeMs();
    for (const tap of Object.keys(ageMap)) {
      const age = ageMap[tap];
      if (age === null || age === undefined) continue;
      if (age < 5 * 60_000) continue;
      const sev: 'crit' | 'warn' = age > 30 * 60_000 ? 'crit' : 'warn';
      out.push({
        id: `tap-${tap}`,
        type: 'tap-down',
        severity: sev,
        icon: 'cell_tower',
        title: `${tap} sin transmitir`,
        detail: `Última transmisión hace ${this.relativeMs(age)} · concentrador puede estar caído`,
        area: null,
        sensorId: null,
        tap,
        sinceMs: age,
        areaSlug: null,
      });
    }

    // 3. Sensor en falla (defective marcado).
    for (const s of this.coldRoomSensors()) {
      if (!s.defective) continue;
      out.push({
        id: `fault-${s.id}`,
        type: 'sensor-fault',
        severity: 'warn',
        icon: 'sensors_off',
        title: `${s.id} fuera de servicio`,
        detail: s.defectiveReason || 'Marcado como defectivo; excluido del cómputo',
        area: s.area,
        sensorId: s.id,
        tap: s.tap,
        sinceMs: null,
        areaSlug: this.salaSlug(s.area),
      });
    }

    // 4. Sensor sin lectura reciente (stale individual, no por TAP).
    const STALE_MS_ALARM = 10 * 60_000;
    for (const s of this.coldRoomSensors()) {
      if (s.defective) continue;
      if (!s.lastSeen) continue;
      const ts = new Date(s.lastSeen).getTime();
      if (!Number.isFinite(ts) || ts <= 0) continue;
      const age = nowMs - ts;
      if (age < STALE_MS_ALARM) continue;
      // Si TAP entero caído, no duplicar (ya está la alarma TAP).
      const tapAge = ageMap[s.tap];
      if (tapAge !== null && tapAge !== undefined && tapAge >= 5 * 60_000) continue;
      out.push({
        id: `stale-${s.id}`,
        type: 'sensor-down',
        severity: 'warn',
        icon: 'signal_disconnected',
        title: `${s.id} sin lectura reciente`,
        detail: `Última lectura hace ${this.relativeMs(age)} · TAP transmite, sensor podría haberse caído`,
        area: s.area,
        sensorId: s.id,
        tap: s.tap,
        sinceMs: age,
        areaSlug: this.salaSlug(s.area),
      });
    }

    // 5. Salas sin umbral configurado (compliance no calculable).
    for (const sa of this.salaAggregates()) {
      if (sa.thresholdMax !== null) continue;
      out.push({
        id: `noumb-${sa.slug}`,
        type: 'sin-umbral',
        severity: 'info',
        icon: 'tune',
        title: `${sa.area} sin umbral configurado`,
        detail: 'Configurar Umbrales para habilitar monitoreo HACCP de esta sala',
        area: sa.area,
        sensorId: null,
        tap: null,
        sinceMs: null,
        areaSlug: sa.slug,
      });
    }

    // Sort: crit primero, luego warn, luego info. Dentro de severidad por sinceMs desc.
    const sevRank = { crit: 0, warn: 1, info: 2 } as const;
    out.sort((a, b) => {
      if (sevRank[a.severity] !== sevRank[b.severity])
        return sevRank[a.severity] - sevRank[b.severity];
      return (b.sinceMs ?? 0) - (a.sinceMs ?? 0);
    });
    return out;
  });

  readonly alarmsCounts = computed(() => {
    const list = this.alarmsList();
    return {
      total: list.length,
      crit: list.filter((a) => a.severity === 'crit').length,
      warn: list.filter((a) => a.severity === 'warn').length,
      info: list.filter((a) => a.severity === 'info').length,
    };
  });

  readonly alarmsFilter = signal<'all' | 'crit' | 'warn' | 'info'>('all');

  // Vista de la pestaña Alarmas: activas (operacionales) vs historial (disparadas).
  readonly alarmsView = signal<'activas' | 'historial'>('activas');
  readonly alarmEvents = computed<AlarmEvent[]>(() => this.alarmRulesSvc.events());
  readonly alarmEventsLoaded = computed(() => this.alarmRulesSvc.eventsLoaded());

  // Mapea los eventos al modelo compartido AlarmHistoryItem.
  readonly alarmHistoryItems = computed<AlarmHistoryItem[]>(() => {
    const events = this.alarmEvents().map((e) => {
      const sev: 'info' | 'warn' | 'crit' = e.rule_severity || 'warn';
      const sevLabel = sev === 'crit' ? 'Crítica' : sev === 'warn' ? 'Advertencia' : 'Info';
      return {
        id: e.id,
        title: e.rule_name || 'Alarma',
        detail: this.alarmEventSummary(e),
        severity: sev,
        severityLabel: sevLabel,
        startedAt: e.triggered_at,
        endedAt: e.resolved_at,
        status: e.resolved_at ? 'resuelta' : 'activa',
        tags: e.email_sent ? [{ icon: 'mail', label: 'Notificada' }] : [],
      } satisfies AlarmHistoryItem;
    });
    return [...events, ...this.deviationObservationItems()].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  });

  /**
   * Desviaciones HACCP que tienen una observación del operador (nota o causa
   * marcada manualmente) → entran al historial como items propios. La nota va
   * siempre con SU desviación (nunca mal atribuida a otro evento).
   */
  private deviationObservationItems(): AlarmHistoryItem[] {
    const out: AlarmHistoryItem[] = [];
    for (const d of this.deviationsSvc.detect(this.coldRoomSensors())) {
      const ack = this.deviationsSvc.getAck(d.id);
      const manualCause =
        ack?.cause && ack.causeSource === 'manual' ? DEVIATION_CAUSES[ack.cause].label : null;
      const note = ack?.causeNote || ack?.note || null;
      if (!manualCause && !note) continue; // solo desviaciones documentadas

      const observation = [manualCause, note].filter(Boolean).join(' — ');
      const sev: 'info' | 'warn' | 'crit' =
        d.level === 'severe' || d.level === 'crit' ? 'crit' : d.level === 'warn' ? 'warn' : 'info';
      const tags: AlarmHistoryItem['tags'] = [{ icon: 'memory', label: d.tap }];
      if (manualCause && ack?.cause) {
        tags.unshift({ icon: DEVIATION_CAUSES[ack.cause].icon, label: manualCause });
      }
      out.push({
        id: `dev:${d.id}`,
        title: `Desviación de temperatura · ${d.area}`,
        code: 'HACCP',
        detail: `${d.peakT}°C (máx ${d.thresholdMax}°C) · ${d.durationMin} min`,
        observation,
        severity: sev,
        severityLabel: sev === 'crit' ? 'Crítica' : sev === 'warn' ? 'Advertencia' : 'Info',
        startedAt: d.startTs,
        endedAt: d.endTs,
        status: this.deviationsSvc.isOpen(d) ? 'activa' : 'resuelta',
        icon: 'thermostat',
        tags,
      });
    }
    return out;
  }

  private alarmEventSummary(e: AlarmEvent): string {
    if (!e.rule_metric) return e.target_label || '';
    const unit = e.rule_metric === 'temperatura' ? '°C' : e.rule_metric === 'humedad' ? '%' : 'min';
    const val = e.current_value !== null ? `${e.current_value}${unit}` : '—';
    const cond =
      e.rule_op && e.rule_threshold !== null ? `${e.rule_op} ${e.rule_threshold}${unit}` : '';
    return `${val} (umbral ${cond}) · ${e.target_label || ''}`.trim();
  }

  readonly alarmsFiltered = computed(() => {
    const f = this.alarmsFilter();
    if (f === 'all') return this.alarmsList();
    return this.alarmsList().filter((a) => a.severity === f);
  });

  // Alarmas ACTIVAS mapeadas al modelo compartido (mismo UI que el historial).
  readonly alarmsActivasItems = computed<AlarmHistoryItem[]>(() => {
    const q = this.salaQueryParams();
    return this.alarmsFiltered().map((al) => {
      const tags: AlarmHistoryItem['tags'] = [];
      if (al.area) tags.push({ icon: 'meeting_room', label: al.area });
      if (al.tap) tags.push({ icon: 'memory', label: al.tap });
      return {
        id: al.id,
        title: al.title,
        detail: al.detail,
        severity: al.severity,
        severityLabel:
          al.severity === 'crit' ? 'Crítica' : al.severity === 'warn' ? 'Advertencia' : 'Info',
        icon: al.icon,
        startedAt: new Date(Date.now() - (al.sinceMs ?? 0)).toISOString(),
        endedAt: null,
        status: 'activa',
        tags,
        link: al.areaSlug ? this.alarmAreaLink(al.areaSlug) : null,
        linkQuery: q,
        linkTitle: 'Ir a detalle de sala',
      } satisfies AlarmHistoryItem;
    });
  });

  readonly alarmsEmptyText = computed(() =>
    this.alarmsCounts().total === 0 ? 'Sin alarmas activas' : 'Sin alarmas en este filtro',
  );

  alarmAreaLink(slug: string | null): string[] | null {
    if (!slug) return null;
    return ['/companies', this.siteId(), 'sala', slug];
  }

  // === Descargar historial (modal) ===
  readonly historyExportOpen = signal<boolean>(false);
  readonly historyExportSelectedSalas = signal<Set<string>>(new Set<string>());
  readonly historyExportSelectedSensors = signal<Set<string>>(new Set<string>());
  readonly historyExportFrom = signal<string>('');
  readonly historyExportTo = signal<string>('');
  readonly historyExportLoading = signal<boolean>(false);
  readonly historyExportError = signal<string | null>(null);
  // Intervalo de agrupación (promedio/mín/máx por intervalo). 'auto' = resolución base.
  readonly historyExportInterval = signal<ColdRoomExportInterval>('auto');
  readonly historyExportIntervalOptions: { value: ColdRoomExportInterval; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: '1min', label: '1 min' },
    { value: '5min', label: '5 min' },
    { value: '15min', label: '15 min' },
    { value: '1h', label: '1 hora' },
    { value: '1d', label: '1 día' },
  ];
  // Variables a incluir en el Excel.
  readonly historyExportVars = signal<'both' | 'temp' | 'hum'>('both');
  readonly historyExportVarsOptions: { value: 'both' | 'temp' | 'hum'; label: string }[] = [
    { value: 'both', label: 'Ambas' },
    { value: 'temp', label: 'Temperatura' },
    { value: 'hum', label: 'Humedad' },
  ];

  openHistoryExport(): void {
    // Default: hoy 00:00 → ahora.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    this.historyExportFrom.set(this.toDatetimeLocal(startOfToday));
    this.historyExportTo.set(this.toDatetimeLocal(now));
    this.historyExportSelectedSalas.set(new Set());
    this.historyExportSelectedSensors.set(new Set());
    this.historyExportError.set(null);
    this.historyExportOpen.set(true);
  }

  closeHistoryExport(): void {
    this.historyExportOpen.set(false);
  }

  private toDatetimeLocal(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  toggleExportSala(slug: string): void {
    const cur = new Set(this.historyExportSelectedSalas());
    if (cur.has(slug)) cur.delete(slug);
    else cur.add(slug);
    this.historyExportSelectedSalas.set(cur);
    // Limpia sensores cuyo área ya no está seleccionada.
    const validIds = new Set(this.exportAvailableSensors().map((s) => s.id));
    const cleanSensors = new Set(
      [...this.historyExportSelectedSensors()].filter((id) => validIds.has(id)),
    );
    this.historyExportSelectedSensors.set(cleanSensors);
  }

  toggleExportSensor(id: string): void {
    const cur = new Set(this.historyExportSelectedSensors());
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    this.historyExportSelectedSensors.set(cur);
  }

  toggleExportSelectAllSalas(): void {
    const all = this.salaAggregates().map((sa) => sa.slug);
    const cur = this.historyExportSelectedSalas();
    if (cur.size === all.length) this.historyExportSelectedSalas.set(new Set());
    else this.historyExportSelectedSalas.set(new Set(all));
    // Reset sensores.
    this.historyExportSelectedSensors.set(new Set());
  }

  toggleExportSelectAllSensors(): void {
    const available = this.exportAvailableSensors().map((s) => s.id);
    const cur = this.historyExportSelectedSensors();
    if (cur.size === available.length) this.historyExportSelectedSensors.set(new Set());
    else this.historyExportSelectedSensors.set(new Set(available));
  }

  readonly exportAvailableSensors = computed(() => {
    const salaSlugs = this.historyExportSelectedSalas();
    if (salaSlugs.size === 0) return [];
    return this.coldRoomSensors().filter((s) => salaSlugs.has(this.salaSlug(s.area)));
  });

  setHistoryExportFrom(ev: Event): void {
    this.historyExportFrom.set((ev.target as HTMLInputElement).value);
  }
  setHistoryExportTo(ev: Event): void {
    this.historyExportTo.set((ev.target as HTMLInputElement).value);
  }

  async confirmHistoryExport(): Promise<void> {
    this.historyExportError.set(null);
    const sensors = [...this.historyExportSelectedSensors()];
    if (sensors.length === 0) {
      this.historyExportError.set('Selecciona al menos un sensor.');
      return;
    }
    const fromStr = this.historyExportFrom();
    const toStr = this.historyExportTo();
    if (!fromStr || !toStr) {
      this.historyExportError.set('Rango de fechas inválido.');
      return;
    }
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (to <= from) {
      this.historyExportError.set('La fecha "Hasta" debe ser mayor que "Desde".');
      return;
    }

    const sid = this.siteId();
    const related = this.coldRoomSites().map((s) => s.id);
    const allIds = related.length > 0 ? [...new Set([sid, ...related])] : [sid];

    this.historyExportLoading.set(true);
    this.coldRoom
      .exportHistory(
        sid,
        from.toISOString(),
        to.toISOString(),
        allIds,
        sensors,
        this.historyExportInterval(),
      )
      .subscribe({
        next: async (res) => {
          this.historyExportLoading.set(false);
          if (!res.ok) {
            this.historyExportError.set(res.error || 'Error al obtener datos.');
            return;
          }
          if (res.data.points.length === 0) {
            this.historyExportError.set('Sin datos en el rango seleccionado.');
            return;
          }
          try {
            await this.downloadHistoryXlsx(
              res.data.points,
              from,
              to,
              res.meta.view,
              sensors,
              res.meta.interval,
            );
            this.closeHistoryExport();
          } catch (err) {
            this.historyExportError.set(
              'Error al generar Excel: ' + (err instanceof Error ? err.message : String(err)),
            );
          }
        },
        error: (err) => {
          this.historyExportLoading.set(false);
          this.historyExportError.set(
            'Error HTTP: ' + (err?.error?.error || err?.message || 'desconocido'),
          );
        },
      });
  }

  // Lazy load xlsx — primer click paga la descarga (~150 kB), siguientes
  // clicks reusan el módulo en memoria.
  private xlsxLoader?: Promise<typeof import('xlsx')>;
  private async loadXlsx(): Promise<typeof import('xlsx')> {
    if (!this.xlsxLoader) this.xlsxLoader = import('xlsx');
    return this.xlsxLoader;
  }

  private formatChileShort(ts: string): string {
    const { date, time } = this.formatChileParts(ts);
    return `${date} ${time}`;
  }

  private formatChileParts(ts: string): { date: string; time: string } {
    const d = new Date(ts);
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}:${get('minute')}`,
    };
  }

  private async downloadHistoryXlsx(
    points: ColdRoomExportPoint[],
    from: Date,
    to: Date,
    view: string,
    sensorIds: string[],
    intervalLabel?: string,
  ): Promise<void> {
    const XLSX = await this.loadXlsx();
    const wb = XLSX.utils.book_new();
    const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
    const vars = this.historyExportVars();
    const incT = vars !== 'hum';
    const incH = vars !== 'temp';

    // Hoja 1: Lecturas (promedio/mín/máx por intervalo). Columnas según variables.
    const rows = points.map((p) => {
      const dt = this.formatChileParts(p.ts);
      const row: Record<string, string | number | null> = {
        Fecha: dt.date,
        Hora: dt.time,
        Sensor: p.sensorId,
        Sala: (p.area || '').replace(/\s+/g, ' ').trim(),
        TAP: p.tap,
      };
      if (incT) {
        row['Temp prom (°C)'] = r2(p.t);
        row['Temp mín (°C)'] = r2(p.tMin);
        row['Temp máx (°C)'] = r2(p.tMax);
      }
      if (incH) {
        row['HR prom (%)'] = r2(p.h);
        row['HR mín (%)'] = r2(p.hMin);
        row['HR máx (%)'] = r2(p.hMax);
      }
      return row;
    });
    const sheet1 = XLSX.utils.json_to_sheet(rows);
    sheet1['!cols'] = [
      { wch: 12 }, // Fecha
      { wch: 8 }, // Hora
      { wch: 10 }, // Sensor
      { wch: 28 }, // Sala
      { wch: 8 }, // TAP
      ...(incT ? [{ wch: 14 }, { wch: 13 }, { wch: 13 }] : []),
      ...(incH ? [{ wch: 12 }, { wch: 11 }, { wch: 11 }] : []),
    ];
    // Freeze header row.
    sheet1['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, sheet1, 'Lecturas');

    // Hoja 2: Resumen.
    const fmtRange = (d: Date) => this.formatChileShort(d.toISOString());
    const cagg: Record<string, string> = {
      equipo_1min: '1 minuto',
      equipo_5min: '5 minutos',
      equipo_hourly: '1 hora',
      equipo_daily: '1 día',
    };
    const intervalNames: Record<string, string> = {
      '1min': '1 minuto',
      '5min': '5 minutos',
      '15min': '15 minutos',
      '1h': '1 hora',
      '1d': '1 día',
    };
    const summary = [
      { Campo: 'Sitio', Valor: 'Ventisqueros' },
      { Campo: 'Generado', Valor: this.formatChileShort(new Date().toISOString()) },
      { Campo: 'Rango desde', Valor: fmtRange(from) },
      { Campo: 'Rango hasta', Valor: fmtRange(to) },
      {
        Campo: 'Agrupación (promedio/mín/máx)',
        Valor: intervalLabel ? intervalNames[intervalLabel] || intervalLabel : cagg[view] || view,
      },
      { Campo: 'Resolución base', Valor: cagg[view] || view },
      {
        Campo: 'Variables',
        Valor:
          vars === 'both' ? 'Temperatura + Humedad' : vars === 'temp' ? 'Temperatura' : 'Humedad',
      },
      { Campo: 'Sensores', Valor: sensorIds.join(', ') },
      { Campo: 'Total filas', Valor: points.length },
    ];
    const sheet2 = XLSX.utils.json_to_sheet(summary);
    sheet2['!cols'] = [{ wch: 18 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, sheet2, 'Resumen');

    const fmt = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const fileName = `ventisqueros-historial-${fmt(from)}-${fmt(to)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  readonly salasSinUmbralCount = computed(
    () => this.salaAggregates().filter((sa) => sa.thresholdMax === null).length,
  );

  readonly defrostEnabledCount = computed(() => {
    const map = this.defrostSvc.schedules();
    return Object.values(map).reduce(
      (sum, list) => sum + (list as DefrostWindow[]).filter((w) => w.enabled).length,
      0,
    );
  });

  // === TAP technical diagnostics (cagg-derived, Modbus wired) ===
  readonly diagFilter = signal<'all' | 'online' | 'degraded' | 'offline'>('all');
  readonly diagSort = signal<'lastSeen' | 'tap'>('tap');

  readonly tapDiagnostics = computed<TapDiagnostic[]>(() => {
    const colors = this.tapColors();
    const taps = this.taps();
    const ageMap = this.tapLastSeenAgeMs();
    const coldSensors = this.coldRoomSensors();
    const now = Date.now();
    const STALE_FRESH_MS = 5 * 60_000;
    const STALE_OFFLINE_MS = 30 * 60_000;
    return taps.map((tap) => {
      // Sensores del TAP reportando reciente (cagg propio).
      const tapSensors = coldSensors.filter((s) => s.tap === tap);

      // Cobertura 24h: cuántos minutos del cagg tienen al menos una lectura.
      // 1440 = 24h * 60min. Sparkline en 60 slots de 24min cada uno.
      const cutoff = now - 24 * 3_600_000;
      const slotsCount = 60;
      const slotMs = (24 * 3_600_000) / slotsCount;
      const coverageSlots = new Array<boolean>(slotsCount).fill(false);
      const uniqueMinutes = new Set<number>();
      for (const s of tapSensors) {
        if (!s.histPoints || s.histPoints.length === 0) continue;
        for (const p of s.histPoints) {
          const ts = new Date(p.t).getTime();
          if (!Number.isFinite(ts) || ts < cutoff) continue;
          uniqueMinutes.add(Math.floor(ts / 60_000));
          const slot = Math.floor((ts - cutoff) / slotMs);
          if (slot >= 0 && slot < slotsCount) coverageSlots[slot] = true;
        }
      }
      const coverageMinutes = uniqueMinutes.size;
      const coveragePct = (coverageMinutes / 1440) * 100;

      // Edad de transmisión: directo del cagg.
      const caggAge = ageMap[tap];
      const transmissionAgeMs = caggAge !== null && caggAge !== undefined ? caggAge : null;

      // Status puramente cagg-derived (Modbus wired, sin concentrador maestro).
      let status: TapTechStatus = 'unknown';
      if (transmissionAgeMs === null) {
        status = 'unknown';
      } else if (transmissionAgeMs < STALE_FRESH_MS) {
        status = 'online';
      } else if (transmissionAgeMs < STALE_OFFLINE_MS) {
        status = 'degraded';
      } else {
        status = 'offline';
      }

      const oldestIso =
        transmissionAgeMs !== null ? new Date(now - transmissionAgeMs).toISOString() : null;

      return {
        tap,
        color: colors[tap],
        status,
        oldestSeenIso: oldestIso,
        oldestSeenMs: transmissionAgeMs,
        coveragePct,
        coverageMinutes,
        coverageSlots,
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
      return a.tap.localeCompare(b.tap);
    });
    return filtered;
  });

  readonly diagKpis = computed(() => {
    const list = this.tapDiagnostics();
    const online = list.filter((d) => d.status === 'online').length;
    const degraded = list.filter((d) => d.status === 'degraded').length;
    const offline = list.filter((d) => d.status === 'offline').length;
    return { online, degraded, offline, total: list.length };
  });

  relativeMs(ms: number | null): string {
    if (ms === null) return '—';
    if (ms < 1000) return 'recién';
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    return `${Math.floor(ms / 3_600_000)}h`;
  }

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

    // Carga reglas + historial de alarmas del sitio para la pestaña Alarmas.
    effect(() => {
      const id = this.siteId();
      if (id) this.alarmRulesSvc.setSiteId(id);
    });

    effect(() => {
      // Rich cold-room data when Salas or Compliance tab active.
      const tab = this.effectiveTab();
      // Pollear en General, Salas, Compliance y TAP técnico — todos usan
      // coldRoomSensors. Sin esto el TAP técnico queda congelado en datos
      // iniciales y status no se refresca.
      if (tab === 'general' || tab === 'salas' || tab === 'compliance' || tab === 'taps') {
        this.startColdRoomPolling();
      } else {
        this.stopColdRoomPolling();
      }
    });
  }

  ngOnInit(): void {
    // Tick cada 5s en lugar de 1s: la mayoría de UI muestra antigüedad en
    // minutos/horas, no segundos. Cada tick dispara recompute de ~10
    // signals que iteran histPoints (1440pts × N sensores × M salas). Bajar
    // a 5s reduce CPU/GC ~5x. Pausa cuando tab está oculto (Page Visibility).
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.now.set(Date.now());
    };
    this.intervalId = setInterval(tick, 5000);
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (!document.hidden) this.now.set(Date.now());
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    const sid = this.siteId();
    if (sid) {
      this.thresholdsSvc.setSiteId(sid);
      this.defrostSvc.setSiteId(sid);
      this.deviationsSvc.setSiteId(sid);
      this.auditSvc.setSiteId(sid);
    }
  }

  private visibilityHandler: (() => void) | null = null;

  ngOnDestroy(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
    }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.stopColdRoomPolling();
    this.stopColdRoom7dPolling();
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
    // Agrega siteIds de TODOS los TAPs cold-room para que backend bundle desde
    // múltiples reg_map + equipo_1min cagg en una sola query. Si coldRoomSites
    // está vacío (vista single-site), usa solo el siteId primary.
    const related = this.coldRoomSites().map((s) => s.id);
    const allIds = related.length > 0 ? [...new Set([id, ...related])] : [id];
    this.coldRoom.getSensors(id, null, '24h', allIds).subscribe({
      next: (res) => {
        if (res.ok) this.coldRoomSensors.set(res.data || []);
      },
      error: () => {
        /* keep last known */
      },
    });
  }

  private fetchColdRoom7d(): void {
    const id = this.siteId();
    if (!id) return;
    const related = this.coldRoomSites().map((s) => s.id);
    const allIds = related.length > 0 ? [...new Set([id, ...related])] : [id];
    this.coldRoom.getSensors(id, null, '7d', allIds).subscribe({
      next: (res) => {
        if (res.ok) this.coldRoomSensors7d.set(res.data || []);
      },
      error: () => {
        /* keep last known */
      },
    });
  }

  private startColdRoom7dPolling(): void {
    if (this.coldRoom7dPollTimer !== null) return;
    this.fetchColdRoom7d();
    // 5 min refresh: 7d data cambia lento, no necesita poll agresivo.
    this.coldRoom7dPollTimer = setInterval(() => this.fetchColdRoom7d(), 300_000);
  }

  private stopColdRoom7dPolling(): void {
    if (this.coldRoom7dPollTimer !== null) {
      clearInterval(this.coldRoom7dPollTimer);
      this.coldRoom7dPollTimer = null;
    }
  }

  private computeOutOfBandMin(sensors: ColdRoomSensor[], threshold: number | null): number {
    if (sensors.length === 0 || threshold === null) return 0;
    const first = sensors[0];
    const points = first.hist?.length || 0;
    if (points === 0) return 0;

    let intervalMs = 15 * 60 * 1000;
    const pts = first.histPoints;
    if (pts && pts.length >= 2) {
      const a = new Date(pts[0].t).getTime();
      const b = new Date(pts[1].t).getTime();
      if (isFinite(a) && isFinite(b) && b > a) intervalMs = b - a;
    }

    let outOfBandPts = 0;
    for (let i = 0; i < points; i++) {
      let maxV = -Infinity;
      for (const s of sensors) {
        const v = s.hist[i];
        if (typeof v !== 'number' || !isFinite(v)) continue;
        if (v > maxV) maxV = v;
      }
      if (maxV > threshold) outOfBandPts++;
    }
    return Math.round((outOfBandPts * intervalMs) / 60000);
  }

  private computeReportingCount(sensors: ColdRoomSensor[]): number {
    if (sensors.length === 0) return 0;
    const now = Date.now();
    return sensors.filter((s) => {
      // Sensor defectuoso aunque reporte timestamp no cuenta como activo.
      if (s.defective) return false;
      if (!s.lastSeen) return false;
      return now - new Date(s.lastSeen).getTime() < this.STALE_MS;
    }).length;
  }

  longestOngoingMin(sa: SalaAggregate): number {
    const rich = this.coldRoomSensors().filter((s) => s.area === sa.area);
    const exs = this.deviationsSvc.detect(rich).filter((e) => e.ongoing);
    return exs.reduce((m, e) => Math.max(m, e.durationMin), 0);
  }

  isSalaStale(sa: SalaAggregate): boolean {
    // Sala stale si ningún sensor activo reportó en últimos 5 min.
    return sa.activeCount > 0 && sa.reportingCount === 0;
  }

  fmtMinutes(min: number): string {
    if (!min || min === 0) return '0m';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  fmtTemp = fmtTemp;
  fmtHum = fmtHum;
  tempColor = tempColor;
  humColor = humColor;

  rowBg(s: Sensor): string {
    if (this.selectedId() === s.id) return 'var(--color-primary-tint-08)';
    if (s.alerted) return 'rgba(239,68,68,0.04)';
    return 'transparent';
  }

  onRetry(): void {
    this.service.refresh();
  }

  rowBorder(s: Sensor): string {
    if (this.selectedId() === s.id) return '1px solid var(--color-primary-tint-35)';
    if (s.alerted) return '1px solid rgba(239,68,68,0.20)';
    return '1px solid transparent';
  }
}
