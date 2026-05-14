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
    <div class="flex h-full min-w-0 flex-1 flex-col overflow-hidden" style="background: #F0F2F5;">
      <!-- Site header -->
      <div
        style="border-top: 1px solid #E2E8F0; border-bottom: 2px solid #0DAFBD; background: #F8FAFC;"
        class="flex flex-wrap items-center gap-3 px-5 py-2.5"
      >
        <div
          class="flex h-[38px] w-[38px] shrink-0 items-center justify-center"
          style="border-radius: 9px; background: rgba(99,102,241,0.10); border: 1px solid rgba(99,102,241,0.25);"
        >
          <span class="material-symbols-outlined text-[18px]" style="color: #6366F1;">factory</span>
        </div>
        <div>
          <div
            style="font-family: 'Josefin Sans'; font-size: 16px; font-weight: 700; color: #1E293B; letter-spacing: 0.02em; line-height: 1.1;"
          >
            Ventisqueros · Planta Castro
          </div>
          <div style="font-size: 11px; color: #94A3B8; margin-top: 2px;">
            Variables de Proceso · {{ sensors().length }} sensores THM activos
          </div>
        </div>
        <div class="ml-3 flex gap-1.5">
          <div
            class="flex items-center gap-1"
            style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 6px; padding: 4px 8px; font-size: 11px; font-weight: 500; color: #16A34A;"
          >
            <span
              style="width: 6px; height: 6px; border-radius: 50%; background: #22C55E; display: inline-block;"
            ></span>
            En vivo
          </div>
          <div
            class="flex items-center gap-1"
            style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 6px; padding: 4px 8px; font-size: 11px; color: #2563EB;"
          >
            <span class="material-symbols-outlined text-[10px]">schedule</span>
            {{ nowLabel() }}
          </div>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-1.5">
          <span style="font-size: 12px; color: #94A3B8;">Desde</span>
          <div
            class="flex items-center gap-[5px]"
            style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 10px; font-size: 12px; color: #475569;"
          >
            <span class="material-symbols-outlined text-[12px]">calendar_today</span>
            {{ rangeFrom }}
          </div>
          <span style="font-size: 12px; color: #94A3B8;">Hasta</span>
          <div
            class="flex items-center gap-[5px]"
            style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 10px; font-size: 12px; color: #475569;"
          >
            <span class="material-symbols-outlined text-[12px]">calendar_today</span>
            {{ rangeTo }}
          </div>
          <button
            style="background: #0DAFBD; border: none; border-radius: 4px; padding: 5px 14px; font-size: 11px; font-weight: 700; color: #fff; cursor: pointer; font-family: 'Josefin Sans'; letter-spacing: 0.08em; text-transform: uppercase;"
          >
            Aplicar
          </button>
        </div>
      </div>

      <!-- Sub-tabs -->
      <div
        class="flex shrink-0 items-center gap-0"
        style="background: #FFFFFF; border-bottom: 1px solid #E2E8F0; padding: 0 20px;"
      >
        @for (t of subTabs(); track t.key) {
          <button
            class="flex items-center gap-1.5"
            style="padding: 12px 14px; font-size: 13px; font-weight: 500; background: none; border: none; cursor: pointer; font-family: 'DM Sans';"
            [style.color]="activeTab() === t.key ? '#0899A5' : '#64748B'"
            [style.border-bottom]="
              activeTab() === t.key ? '2px solid #0DAFBD' : '2px solid transparent'
            "
            (click)="activeTab.set(t.key)"
          >
            <span class="material-symbols-outlined text-[13px]">{{ t.icon }}</span>
            {{ t.label }}
            @if (t.badge) {
              <span
                style="margin-left: 4px; font-family: 'JetBrains Mono'; font-size: 10px; font-weight: 700; background: #EF4444; color: #fff; border-radius: 999px; padding: 1px 6px;"
                >{{ t.badge }}</span
              >
            }
          </button>
        }
        <div class="flex-1"></div>
        <div class="flex items-center gap-2">
          <span style="font-size: 11px; color: #94A3B8; font-family: 'JetBrains Mono';">
            <span
              style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #22C55E; margin-right: 5px; vertical-align: middle;"
            ></span>
            En vivo · hace 0:32
          </span>
        </div>
      </div>

      <!-- Scrollable content -->
      <div
        class="min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        style="padding: 14px 18px 18px;"
      >
        @if (activeTab() === 'general') {
          <!-- Title strip -->
          <div class="mb-3 flex flex-wrap items-end justify-between gap-3.5">
            <div>
              <div
                style="font-family: 'Josefin Sans'; font-size: 22px; font-weight: 700; color: #1E293B; letter-spacing: 0.02em; line-height: 1.1;"
              >
                Monitoreo de Cámaras
              </div>
              <div style="font-size: 12px; color: #64748B; margin-top: 4px;">
                Temperatura, humedad relativa y alertas térmicas en vivo
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div
                class="flex gap-[2px]"
                style="background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 10px; padding: 3px;"
              >
                @for (o of metricOptions; track o.v) {
                  <button
                    class="flex items-center gap-1.5"
                    style="padding: 6px 12px; border: none; border-radius: 7px; font-family: 'DM Sans'; font-size: 12px; cursor: pointer; transition: all 0.12s;"
                    [style.background]="metric() === o.v ? '#FFFFFF' : 'transparent'"
                    [style.color]="metric() === o.v ? '#0899A5' : '#64748B'"
                    [style.font-weight]="metric() === o.v ? 600 : 500"
                    [style.box-shadow]="metric() === o.v ? '0 1px 3px rgba(15,23,42,0.10)' : 'none'"
                    (click)="metric.set(o.v)"
                  >
                    <span class="material-symbols-outlined text-[13px]">{{ o.icon }}</span>
                    {{ o.label }}
                  </button>
                }
              </div>
              <button
                class="inline-flex items-center gap-[5px]"
                style="padding: 7px 12px; border-radius: 8px; background: #FFFFFF; border: 1px solid #E2E8F0; font-family: 'DM Sans'; font-size: 12px; color: #475569; cursor: pointer;"
              >
                <span class="material-symbols-outlined text-[13px]">download</span>
                Exportar
              </button>
            </div>
          </div>

          <!-- Alert banner -->
          @if (alerts().length) {
            <div class="mb-3">
              <div
                class="relative flex items-center gap-3.5 overflow-hidden"
                style="
                background: linear-gradient(90deg, rgba(239,68,68,0.10) 0%, rgba(239,68,68,0.04) 80%);
                border: 1px solid rgba(239,68,68,0.30);
                border-radius: 12px;
                padding: 10px 14px;
              "
              >
                <div class="relative shrink-0" style="width: 28px; height: 28px;">
                  <div
                    style="position: absolute; inset: 0; border-radius: 50%; background: rgba(239,68,68,0.18); animation: vsPulse 1.6s ease-out infinite;"
                  ></div>
                  <div
                    class="flex items-center justify-center text-white"
                    style="position: absolute; inset: 6px; border-radius: 50%; background: #EF4444;"
                  >
                    <span class="material-symbols-outlined text-[10px]">warning</span>
                  </div>
                </div>
                <div class="min-w-0 flex-1">
                  <div
                    style="font-family: 'Josefin Sans'; font-size: 13px; font-weight: 700; color: #991B1B; letter-spacing: 0.02em;"
                  >
                    {{ alerts().length }}
                    {{ alerts().length === 1 ? 'alerta activa' : 'alertas activas' }}
                  </div>
                  <div style="font-size: 12px; color: #7F1D1D; opacity: 0.85; margin-top: 1px;">
                    Variables fuera de rango detectadas en
                    @for (a of alertSnippet(); track a.id; let last = $last) {
                      <button
                        style="background: transparent; border: none; padding: 0; color: #7F1D1D; cursor: pointer; font-weight: 600; text-decoration: underline dotted; font-family: inherit; font-size: inherit;"
                        (click)="selectedId.set(a.id)"
                      >
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
                    <span
                      style="font-family: 'JetBrains Mono'; font-size: 11px; font-weight: 600; background: #FFFFFF; color: #B91C1C; border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; padding: 3px 7px;"
                      >{{ a.id }}</span
                    >
                  }
                </div>
                <button
                  class="flex items-center gap-1.5"
                  style="background: #EF4444; border: none; border-radius: 6px; padding: 6px 12px; color: #fff; font-family: 'DM Sans'; font-size: 12px; font-weight: 600; cursor: pointer;"
                >
                  <span class="material-symbols-outlined text-[11px]">notifications_active</span>
                  Ver eventos
                </button>
              </div>
            </div>
          }

          <!-- KPI strip -->
          <div
            class="mb-3.5 grid gap-2.5"
            style="grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));"
          >
            @for (k of kpis(); track k.label) {
              <div
                class="relative overflow-hidden"
                style="border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; min-width: 0;"
                [style.background]="
                  k.highlight
                    ? 'linear-gradient(135deg, ' + k.accentBg + ' 0%, #FFFFFF 75%)'
                    : '#FFFFFF'
                "
                [style.border]="'1px solid ' + (k.highlight ? k.accent + '55' : '#E2E8F0')"
                [style.box-shadow]="
                  k.highlight
                    ? '0 0 0 1px ' + k.accent + '1A, 0 2px 10px rgba(15,23,42,0.05)'
                    : '0 1px 2px rgba(15,23,42,0.04)'
                "
              >
                <div class="flex items-center gap-1.5">
                  <div
                    class="flex shrink-0 items-center justify-center"
                    style="width: 22px; height: 22px; border-radius: 6px;"
                    [style.background]="k.accentBg"
                    [style.border]="'1px solid ' + k.accent + '33'"
                  >
                    <span class="material-symbols-outlined text-[12px]" [style.color]="k.accent">{{
                      k.icon
                    }}</span>
                  </div>
                  <div
                    class="truncate"
                    style="font-family: 'DM Sans'; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #94A3B8;"
                  >
                    {{ k.label }}
                  </div>
                </div>
                <div class="mt-[2px] flex items-baseline gap-1">
                  <span
                    style="font-family: 'JetBrains Mono'; font-size: 22px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums;"
                    [style.color]="k.accent"
                    >{{ k.value }}</span
                  >
                  @if (k.unit) {
                    <span style="font-family: 'JetBrains Mono'; font-size: 12px; color: #64748B;">{{
                      k.unit
                    }}</span>
                  }
                </div>
                @if (k.sub) {
                  <div style="font-size: 11px; color: #94A3B8; margin-top: 2px;">{{ k.sub }}</div>
                }
              </div>
            }
          </div>

          <!-- Map + sensor rail -->
          <div
            class="grid gap-3"
            style="grid-template-columns: minmax(0, 1fr) 320px; height: min(760px, calc(100vh - 360px)); min-height: 540px;"
          >
            <app-ventisqueros-floor-map
              [sensors]="sensors()"
              [metric]="metric()"
              [selectedId]="selectedId()"
              [hiddenSensors]="hiddenSensors()"
              [hasAlerts]="alerts().length > 0"
              (selectSensor)="selectedId.set($event)"
            ></app-ventisqueros-floor-map>

            <!-- Sensor rail -->
            <div
              class="flex h-full min-w-0 shrink-0 flex-col gap-3 overflow-hidden"
              style="width: 320px; min-width: 320px;"
            >
              @if (focusSensor(); as focus) {
                <div
                  class="shrink-0"
                  style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px 14px 12px; box-shadow: 0 2px 10px rgba(15,23,42,0.05);"
                >
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span
                          style="font-family: 'JetBrains Mono'; font-size: 11px; font-weight: 600; background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 4px; padding: 2px 6px; color: #475569;"
                          >{{ focus.id }}</span
                        >
                        <span
                          style="font-family: 'Josefin Sans'; font-size: 10px; font-weight: 700; color: #0899A5; background: rgba(13,175,189,0.10); border-radius: 4px; padding: 2px 6px; letter-spacing: 0.06em; border: 1px solid rgba(13,175,189,0.25);"
                          >{{ focus.tap }}</span
                        >
                        @if (focus.alerted) {
                          <span
                            style="font-family: 'Josefin Sans'; font-size: 10px; font-weight: 700; color: #B91C1C; background: rgba(239,68,68,0.10); border-radius: 4px; padding: 2px 6px; border: 1px solid rgba(239,68,68,0.25); letter-spacing: 0.06em;"
                            >EN ALERTA</span
                          >
                        }
                      </div>
                      <div
                        style="font-family: 'Josefin Sans'; font-size: 17px; font-weight: 700; color: #1E293B; margin-top: 6px; letter-spacing: 0.02em;"
                      >
                        {{ focus.area }}
                      </div>
                    </div>
                    <button
                      class="flex"
                      style="background: none; border: 1px solid #E2E8F0; border-radius: 6px; padding: 4px; cursor: pointer; color: #64748B;"
                    >
                      <span class="material-symbols-outlined text-[13px]">open_in_new</span>
                    </button>
                  </div>

                  <div class="mt-3 grid grid-cols-2 gap-2.5">
                    <div
                      style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px;"
                    >
                      <div
                        style="font-size: 9px; font-weight: 700; color: #94A3B8; letter-spacing: 0.1em; text-transform: uppercase;"
                      >
                        Temperatura
                      </div>
                      <div class="mt-1 flex items-baseline gap-[3px]">
                        <span
                          style="font-family: 'JetBrains Mono'; font-size: 22px; font-weight: 700; line-height: 1;"
                          [style.color]="focus.alerted ? '#B91C1C' : '#1E293B'"
                          >{{ focus.t.toFixed(1) }}</span
                        >
                        <span
                          style="font-family: 'JetBrains Mono'; font-size: 12px; color: #64748B;"
                          >°C</span
                        >
                      </div>
                      <div class="mt-1.5">
                        <svg
                          [attr.width]="120"
                          [attr.height]="28"
                          style="display: block; overflow: visible;"
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
                    <div
                      style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px;"
                    >
                      <div
                        style="font-size: 9px; font-weight: 700; color: #94A3B8; letter-spacing: 0.1em; text-transform: uppercase;"
                      >
                        Humedad
                      </div>
                      <div class="mt-1 flex items-baseline gap-[3px]">
                        <span
                          style="font-family: 'JetBrains Mono'; font-size: 22px; font-weight: 700; color: #1E293B; line-height: 1;"
                          >{{ focus.h }}</span
                        >
                        <span
                          style="font-family: 'JetBrains Mono'; font-size: 12px; color: #64748B;"
                          >%</span
                        >
                      </div>
                      <div
                        style="margin-top: 8px; height: 6px; background: #E2E8F0; border-radius: 999px; overflow: hidden;"
                      >
                        <div
                          style="height: 100%; border-radius: 999px;"
                          [style.width]="focus.h + '%'"
                          [style.background]="humBarGradient(focus.h)"
                        ></div>
                      </div>
                      <div
                        class="mt-1 flex justify-between"
                        style="font-size: 9px; color: #94A3B8; font-family: 'JetBrains Mono';"
                      >
                        <span>40%</span><span>100%</span>
                      </div>
                    </div>
                  </div>

                  <div
                    class="mt-2.5 flex items-center justify-between pt-2.5"
                    style="border-top: 1px dashed #E2E8F0; font-size: 11px; color: #64748B;"
                  >
                    <span class="flex items-center gap-1">
                      <span class="material-symbols-outlined text-[11px]">schedule</span>
                      hace 32 s
                    </span>
                    <span style="font-family: 'JetBrains Mono'; font-size: 11px;"
                      >Base: {{ fmtTemp(focus.baseT) }}</span
                    >
                  </div>
                </div>
              }

              <div
                class="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden"
                style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 12px 10px;"
              >
                <div class="flex items-center justify-between" style="padding: 0 4px 4px;">
                  <div
                    style="font-family: 'Josefin Sans'; font-size: 12px; font-weight: 700; color: #1E293B; letter-spacing: 0.04em;"
                  >
                    TAP
                  </div>
                  <span style="font-size: 10px; color: #94A3B8; font-family: 'JetBrains Mono';">
                    {{ sensors().length }} sensores · {{ taps.length }} TAP
                  </span>
                </div>
                <div class="flex-1 overflow-y-auto overflow-x-hidden pr-1">
                  @for (tap of taps; track tap) {
                    @if ((groupedSensors()[tap] || []).length > 0) {
                      <div class="mb-2">
                        <div
                          class="flex items-center justify-between"
                          style="padding: 6px 8px 4px; font-size: 10px; font-weight: 700; color: #94A3B8; letter-spacing: 0.1em; text-transform: uppercase;"
                        >
                          <span>{{ tap }}</span>
                          <span style="font-family: 'JetBrains Mono'; color: #CBD5E1;">
                            {{ groupedSensors()[tap]?.length || 0 }}
                          </span>
                        </div>
                        <div class="flex flex-col gap-[2px]">
                          @for (s of groupedSensors()[tap] || []; track s.id) {
                            <div
                              class="grid cursor-pointer items-center gap-2.5"
                              style="grid-template-columns: 8px 1fr auto; padding: 8px 10px; border-radius: 8px; transition: background 0.12s, border-color 0.12s;"
                              [style.background]="rowBg(s)"
                              [style.border]="rowBorder(s)"
                              (click)="selectedId.set(s.id)"
                            >
                              <span
                                style="width: 8px; height: 8px; border-radius: 50%;"
                                [style.background]="
                                  metric() === 'H' ? humColor(s.h) : tempColor(s.t)
                                "
                                [style.box-shadow]="
                                  s.alerted ? '0 0 0 3px rgba(239,68,68,0.25)' : 'none'
                                "
                              ></span>
                              <div class="min-w-0">
                                <div class="flex items-center gap-1.5">
                                  <span
                                    style="font-family: 'JetBrains Mono'; font-size: 10.5px; background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 4px; padding: 1px 5px; color: #475569; font-weight: 600;"
                                    >{{ s.id }}</span
                                  >
                                  @if (s.alerted) {
                                    <span
                                      class="inline-flex items-center gap-[3px]"
                                      style="font-size: 9.5px; font-weight: 700; color: #B91C1C; background: rgba(239,68,68,0.10); border: 1px solid rgba(239,68,68,0.25); border-radius: 4px; padding: 1px 5px; letter-spacing: 0.04em;"
                                    >
                                      <span
                                        style="width: 5px; height: 5px; border-radius: 50%; background: #EF4444; animation: vsPulse 1.4s ease-out infinite;"
                                      ></span>
                                      ALERTA
                                    </span>
                                  }
                                </div>
                                <div
                                  class="truncate"
                                  style="font-family: 'DM Sans'; font-size: 12.5px; color: #1E293B; margin-top: 2px;"
                                >
                                  {{ s.area }}
                                </div>
                              </div>
                              <div class="text-right">
                                <div
                                  style="font-family: 'JetBrains Mono'; font-size: 13px; font-weight: 700; line-height: 1;"
                                  [style.color]="s.alerted ? '#B91C1C' : '#1E293B'"
                                >
                                  {{ fmtTemp(s.t) }}
                                </div>
                                <div
                                  style="font-family: 'JetBrains Mono'; font-size: 10.5px; color: #64748B; margin-top: 2px;"
                                >
                                  {{ fmtHum(s.h) }}
                                </div>
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
          <div
            class="mt-3.5"
            style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 14px; box-shadow: 0 1px 4px rgba(15,23,42,0.04);"
          >
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div
                  style="font-family: 'Josefin Sans'; font-size: 14px; font-weight: 700; color: #1E293B; letter-spacing: 0.02em;"
                >
                  Visibilidad en plano
                </div>
                <div style="font-size: 11px; color: #94A3B8; margin-top: 2px;">
                  Oculta sensores individuales o grupos completos (TAP) sin perder su lectura
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <span style="font-size: 11px; color: #64748B; font-family: 'JetBrains Mono';">
                  {{ sensors().length - hiddenSensors().size }}/{{ sensors().length }} visibles
                </span>
                <button
                  (click)="showAll()"
                  [disabled]="hiddenSensors().size === 0"
                  class="flex items-center gap-1"
                  style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 10px; font-size: 11px; color: #475569; font-family: 'DM Sans'; cursor: pointer;"
                  [style.opacity]="hiddenSensors().size === 0 ? 0.5 : 1"
                >
                  <span class="material-symbols-outlined text-[12px]">visibility</span>
                  Mostrar todos
                </button>
                <button
                  (click)="hideAll()"
                  [disabled]="hiddenSensors().size === sensors().length"
                  class="flex items-center gap-1"
                  style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 6px; padding: 5px 10px; font-size: 11px; color: #475569; font-family: 'DM Sans'; cursor: pointer;"
                  [style.opacity]="hiddenSensors().size === sensors().length ? 0.5 : 1"
                >
                  <span class="material-symbols-outlined text-[12px]">visibility_off</span>
                  Ocultar todos
                </button>
              </div>
            </div>

            <div
              class="grid gap-2.5"
              style="grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));"
            >
              @for (tap of taps; track tap) {
                @if ((groupedSensors()[tap] || []).length > 0) {
                  <div
                    style="border: 1px solid #E2E8F0; border-radius: 10px; overflow: hidden; background: #FFFFFF;"
                  >
                    <button
                      (click)="toggleTap(tap)"
                      class="flex w-full items-center justify-between gap-2"
                      style="padding: 10px 12px; background: #F8FAFC; border: none; border-bottom: 1px solid #E2E8F0; cursor: pointer; font-family: 'DM Sans';"
                    >
                      <div class="flex items-center gap-2">
                        <span
                          style="width: 10px; height: 10px; border-radius: 50%;"
                          [style.background]="tapColors[tap]"
                          [style.box-shadow]="'0 0 0 3px ' + tapColors[tap] + '22'"
                        ></span>
                        <span
                          style="font-family: 'Josefin Sans'; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: #1E293B;"
                          >{{ tap }}</span
                        >
                        <span
                          style="font-family: 'JetBrains Mono'; font-size: 10px; color: #94A3B8;"
                          >{{ (groupedSensors()[tap] || []).length }} sensores</span
                        >
                      </div>
                      <span
                        class="flex items-center gap-1"
                        style="font-size: 11px; color: #475569;"
                      >
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
                    <div class="flex flex-col" style="padding: 6px;">
                      @for (s of groupedSensors()[tap] || []; track s.id) {
                        <label
                          class="flex cursor-pointer items-center gap-2"
                          style="padding: 6px 8px; border-radius: 6px;"
                          [style.opacity]="isSensorHidden(s.id) ? 0.55 : 1"
                          onmouseover="this.style.background='#F8FAFC'"
                          onmouseout="this.style.background='transparent'"
                        >
                          <input
                            type="checkbox"
                            [checked]="!isSensorHidden(s.id)"
                            (change)="toggleSensor(s.id)"
                            style="width: 14px; height: 14px; accent-color: #0DAFBD; cursor: pointer;"
                          />
                          <span
                            style="font-family: 'JetBrains Mono'; font-size: 10.5px; background: #F1F5F9; border: 1px solid #E2E8F0; border-radius: 4px; padding: 1px 5px; color: #475569; font-weight: 600;"
                            >{{ s.id }}</span
                          >
                          <span
                            class="flex-1 truncate"
                            style="font-family: 'DM Sans'; font-size: 12px; color: #1E293B;"
                            >{{ s.area }}</span
                          >
                          @if (s.alerted) {
                            <span
                              style="width: 6px; height: 6px; border-radius: 50%; background: #EF4444; box-shadow: 0 0 0 2px rgba(239,68,68,0.25);"
                            ></span>
                          }
                          <span
                            style="font-family: 'JetBrains Mono'; font-size: 10.5px; color: #64748B;"
                            >{{ fmtTemp(s.t) }}</span
                          >
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
              <h2
                class="text-slate-800"
                style="font-family: 'Josefin Sans'; font-size: 22px; font-weight: 700; letter-spacing: 0.02em; line-height: 1.1;"
              >
                Concentradores TAP
              </h2>
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

          <div
            class="grid gap-3"
            style="grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));"
          >
            @for (t of tapAggregates(); track t.tap) {
              <button
                type="button"
                [routerLink]="['/ventisqueros/tap', t.tap.replace(' ', '-')]"
                class="group flex w-full cursor-pointer flex-col rounded-2xl border bg-white px-4 py-4 text-left transition-all duration-200 hover:-translate-y-0.5"
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
                      <h3
                        class="truncate font-bold text-slate-800"
                        style="font-family: 'Josefin Sans'; font-size: 15px; letter-spacing: 0.02em;"
                      >
                        {{ t.tap }}
                      </h3>
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
                    <p class="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                      Prom.
                    </p>
                    <p
                      class="text-slate-800"
                      style="font-family: 'JetBrains Mono'; font-size: 14px; font-weight: 700;"
                    >
                      {{ t.avgT }}<span class="text-[10px] text-slate-500">°C</span>
                    </p>
                  </div>
                  <div>
                    <p class="text-[9px] font-bold uppercase tracking-wider text-slate-400">Mín</p>
                    <p
                      style="font-family: 'JetBrains Mono'; font-size: 14px; font-weight: 700; color: #0DAFBD;"
                    >
                      {{ t.minT }}<span class="text-[10px] text-slate-500">°C</span>
                    </p>
                  </div>
                  <div>
                    <p class="text-[9px] font-bold uppercase tracking-wider text-slate-400">Máx</p>
                    <p
                      style="font-family: 'JetBrains Mono'; font-size: 14px; font-weight: 700;"
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
                        class="inline-block h-1.5 w-1.5 rounded-full bg-rose-500"
                        style="animation: vsPulse 1.4s ease-out infinite;"
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
                    <span class="text-[10px] text-slate-400" style="font-family: 'JetBrains Mono';">
                      HR {{ t.avgH }}%
                    </span>
                  }
                </div>
              </button>
            }
          </div>
        }

        @if (activeTab() === 'eventos') {
          <div
            class="flex items-center justify-center"
            style="height: 320px; background: #FFFFFF; border: 1px dashed #E2E8F0; border-radius: 12px; color: #94A3B8; font-family: 'DM Sans'; font-size: 13px;"
          >
            Eventos — vista por implementar
          </div>
        }

        @if (activeTab() === 'contacts') {
          <div
            class="flex items-center justify-center"
            style="height: 320px; background: #FFFFFF; border: 1px dashed #E2E8F0; border-radius: 12px; color: #94A3B8; font-family: 'DM Sans'; font-size: 13px;"
          >
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
