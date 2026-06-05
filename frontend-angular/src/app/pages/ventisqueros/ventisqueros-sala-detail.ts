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
  type ColdRoomRange,
  type ColdRoomSensor,
  type ColdRoomSensorHistory,
} from '../../services/cold-room.service';
import { ColdRoomThresholdsService } from '../../services/cold-room-thresholds.service';
import {
  ColdRoomDeviationsService,
  DEVIATION_CAUSES,
  type Deviation,
  type DeviationCause,
} from '../../services/cold-room-deviations.service';
import { fmtHum, fmtTemp, humColor, tempColor } from './ventisqueros-data';

Chart.register(...registerables, annotationPlugin, zoomPlugin);

const POLL_MS = 30_000;
const RANGES: ColdRoomRange[] = ['1h', '6h', '24h', '7d'];

function slugify(area: string): string {
  return area
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Component({
  selector: 'app-ventisqueros-sala-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style="background:#F0F2F5;">
      <!-- Header -->
      <div class="sala-header flex flex-wrap items-center gap-3 border-t border-b px-5 py-2.5">
        <button type="button" (click)="goBack()" class="sala-icon-btn" aria-label="Volver">
          <span class="material-symbols-outlined text-[18px]">arrow_back</span>
        </button>
        <div
          class="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg"
          [style.background]="
            statusLevel() === 'critical' ? 'rgba(239,68,68,0.10)' : 'rgba(13,175,189,0.10)'
          "
          [style.border]="
            '1px solid ' +
            (statusLevel() === 'critical' ? 'rgba(239,68,68,0.30)' : 'rgba(13,175,189,0.30)')
          "
        >
          <span
            class="material-symbols-outlined text-[18px]"
            [style.color]="statusLevel() === 'critical' ? '#DC2626' : '#0DAFBD'"
            >meeting_room</span
          >
        </div>
        <div class="min-w-0">
          <div class="sala-title truncate">{{ siteName() }} · {{ areaName() }}</div>
          <div class="mt-0.5 text-[11px] text-slate-400">
            Sala · {{ sensors().length }} sensores · rango {{ range() }}
          </div>
        </div>

        <span class="sala-live ml-auto" [class.sala-live--err]="!!serviceError()">
          <span
            class="sala-live-dot"
            [class.sala-live-dot--err]="!!serviceError()"
            [class.sala-live-dot--pulse]="!serviceError() && !isLoading()"
          ></span>
          {{ liveLabel() }}
        </span>

        <button
          type="button"
          class="sala-icon-btn"
          [disabled]="isLoading()"
          (click)="refresh()"
          title="Actualizar (R)"
        >
          <span class="material-symbols-outlined text-[16px]" [class.sala-spin]="isLoading()"
            >sync</span
          >
        </button>

        <button
          type="button"
          class="sala-btn"
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
          class="sala-btn"
          [disabled]="!chart"
          (click)="exportPng()"
          title="Descargar PNG"
        >
          <span class="material-symbols-outlined text-[16px]">image</span>
          PNG
        </button>
      </div>

      <!-- Status banner -->
      @if (sensors().length > 0) {
        <div class="status-banner" [attr.data-level]="statusLevel()">
          <div class="status-banner-inner">
            <span class="status-icon material-symbols-outlined">{{ statusIcon() }}</span>
            <div class="status-text">
              <div class="status-title">{{ statusTitle() }}</div>
              <div class="status-sub">{{ statusSub() }}</div>
            </div>
            <div class="status-meta">
              <span class="status-meta-item">
                <span class="status-meta-lbl">Setpoint prom.</span>
                <strong>{{ stats().setpointAvg.toFixed(1) }}°C</strong>
              </span>
              <span class="status-meta-item">
                <span class="status-meta-lbl">Δ vs setpoint</span>
                <strong>{{ stats().delta.toFixed(1) }}°C</strong>
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
      <div class="sala-content min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-5">
        <!-- KPI strip -->
        @if (sensors().length > 0) {
          <div class="kpi-strip mb-5 flex flex-wrap items-end gap-8">
            <div class="kpi-hero">
              <div
                class="kpi-hero-value"
                [style.color]="stats().alerts > 0 ? '#DC2626' : '#0DAFBD'"
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
                >Actual <strong>{{ stats().actualT }}°C</strong></span
              >
              <span
                >Prom <strong>{{ stats().avgT }}°C</strong></span
              >
              <span
                >HR <strong>{{ stats().avgH }}%</strong></span
              >
              <span
                >Mín <strong>{{ stats().minT }}°C</strong></span
              >
              <span
                >Máx <strong>{{ stats().maxT }}°C</strong></span
              >
              @if (stats().thresholdMax !== null) {
                <span
                  >Umbral <strong>{{ stats().thresholdMax }}°C</strong></span
                >
              }
              @if (taps().length > 0) {
                <span class="kpi-meta-tap">{{ taps().join(' · ') }}</span>
              }
            </div>
          </div>
        }

        <!-- Sensors grid -->
        @if (sensors().length > 0) {
          <section class="mb-6">
            <h3 class="section-title mb-3">
              Sensores de esta sala
              <span class="section-count">{{ sensors().length }}</span>
            </h3>
            <div class="sensor-grid">
              @for (s of sensors(); track s.id; let i = $index) {
                <article
                  class="sensor-card anim-stagger"
                  [class.sensor-card--alert]="s.alerted"
                  [style.--i]="i"
                  (click)="openSensorDrilldown(s.id)"
                  (keydown.enter)="openSensorDrilldown(s.id)"
                  tabindex="0"
                  role="button"
                  [attr.aria-label]="'Detalle ' + s.id"
                >
                  <header class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5">
                      <span class="sensor-id-chip">{{ s.id }}</span>
                      @if (s.alerted) {
                        <span class="sensor-alert-chip">ALERTA</span>
                      }
                    </div>
                    <span class="tap-tag">{{ s.tap }}</span>
                  </header>
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
                      <linearGradient [attr.id]="'salasp-' + s.id" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" [attr.stop-color]="tempColor(s.t)" stop-opacity="0.30" />
                        <stop offset="100%" stop-color="#fff" stop-opacity="0" />
                      </linearGradient>
                    </defs>
                    <path
                      [attr.d]="sparkArea(s.hist, 32)"
                      [attr.fill]="'url(#salasp-' + s.id + ')'"
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
        } @else if (isLoading()) {
          <div class="empty-block">Cargando sensores…</div>
        } @else {
          <div class="empty-state">
            <span class="material-symbols-outlined text-[36px] text-slate-300">sensors_off</span>
            <div class="empty-title">Sin sensores en esta sala</div>
            <div class="empty-sub">Verifica que la sala "{{ areaName() }}" esté provisionada.</div>
          </div>
        }

        <!-- Desviaciones (HACCP) -->
        @if (sensors().length > 0 && deviations().length > 0) {
          <section class="mb-6">
            <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 class="section-title">
                Desviaciones de temperatura
                <span class="section-count">{{ deviations().length }}</span>
              </h3>
              <span class="text-[11px] text-slate-400">
                {{ deviationsOpen().length }} abiertas · {{ deviationsOngoing().length }} en curso
              </span>
            </div>
            <div class="deviation-list">
              @for (ex of deviations(); track ex.id) {
                <article
                  class="deviation-card"
                  [attr.data-level]="effectiveCause(ex)?.cause === 'defrost' ? 'defrost' : ex.level"
                >
                  <header class="deviation-head">
                    <div class="deviation-level-pill" [attr.data-level]="ex.level">
                      <span class="material-symbols-outlined text-[11px]">{{
                        ex.level === 'severe' ? 'error' : ex.level === 'crit' ? 'warning' : 'flag'
                      }}</span>
                      {{ deviationLevelLabel(ex.level) }}
                    </div>
                    <span class="deviation-sensor">{{ ex.sensorId }}</span>
                    @if (effectiveCause(ex); as ec) {
                      <span
                        class="deviation-cause-badge"
                        [attr.data-cause]="ec.cause"
                        [attr.data-source]="ec.source"
                        [title]="
                          ec.source === 'auto'
                            ? 'Clasificado automáticamente por ventana defrost'
                            : 'Clasificado manualmente por operador'
                        "
                      >
                        <span class="material-symbols-outlined text-[11px]">{{
                          causeIcon(ec.cause)
                        }}</span>
                        {{ causeLabel(ec.cause) }}
                        <span class="deviation-cause-src"
                          >({{ ec.source === 'auto' ? 'auto' : 'manual' }})</span
                        >
                      </span>
                    }
                    @if (ex.ongoing) {
                      <span class="deviation-ongoing">
                        <span class="deviation-pulse"></span>
                        EN CURSO
                      </span>
                    }
                    @if (!ex.defrost && ex.defrostOverlapMin > 0) {
                      <span
                        class="deviation-defrost-overlap"
                        title="Minutos solapando ventana defrost (descontados del cómputo)"
                      >
                        <span class="material-symbols-outlined text-[10px]">ac_unit</span>
                        −{{ ex.defrostOverlapMin }}m
                      </span>
                    }
                  </header>
                  <div class="deviation-body">
                    <div class="deviation-stat">
                      <span class="deviation-stat-lbl">Inicio</span>
                      <span class="deviation-stat-val">{{ fmtDeviationTime(ex.startTs) }}</span>
                    </div>
                    <div class="deviation-stat">
                      <span class="deviation-stat-lbl">Duración</span>
                      <span class="deviation-stat-val">
                        {{ fmtDeviationDuration(ex.durationMin) }}
                        @if (ex.defrostOverlapMin > 0 && !ex.defrost) {
                          <span class="deviation-stat-sub"
                            >efectivo {{ fmtDeviationDuration(ex.effectiveMin) }}</span
                          >
                        }
                      </span>
                    </div>
                    <div class="deviation-stat">
                      <span class="deviation-stat-lbl">Peak T</span>
                      <span class="deviation-stat-val" [class.text-rose-700]="!ex.defrost"
                        >{{ ex.peakT }}°C</span
                      >
                    </div>
                    <div class="deviation-stat">
                      <span class="deviation-stat-lbl">Umbral</span>
                      <span class="deviation-stat-val">{{ ex.thresholdMax }}°C</span>
                    </div>
                  </div>
                  @if (getAck(ex.id); as ack) {
                    <div class="deviation-ack">
                      <span class="material-symbols-outlined text-[12px]">{{
                        ack.resolved ? 'task_alt' : 'check_circle'
                      }}</span>
                      <span>
                        {{ ack.resolved ? 'Resuelta' : 'Reconocida' }}
                        · {{ ack.ackedBy }} ·
                        {{
                          fmtDeviationTime(
                            ack.resolved ? ack.resolvedAt || ack.ackedAt! : ack.ackedAt!
                          )
                        }}
                      </span>
                    </div>
                  }
                  <footer class="deviation-foot">
                    <select
                      class="deviation-cause-select"
                      (change)="onCauseChange(ex.id, $event)"
                      (click)="$event.stopPropagation()"
                      [attr.aria-label]="'Clasificar desviación ' + ex.id"
                    >
                      <option value="">
                        {{ effectiveCause(ex) ? 'Cambiar causa…' : 'Clasificar causa…' }}
                      </option>
                      @for (c of causes; track c.key) {
                        <option [value]="c.key">
                          {{ c.label }}{{ c.expected ? ' (esperada)' : '' }}
                        </option>
                      }
                    </select>
                    @if (effectiveCause(ex); as ec) {
                      @if (ec.source === 'manual') {
                        <button
                          type="button"
                          class="deviation-btn deviation-btn--ghost"
                          (click)="clearCause(ex.id, $event)"
                          title="Quitar clasificación manual"
                        >
                          <span class="material-symbols-outlined text-[14px]">close</span>
                          Quitar causa
                        </button>
                      }
                    }
                    <span class="deviation-foot-spacer"></span>
                    @if (!isDeviationClosed(ex)) {
                      @if (!getAck(ex.id)?.acknowledged) {
                        <button
                          type="button"
                          class="deviation-btn deviation-btn--primary"
                          (click)="ackDeviation(ex.id, $event)"
                        >
                          <span class="material-symbols-outlined text-[14px]">visibility</span>
                          Reconocer
                        </button>
                      }
                      @if (!ex.ongoing && !getAck(ex.id)?.resolved) {
                        <button
                          type="button"
                          class="deviation-btn"
                          (click)="resolveDeviation(ex.id, $event)"
                        >
                          <span class="material-symbols-outlined text-[14px]">check</span>
                          Marcar resuelta
                        </button>
                      }
                    } @else {
                      <span class="deviation-closed-tag">
                        <span class="material-symbols-outlined text-[12px]">task_alt</span>
                        Cerrada
                      </span>
                    }
                  </footer>
                </article>
              }
            </div>
          </section>
        }

        <!-- Histórico -->
        @if (sensors().length > 0) {
          <section class="mt-2">
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
              <div class="h-[320px]">
                <canvas #chartCanvas></canvas>
              </div>
              <div class="chart-tip">scroll zoom · drag pan · click reset</div>
            </div>
          </section>
        }
      </div>

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
                {{ drilldownData()?.area || '—' }} · {{ drilldownData()?.tap || '' }}
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

      .sala-header {
        background: linear-gradient(180deg, #fbfcfd, #f8fafc);
        border-bottom-width: 2px;
        border-top-color: #e2e8f0;
        border-bottom-color: #0d99a5;
      }
      .sala-icon-btn {
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
      .sala-icon-btn:hover {
        color: #0d99a5;
      }
      .sala-icon-btn:active {
        transform: translateY(1px);
      }
      .sala-icon-btn:disabled {
        opacity: 0.5;
      }
      .sala-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 12px;
        border-radius: 9px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 500;
        transition:
          color 0.15s ease,
          background 0.15s ease,
          transform 0.18s ease;
      }
      .sala-btn:hover {
        color: #0d99a5;
        background: rgba(13, 175, 189, 0.05);
      }
      .sala-btn:active {
        transform: translateY(1px);
      }
      .sala-btn:disabled {
        opacity: 0.5;
      }

      .sala-title {
        font-family: 'Josefin Sans', sans-serif;
        font-size: 16px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .sala-live {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: 'DM Sans', sans-serif;
        font-size: 11px;
        font-weight: 500;
        color: #475569;
        padding: 4px 9px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.08);
        border: 1px solid rgba(34, 197, 94, 0.2);
      }
      .sala-live--err {
        color: #b91c1c;
        background: rgba(239, 68, 68, 0.08);
        border-color: rgba(239, 68, 68, 0.25);
      }
      .sala-live-dot {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #22c55e;
      }
      .sala-live-dot--err {
        background: #ef4444;
      }
      .sala-live-dot--pulse {
        animation: salaPulse 1.6s ease-in-out infinite;
      }
      @keyframes salaPulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55);
        }
        70% {
          box-shadow: 0 0 0 6px rgba(34, 197, 94, 0);
        }
      }
      .sala-spin {
        animation: salaSpin 0.8s linear infinite;
      }
      @keyframes salaSpin {
        to {
          transform: rotate(360deg);
        }
      }

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
        color: #16a34a;
      }
      .status-banner[data-level='warning'] .status-icon {
        color: #d97706;
      }
      .status-banner[data-level='critical'] .status-icon {
        color: #dc2626;
      }
      .status-banner[data-level='unknown'] .status-banner-inner {
        background: #f8fafc;
        border-color: #e2e8f0;
      }
      .status-banner[data-level='unknown'] .status-icon {
        color: #94a3b8;
      }
      .status-title {
        font-family: 'DM Sans', sans-serif;
        font-size: 13.5px;
        font-weight: 600;
        color: #1e293b;
      }
      .status-sub {
        font-family: 'DM Sans', sans-serif;
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
        font-family: 'DM Sans', sans-serif;
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

      .sensor-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
      }
      .sensor-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 14px 16px;
        cursor: pointer;
        text-align: left;
        transition:
          transform 0.18s ease,
          box-shadow 0.18s ease,
          border-color 0.15s ease;
      }
      .sensor-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      }
      .sensor-card--alert {
        border-color: rgba(239, 68, 68, 0.3);
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.05), transparent 70%);
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
        background: rgba(239, 68, 68, 0.1);
        border: 1px solid rgba(239, 68, 68, 0.25);
        color: #b91c1c;
        border-radius: 4px;
        padding: 1px 5px;
      }
      .tap-tag {
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        color: #94a3b8;
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
        color: #0d99a5;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
      .band-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: 'DM Sans', sans-serif;
        font-size: 11.5px;
        color: #64748b;
        cursor: pointer;
      }
      .band-toggle input {
        accent-color: #0d99a5;
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
        font-family: 'DM Sans', sans-serif;
        font-size: 10px;
        color: #94a3b8;
      }

      /* Deviations */
      .deviation-list {
        display: grid;
        gap: 10px;
      }
      .deviation-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 14px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .deviation-card[data-level='warn'] {
        border-color: rgba(245, 158, 11, 0.32);
      }
      .deviation-card[data-level='crit'] {
        border-color: rgba(239, 68, 68, 0.32);
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.04), transparent 70%);
      }
      .deviation-card[data-level='severe'] {
        border-color: rgba(185, 28, 28, 0.45);
        background: linear-gradient(135deg, rgba(185, 28, 28, 0.06), transparent 70%);
      }
      .deviation-card[data-level='defrost'] {
        border-color: rgba(56, 189, 248, 0.32);
        background: linear-gradient(135deg, rgba(56, 189, 248, 0.06), transparent 70%);
        opacity: 0.92;
      }
      .deviation-head {
        display: flex;
        align-items: center;
        gap: 8px;
        font-family: 'DM Sans', sans-serif;
      }
      .deviation-level-pill {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .deviation-level-pill[data-level='warn'] {
        background: rgba(245, 158, 11, 0.1);
        color: #b45309;
      }
      .deviation-level-pill[data-level='crit'] {
        background: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
      }
      .deviation-level-pill[data-level='severe'] {
        background: #b91c1c;
        color: #fff;
      }
      .deviation-level-pill[data-level='defrost'] {
        background: rgba(56, 189, 248, 0.12);
        color: #0369a1;
        border: 1px solid rgba(14, 165, 233, 0.3);
      }
      .deviation-defrost-overlap {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-family: 'JetBrains Mono', monospace;
        font-size: 10px;
        font-weight: 600;
        color: #0369a1;
        background: rgba(56, 189, 248, 0.1);
        border: 1px solid rgba(14, 165, 233, 0.25);
        border-radius: 999px;
        padding: 2px 7px;
        cursor: help;
      }
      .deviation-stat-sub {
        display: block;
        font-family: 'DM Sans', sans-serif;
        font-size: 10px;
        font-weight: 500;
        color: #0369a1;
        margin-top: 2px;
        text-transform: lowercase;
      }
      .deviation-sensor {
        font-family: 'JetBrains Mono', monospace;
        font-size: 11px;
        font-weight: 600;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 1px 6px;
        color: #475569;
      }
      .deviation-ongoing {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-family: 'DM Sans', sans-serif;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        color: #b91c1c;
      }
      .deviation-pulse {
        display: inline-block;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #ef4444;
        animation: devPulse 1.4s ease-in-out infinite;
      }
      @keyframes devPulse {
        0%,
        100% {
          box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.55);
        }
        70% {
          box-shadow: 0 0 0 6px rgba(239, 68, 68, 0);
        }
      }
      .deviation-body {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .deviation-stat {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .deviation-stat-lbl {
        font-family: 'DM Sans', sans-serif;
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .deviation-stat-val {
        font-family: 'JetBrains Mono', monospace;
        font-size: 13px;
        font-weight: 600;
        color: #1e293b;
        font-variant-numeric: tabular-nums;
      }
      .deviation-ack {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 10px;
        border-radius: 8px;
        background: rgba(34, 197, 94, 0.08);
        border: 1px solid rgba(34, 197, 94, 0.2);
        color: #15803d;
        font-family: 'DM Sans', sans-serif;
        font-size: 11.5px;
      }
      .deviation-foot {
        display: flex;
        gap: 6px;
        justify-content: flex-end;
      }
      .deviation-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: 'DM Sans', sans-serif;
        font-size: 11.5px;
        font-weight: 500;
        cursor: pointer;
      }
      .deviation-btn:hover {
        color: #1e293b;
        background: #f8fafc;
      }
      .deviation-btn--primary {
        background: #0d99a5;
        color: #fff;
        border-color: #0d99a5;
      }
      .deviation-btn--primary:hover {
        background: #0a7d87;
      }
      .deviation-btn--ghost {
        color: #94a3b8;
      }
      .deviation-btn--ghost:hover {
        color: #475569;
        background: #f1f5f9;
      }

      .deviation-cause-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 999px;
        font-family: 'DM Sans', sans-serif;
        font-size: 10.5px;
        font-weight: 600;
      }
      .deviation-cause-badge[data-cause='defrost'] {
        background: rgba(56, 189, 248, 0.1);
        color: #0369a1;
        border: 1px solid rgba(14, 165, 233, 0.3);
      }
      .deviation-cause-badge[data-cause='door-open'] {
        background: rgba(168, 85, 247, 0.1);
        color: #6d28d9;
        border: 1px solid rgba(168, 85, 247, 0.3);
      }
      .deviation-cause-badge[data-cause='load-unload'] {
        background: rgba(245, 158, 11, 0.1);
        color: #b45309;
        border: 1px solid rgba(245, 158, 11, 0.3);
      }
      .deviation-cause-badge[data-cause='cleaning'] {
        background: rgba(20, 184, 166, 0.1);
        color: #0f766e;
        border: 1px solid rgba(20, 184, 166, 0.3);
      }
      .deviation-cause-badge[data-cause='other'] {
        background: #f1f5f9;
        color: #475569;
        border: 1px solid #e2e8f0;
      }
      .deviation-cause-src {
        font-family: 'JetBrains Mono', monospace;
        font-size: 9px;
        font-weight: 500;
        opacity: 0.7;
        margin-left: 2px;
      }

      .deviation-cause-select {
        font-family: 'DM Sans', sans-serif;
        font-size: 11.5px;
        padding: 5px 8px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #ffffff;
        color: #475569;
        max-width: 220px;
      }
      .deviation-cause-select:focus {
        outline: 2px solid #0d99a5;
        outline-offset: 1px;
        border-color: #0d99a5;
      }

      .deviation-foot-spacer {
        flex: 1;
      }
      .deviation-closed-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.1);
        color: #15803d;
        border: 1px solid rgba(34, 197, 94, 0.22);
        font-family: 'DM Sans', sans-serif;
        font-size: 11px;
        font-weight: 600;
      }

      .empty-block {
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
        padding: 28px;
        text-align: center;
        background: #ffffff;
        color: #94a3b8;
      }
      .empty-state {
        text-align: center;
        padding: 60px 24px;
        background: #ffffff;
        border: 1px dashed #e2e8f0;
        border-radius: 14px;
      }
      .empty-title {
        font-family: 'DM Sans', sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: #475569;
        margin-top: 8px;
      }
      .empty-sub {
        font-family: 'DM Sans', sans-serif;
        font-size: 11.5px;
        color: #94a3b8;
        margin-top: 4px;
      }

      .anim-stagger {
        opacity: 0;
        transform: translateY(4px);
        animation: cardIn 0.32s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        animation-delay: calc(var(--i, 0) * 30ms);
      }
      @keyframes cardIn {
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .anim-stagger {
          animation: none;
          opacity: 1;
          transform: none;
        }
        .sala-live-dot--pulse,
        .sala-spin {
          animation: none;
        }
      }

      /* Drawer */
      .drawer-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.42);
        z-index: 40;
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
        animation: salaSlideIn 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes salaSlideIn {
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
        font-family: 'DM Sans', sans-serif;
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
        font-family: 'DM Sans', sans-serif;
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
    `,
  ],
})
export class VentisquerosSalaDetailComponent implements OnInit, OnDestroy, AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly coldRoom = inject(ColdRoomService);
  private readonly companyService = inject(CompanyService);
  private readonly location = inject(Location);
  private readonly thresholdsSvc = inject(ColdRoomThresholdsService);
  private readonly deviationsSvc = inject(ColdRoomDeviationsService);

  readonly deviations = computed<Deviation[]>(() => {
    this.thresholdsSvc.thresholds();
    this.deviationsSvc.ackMap();
    return this.deviationsSvc.detect(this.sensors());
  });

  readonly deviationsOngoing = computed(() => this.deviations().filter((e) => e.ongoing));

  readonly deviationsOpen = computed(() =>
    this.deviations().filter((e) => this.deviationsSvc.isOpen(e)),
  );

  getAck(id: string) {
    return this.deviationsSvc.getAck(id);
  }

  ackDeviation(id: string, ev: Event): void {
    ev.stopPropagation();
    this.deviationsSvc.acknowledge(id);
  }

  resolveDeviation(id: string, ev: Event): void {
    ev.stopPropagation();
    this.deviationsSvc.resolve(id);
  }

  fmtDeviationDuration(min: number): string {
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  fmtDeviationTime(iso: string): string {
    return new Date(iso).toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  deviationLevelLabel(level: Deviation['level']): string {
    switch (level) {
      case 'severe':
        return 'Severa';
      case 'crit':
        return 'Sostenida';
      case 'warn':
        return 'Breve';
      default:
        return level;
    }
  }

  // === Cause classification (híbrido) ===
  readonly causes = (
    Object.entries(DEVIATION_CAUSES) as Array<
      [DeviationCause, (typeof DEVIATION_CAUSES)[DeviationCause]]
    >
  ).map(([key, meta]) => ({ key, ...meta }));

  effectiveCause(d: Deviation) {
    return this.deviationsSvc.effectiveCause(d);
  }

  causeLabel(key: string): string {
    return DEVIATION_CAUSES[key as DeviationCause]?.label || key;
  }

  causeIcon(key: string): string {
    return DEVIATION_CAUSES[key as DeviationCause]?.icon || 'help';
  }

  isCauseExpected(key: string): boolean {
    return DEVIATION_CAUSES[key as DeviationCause]?.expected ?? false;
  }

  onCauseChange(id: string, ev: Event): void {
    ev.stopPropagation();
    const target = ev.target as HTMLSelectElement | null;
    if (!target || !target.value) return;
    this.deviationsSvc.setCause(id, target.value as DeviationCause, 'manual');
    target.value = '';
  }

  clearCause(id: string, ev: Event): void {
    ev.stopPropagation();
    this.deviationsSvc.clearCause(id);
  }

  isDeviationClosed(d: Deviation): boolean {
    return !this.deviationsSvc.isOpen(d);
  }

  goBack(): void {
    this.location.back();
  }

  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('drilldownCanvas') drilldownCanvas?: ElementRef<HTMLCanvasElement>;

  readonly ranges = RANGES;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  readonly siteId = computed(() => this.params().get('siteId') || '');
  readonly salaSlug = computed(() => (this.params().get('salaSlug') || '').toLowerCase());
  readonly siteRecord = signal<SiteRecord | null>(null);
  readonly now = signal<number>(Date.now());

  readonly allSensors = signal<ColdRoomSensor[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly serviceError = signal<string | null>(null);
  readonly lastUpdate = signal<Date | null>(null);
  readonly range = signal<ColdRoomRange>('24h');
  readonly exporting = signal<boolean>(false);
  readonly showBand = signal<boolean>(true);

  readonly drilldownSensorId = signal<string | null>(null);
  readonly drilldownRange = signal<ColdRoomRange>('24h');
  readonly drilldownData = signal<ColdRoomSensorHistory | null>(null);
  readonly drilldownLoading = signal<boolean>(false);

  readonly backLink = computed(() => ['/companies', this.siteId()]);
  readonly siteName = computed(() => this.siteRecord()?.descripcion || 'Sitio');

  readonly sensors = computed(() => {
    const slug = this.salaSlug();
    return this.allSensors().filter((s) => slugify(s.area || '') === slug);
  });

  readonly areaName = computed(() => {
    const first = this.sensors()[0];
    if (first?.area) return first.area;
    return this.salaSlug()
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  });

  readonly taps = computed(() => Array.from(new Set(this.sensors().map((s) => s.tap))).sort());

  readonly liveLabel = computed(() => {
    if (this.serviceError()) return 'Sin conexión';
    const last = this.lastUpdate();
    if (!last) return this.isLoading() ? 'Cargando…' : 'Esperando lectura';
    const diff = Math.max(0, Math.floor((this.now() - last.getTime()) / 1000));
    if (diff < 60) return `En vivo · hace ${diff}s`;
    return `En vivo · hace ${Math.floor(diff / 60)}m`;
  });

  readonly stats = computed(() => {
    // Trigger when thresholds change.
    this.thresholdsSvc.thresholds();
    const list = this.sensors();
    const area = this.areaName();
    if (list.length === 0) {
      return {
        count: 0,
        actualT: '—',
        avgT: '—',
        avgH: 0,
        alerts: 0,
        minT: '—',
        maxT: '—',
        delta: 0,
        setpointAvg: 0,
        thresholdMax: this.thresholdsSvc.get(area)?.tMax ?? null,
      };
    }
    const ts = list.map((s) => s.t);
    const hs = list.map((s) => s.h);
    const actualNum = ts.reduce((a, b) => a + b, 0) / ts.length;
    const allHist = list.flatMap((s) => s.hist || []);
    const histAvg = allHist.length
      ? allHist.reduce((a, b) => a + b, 0) / allHist.length
      : actualNum;
    const setAvg = list.reduce((a, b) => a + b.setpoint, 0) / list.length;
    const th = this.thresholdsSvc.get(area);
    const alerts = list.filter((s) =>
      th ? this.thresholdsSvc.isSensorOutOfBand(area, s.t) : s.alerted,
    ).length;
    return {
      count: list.length,
      actualT: actualNum.toFixed(1),
      avgT: histAvg.toFixed(1),
      avgH: Math.round(hs.reduce((a, b) => a + b, 0) / hs.length),
      alerts,
      minT: Math.min(...ts).toFixed(1),
      maxT: Math.max(...ts).toFixed(1),
      delta: actualNum - setAvg,
      setpointAvg: setAvg,
      thresholdMax: th?.tMax ?? null,
    };
  });

  readonly statusLevel = computed<'ok' | 'warning' | 'critical' | 'unknown'>(() => {
    this.thresholdsSvc.thresholds();
    const list = this.sensors();
    const area = this.areaName();
    if (list.length === 0) return 'unknown';
    const th = this.thresholdsSvc.get(area);
    if (!th) return 'unknown';
    const maxT = Math.max(...list.map((s) => s.t));
    const eval$ = this.thresholdsSvc.evaluate(area, maxT);
    if (eval$ === 'crit') return 'critical';
    if (eval$ === 'warn') return 'warning';
    return 'ok';
  });

  readonly statusIcon = computed(() => {
    const l = this.statusLevel();
    if (l === 'ok') return 'check_circle';
    if (l === 'warning') return 'warning';
    if (l === 'critical') return 'error';
    return 'help';
  });

  readonly statusTitle = computed(() => {
    const l = this.statusLevel();
    const max = this.stats().thresholdMax;
    if (l === 'unknown') return 'Sin umbral configurado';
    if (l === 'ok') return `Bajo umbral (máx ${max}°C)`;
    if (l === 'warning') return `Cerca del umbral (máx ${max}°C)`;
    return `Excede umbral · ${this.stats().alerts} sensor(es) sobre ${max}°C`;
  });

  readonly statusSub = computed(() => {
    const l = this.statusLevel();
    if (l === 'unknown') return 'Define un umbral en "Umbrales" para evaluar estado.';
    if (l === 'ok') return 'Lectura máxima por debajo del umbral configurado.';
    if (l === 'warning') return 'Lectura cerca del umbral. Revisar tendencia.';
    return 'Atención inmediata: temperatura sobre umbral del cliente.';
  });

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
      const list = this.sensors();
      if (list.length === 0) {
        this.destroyChart();
        return;
      }
      const band = this.showBand();
      queueMicrotask(() => this.renderMainChart(list, band));
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
    this.thresholdsSvc.setSiteId(id);
    this.deviationsSvc.setSiteId(id);
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
    queueMicrotask(() => this.renderMainChart(this.sensors(), this.showBand()));
  }

  ngOnDestroy(): void {
    this.stopPolling();
    this.destroyChart();
    this.destroyDrilldownChart();
    if (this.clockId !== null) clearInterval(this.clockId);
  }

  @HostListener('document:keydown', ['$event'])
  handleKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && this.drilldownSensorId()) {
      ev.preventDefault();
      this.closeDrilldown();
      return;
    }
    const target = ev.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    if (ev.key === 'r' || ev.key === 'R') {
      ev.preventDefault();
      this.refresh();
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

  openSensorDrilldown(id: string): void {
    this.drilldownSensorId.set(id);
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
    // Exporta todos los datos (sin filtro tap) y deja al usuario filtrar; sala-level
    // export requeriría endpoint dedicado.
    this.coldRoom.downloadCsv(sid, null, this.range()).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sala-${this.salaSlug()}-${this.range()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.exporting.set(false);
      },
      error: () => {
        this.exporting.set(false);
        this.serviceError.set('No se pudo descargar el CSV');
      },
    });
  }

  exportPng(): void {
    if (!this.chart) return;
    const url = this.chart.toBase64Image('image/png', 1);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sala-${this.salaSlug()}-${this.range()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
    // Sin filtro tap → trae todos los sensores del sitio. Cliente filtra por area.
    this.coldRoom.getSensors(id, null, this.range()).subscribe({
      next: (res) => {
        if (res.ok) {
          this.allSensors.set(res.data || []);
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
          content: `Banda ${tMin}/${tMax}°C`,
          position: { x: 'end', y: 'start' },
          color: '#15803D',
          font: { size: 10, family: 'JetBrains Mono' },
          padding: 3,
        },
      };
      const setAvg = sensors.reduce((a, b) => a + b.setpoint, 0) / sensors.length;
      annotations['setpoint'] = {
        type: 'line',
        yMin: setAvg,
        yMax: setAvg,
        borderColor: 'rgba(13, 175, 189, 0.7)',
        borderWidth: 1.2,
        borderDash: [6, 4],
        label: {
          display: true,
          content: `Setpoint ${setAvg.toFixed(1)}°C`,
          position: 'start',
          color: '#0D99A5',
          font: { size: 10, family: 'JetBrains Mono' },
          padding: 3,
        },
      };
    }

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: sensors.map((s, i) => ({
          label: `${s.id}`,
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
            pan: { enabled: true, mode: 'x' },
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
            borderColor: '#0D99A5',
            backgroundColor: '#0D99A520',
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
