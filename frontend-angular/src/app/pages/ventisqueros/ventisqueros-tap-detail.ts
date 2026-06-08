import { CommonModule, Location } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Chart, registerables } from 'chart.js';
import annotationPlugin, { type AnnotationOptions } from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';
import type { CompanyNode, SiteRecord } from '@emeltec/shared';
import { CompanyService } from '../../services/company.service';
import {
  ColdRoomService,
  type ColdRoomBackupSensor,
  type ColdRoomConcentrator,
  type ColdRoomRange,
  type ColdRoomSensor,
  type ColdRoomSensorHistory,
} from '../../services/cold-room.service';
import { SiteVariableSettingsPanelComponent } from '../companies/components/site-variable-settings-panel';
import { VentisquerosFloorMapComponent } from './ventisqueros-floor-map';
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

Chart.register(...registerables, annotationPlugin, zoomPlugin);

type DetailTab = 'resumen' | 'configuracion';
type ViewMode = 'table' | 'grid';
type SortKey = 'id' | 'area' | 't' | 'h' | 'status';
type SortDir = 'asc' | 'desc';

const POLL_MS = 30_000;
const RANGES: ColdRoomRange[] = ['1h', '6h', '24h', '7d'];
const PIN_STORAGE_KEY = 'coldroom:pinned';
const VIEW_STORAGE_KEY = 'coldroom:viewMode';
const SHOW_MAP_KEY = 'coldroom:showMap';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

@Component({
  selector: 'app-ventisqueros-tap-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SiteVariableSettingsPanelComponent,
    VentisquerosFloorMapComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style="background:#F0F2F5;">
      <!-- Header -->
      <div
        class="cr-header flex flex-wrap items-center gap-3 border-t border-b px-5 py-2.5"
        [style.borderBottomColor]="tapColor()"
      >
        <button type="button" (click)="goBack()" class="cr-icon-btn" aria-label="Volver">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
        </button>
        <div
          class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg"
          [style.background]="tapColor() + '1A'"
          [style.border]="'1px solid ' + tapColor() + '40'"
        >
          <span class="material-symbols-outlined text-[18px]" [style.color]="tapColor()">{{
            isTap1() ? 'hub' : 'memory'
          }}</span>
        </div>
        <div class="min-w-0">
          <div class="tap-title truncate">{{ siteName() }} · {{ tapId() }}</div>
          <div class="mt-0.5 text-[11px] text-slate-400">
            @if (isTap1()) {
              Concentrador maestro · canal de respaldo
            } @else {
              {{ sensors().length }} sensores THM · rango {{ range() }}
            }
          </div>
        </div>

        <span class="cr-live ml-auto" [class.cr-live--err]="!!serviceError()" [title]="liveLabel()">
          <span
            class="cr-live-dot"
            [class.cr-live-dot--err]="!!serviceError()"
            [class.cr-live-dot--pulse]="!serviceError() && !isLoading()"
          ></span>
          {{ liveLabel() }}
        </span>

        <button
          type="button"
          class="cr-icon-btn"
          [disabled]="isLoading()"
          (click)="refresh()"
          title="Actualizar (R)"
          aria-label="Actualizar"
        >
          <span class="material-symbols-outlined text-[16px]" [class.cr-spin]="isLoading()"
            >sync</span
          >
        </button>

        @if (!isTap1()) {
          <button
            type="button"
            class="cr-icon-btn"
            [class.cr-icon-btn--active]="showMap()"
            (click)="toggleMap()"
            title="Plano (M)"
            aria-label="Plano"
          >
            <span class="material-symbols-outlined text-[16px]">map</span>
          </button>

          <button
            type="button"
            class="cr-btn"
            [disabled]="sensors().length === 0 || exporting()"
            (click)="exportCsv()"
            title="Descargar CSV"
          >
            <span class="material-symbols-outlined text-[16px]">{{
              exporting() ? 'hourglass_top' : 'download'
            }}</span>
            CSV
          </button>
          <button
            type="button"
            class="cr-btn"
            [disabled]="!chart"
            (click)="exportPng()"
            title="Descargar PNG"
          >
            <span class="material-symbols-outlined text-[16px]">image</span>
            PNG
          </button>
        }

        <button
          type="button"
          class="cr-btn"
          [class.cr-btn--active]="tab() === 'configuracion'"
          (click)="tab.set(tab() === 'configuracion' ? 'resumen' : 'configuracion')"
          [attr.aria-pressed]="tab() === 'configuracion'"
        >
          <span class="material-symbols-outlined text-[16px]">{{
            tab() === 'configuracion' ? 'arrow_back' : 'tune'
          }}</span>
          {{ tab() === 'configuracion' ? 'Resumen' : 'Configurar' }}
        </button>
      </div>

      <!-- Smart status banner -->
      @if (tab() === 'resumen' && !isTap1() && sensors().length > 0) {
        <div class="status-banner" [attr.data-level]="statusLevel()">
          <div class="status-banner-inner">
            <span class="status-icon material-symbols-outlined">{{ statusIcon() }}</span>
            <div class="status-text">
              <div class="status-title">{{ statusTitle() }}</div>
              <div class="status-sub">{{ statusSub() }}</div>
            </div>
            <div class="status-meta">
              <span class="status-meta-item">
                <span class="status-meta-lbl">Δ Setpoint prom.</span>
                <strong>{{ statusDeltaSetpoint() }}°C</strong>
              </span>
              <span class="status-meta-item">
                <span class="status-meta-lbl">Banda viol.</span>
                <strong>{{ stats().alerts }} / {{ stats().count }}</strong>
              </span>
            </div>
          </div>
        </div>
      }

      <!-- Content -->
      <div class="cr-content min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        @if (tab() === 'resumen') {
          @if (isTap1()) {
            <div class="px-5 py-5">
              <!-- Concentrator -->
              <section class="mb-6">
                <h3 class="section-title mb-3">Concentrador</h3>
                @if (concentrator(); as c) {
                  <div class="conc-grid">
                    <div class="conc-card">
                      <div class="kpi-hero">
                        <div
                          class="kpi-hero-value"
                          [style.color]="c.alerted ? '#DC2626' : tapColor()"
                        >
                          {{ c.online ?? 0 }}<span class="kpi-hero-total">/{{ c.total ?? 0 }}</span>
                        </div>
                        <div class="kpi-hero-label">canales online</div>
                      </div>
                      <div class="conc-meta">
                        <span
                          >Uptime <strong>{{ (c.uptime ?? 0).toFixed(2) }}%</strong></span
                        >
                        <span
                          >Firmware <strong>{{ c.firmwareVersion || '—' }}</strong></span
                        >
                        <span
                          >Bridge <strong>{{ c.bridgeAddress || '—' }}</strong></span
                        >
                      </div>
                    </div>
                    <div class="conc-channels">
                      <div class="conc-channels-head">
                        <span>Canal</span>
                        <span>TAP</span>
                        <span>Área</span>
                        <span class="text-right">RSSI</span>
                        <span class="text-right">Último</span>
                      </div>
                      @for (ch of c.channels || []; track ch.id; let i = $index) {
                        <div class="conc-channels-row anim-stagger" [style.--i]="i">
                          <span class="sensor-id-chip">{{ ch.id }}</span>
                          <span class="tap-tag" [style.color]="tapColorByLabel(ch.tap)">{{
                            ch.tap
                          }}</span>
                          <span class="truncate text-slate-600">{{ ch.area }}</span>
                          <span class="text-right font-mono text-[12px] text-slate-700"
                            >{{ ch.rssi }} dBm</span
                          >
                          <span class="text-right font-mono text-[11px] text-slate-400">{{
                            relativeTime(ch.lastSeen)
                          }}</span>
                        </div>
                      }
                    </div>
                  </div>
                } @else if (isLoading()) {
                  <div class="empty-block">Cargando concentrador…</div>
                }
              </section>

              <!-- Backup -->
              <section class="mb-6">
                <div class="mb-3 flex items-baseline justify-between gap-3">
                  <h3 class="section-title">Canal de respaldo · alarmas in-situ</h3>
                  <span class="section-meta">{{ backup().length }} canales redundantes</span>
                </div>
                @if (backup().length > 0) {
                  <div class="backup-grid">
                    @for (b of backup(); track b.id; let i = $index) {
                      <article
                        class="backup-card anim-stagger"
                        [class.backup-card--alert]="b.alertaFisica"
                        [style.--i]="i"
                        (click)="openSensorDrilldown(b.id)"
                        (keydown.enter)="openSensorDrilldown(b.id)"
                        tabindex="0"
                        role="button"
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div class="flex items-center gap-1.5">
                            <span class="sensor-id-chip">{{ b.id }}</span>
                            @if (b.alertaFisica) {
                              <span class="sensor-alert-chip">ALARMA</span>
                            }
                          </div>
                          <span class="tap-tag" [style.color]="tapColorByLabel(b.tap)">{{
                            b.tap
                          }}</span>
                        </div>
                        <div class="sensor-area mt-1.5 truncate">{{ b.area }}</div>
                        <div class="mt-2 flex items-baseline gap-3">
                          <div>
                            <div
                              class="sensor-metric-val"
                              [style.color]="b.alertaFisica ? '#B91C1C' : tempColor(b.t)"
                            >
                              {{ fmtTemp(b.t) }}
                            </div>
                            <div class="sensor-metric-lbl">T</div>
                          </div>
                          <div>
                            <div class="sensor-metric-val text-slate-700">{{ fmtHum(b.h) }}</div>
                            <div class="sensor-metric-lbl">HR</div>
                          </div>
                        </div>
                        <svg viewBox="0 0 120 28" class="mt-2 h-7 w-full">
                          <defs>
                            <linearGradient [attr.id]="'bgsp-' + b.id" x1="0" y1="0" x2="0" y2="1">
                              <stop
                                offset="0%"
                                [attr.stop-color]="b.alertaFisica ? '#EF4444' : tempColor(b.t)"
                                stop-opacity="0.35"
                              />
                              <stop offset="100%" stop-color="#fff" stop-opacity="0" />
                            </linearGradient>
                          </defs>
                          <path
                            [attr.d]="sparkArea(b.hist, 28)"
                            [attr.fill]="'url(#bgsp-' + b.id + ')'"
                          />
                          <path
                            [attr.d]="sparkLine(b.hist, 28)"
                            fill="none"
                            [attr.stroke]="b.alertaFisica ? '#EF4444' : tempColor(b.t)"
                            stroke-width="1.4"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          />
                        </svg>
                        <div class="mt-1 text-[10px] text-slate-400">
                          Último {{ relativeTime(b.lastSeen) }} · banda [{{ b.tMin }} /
                          {{ b.tMax }}]
                        </div>
                      </article>
                    }
                  </div>
                } @else if (isLoading()) {
                  <div class="empty-block">Cargando respaldo…</div>
                } @else {
                  <div class="empty-block">Sin canales de respaldo activos</div>
                }
              </section>
            </div>
          } @else {
            <!-- TAP 2/3/4 -->
            <div class="px-5 pt-5">
              <!-- KPI strip -->
              <div class="kpi-strip mb-5 flex flex-wrap items-end gap-8">
                <div class="kpi-hero">
                  <div
                    class="kpi-hero-value"
                    [style.color]="stats().alerts > 0 ? '#DC2626' : tapColor()"
                  >
                    {{ stats().alerts > 0 ? stats().alerts : stats().count }}
                  </div>
                  <div class="kpi-hero-label">
                    {{
                      stats().alerts === 1
                        ? 'sensor en alerta'
                        : stats().alerts > 0
                          ? 'sensores en alerta'
                          : 'sensores en operación'
                    }}
                  </div>
                </div>
                <div class="kpi-meta flex flex-wrap items-baseline gap-x-5 gap-y-1">
                  <span
                    >Temp prom <strong>{{ stats().avgT }}°C</strong></span
                  >
                  <span
                    >HR prom <strong>{{ stats().avgH }}%</strong></span
                  >
                  <span
                    >Mín <strong>{{ stats().minT }}°C</strong></span
                  >
                  <span
                    >Máx <strong>{{ stats().maxT }}°C</strong></span
                  >
                  <span class="kpi-meta-tap">{{ tapId() }}</span>
                </div>

                <!-- Distribution sparkline -->
                <div class="kpi-distribution" *ngIf="sensors().length > 1">
                  <div class="kpi-distribution-lbl">Distribución T</div>
                  <svg viewBox="0 0 160 36" class="kpi-distribution-svg">
                    @for (b of distribution(); track b.x; let i = $index) {
                      <rect
                        [attr.x]="b.x"
                        [attr.y]="36 - b.h"
                        [attr.width]="b.w"
                        [attr.height]="b.h"
                        [attr.fill]="b.color"
                        rx="1"
                      />
                    }
                  </svg>
                </div>
              </div>

              <!-- Floor-map embed -->
              @if (showMap()) {
                <div class="mb-5 floor-shell">
                  <app-ventisqueros-floor-map
                    [sensors]="asSensors()"
                    [hasAlerts]="stats().alerts > 0"
                    (selectSensor)="openSensorDrilldown($event)"
                  />
                </div>
              }
            </div>

            <!-- Alertas destacadas -->
            @if (alertedSensors().length > 0) {
              <section class="mb-5 px-5">
                <h3 class="section-title mb-2 text-rose-700">
                  Sensores en alerta
                  <span class="section-count">{{ alertedSensors().length }}</span>
                </h3>
                <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  @for (s of alertedSensors(); track s.id; let i = $index) {
                    <article
                      class="alert-card anim-stagger"
                      [style.--i]="i"
                      (click)="openSensorDrilldown(s.id)"
                      (keydown.enter)="openSensorDrilldown(s.id)"
                      tabindex="0"
                      role="button"
                    >
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
                          style="box-shadow: 0 0 0 4px rgba(239,68,68,0.20);"
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
                      <div class="mt-2 text-[10px] text-slate-500">
                        Banda [{{ s.tMin }}°C / {{ s.tMax }}°C] · setpoint {{ s.setpoint }}°C
                      </div>
                      <svg viewBox="0 0 120 32" class="mt-2 h-8 w-full">
                        <defs>
                          <linearGradient [attr.id]="'asp-' + s.id" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#EF4444" stop-opacity="0.35" />
                            <stop offset="100%" stop-color="#fff" stop-opacity="0" />
                          </linearGradient>
                        </defs>
                        <path
                          [attr.d]="sparkArea(s.hist, 32)"
                          [attr.fill]="'url(#asp-' + s.id + ')'"
                        />
                        <path
                          [attr.d]="sparkLine(s.hist, 32)"
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

            <!-- Sticky filter bar -->
            <div class="filter-bar">
              <div class="filter-bar-inner">
                <h3 class="section-title">
                  Sensores
                  <span class="section-count">{{ filteredSensors().length }}</span>
                </h3>

                <div class="search-wrap">
                  <span class="material-symbols-outlined search-icon">search</span>
                  <input
                    #searchInput
                    type="search"
                    class="search-input"
                    placeholder="Buscar id o área…  ( / )"
                    [ngModel]="query()"
                    (ngModelChange)="query.set($event)"
                    aria-label="Buscar sensores"
                  />
                  @if (query()) {
                    <button
                      type="button"
                      class="search-clear"
                      (click)="query.set('')"
                      aria-label="Limpiar"
                    >
                      <span class="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  }
                </div>

                <div class="view-toggle" role="tablist" aria-label="Vista">
                  <button
                    type="button"
                    role="tab"
                    class="view-toggle-btn"
                    [class.view-toggle-btn--active]="viewMode() === 'table'"
                    (click)="setViewMode('table')"
                    title="Vista tabla"
                  >
                    <span class="material-symbols-outlined text-[16px]">table_rows</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    class="view-toggle-btn"
                    [class.view-toggle-btn--active]="viewMode() === 'grid'"
                    (click)="setViewMode('grid')"
                    title="Vista grid"
                  >
                    <span class="material-symbols-outlined text-[16px]">grid_view</span>
                  </button>
                </div>

                @if (compareSet().size > 0) {
                  <button
                    type="button"
                    class="compare-pill"
                    (click)="clearCompare()"
                    title="Vaciar selección de comparación"
                  >
                    <span class="material-symbols-outlined text-[14px]">compare_arrows</span>
                    Comparando {{ compareSet().size }}
                    <span class="material-symbols-outlined text-[14px]">close</span>
                  </button>
                }
              </div>
            </div>

            <div class="px-5 pb-5">
              <!-- Pinned -->
              @if (pinnedSensors().length > 0) {
                <div class="pinned-strip mb-3">
                  <span class="pinned-lbl">
                    <span class="material-symbols-outlined text-[14px]">push_pin</span>
                    Fijados
                  </span>
                  @for (s of pinnedSensors(); track s.id) {
                    <button
                      type="button"
                      class="pinned-chip"
                      [class.pinned-chip--alert]="s.alerted"
                      (click)="openSensorDrilldown(s.id)"
                    >
                      <span class="sensor-id-chip">{{ s.id }}</span>
                      <span class="font-mono text-[11px] text-slate-700">{{ fmtTemp(s.t) }}</span>
                    </button>
                  }
                </div>
              }

              <!-- Table view -->
              @if (viewMode() === 'table' && filteredSensors().length > 0) {
                <div class="sensor-table" role="table" aria-label="Sensores">
                  <div class="sensor-table-head" role="row">
                    <span aria-hidden="true"></span>
                    <button class="th-btn" role="columnheader" (click)="toggleSort('id')">
                      Sensor {{ sortArrow('id') }}
                    </button>
                    <button class="th-btn" role="columnheader" (click)="toggleSort('area')">
                      Ubicación {{ sortArrow('area') }}
                    </button>
                    <button class="th-btn text-right" role="columnheader" (click)="toggleSort('t')">
                      Temp {{ sortArrow('t') }}
                    </button>
                    <button class="th-btn text-right" role="columnheader" (click)="toggleSort('h')">
                      HR {{ sortArrow('h') }}
                    </button>
                    <button class="th-btn" role="columnheader" (click)="toggleSort('status')">
                      Estado {{ sortArrow('status') }}
                    </button>
                    <span role="columnheader">Tendencia</span>
                    <span aria-hidden="true"></span>
                  </div>
                  @for (s of filteredSensors(); track s.id; let i = $index) {
                    <div
                      class="sensor-row anim-stagger"
                      [class.sensor-row--alert]="s.alerted"
                      [class.sensor-row--cmp]="compareSet().has(s.id)"
                      [style.--i]="i"
                      [title]="s.area"
                      role="row"
                      tabindex="0"
                      (click)="openSensorDrilldown(s.id)"
                      (keydown.enter)="openSensorDrilldown(s.id)"
                    >
                      <input
                        type="checkbox"
                        class="row-cmp"
                        [checked]="compareSet().has(s.id)"
                        (click)="$event.stopPropagation()"
                        (change)="toggleCompare(s.id, $event)"
                        [attr.aria-label]="'Comparar ' + s.id"
                      />
                      <span class="sensor-id-chip" role="cell">{{ s.id }}</span>
                      <span class="sensor-row-area truncate" role="cell">{{ s.area }}</span>
                      <span
                        class="sensor-row-temp text-right"
                        role="cell"
                        [style.color]="s.alerted ? '#B91C1C' : '#1E293B'"
                        >{{ fmtTemp(s.t) }}</span
                      >
                      <span class="sensor-row-hum text-right" role="cell">{{ fmtHum(s.h) }}</span>
                      <span class="status-cell" role="cell">
                        <span
                          class="status-dot"
                          [style.background]="s.alerted ? '#EF4444' : '#22C55E'"
                        ></span>
                        {{ s.alerted ? 'Alerta' : 'Normal' }}
                      </span>
                      <svg viewBox="0 0 120 18" class="sensor-row-spark" role="cell">
                        <path
                          [attr.d]="sparkLine(s.hist, 18)"
                          fill="none"
                          [attr.stroke]="tempColor(s.t)"
                          stroke-width="1.4"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                      <button
                        type="button"
                        class="row-pin"
                        [class.row-pin--on]="pinnedSet().has(s.id)"
                        (click)="togglePin(s.id, $event)"
                        [attr.aria-label]="
                          pinnedSet().has(s.id) ? 'Quitar fijo ' + s.id : 'Fijar ' + s.id
                        "
                      >
                        <span class="material-symbols-outlined text-[15px]">push_pin</span>
                      </button>
                    </div>
                  }
                </div>
              }

              <!-- Grid view -->
              @if (viewMode() === 'grid' && filteredSensors().length > 0) {
                <div class="grid-view">
                  @for (s of filteredSensors(); track s.id; let i = $index) {
                    <article
                      class="grid-card anim-stagger"
                      [class.grid-card--alert]="s.alerted"
                      [class.grid-card--cmp]="compareSet().has(s.id)"
                      [style.--i]="i"
                      (click)="openSensorDrilldown(s.id)"
                      (keydown.enter)="openSensorDrilldown(s.id)"
                      tabindex="0"
                      role="button"
                    >
                      <header class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5">
                          <span class="sensor-id-chip">{{ s.id }}</span>
                          @if (s.alerted) {
                            <span class="sensor-alert-chip">ALERTA</span>
                          }
                        </div>
                        <div class="flex items-center gap-1">
                          <input
                            type="checkbox"
                            class="row-cmp"
                            [checked]="compareSet().has(s.id)"
                            (click)="$event.stopPropagation()"
                            (change)="toggleCompare(s.id, $event)"
                          />
                          <button
                            type="button"
                            class="row-pin"
                            [class.row-pin--on]="pinnedSet().has(s.id)"
                            (click)="togglePin(s.id, $event)"
                          >
                            <span class="material-symbols-outlined text-[15px]">push_pin</span>
                          </button>
                        </div>
                      </header>
                      <div class="sensor-area mt-1.5 truncate">{{ s.area }}</div>
                      <div class="mt-2 flex items-baseline gap-4">
                        <div>
                          <div
                            class="sensor-metric-val"
                            [style.color]="s.alerted ? '#B91C1C' : tempColor(s.t)"
                          >
                            {{ fmtTemp(s.t) }}
                          </div>
                          <div class="sensor-metric-lbl">T</div>
                        </div>
                        <div>
                          <div class="sensor-metric-val text-slate-700">{{ fmtHum(s.h) }}</div>
                          <div class="sensor-metric-lbl">HR</div>
                        </div>
                      </div>
                      <div class="mt-2 text-[10px] text-slate-500">
                        Banda [{{ s.tMin }}°C / {{ s.tMax }}°C] · sp {{ s.setpoint }}°C
                      </div>
                      <svg viewBox="0 0 120 32" class="mt-2 h-8 w-full">
                        <defs>
                          <linearGradient [attr.id]="'gsp-' + s.id" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="0%"
                              [attr.stop-color]="tempColor(s.t)"
                              stop-opacity="0.30"
                            />
                            <stop offset="100%" stop-color="#fff" stop-opacity="0" />
                          </linearGradient>
                        </defs>
                        <path
                          [attr.d]="sparkArea(s.hist, 32)"
                          [attr.fill]="'url(#gsp-' + s.id + ')'"
                        />
                        <path
                          [attr.d]="sparkLine(s.hist, 32)"
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
              }

              <!-- Empty states -->
              @if (sensors().length === 0 && isLoading()) {
                <div class="sensor-table">
                  <div class="sensor-table-head">
                    <span></span>
                    <span>Sensor</span>
                    <span>Ubicación</span>
                    <span class="text-right">Temp</span>
                    <span class="text-right">HR</span>
                    <span>Estado</span>
                    <span>Tendencia</span>
                    <span></span>
                  </div>
                  @for (_ of [1, 2, 3, 4, 5]; track $index) {
                    <div class="skeleton-row" aria-hidden="true">
                      <span></span>
                      <span class="skeleton-bar" style="width:48px"></span>
                      <span class="skeleton-bar" style="width:60%"></span>
                      <span class="skeleton-bar" style="width:56px; margin-left:auto"></span>
                      <span class="skeleton-bar" style="width:40px; margin-left:auto"></span>
                      <span class="skeleton-bar" style="width:64px"></span>
                      <span class="skeleton-bar" style="width:100%"></span>
                      <span></span>
                    </div>
                  }
                </div>
              } @else if (sensors().length === 0) {
                <div class="empty-state">
                  <svg viewBox="0 0 120 80" class="empty-illust">
                    <rect
                      x="10"
                      y="15"
                      width="100"
                      height="50"
                      rx="8"
                      fill="#F1F5F9"
                      stroke="#E2E8F0"
                    />
                    <line x1="20" y1="40" x2="100" y2="40" stroke="#CBD5E1" stroke-width="1.4" />
                    <circle cx="35" cy="40" r="3" fill="#94A3B8" />
                    <circle cx="60" cy="40" r="3" fill="#94A3B8" />
                    <circle cx="85" cy="40" r="3" fill="#94A3B8" />
                    <line x1="14" y1="60" x2="106" y2="22" stroke="#EF4444" stroke-width="2" />
                  </svg>
                  <div class="empty-title">Sin sensores en {{ tapId() }}</div>
                  <div class="empty-sub">
                    Verifica que el TAP esté provisionado o intenta actualizar.
                  </div>
                </div>
              } @else if (filteredSensors().length === 0) {
                <div class="empty-state">
                  <svg viewBox="0 0 120 80" class="empty-illust">
                    <circle cx="48" cy="40" r="22" fill="none" stroke="#CBD5E1" stroke-width="2" />
                    <line
                      x1="65"
                      y1="55"
                      x2="92"
                      y2="78"
                      stroke="#CBD5E1"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                  <div class="empty-title">Sin resultados para "{{ query() }}"</div>
                  <div class="empty-sub">Probá con otro id o nombre de área.</div>
                </div>
              }

              <!-- Histórico chart -->
              @if (sensors().length > 0) {
                <section class="mt-7">
                  <div class="mb-3 flex flex-wrap items-baseline justify-between gap-3">
                    <h3 class="section-title">Histórico de temperatura</h3>
                    <div class="flex items-center gap-3">
                      <label class="band-toggle">
                        <input
                          type="checkbox"
                          [checked]="showBand()"
                          (change)="showBand.set(!showBand())"
                        />
                        <span>Banda tolerancia</span>
                      </label>
                      <div class="range-pills" role="tablist" aria-label="Rango">
                        @for (r of ranges; track r) {
                          <button
                            type="button"
                            role="tab"
                            class="range-pill"
                            [class.range-pill--active]="range() === r"
                            (click)="setRange(r)"
                          >
                            {{ r }}
                          </button>
                        }
                      </div>
                    </div>
                  </div>
                  <div class="chart-shell">
                    <div class="h-[300px]">
                      <canvas #chartCanvas></canvas>
                    </div>
                    <div class="chart-tip">
                      Scroll para zoom · arrastra para pan · doble click reset
                    </div>
                  </div>
                </section>
              }
            </div>
          }
        }

        @if (tab() === 'configuracion') {
          <div class="px-5 py-5">
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
          </div>
        }
      </div>

      <!-- Toasts -->
      @if (toast()) {
        <div class="toast" role="status" aria-live="polite">
          <span class="material-symbols-outlined text-[16px]">{{ toast()!.icon }}</span>
          {{ toast()!.message }}
        </div>
      }

      <!-- Drilldown drawer -->
      @if (drilldownSensorId()) {
        <div class="drawer-backdrop" (click)="closeDrilldown()" aria-hidden="true"></div>
        <aside class="drawer" role="dialog" aria-modal="true">
          <header class="drawer-head">
            <div class="min-w-0">
              <div class="drawer-title truncate">
                {{ drilldownData()?.id || drilldownSensorId() }}
              </div>
              <div class="drawer-sub truncate">
                {{ drilldownData()?.area || '—' }} ·
                <span [style.color]="tapColorByLabel(drilldownData()?.tap || '')">{{
                  drilldownData()?.tap || ''
                }}</span>
              </div>
            </div>
            <button
              type="button"
              class="drawer-close"
              (click)="closeDrilldown()"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </header>
          <div class="drawer-body">
            @if (drilldownLoading()) {
              <div class="drawer-loading">Cargando histórico…</div>
            } @else if (drilldownData(); as d) {
              <div class="drawer-kpis">
                <div>
                  <div class="drawer-kpi-lbl">Setpoint</div>
                  <div class="drawer-kpi-val">{{ d.setpoint }}°C</div>
                </div>
                <div>
                  <div class="drawer-kpi-lbl">Mín banda</div>
                  <div class="drawer-kpi-val">{{ d.tMin }}°C</div>
                </div>
                <div>
                  <div class="drawer-kpi-lbl">Máx banda</div>
                  <div class="drawer-kpi-val">{{ d.tMax }}°C</div>
                </div>
                <div>
                  <div class="drawer-kpi-lbl">Rango</div>
                  <div class="drawer-kpi-val">{{ d.range }}</div>
                </div>
              </div>
              <div class="range-pills mt-3" role="tablist">
                @for (r of ranges; track r) {
                  <button
                    type="button"
                    role="tab"
                    class="range-pill"
                    [class.range-pill--active]="drilldownRange() === r"
                    (click)="setDrilldownRange(r)"
                  >
                    {{ r }}
                  </button>
                }
              </div>
              <div class="mt-3 drawer-chart-shell">
                <div class="h-[260px]">
                  <canvas #drilldownCanvas></canvas>
                </div>
              </div>
            } @else {
              <div class="drawer-loading">Sin datos</div>
            }
          </div>
        </aside>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .cr-header {
        background: linear-gradient(180deg, #fbfcfd, #f8fafc);
        border-bottom-width: 2px;
        border-top-color: #e2e8f0;
      }
      .cr-icon-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 36px;
        width: 36px;
        border-radius: 9px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #64748b;
        transition:
          color 0.15s ease,
          background 0.15s ease,
          transform 0.18s ease;
      }
      .cr-icon-btn:hover {
        color: #0284c7;
      }
      .cr-icon-btn:active {
        transform: translateY(1px);
      }
      .cr-icon-btn:disabled {
        opacity: 0.5;
      }
      .cr-icon-btn--active {
        background: rgba(2, 132, 199, 0.08);
        color: #0284c7;
        border-color: rgba(2, 132, 199, 0.3);
      }
      .cr-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 12px;
        border-radius: 9px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-body), sans-serif;
        font-size: 12px;
        font-weight: 500;
        transition:
          color 0.15s ease,
          background 0.15s ease,
          transform 0.18s ease;
      }
      .cr-btn:hover {
        color: #0284c7;
        background: rgba(2, 132, 199, 0.04);
      }
      .cr-btn:active {
        transform: translateY(1px);
      }
      .cr-btn:disabled {
        opacity: 0.5;
      }
      .cr-btn--active {
        background: rgba(2, 132, 199, 0.08);
        color: #0284c7;
        border-color: rgba(2, 132, 199, 0.3);
      }

      .tap-title {
        font-family: var(--font-josefin), sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }

      .cr-live {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-body), sans-serif;
        font-size: 11px;
        font-weight: 500;
        color: #475569;
        padding: 4px 9px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.08);
        border: 1px solid rgba(34, 197, 94, 0.2);
      }
      .cr-live--err {
        color: #b91c1c;
        background: rgba(239, 68, 68, 0.08);
        border-color: rgba(239, 68, 68, 0.25);
      }
      .cr-live-dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--color-success);
      }
      .cr-live-dot--err {
        background: #ef4444;
      }
      .cr-live-dot--pulse {
        animation: livePulse 1.6s ease-in-out infinite;
      }
      @keyframes livePulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55);
        }
        70% {
          box-shadow: 0 0 0 6px rgba(34, 197, 94, 0);
        }
      }

      /* Smart status banner */
      .status-banner {
        padding: 0 20px;
        background: #f8fafc;
        border-bottom: 1px solid #e2e8f0;
      }
      .status-banner-inner {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 10px 14px;
        border-radius: 12px;
        background: linear-gradient(90deg, rgba(34, 197, 94, 0.07), transparent 60%);
        border: 1px solid rgba(34, 197, 94, 0.18);
        margin: 10px 0;
      }
      .status-banner[data-level='warning'] .status-banner-inner {
        background: linear-gradient(90deg, rgba(251, 191, 36, 0.1), transparent 60%);
        border-color: rgba(251, 191, 36, 0.25);
      }
      .status-banner[data-level='critical'] .status-banner-inner {
        background: linear-gradient(90deg, rgba(239, 68, 68, 0.12), transparent 60%);
        border-color: rgba(239, 68, 68, 0.3);
      }
      .status-icon {
        font-size: 22px;
        color: var(--color-success);
      }
      .status-banner[data-level='warning'] .status-icon {
        color: var(--color-warning);
      }
      .status-banner[data-level='critical'] .status-icon {
        color: var(--color-danger);
      }
      .status-text {
        min-width: 0;
      }
      .status-title {
        font-family: var(--font-body), sans-serif;
        font-size: 13.5px;
        font-weight: 600;
        color: #1e293b;
      }
      .status-sub {
        font-family: var(--font-body), sans-serif;
        font-size: 11.5px;
        color: #64748b;
        margin-top: 1px;
      }
      .status-meta {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 18px;
      }
      .status-meta-item {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        font-family: var(--font-body), sans-serif;
        font-size: 11px;
        color: #94a3b8;
      }
      .status-meta-lbl {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 9.5px;
      }
      .status-meta-item strong {
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px;
        color: #1e293b;
        margin-top: 2px;
      }

      .cr-content {
        scroll-behavior: smooth;
      }

      button:focus-visible,
      a:focus-visible,
      input:focus-visible {
        outline: 2px solid #0284c7;
        outline-offset: 2px;
        border-radius: 8px;
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
      .kpi-hero-total {
        font-size: 22px;
        color: #94a3b8;
        font-weight: 500;
        margin-left: 2px;
      }
      .kpi-hero-label {
        font-family: var(--font-body), sans-serif;
        font-size: 11px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #94a3b8;
        margin-top: 6px;
      }
      .kpi-meta {
        font-family: var(--font-body), sans-serif;
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
      .kpi-distribution {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-bottom: 2px;
      }
      .kpi-distribution-lbl {
        font-family: var(--font-body), sans-serif;
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .kpi-distribution-svg {
        height: 36px;
        width: 160px;
      }

      .section-title {
        font-family: var(--font-body), sans-serif;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #475569;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin: 0;
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
        font-family: var(--font-body), sans-serif;
        font-size: 11px;
        color: #94a3b8;
      }

      .alert-card {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.05), transparent 70%);
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 14px;
        padding: 14px 16px;
        cursor: pointer;
        text-align: left;
        transition:
          transform 0.18s ease,
          box-shadow 0.18s ease;
      }
      .alert-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(239, 68, 68, 0.14);
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
      .tap-tag {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.04em;
      }
      .sensor-area {
        font-family: var(--font-body), sans-serif;
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
        font-family: var(--font-body), sans-serif;
        font-size: 10.5px;
        color: #94a3b8;
        margin-top: 3px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      /* Sticky filter bar */
      .filter-bar {
        position: sticky;
        top: 0;
        z-index: 5;
        background: #f0f2f5;
        border-bottom: 1px solid #e2e8f0;
        margin-top: 4px;
      }
      .filter-bar-inner {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        padding: 10px 20px;
      }

      .search-wrap {
        position: relative;
        display: flex;
        align-items: center;
        width: 260px;
        max-width: 100%;
      }
      .search-icon {
        position: absolute;
        left: 9px;
        font-size: 16px;
        color: #94a3b8;
        pointer-events: none;
      }
      .search-input {
        width: 100%;
        padding: 7px 28px 7px 30px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        font-family: var(--font-body), sans-serif;
        font-size: 12.5px;
        color: #1e293b;
      }
      .search-input:focus {
        border-color: #0284c7;
      }
      .search-clear {
        position: absolute;
        right: 4px;
        width: 22px;
        height: 22px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        color: #94a3b8;
        background: transparent;
      }
      .search-clear:hover {
        color: #475569;
        background: #f1f5f9;
      }

      .view-toggle {
        display: inline-flex;
        gap: 2px;
        padding: 3px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 9px;
      }
      .view-toggle-btn {
        width: 30px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        color: #94a3b8;
        background: transparent;
      }
      .view-toggle-btn:hover {
        color: #475569;
      }
      .view-toggle-btn--active {
        color: #0284c7;
        background: rgba(2, 132, 199, 0.1);
      }

      .compare-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 999px;
        background: rgba(2, 132, 199, 0.1);
        border: 1px solid rgba(2, 132, 199, 0.25);
        color: #0284c7;
        font-family: var(--font-body), sans-serif;
        font-size: 11.5px;
        font-weight: 600;
      }
      .compare-pill:hover {
        background: rgba(2, 132, 199, 0.18);
      }

      /* Range pills */
      .range-pills {
        display: inline-flex;
        gap: 4px;
        padding: 3px;
        background: #f1f5f9;
        border-radius: 9px;
      }
      .range-pill {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 6px;
        color: #64748b;
        background: transparent;
        transition:
          background 0.15s ease,
          color 0.15s ease;
      }
      .range-pill:hover {
        color: #1e293b;
      }
      .range-pill--active {
        background: #ffffff;
        color: #0284c7;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      .band-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-body), sans-serif;
        font-size: 11.5px;
        color: #64748b;
        cursor: pointer;
      }
      .band-toggle input {
        accent-color: #0284c7;
      }

      /* Pinned strip */
      .pinned-strip {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        background: linear-gradient(90deg, var(--color-primary-tint-06), transparent 70%);
        border: 1px solid var(--color-primary-tint-20);
        border-radius: 10px;
      }
      .pinned-lbl {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: var(--font-body), sans-serif;
        font-size: 10.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--color-primary);
      }
      .pinned-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        transition:
          transform 0.18s ease,
          border-color 0.15s ease;
      }
      .pinned-chip:hover {
        transform: translateY(-1px);
        border-color: var(--color-primary-tint-40);
      }
      .pinned-chip--alert {
        border-color: rgba(239, 68, 68, 0.3);
      }

      /* Table */
      .sensor-table {
        border-top: 1px solid #e2e8f0;
        background: #ffffff;
        border-radius: 12px;
        padding: 0 4px;
      }
      .sensor-table-head,
      .sensor-row {
        display: grid;
        grid-template-columns: 26px 60px minmax(0, 1fr) 84px 64px 84px 120px 30px;
        align-items: center;
        gap: 12px;
        padding: 8px 8px;
        border-bottom: 1px solid #e2e8f0;
      }
      .sensor-table-head {
        font-family: var(--font-body), sans-serif;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
        padding-top: 10px;
        padding-bottom: 10px;
      }
      .th-btn {
        background: transparent;
        border: 0;
        padding: 0;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        letter-spacing: 0.08em;
      }
      .th-btn:hover {
        color: #475569;
      }
      .sensor-row {
        font-family: var(--font-body), sans-serif;
        font-size: 13px;
        color: #1e293b;
        transition: background 0.12s ease;
        cursor: pointer;
      }
      .sensor-row:hover {
        background: rgba(2, 132, 199, 0.04);
      }
      .sensor-row--alert {
        background: rgba(239, 68, 68, 0.04);
      }
      .sensor-row--alert:hover {
        background: rgba(239, 68, 68, 0.08);
      }
      .sensor-row--cmp {
        box-shadow: inset 3px 0 0 #0284c7;
      }
      .sensor-row-area {
        color: #475569;
      }
      .sensor-row-temp {
        font-family: 'JetBrains Mono', monospace;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
      }
      .sensor-row-hum {
        font-family: 'JetBrains Mono', monospace;
        color: #64748b;
        font-variant-numeric: tabular-nums;
      }
      .status-cell {
        font-family: var(--font-body), sans-serif;
        font-size: 11.5px;
        color: #475569;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .status-dot {
        display: inline-block;
        width: 6px;
        height: 6px;
        border-radius: 50%;
      }
      .sensor-row-spark {
        height: 18px;
        width: 100%;
      }
      .row-cmp {
        accent-color: #0284c7;
        cursor: pointer;
      }
      .row-pin {
        background: transparent;
        color: #cbd5e1;
        padding: 2px;
        border-radius: 4px;
        transition:
          color 0.15s ease,
          background 0.15s ease;
      }
      .row-pin:hover {
        color: var(--color-primary);
        background: var(--color-primary-tint-10);
      }
      .row-pin--on {
        color: var(--color-primary);
      }

      /* Grid view */
      .grid-view {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
      }
      .grid-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        cursor: pointer;
        text-align: left;
        transition:
          transform 0.18s ease,
          box-shadow 0.18s ease,
          border-color 0.15s ease;
      }
      .grid-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
      }
      .grid-card--alert {
        border-color: rgba(239, 68, 68, 0.3);
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.04), transparent 70%);
      }
      .grid-card--cmp {
        box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.35);
      }

      .empty-state {
        text-align: center;
        padding: 40px 24px;
        background: #ffffff;
        border: 1px dashed #e2e8f0;
        border-radius: 14px;
      }
      .empty-illust {
        width: 120px;
        height: 80px;
        margin: 0 auto 8px;
      }
      .empty-title {
        font-family: var(--font-body), sans-serif;
        font-size: 13px;
        font-weight: 600;
        color: #475569;
      }
      .empty-sub {
        font-family: var(--font-body), sans-serif;
        font-size: 11.5px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .empty-block {
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
        padding: 28px;
        text-align: center;
        background: #ffffff;
        color: #94a3b8;
      }

      .chart-shell {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 18px 18px 8px;
        position: relative;
      }
      .chart-tip {
        position: absolute;
        bottom: 6px;
        right: 14px;
        font-family: var(--font-body), sans-serif;
        font-size: 10px;
        color: #94a3b8;
      }

      /* Floor map shell */
      .floor-shell {
        height: 360px;
        border-radius: 14px;
        overflow: hidden;
      }

      /* Skeleton */
      .skeleton-row {
        display: grid;
        grid-template-columns: 26px 60px minmax(0, 1fr) 84px 64px 84px 120px 30px;
        align-items: center;
        gap: 12px;
        padding: 10px 8px;
        border-bottom: 1px solid #e2e8f0;
      }
      .skeleton-bar {
        height: 12px;
        border-radius: 4px;
        background: linear-gradient(
          90deg,
          rgba(148, 163, 184, 0.1),
          rgba(148, 163, 184, 0.22),
          rgba(148, 163, 184, 0.1)
        );
        background-size: 200% 100%;
        animation: skelShimmer 1.4s linear infinite;
      }
      @keyframes skelShimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .skeleton-bar,
        .anim-stagger,
        .cr-spin,
        .cr-live-dot--pulse {
          animation: none !important;
        }
        .anim-stagger {
          opacity: 1 !important;
          transform: none !important;
        }
      }

      /* Stagger entrance */
      .anim-stagger {
        opacity: 0;
        transform: translateY(4px);
        animation: cardIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        animation-delay: calc(var(--i, 0) * 28ms);
      }
      @keyframes cardIn {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      /* Concentrator (TAP 1) */
      .conc-grid {
        display: grid;
        grid-template-columns: minmax(220px, 320px) minmax(0, 1fr);
        gap: 18px;
        align-items: stretch;
      }
      @media (max-width: 900px) {
        .conc-grid {
          grid-template-columns: minmax(0, 1fr);
        }
      }
      .conc-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .conc-meta {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: var(--font-body), sans-serif;
        font-size: 12px;
        color: #64748b;
      }
      .conc-meta strong {
        font-family: 'JetBrains Mono', monospace;
        color: #1e293b;
        font-weight: 600;
      }
      .conc-channels {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 0 14px;
        max-height: 360px;
        overflow-y: auto;
      }
      .conc-channels-head,
      .conc-channels-row {
        display: grid;
        grid-template-columns: 60px 60px minmax(0, 1fr) 90px 70px;
        gap: 12px;
        align-items: center;
        padding: 10px 0;
        border-bottom: 1px solid #f1f5f9;
        font-family: var(--font-body), sans-serif;
        font-size: 12px;
      }
      .conc-channels-head {
        position: sticky;
        top: 0;
        background: #ffffff;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
        border-bottom: 1px solid #e2e8f0;
      }

      /* Backup grid */
      .backup-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 12px;
      }
      .backup-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        cursor: pointer;
        text-align: left;
        transition:
          transform 0.18s ease,
          box-shadow 0.18s ease;
      }
      .backup-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
      }
      .backup-card--alert {
        border-color: rgba(239, 68, 68, 0.35);
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.06), transparent 70%);
      }

      /* Toast */
      .toast {
        position: fixed;
        bottom: 22px;
        left: 50%;
        transform: translateX(-50%);
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 14px;
        background: #1e293b;
        color: #f8fafc;
        font-family: var(--font-body), sans-serif;
        font-size: 12.5px;
        border-radius: 999px;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
        z-index: 60;
        animation: toastIn 0.22s ease;
      }
      @keyframes toastIn {
        from {
          transform: translate(-50%, 8px);
          opacity: 0;
        }
        to {
          transform: translate(-50%, 0);
          opacity: 1;
        }
      }

      /* Drawer */
      .drawer-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.42);
        z-index: 40;
        animation: fadeIn 0.18s ease;
      }
      .drawer {
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
        animation: slideIn 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes slideIn {
        from {
          transform: translateX(24px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      .drawer-head {
        padding: 14px 16px;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .drawer-title {
        font-family: 'JetBrains Mono', monospace;
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
      }
      .drawer-sub {
        font-family: var(--font-body), sans-serif;
        font-size: 11.5px;
        color: #64748b;
        margin-top: 1px;
      }
      .drawer-close {
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
      .drawer-close:hover {
        color: #1e293b;
        background: #f1f5f9;
      }
      .drawer-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }
      .drawer-loading {
        text-align: center;
        padding: 48px 16px;
        color: #94a3b8;
        font-size: 12.5px;
      }
      .drawer-kpis {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .drawer-kpi-lbl {
        font-family: var(--font-body), sans-serif;
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .drawer-kpi-val {
        font-family: 'JetBrains Mono', monospace;
        font-size: 16px;
        font-weight: 600;
        color: #1e293b;
        margin-top: 4px;
      }
      .drawer-chart-shell {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px 14px 6px;
      }

      .cr-spin {
        animation: cr-spin 0.8s linear infinite;
      }
      @keyframes cr-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class VentisquerosTapDetailComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly coldRoom = inject(ColdRoomService);
  private readonly companyService = inject(CompanyService);
  private readonly location = inject(Location);

  goBack(): void {
    this.location.back();
  }

  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('drilldownCanvas') drilldownCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  readonly ranges = RANGES;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  readonly tab = signal<DetailTab>('resumen');
  readonly siteId = computed(() => this.params().get('siteId') || '');
  readonly siteRecord = signal<SiteRecord | null>(null);
  readonly now = signal<number>(Date.now());

  readonly sensors = signal<ColdRoomSensor[]>([]);
  readonly concentrator = signal<ColdRoomConcentrator | null>(null);
  readonly backup = signal<ColdRoomBackupSensor[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly serviceError = signal<string | null>(null);
  readonly lastUpdate = signal<Date | null>(null);
  readonly range = signal<ColdRoomRange>('24h');
  readonly query = signal<string>('');
  readonly sort = signal<SortState>({ key: 'id', dir: 'asc' });
  readonly exporting = signal<boolean>(false);
  readonly viewMode = signal<ViewMode>(this.loadViewMode());
  readonly compareSet = signal<Set<string>>(new Set<string>());
  readonly pinnedSet = signal<Set<string>>(this.loadPinned());
  readonly showMap = signal<boolean>(this.loadShowMap());
  readonly showBand = signal<boolean>(true);
  readonly toast = signal<{ message: string; icon: string } | null>(null);
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  // Drilldown
  readonly drilldownSensorId = signal<string | null>(null);
  readonly drilldownRange = signal<ColdRoomRange>('24h');
  readonly drilldownData = signal<ColdRoomSensorHistory | null>(null);
  readonly drilldownLoading = signal<boolean>(false);

  readonly backLink = computed(() => ['/companies']);
  readonly siteName = computed(() => this.siteRecord()?.descripcion || 'Sitio');

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
  readonly isTap1 = computed(() => this.tapId() === 'TAP 1');

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
    if (list.length === 0) {
      return {
        count: 0,
        avgT: '—',
        avgH: 0,
        alerts: 0,
        minT: '—',
        maxT: '—',
        avgTNum: 0,
        setpointAvg: 0,
      };
    }
    const ts = list.map((s) => s.t);
    const hs = list.map((s) => s.h);
    const avgT = ts.reduce((a, b) => a + b, 0) / ts.length;
    const setAvg = list.reduce((a, b) => a + b.setpoint, 0) / list.length;
    return {
      count: list.length,
      avgT: avgT.toFixed(1),
      avgH: Math.round(hs.reduce((a, b) => a + b, 0) / hs.length),
      alerts: list.filter((s) => s.alerted).length,
      minT: Math.min(...ts).toFixed(1),
      maxT: Math.max(...ts).toFixed(1),
      avgTNum: avgT,
      setpointAvg: setAvg,
    };
  });

  readonly statusLevel = computed<'ok' | 'warning' | 'critical'>(() => {
    const s = this.stats();
    if (s.count === 0) return 'ok';
    const ratio = s.alerts / s.count;
    if (ratio === 0) return 'ok';
    if (ratio < 0.34) return 'warning';
    return 'critical';
  });

  readonly statusIcon = computed(() => {
    const l = this.statusLevel();
    if (l === 'ok') return 'check_circle';
    if (l === 'warning') return 'warning';
    return 'error';
  });

  readonly statusTitle = computed(() => {
    const l = this.statusLevel();
    if (l === 'ok') return 'Todos los sensores en banda';
    if (l === 'warning') return `${this.stats().alerts} sensor(es) fuera de banda`;
    return `Alerta crítica · ${this.stats().alerts} sensor(es) fuera de banda`;
  });

  readonly statusSub = computed(() => {
    const l = this.statusLevel();
    if (l === 'ok') return 'Temperatura promedio dentro del rango configurado.';
    if (l === 'warning') return 'Revisa los sensores marcados y verifica el sistema.';
    return 'Atención inmediata requerida. Revisa cadena de frío y backup.';
  });

  readonly statusDeltaSetpoint = computed(() => {
    const s = this.stats();
    if (s.count === 0) return '—';
    return (s.avgTNum - s.setpointAvg).toFixed(1);
  });

  readonly alertedSensors = computed(() => this.sensors().filter((s) => s.alerted));

  readonly filteredSensors = computed(() => {
    const q = this.query().trim().toLowerCase();
    const sortState = this.sort();
    const pinned = this.pinnedSet();
    const list = this.sensors().filter((s) => {
      if (!q) return true;
      return s.id.toLowerCase().includes(q) || s.area.toLowerCase().includes(q);
    });
    const dir = sortState.dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortState.key) {
        case 'id':
          return a.id.localeCompare(b.id) * dir;
        case 'area':
          return a.area.localeCompare(b.area) * dir;
        case 't':
          return (a.t - b.t) * dir;
        case 'h':
          return (a.h - b.h) * dir;
        case 'status':
          return ((a.alerted ? 1 : 0) - (b.alerted ? 1 : 0)) * dir;
      }
    });
    return list.filter((s) => !pinned.has(s.id)).length === 0
      ? list
      : [...list.filter((s) => pinned.has(s.id)), ...list.filter((s) => !pinned.has(s.id))];
  });

  readonly pinnedSensors = computed(() => {
    const set = this.pinnedSet();
    return this.sensors().filter((s) => set.has(s.id));
  });

  readonly distribution = computed(() => {
    const sensors = this.sensors();
    if (sensors.length < 2) return [];
    const ts = sensors.map((s) => s.t);
    const min = Math.min(...ts);
    const max = Math.max(...ts);
    const buckets = 12;
    const w = 160 / buckets;
    const counts = new Array(buckets).fill(0);
    const range = max - min || 1;
    ts.forEach((t) => {
      const idx = Math.min(buckets - 1, Math.floor(((t - min) / range) * buckets));
      counts[idx]++;
    });
    const maxC = Math.max(...counts);
    return counts.map((c, i) => {
      const center = min + (range * (i + 0.5)) / buckets;
      return {
        x: i * w + 0.5,
        w: w - 1,
        h: maxC > 0 ? (c / maxC) * 30 : 0,
        value: center,
        color: tempColor(center),
      };
    });
  });

  // Cast to Sensor for floor-map (compatible shape).
  readonly asSensors = computed<Sensor[]>(() =>
    this.sensors().map((s) => ({
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
    })),
  );

  chart: Chart | null = null;
  private drilldownChart: Chart | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private clockId: ReturnType<typeof setInterval> | null = null;

  fmtTemp = fmtTemp;
  fmtHum = fmtHum;
  tempColor = tempColor;
  humColor = humColor;

  constructor() {
    effect(() => {
      if (this.tab() !== 'resumen' || this.isTap1()) {
        this.destroyChart();
        return;
      }
      const list = this.sensors();
      if (list.length === 0) {
        this.destroyChart();
        return;
      }
      const cmp = this.compareSet();
      const subset = cmp.size > 0 ? list.filter((s) => cmp.has(s.id)) : list;
      const band = this.showBand();
      queueMicrotask(() => this.renderMainChart(subset, band));
    });

    effect(() => {
      const id = this.drilldownSensorId();
      if (!id) {
        this.destroyDrilldownChart();
        return;
      }
      this.loadDrilldown(id, this.drilldownRange());
    });

    effect(() => {
      const data = this.drilldownData();
      if (!data) return;
      queueMicrotask(() => this.renderDrilldownChart(data));
    });
  }

  ngOnInit(): void {
    const id = this.siteId();
    if (!id) {
      this.router.navigate(['/companies']);
      return;
    }
    this.clockId = setInterval(() => this.now.set(Date.now()), 5_000);
    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        if (res.ok) {
          const site = this.findSite(res.data, id);
          if (site) this.siteRecord.set(site);
        }
        this.startPolling();
      },
      error: () => this.startPolling(),
    });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => {
      if (!this.isTap1()) this.renderMainChart(this.sensors(), this.showBand());
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.destroyChart();
    this.destroyDrilldownChart();
    if (this.clockId !== null) clearInterval(this.clockId);
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(ev: KeyboardEvent): void {
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;

    if (ev.key === 'Escape') {
      if (this.drilldownSensorId()) {
        ev.preventDefault();
        this.closeDrilldown();
      }
      return;
    }
    if (isInput) return;

    if (ev.key === '/' || (ev.key === 'k' && (ev.ctrlKey || ev.metaKey))) {
      ev.preventDefault();
      this.searchInput?.nativeElement.focus();
      return;
    }
    if (ev.key === 'r' || ev.key === 'R') {
      ev.preventDefault();
      this.refresh();
      this.showToast('Actualizando…', 'sync');
      return;
    }
    if (ev.key === 'm' || ev.key === 'M') {
      if (!this.isTap1()) this.toggleMap();
      return;
    }
    if (['1', '2', '3', '4'].includes(ev.key)) {
      const idx = Number(ev.key) - 1;
      if (RANGES[idx]) this.setRange(RANGES[idx]);
    }
  }

  refresh(): void {
    this.fetchData();
  }

  setRange(r: ColdRoomRange): void {
    if (this.range() === r) return;
    this.range.set(r);
    this.fetchData();
  }

  setDrilldownRange(r: ColdRoomRange): void {
    if (this.drilldownRange() === r) return;
    this.drilldownRange.set(r);
  }

  setViewMode(m: ViewMode): void {
    this.viewMode.set(m);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, m);
    } catch {
      /* ignore */
    }
  }

  toggleMap(): void {
    const next = !this.showMap();
    this.showMap.set(next);
    try {
      localStorage.setItem(SHOW_MAP_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  toggleSort(key: SortKey): void {
    const cur = this.sort();
    if (cur.key === key) {
      this.sort.set({ key, dir: cur.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      this.sort.set({ key, dir: 'asc' });
    }
  }

  sortArrow(key: SortKey): string {
    const cur = this.sort();
    if (cur.key !== key) return '';
    return cur.dir === 'asc' ? '↑' : '↓';
  }

  toggleCompare(id: string, ev: Event): void {
    ev.stopPropagation();
    const set = new Set(this.compareSet());
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.compareSet.set(set);
  }

  clearCompare(): void {
    this.compareSet.set(new Set());
  }

  togglePin(id: string, ev: Event): void {
    ev.stopPropagation();
    const set = new Set(this.pinnedSet());
    if (set.has(id)) {
      set.delete(id);
      this.showToast(`${id} ya no está fijado`, 'push_pin');
    } else {
      set.add(id);
      this.showToast(`${id} fijado`, 'push_pin');
    }
    this.pinnedSet.set(set);
    try {
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify([...set]));
    } catch {
      /* ignore */
    }
  }

  openSensorDrilldown(sensorId: string): void {
    this.drilldownSensorId.set(sensorId);
    this.drilldownRange.set(this.range());
  }

  closeDrilldown(): void {
    this.drilldownSensorId.set(null);
    this.drilldownData.set(null);
  }

  exportCsv(): void {
    const sid = this.siteId();
    if (!sid) return;
    this.exporting.set(true);
    const tap = this.isTap1() ? null : this.tapId();
    this.coldRoom.downloadCsv(sid, tap, this.range()).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safe = (tap || 'all').replace(/\s+/g, '-').toLowerCase();
        a.download = `cold-room-${sid}-${safe}-${this.range()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.exporting.set(false);
        this.showToast('CSV descargado', 'download');
      },
      error: () => {
        this.exporting.set(false);
        this.serviceError.set('No se pudo descargar el CSV');
        this.showToast('Error al descargar CSV', 'error');
      },
    });
  }

  exportPng(): void {
    if (!this.chart) return;
    const url = this.chart.toBase64Image('image/png', 1);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cold-room-${this.tapId().replace(/\s+/g, '-').toLowerCase()}-${this.range()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    this.showToast('PNG descargado', 'image');
  }

  tapColorByLabel(label: string): string {
    const m = label.match(/(\d+)/);
    const idx = m ? Number(m[1]) - 1 : 0;
    return tapColorFor(Math.max(0, idx));
  }

  relativeTime(iso: string | null): string {
    if (!iso) return '—';
    const diff = Math.max(0, Math.floor((this.now() - new Date(iso).getTime()) / 1000));
    if (diff < 60) return `hace ${diff}s`;
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
    return `hace ${Math.floor(diff / 3600)}h`;
  }

  sparkLine(hist: number[], height: number): string {
    return this.buildSparkPath(hist, height, false);
  }

  sparkArea(hist: number[], height: number): string {
    return this.buildSparkPath(hist, height, true);
  }

  private buildSparkPath(hist: number[], height: number, area: boolean): string {
    if (!hist || hist.length === 0) return '';
    const min = Math.min(...hist);
    const max = Math.max(...hist);
    const range = max - min || 1;
    const stepX = 120 / Math.max(hist.length - 1, 1);
    const pad = 2;
    const pts = hist.map((v, i) => {
      const x = i * stepX;
      const y = pad + (1 - (v - min) / range) * (height - pad * 2);
      return [x, y];
    });
    const line = pts
      .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
    if (!area) return line;
    const last = pts[pts.length - 1];
    return `${line} L ${last[0].toFixed(1)} ${height} L 0 ${height} Z`;
  }

  private loadViewMode(): ViewMode {
    try {
      const v = localStorage.getItem(VIEW_STORAGE_KEY);
      if (v === 'table' || v === 'grid') return v;
    } catch {
      /* ignore */
    }
    return 'table';
  }

  private loadPinned(): Set<string> {
    try {
      const raw = localStorage.getItem(PIN_STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return new Set(arr.filter((x) => typeof x === 'string'));
      }
    } catch {
      /* ignore */
    }
    return new Set();
  }

  private loadShowMap(): boolean {
    try {
      const v = localStorage.getItem(SHOW_MAP_KEY);
      if (v === '1') return true;
      if (v === '0') return false;
    } catch {
      /* ignore */
    }
    return false;
  }

  private showToast(message: string, icon: string): void {
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toast.set({ message, icon });
    this.toastTimer = setTimeout(() => this.toast.set(null), 2200);
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

  private startPolling(): void {
    this.stopPolling();
    this.fetchData();
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private fetchData(): void {
    const id = this.siteId();
    if (!id) return;
    this.isLoading.set(true);
    if (this.isTap1()) {
      this.fetchTap1(id);
    } else {
      this.fetchSensors(id);
    }
  }

  private fetchSensors(siteId: string): void {
    this.coldRoom.getSensors(siteId, this.tapId(), this.range()).subscribe({
      next: (res) => {
        if (res.ok) {
          this.sensors.set(res.data || []);
          this.lastUpdate.set(new Date());
          this.serviceError.set(null);
        } else {
          this.serviceError.set(res.error || 'Sin datos');
        }
        this.isLoading.set(false);
        this.scheduleNextPoll();
      },
      error: () => {
        this.serviceError.set('Error de conexión');
        this.isLoading.set(false);
        this.scheduleNextPoll();
      },
    });
  }

  private fetchTap1(siteId: string): void {
    let pending = 2;
    const done = () => {
      pending--;
      if (pending === 0) {
        this.isLoading.set(false);
        this.lastUpdate.set(new Date());
        this.scheduleNextPoll();
      }
    };
    this.coldRoom.getConcentrator(siteId).subscribe({
      next: (res) => {
        if (res.ok) this.concentrator.set(res.data);
        else this.serviceError.set(res.error || null);
        done();
      },
      error: () => {
        this.serviceError.set('Error de conexión');
        done();
      },
    });
    this.coldRoom.getBackup(siteId, this.range()).subscribe({
      next: (res) => {
        if (res.ok) this.backup.set(res.data || []);
        done();
      },
      error: () => done(),
    });
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => this.fetchData(), POLL_MS);
  }

  private loadDrilldown(sensorId: string, range: ColdRoomRange): void {
    const sid = this.siteId();
    if (!sid) return;
    this.drilldownLoading.set(true);
    this.coldRoom.getSensorHistory(sid, sensorId, range).subscribe({
      next: (res) => {
        if (res.ok) this.drilldownData.set(res.data);
        else this.drilldownData.set(null);
        this.drilldownLoading.set(false);
      },
      error: () => {
        this.drilldownData.set(null);
        this.drilldownLoading.set(false);
      },
    });
  }

  private renderMainChart(sensors: ColdRoomSensor[], showBand: boolean): void {
    if (!this.chartCanvas?.nativeElement || sensors.length === 0) return;
    this.destroyChart();
    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const labels =
      sensors[0]?.histPoints?.map((p) =>
        new Date(p.t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
      ) || sensors[0]?.hist.map((_, i) => String(i));
    const palette = ['#0EA5E9', '#6366F1', '#22C55E', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

    const annotations: Record<string, AnnotationOptions> = {} as Record<string, AnnotationOptions>;
    if (showBand && sensors.length > 0) {
      const tMin = Math.min(...sensors.map((s) => s.tMin));
      const tMax = Math.max(...sensors.map((s) => s.tMax));
      annotations['band'] = {
        type: 'box',
        yMin: tMin,
        yMax: tMax,
        backgroundColor: 'rgba(34, 197, 94, 0.06)',
        borderColor: 'rgba(34, 197, 94, 0.30)',
        borderWidth: 1,
        borderDash: [4, 4],
        label: {
          display: true,
          content: `Banda tolerancia ${tMin}/${tMax}°C`,
          position: { x: 'end', y: 'start' },
          color: '#15803D',
          font: { size: 10, family: 'JetBrains Mono' },
          padding: 3,
        },
      };
      const setpointAvg = sensors.reduce((a, b) => a + b.setpoint, 0) / sensors.length;
      annotations['setpoint'] = {
        type: 'line',
        yMin: setpointAvg,
        yMax: setpointAvg,
        borderColor: 'var(--color-primary-tint-55)',
        borderWidth: 1.2,
        borderDash: [6, 4],
        label: {
          display: true,
          content: `Setpoint ${setpointAvg.toFixed(1)}°C`,
          position: 'start',
          color: '#0D99A5',
          font: { size: 10, family: 'JetBrains Mono' },
          backgroundColor: 'rgba(255,255,255,0.6)',
          padding: 3,
        },
      };
    }

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: sensors.map((s, i) => ({
          label: `${s.id} · ${s.area}`,
          data: s.histPoints?.map((p) => p.v) || s.hist,
          borderColor: palette[i % palette.length],
          backgroundColor: palette[i % palette.length] + '15',
          borderWidth: 1.6,
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
          annotation: { annotations },
          zoom: {
            pan: { enabled: true, mode: 'x', modifierKey: undefined },
            zoom: {
              wheel: { enabled: true, speed: 0.05 },
              pinch: { enabled: true },
              mode: 'x',
            },
            limits: { x: { min: 'original', max: 'original' } },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, color: '#94A3B8', maxTicksLimit: 8, autoSkip: true },
          },
          y: {
            grid: { color: 'rgba(148,163,184,0.15)' },
            ticks: { font: { size: 10 }, color: '#94A3B8', callback: (v) => `${v}°C` },
          },
        },
        onClick: () => {
          if (this.chart) this.chart.resetZoom?.();
        },
      },
    });
  }

  private renderDrilldownChart(data: ColdRoomSensorHistory): void {
    if (!this.drilldownCanvas?.nativeElement) return;
    this.destroyDrilldownChart();
    const ctx = this.drilldownCanvas.nativeElement.getContext('2d');
    if (!ctx) return;
    const labels = data.temperature.map((p) =>
      new Date(p.t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
    );
    this.drilldownChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Temp °C',
            data: data.temperature.map((p) => p.v),
            borderColor: '#0284C7',
            backgroundColor: '#0284C720',
            yAxisID: 'y',
            borderWidth: 1.8,
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
            fill: true,
          },
          {
            label: 'HR %',
            data: data.humidity.map((p) => p.v),
            borderColor: '#22C55E',
            yAxisID: 'y1',
            borderWidth: 1.3,
            borderDash: [4, 4],
            pointRadius: 0,
            pointHoverRadius: 4,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          annotation: {
            annotations: {
              tMin: {
                type: 'line',
                yMin: data.tMin,
                yMax: data.tMin,
                borderColor: 'rgba(239, 68, 68, 0.5)',
                borderWidth: 1.1,
                borderDash: [5, 4],
                label: {
                  display: true,
                  content: `Mín ${data.tMin}°C`,
                  position: 'start',
                  color: '#B91C1C',
                  font: { size: 9, family: 'JetBrains Mono' },
                  backgroundColor: 'rgba(255,255,255,0.6)',
                  padding: 2,
                },
              },
              tMax: {
                type: 'line',
                yMin: data.tMax,
                yMax: data.tMax,
                borderColor: 'rgba(239, 68, 68, 0.5)',
                borderWidth: 1.1,
                borderDash: [5, 4],
                label: {
                  display: true,
                  content: `Máx ${data.tMax}°C`,
                  position: 'start',
                  color: '#B91C1C',
                  font: { size: 9, family: 'JetBrains Mono' },
                  backgroundColor: 'rgba(255,255,255,0.6)',
                  padding: 2,
                },
              },
              sp: {
                type: 'line',
                yMin: data.setpoint,
                yMax: data.setpoint,
                borderColor: 'var(--color-primary-tint-55)',
                borderWidth: 1.2,
                borderDash: [6, 4],
                label: {
                  display: true,
                  content: `Setpoint ${data.setpoint}°C`,
                  position: 'end',
                  color: '#0D99A5',
                  font: { size: 9, family: 'JetBrains Mono' },
                  backgroundColor: 'rgba(255,255,255,0.6)',
                  padding: 2,
                },
              },
            },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const unit = ctx.dataset.yAxisID === 'y1' ? '%' : '°C';
                return `${ctx.dataset.label}: ${(ctx.parsed.y as number).toFixed(1)}${unit}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 }, color: '#94A3B8', maxTicksLimit: 8, autoSkip: true },
          },
          y: {
            position: 'left',
            grid: { color: 'rgba(148,163,184,0.15)' },
            ticks: { font: { size: 10 }, color: '#94A3B8', callback: (v) => `${v}°C` },
          },
          y1: {
            position: 'right',
            grid: { display: false },
            ticks: {
              font: { size: 10 },
              color: '#94A3B8',
              callback: (v) => `${Number(v).toFixed(0)}%`,
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

  private destroyDrilldownChart(): void {
    if (this.drilldownChart) {
      this.drilldownChart.destroy();
      this.drilldownChart = null;
    }
  }
}
