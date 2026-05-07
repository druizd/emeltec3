import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of, Subscription, switchMap, timer } from 'rxjs';
import { CompanyService } from '../../services/company.service';
import { CompaniesSiteDetailSkeletonComponent } from './components/companies-site-detail-skeleton';

interface SiteContext {
  company: any;
  subCompany: any;
  site: any;
}

interface HistoricalTelemetryValue {
  ok?: boolean;
  valor?: string | number | null;
  unidad?: string | null;
  alias?: string | null;
}

interface HistoricalTelemetryApiRow {
  timestamp?: string | null;
  fecha: string;
  caudal?: HistoricalTelemetryValue | null;
  totalizador?: HistoricalTelemetryValue | null;
  nivel_freatico?: HistoricalTelemetryValue | null;
}

interface HistoricalTelemetryRow {
  id: string;
  fecha: string;
  caudal: string;
  totalizador: string;
  nivelFreatico: string;
  mock?: boolean;
}

interface MonthlyFlowPoint {
  label: string;
  value: number;
}

interface DashboardVariable {
  key?: string | null;
  alias?: string | null;
  rol_dashboard?: string | null;
  transformacion?: string | null;
  unidad?: string | null;
  ok?: boolean;
  valor?: string | number | null;
}

interface SiteDashboardData {
  pozo_config?: {
    profundidad_pozo_m?: number | string | null;
    profundidad_sensor_m?: number | string | null;
  } | null;
  resumen?: Record<string, { valor?: string | number | null; ok?: boolean; unidad?: string | null } | undefined>;
  variables?: DashboardVariable[];
}

type DetailTab = 'dga' | 'historico' | 'operacion';
type OperationMode = 'realtime' | 'turnos';

@Component({
  selector: 'app-company-site-water-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, CompaniesSiteDetailSkeletonComponent],
  template: `
    <div class="min-h-full bg-[#f4f7fb] px-3 pb-5 pt-3 text-slate-700 md:px-4 xl:px-5">
      @if (loading() && !siteContext()) {
        <app-companies-site-detail-skeleton />
      } @else if (siteContext(); as context) {
        <div class="mx-auto max-w-[1360px] space-y-3">
          <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div class="flex flex-col gap-3 border-b border-slate-100 px-3 py-2 xl:flex-row xl:items-center xl:justify-between">
              <div class="flex min-w-0 items-center gap-2.5">
                <a
                  routerLink="/companies"
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-100 bg-cyan-50 text-cyan-700 transition-colors hover:bg-cyan-100"
                  aria-label="Volver a instalaciones"
                >
                  <span class="material-symbols-outlined text-[20px]">water_drop</span>
                </a>

                <div class="min-w-0">
                  <h1 class="truncate text-lg font-black text-slate-800">{{ getSiteName(context) }}</h1>
                  <p class="truncate text-[11px] font-semibold text-slate-400">{{ context.subCompany.nombre }}</p>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-emerald-700">
                  <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                  hace 0 segundos
                </span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-blue-700">
                  <span class="material-symbols-outlined text-[15px]">schedule</span>
                  26 abr 2026, 22:23
                </span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-emerald-700">
                  <span class="material-symbols-outlined text-[15px]">verified</span>
                  Reporte DGA · Aceptado · 17:00
                </span>
                <span class="ml-2 text-slate-400">Desde</span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-600">
                  <span class="material-symbols-outlined text-[15px]">calendar_month</span>
                  25-04-2026
                </span>
                <span class="text-slate-400">Hasta</span>
                <span class="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-600">
                  <span class="material-symbols-outlined text-[15px]">calendar_month</span>
                  26-04-2026
                </span>
                <button
                  type="button"
                  class="h-7 rounded-lg bg-cyan-600 px-3 text-[10px] font-black uppercase tracking-wide text-white transition-colors hover:bg-cyan-700"
                >
                  Aplicar
                </button>
                <button
                  type="button"
                  class="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
                  aria-label="Configuracion"
                >
                  <span class="material-symbols-outlined text-[18px]">settings</span>
                </button>
              </div>
            </div>

            <div class="flex items-center gap-5 px-3">
              <button
                type="button"
                (click)="setDetailTab('dga')"
                [class]="getDetailTabClass('dga')"
              >
                <span class="material-symbols-outlined text-[18px]">layers</span>
                DGA
                @if (activeDetailTab() === 'dga') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600"></span>
                }
              </button>
              <button
                type="button"
                (click)="setDetailTab('operacion')"
                [class]="getDetailTabClass('operacion')"
              >
                <span class="material-symbols-outlined text-[18px]">monitoring</span>
                Operación
                @if (activeDetailTab() === 'operacion') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600"></span>
                }
              </button>
              <button
                type="button"
                (click)="setDetailTab('historico')"
                [class]="getDetailTabClass('historico')"
              >
                <span class="material-symbols-outlined text-[18px]">database</span>
                Datos Historicos
                @if (activeDetailTab() === 'historico') {
                  <span class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cyan-600"></span>
                }
              </button>
            </div>
          </section>

          @if (activeDetailTab() === 'dga') {
            <section class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
            <article class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">Enviados</p>
              <p class="mt-1 text-3xl font-black leading-none text-emerald-600">622</p>
              <p class="mt-1 text-xs font-semibold text-emerald-500">registros exitosos</p>
            </article>

            <article class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Último envío</p>
              <p class="mt-1 text-lg font-black leading-none text-slate-800">26 abr 2026</p>
              <p class="mt-1 text-xs font-semibold text-slate-500">21:00</p>
            </article>

            <article class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Tasa de exito</p>
              <p class="mt-1 text-3xl font-black leading-none text-slate-800">100%</p>
            </article>

            <article class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center shadow-sm">
              <p class="text-[10px] font-black uppercase tracking-[0.2em] text-rose-400">Rechazados</p>
              <p class="mt-1 text-3xl font-black leading-none text-rose-500">0</p>
              <p class="mt-1 text-xs font-semibold text-rose-400">por la DGA</p>
            </article>
          </section>

          <section class="grid grid-cols-1 gap-3 xl:grid-cols-[520px_minmax(0,1fr)]">
            <article class="rounded-xl border border-cyan-200 bg-white p-3 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]">
              <p class="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Diagrama del pozo</p>

              @if (dashboardLoading()) {
                <div class="flex min-h-[360px] items-center justify-center rounded-lg border border-slate-100 bg-slate-50">
                  <div class="text-center">
                    <span class="material-symbols-outlined animate-spin text-[32px] text-cyan-600">progress_activity</span>
                    <p class="mt-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">Cargando datos del pozo</p>
                  </div>
                </div>
              } @else {
                <div class="grid grid-cols-[minmax(0,1fr)_128px] gap-5">
                  <div class="relative h-[300px] overflow-hidden rounded-lg border border-slate-100 bg-[#eee7d8]">
                    <div class="absolute inset-0 opacity-40" style="background-image: radial-gradient(#c6b58f 1px, transparent 1px); background-size: 8px 8px;"></div>
                    <div class="absolute left-[31%] top-8 h-[238px] w-[12px] rounded-sm bg-slate-300"></div>
                    <div class="absolute left-[38%] top-8 h-[238px] w-[112px] border-x-4 border-slate-500 bg-white/80"></div>
                    <div
                      class="dga-water-column absolute bottom-0 left-[38%] w-[112px] overflow-hidden border-x-4 border-slate-500 bg-gradient-to-b from-cyan-300 via-cyan-500 to-cyan-800"
                      [style.height.px]="wellWaterColumnHeightPx()"
                    >
                      <div class="dga-water-wave dga-water-wave-a"></div>
                      <div class="dga-water-wave dga-water-wave-b"></div>
                      <div class="dga-water-shine"></div>
                    </div>
                    <div class="absolute left-[16%] top-[112px] w-[215px] border-t-2 border-dashed border-cyan-600"></div>
                    <div class="absolute left-5 top-[100px] text-[10px] font-black text-cyan-700">Nivel<br>Freatico</div>
                    <div class="absolute bottom-[116px] left-[57%] z-10 text-2xl font-black text-white drop-shadow-sm">{{ formatPercent(wellFillPercentage()) }}</div>
                    <div class="absolute right-4 top-8 text-[10px] font-bold text-slate-500">Superficie</div>
                    <div class="absolute bottom-7 right-5 flex items-center gap-1 text-[10px] font-bold text-orange-500">
                      <span class="h-2.5 w-2.5 rounded-sm bg-orange-500"></span>
                      Sensor
                    </div>
                  </div>

                  <div class="space-y-3">
                    <div class="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
                      <p class="text-[10px] font-black uppercase tracking-widest text-cyan-500">Nivel freatico</p>
                      <p class="mt-1 text-2xl font-black leading-none text-cyan-700">{{ formatMeters(wellNivelFreatico()) }}<span class="text-base"> m</span></p>
                      <p class="mt-1 text-[10px] font-semibold text-cyan-500">desde superficie</p>
                    </div>

                    <div class="rounded-xl border border-slate-200 bg-white p-3">
                      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Llenado</p>
                      <p class="mt-1 text-2xl font-black leading-none text-slate-800">{{ formatPercent(wellFillPercentage()) }}</p>
                      <div class="mt-2 h-1.5 rounded-full bg-slate-100">
                        <div class="h-full rounded-full bg-cyan-600 transition-all duration-700" [style.width.%]="wellFillStylePercent()"></div>
                      </div>
                    </div>

                    <div class="rounded-xl border border-slate-200 bg-white p-3">
                      <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">Prof. total</p>
                      <p class="mt-1 text-2xl font-black leading-none text-slate-800">{{ formatMeters(wellTotalDepth()) }}<span class="text-base"> m</span></p>
                    </div>

                    <div class="rounded-xl border border-orange-200 bg-orange-50 p-3">
                      <p class="text-[10px] font-black uppercase tracking-widest text-orange-500">Sensor</p>
                      <p class="mt-1 text-2xl font-black leading-none text-slate-800">{{ formatMeters(wellSensorDepth()) }}<span class="text-base"> m</span></p>
                    </div>
                  </div>
                </div>
              }
            </article>

            <div class="space-y-3">
              <article class="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex min-w-0 items-center gap-3">
                    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                      <span class="material-symbols-outlined text-[22px]">bar_chart</span>
                    </span>
                    <div class="min-w-0">
                      <h2 class="truncate text-xl font-black leading-none text-slate-800">Flujo Mensual</h2>
                      <p class="mt-1 text-sm font-bold text-slate-400">Volumen acumulado en m³</p>
                    </div>
                  </div>

                  <div class="flex items-center gap-3 text-xs font-bold text-slate-400">
                    <span class="inline-flex items-center gap-1.5">
                      <span class="material-symbols-outlined text-[16px]">info</span>
                      Últimos 12 meses
                    </span>
                    <button type="button" class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-slate-50" aria-label="Opciones de grafico">
                      <span class="material-symbols-outlined text-[18px]">more_vert</span>
                    </button>
                  </div>
                </div>

                <div class="mt-5 grid grid-cols-[58px_minmax(0,1fr)] gap-2">
                  <div class="grid h-[250px] grid-rows-5 text-right text-xs font-semibold text-slate-400">
                    @for (tick of monthlyFlowTicks; track tick) {
                      <span>{{ tick }}</span>
                    }
                  </div>

                  <div class="relative h-[250px] border-b border-l border-slate-200">
                    <div class="absolute inset-0 grid grid-rows-4">
                      <span class="border-t border-slate-200"></span>
                      <span class="border-t border-slate-200"></span>
                      <span class="border-t border-slate-200"></span>
                      <span class="border-t border-slate-200"></span>
                    </div>

                    <div class="absolute inset-x-2 bottom-0 top-0 flex items-end justify-between gap-2">
                      @for (month of monthlyFlowMonths; track month.label) {
                        <div class="flex h-full min-w-0 flex-1 flex-col justify-end">
                          <div
                            class="mx-auto w-full max-w-[28px] rounded-t bg-[#5874c8] shadow-sm transition-opacity hover:opacity-85"
                            [style.height.%]="getMonthlyFlowHeight(month.value)"
                            [title]="month.label + ': ' + formatMonthlyFlowValue(month.value) + ' m³'"
                          ></div>
                        </div>
                      }
                    </div>
                  </div>
                </div>

                <div class="ml-[66px] mt-2 flex justify-between gap-2 text-[11px] font-bold text-slate-400">
                  @for (month of monthlyFlowMonths; track month.label) {
                    <span class="block min-w-0 flex-1 origin-top-left truncate text-center" style="transform: rotate(-35deg);">{{ month.label }}</span>
                  }
                </div>
              </article>

              <article class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <p class="mb-2 text-sm font-black text-slate-700">Acciones Rápidas</p>
                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                  @for (action of quickActions; track action.title) {
                    <button
                      type="button"
                      (click)="handleQuickAction(action)"
                      class="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-all hover:border-cyan-200 hover:bg-white hover:shadow-sm"
                    >
                      <span [class]="'material-symbols-outlined text-[20px] ' + action.color">{{ action.icon }}</span>
                      <p class="mt-0.5 text-sm font-black text-slate-800">{{ action.title }}</p>
                      <p class="text-xs font-medium text-slate-400">{{ action.subtitle }}</p>
                    </button>
                  }
                </div>
              </article>
            </div>
          </section>

          } @else if (activeDetailTab() === 'historico') {
          <section class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
              <h2 class="text-sm font-black text-slate-800">Datos Historicos</h2>
              <p class="text-xs font-semibold text-slate-400">
                @if (historyLoading()) {
                  Actualizando registros...
                } @else if (isHistoryMock()) {
                  Vista referencial para pozos sin telemetria activa
                } @else {
                  {{ historyTotalRows() }} registros minuto a minuto
                }
              </p>
            </div>

            <div class="overflow-x-auto">
              <table class="w-full min-w-[820px] text-left text-xs">
                <thead class="bg-slate-50">
                  <tr class="text-[11px] font-black uppercase tracking-[0.16em] text-slate-400">
                    <th class="px-4 py-2.5">FECHA</th>
                    <th class="px-4 py-2.5">CAUDAL</th>
                    <th class="px-4 py-2.5">TOTALIZADOR</th>
                    <th class="px-4 py-2.5">NIVEL FRE&Aacute;TICO</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of paginatedHistoryRows(); track row.id) {
                    <tr class="border-t border-slate-100 font-mono text-[12px] text-slate-600">
                      <td class="px-4 py-2">{{ row.fecha }}</td>
                      <td class="px-4 py-2">{{ row.caudal }}</td>
                      <td class="px-4 py-2">{{ row.totalizador }}</td>
                      <td class="px-4 py-2">{{ row.nivelFreatico }}</td>
                    </tr>
                  } @empty {
                    <tr class="border-t border-slate-100 text-[12px] font-semibold text-slate-400">
                      <td class="px-4 py-5 text-center" colspan="4">Sin registros disponibles para este pozo.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

            <div class="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs font-semibold text-slate-400">
              <span>Filas por pagina: 50 &middot; {{ historyRangeStart() }}-{{ historyRangeEnd() }} de {{ historyTotalRows() }}</span>
              <div class="flex gap-2">
                <button
                  type="button"
                  (click)="previousHistoryPage()"
                  [disabled]="historyPage() === 1"
                  class="h-7 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  &larr;
                </button>
                <button
                  type="button"
                  (click)="nextHistoryPage()"
                  [disabled]="historyPage() === historyTotalPages()"
                  class="h-7 w-8 rounded-lg border border-slate-200 bg-white text-slate-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  &rarr;
                </button>
              </div>
            </div>
            </section>
          } @else {
            <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div class="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    (click)="setOperationMode('realtime')"
                    [class]="getOperationModeClass('realtime')"
                  >
                    <span class="material-symbols-outlined text-[17px]">sync</span>
                    Tiempo Real
                  </button>
                  <button
                    type="button"
                    (click)="setOperationMode('turnos')"
                    [class]="getOperationModeClass('turnos')"
                  >
                    <span class="material-symbols-outlined text-[17px]">schedule</span>
                    Operación por Turnos
                  </button>
                </div>

                <p class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400">
                  <span class="material-symbols-outlined text-[15px]">help</span>
                  La visualización puede presentar variaciones o desfases momentáneos en los datos.
                </p>
              </div>

              <div class="p-4">
                @if (operationMode() === 'realtime') {
                  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                    <div class="rounded-xl bg-gradient-to-r from-[#0797ad] to-[#18bfd0] p-4 text-white shadow-sm">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="flex items-baseline gap-3">
                          <h2 class="text-sm font-black">Datos en tiempo real</h2>
                          <span class="text-xs font-semibold text-cyan-100">(actualización cada minuto)</span>
                        </div>
                        <span class="inline-flex items-center gap-2 text-xs font-bold text-cyan-50">
                          <span class="h-2 w-2 rounded-full bg-emerald-300"></span>
                          06/05/2026 09:37
                        </span>
                      </div>

                      <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                        @for (metric of realtimeMetrics; track metric.label) {
                          <article class="rounded-lg bg-white/12 px-4 py-3 ring-1 ring-white/10">
                            <p class="text-xs font-bold text-cyan-100">{{ metric.label }}</p>
                            <p class="mt-1 text-2xl font-black leading-none">
                              {{ metric.value }}
                              <span class="text-sm font-bold">{{ metric.unit }}</span>
                            </p>
                          </article>
                        }
                      </div>
                    </div>

                    <article class="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                      <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-black text-slate-800">Caudal en Tiempo Real</h3>
                        <p class="text-xs font-semibold text-slate-400">Últimos 60 registros</p>
                      </div>

                      <div class="mt-4 h-[310px] w-full overflow-hidden rounded-lg border border-slate-100 bg-white">
                        <svg viewBox="0 0 1120 260" class="h-full w-full" role="img" aria-label="Gráfico visual de caudal en tiempo real">
                          <g class="text-slate-200" stroke="currentColor" stroke-width="1">
                            <line x1="70" y1="26" x2="1070" y2="26" />
                            <line x1="70" y1="78" x2="1070" y2="78" />
                            <line x1="70" y1="130" x2="1070" y2="130" />
                            <line x1="70" y1="182" x2="1070" y2="182" />
                            <line x1="70" y1="234" x2="1070" y2="234" />
                            <line x1="180" y1="26" x2="180" y2="234" />
                            <line x1="335" y1="26" x2="335" y2="234" />
                            <line x1="490" y1="26" x2="490" y2="234" />
                            <line x1="645" y1="26" x2="645" y2="234" />
                            <line x1="800" y1="26" x2="800" y2="234" />
                            <line x1="955" y1="26" x2="955" y2="234" />
                          </g>

                          <g class="text-slate-400" fill="currentColor" font-size="14" font-weight="700">
                            <text x="18" y="31">46.7</text>
                            <text x="18" y="83">46.65</text>
                            <text x="18" y="135">46.6</text>
                            <text x="18" y="187">46.55</text>
                            <text x="18" y="239">46.5</text>
                            <text x="78" y="254">08:40</text>
                            <text x="250" y="254">08:45</text>
                            <text x="420" y="254">08:50</text>
                            <text x="590" y="254">09:00</text>
                            <text x="760" y="254">09:10</text>
                            <text x="930" y="254">09:25</text>
                          </g>

                          <polyline
                            points="70,26 88,26 105,78 122,26 140,26 157,130 174,130 192,130 209,130 226,26 244,130 261,26 278,26 296,130 313,130 330,130 348,130 365,26 382,130 400,130 417,26 434,130 452,130 469,130 486,26 504,130 521,26 538,130 556,130 573,130 590,130 608,182 625,130 642,182 660,130 677,130 694,130 712,26 729,130 746,130 764,130 781,130 798,26 816,130 833,130 850,26 868,26 885,26 902,130 920,130 937,130 954,130 972,130 989,234 1006,130 1024,130 1041,130 1058,234 1070,26"
                            fill="none"
                            stroke="#5f7fd4"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="3"
                          />
                        </svg>
                      </div>
                    </article>
                  </div>
                } @else {
                  <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_28px_rgba(15,23,42,0.05)]">
                    <div class="rounded-xl border border-slate-200 bg-slate-50 px-5 py-10 text-center">
                      <span class="material-symbols-outlined text-4xl text-cyan-600">schedule</span>
                      <h2 class="mt-2 text-lg font-black text-slate-800">Operación por Turnos</h2>
                      <p class="mx-auto mt-1 max-w-xl text-sm font-semibold text-slate-400">
                        Esta vista queda preparada para separar horas operativas, pausas y comparativas por turno cuando conectemos los datos reales.
                      </p>
                    </div>
                  </div>
                }
              </div>
            </section>
          }
        </div>
      } @else {
        <div class="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          No se encontro la instalacion solicitada.
        </div>
      }
    </div>
  `,
  styles: [`
    @keyframes dga-wave-drift {
      from { transform: translateX(-28%) rotate(0deg); }
      to { transform: translateX(2%) rotate(0deg); }
    }

    @keyframes dga-wave-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(4px); }
    }

    @keyframes dga-shine {
      0% { transform: translateX(-110%); opacity: 0; }
      35% { opacity: 0.35; }
      70% { opacity: 0.12; }
      100% { transform: translateX(130%); opacity: 0; }
    }

    .dga-water-column {
      animation: dga-wave-bob 4.2s ease-in-out infinite;
    }

    .dga-water-wave {
      position: absolute;
      left: -42%;
      top: -18px;
      width: 184%;
      height: 36px;
      border-radius: 48%;
      pointer-events: none;
    }

    .dga-water-wave-a {
      background: rgba(165, 243, 252, 0.82);
      animation: dga-wave-drift 5.6s linear infinite;
    }

    .dga-water-wave-b {
      top: -11px;
      background: rgba(34, 211, 238, 0.34);
      animation: dga-wave-drift 4.1s linear infinite reverse;
    }

    .dga-water-shine {
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.38) 48%, transparent 76%);
      animation: dga-shine 5.8s ease-in-out infinite;
      pointer-events: none;
    }
  `],
})
export class CompanySiteWaterDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly companyService = inject(CompanyService);
  private historyPollingSub?: Subscription;
  private readonly historyFetchLimit = 500;

  siteContext = signal<SiteContext | null>(null);
  loading = signal(true);
  dashboardLoading = signal(true);
  dashboardError = signal('');
  dashboardData = signal<SiteDashboardData | null>(null);
  activeDetailTab = signal<DetailTab>('dga');
  operationMode = signal<OperationMode>('realtime');
  historyLoading = signal(true);
  historyError = signal('');
  historyRows = signal<HistoricalTelemetryRow[]>([]);
  historyPage = signal(1);
  readonly historyPageSize = 50;

  wellNivelFreatico = computed(() => this.extractNivelFreatico(this.dashboardData()));
  wellTotalDepth = computed(() => this.extractPozoNumber('profundidad_pozo_m'));
  wellSensorDepth = computed(() => this.extractPozoNumber('profundidad_sensor_m'));
  wellFillPercentage = computed(() => {
    const totalDepth = this.wellTotalDepth();
    const nivelFreatico = this.wellNivelFreatico();

    if (totalDepth === null || nivelFreatico === null || totalDepth <= 0) {
      return null;
    }

    return Math.round(this.clamp(((totalDepth - nivelFreatico) / totalDepth) * 100, 0, 100));
  });
  wellFillStylePercent = computed(() => this.wellFillPercentage() ?? 0);
  wellWaterColumnHeightPx = computed(() => Math.round(238 * (this.wellFillStylePercent() / 100)));
  historySourceRows = computed(() => {
    if (this.historyRows().length) return this.historyRows();
    return this.historyLoading() ? [] : this.historyMockRows;
  });
  paginatedHistoryRows = computed(() => {
    const start = (this.historyPage() - 1) * this.historyPageSize;
    return this.historySourceRows().slice(start, start + this.historyPageSize);
  });
  historyTotalRows = computed(() => this.historySourceRows().length);
  historyTotalPages = computed(() => Math.max(1, Math.ceil(this.historyTotalRows() / this.historyPageSize)));
  historyRangeStart = computed(() => this.historyTotalRows() ? ((this.historyPage() - 1) * this.historyPageSize) + 1 : 0);
  historyRangeEnd = computed(() => Math.min(this.historyPage() * this.historyPageSize, this.historyTotalRows()));
  isHistoryMock = computed(() => !this.historyLoading() && this.historyRows().length === 0);

  readonly monthlyFlowTicks = ['120,000', '90,000', '60,000', '30,000', '0'];

  readonly monthlyFlowMonths: MonthlyFlowPoint[] = [
    { label: "Jun '25", value: 76000 },
    { label: "Jul '25", value: 45000 },
    { label: "Ago '25", value: 60000 },
    { label: "Sep '25", value: 81000 },
    { label: "Oct '25", value: 90000 },
    { label: "Nov '25", value: 80000 },
    { label: "Dic '25", value: 110000 },
    { label: "Ene '26", value: 86000 },
    { label: "Feb '26", value: 48000 },
    { label: "Mar '26", value: 73000 },
    { label: "Abr '26", value: 12000 },
    { label: "May '26", value: 0 },
  ];

  readonly quickActions = [
    { icon: 'database', title: 'Datos Historicos', subtitle: 'Ver registros', color: 'text-cyan-600', tab: 'historico' as DetailTab },
    { icon: 'download', title: 'Descargar', subtitle: 'Exportar Excel', color: 'text-emerald-600' },
    { icon: 'open_in_new', title: 'Ver en DGA', subtitle: 'Portal oficial', color: 'text-blue-600' },
    { icon: 'description', title: 'Reporte DGA', subtitle: 'Formato oficial', color: 'text-violet-600' },
  ];

  readonly realtimeMetrics = [
    { label: 'Caudal Actual', value: '46.60', unit: 'L/s' },
    { label: 'Totalizador', value: '6,043,415', unit: 'm³' },
    { label: 'Nivel de Agua', value: '27.20', unit: 'm' },
    { label: 'Consumo Hoy', value: '0.0', unit: 'm³' },
  ];

  readonly historyMockRows: HistoricalTelemetryRow[] = [
    { id: 'mock-2026-04-01-06-00', fecha: '01/04/2026 06:00', caudal: '0', totalizador: '531.100', nivelFreatico: '1.6', mock: true },
    { id: 'mock-2026-04-01-05-00', fecha: '01/04/2026 05:00', caudal: '19.75', totalizador: '531.060,063', nivelFreatico: '3.3', mock: true },
    { id: 'mock-2026-04-01-04-00', fecha: '01/04/2026 04:00', caudal: '0', totalizador: '531.038,375', nivelFreatico: '1.5', mock: true },
    { id: 'mock-2026-04-01-03-00', fecha: '01/04/2026 03:00', caudal: '19.75', totalizador: '531.009,375', nivelFreatico: '3.3', mock: true },
    { id: 'mock-2026-04-01-02-00', fecha: '01/04/2026 02:00', caudal: '19.63', totalizador: '530.986,75', nivelFreatico: '3.4', mock: true },
    { id: 'mock-2026-04-01-01-00', fecha: '01/04/2026 01:00', caudal: '19.88', totalizador: '530.956,188', nivelFreatico: '3.1', mock: true },
    { id: 'mock-2026-04-01-00-00', fecha: '01/04/2026 00:00', caudal: '0', totalizador: '530.921,625', nivelFreatico: '1.5', mock: true },
    { id: 'mock-2026-03-31-23-00', fecha: '31/03/2026 23:00', caudal: '19.75', totalizador: '530.900,188', nivelFreatico: '3.4', mock: true },
    { id: 'mock-2026-03-31-22-00', fecha: '31/03/2026 22:00', caudal: '19.75', totalizador: '530.858,938', nivelFreatico: '3.5', mock: true },
    { id: 'mock-2026-03-31-21-00', fecha: '31/03/2026 21:00', caudal: '19.75', totalizador: '530.806,375', nivelFreatico: '3.2', mock: true },
  ];

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');

    if (!siteId) {
      this.router.navigate(['/companies']);
      return;
    }

    this.loadDashboardData(siteId);
    this.startHistoryPolling(siteId);

    this.companyService.fetchHierarchy().subscribe({
      next: (res: any) => {
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
        this.loadHydratedSite(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  ngOnDestroy(): void {
    this.historyPollingSub?.unsubscribe();
  }

  getSiteName(context: SiteContext): string {
    return context.site?.descripcion || context.subCompany?.nombre || 'Instalacion de agua';
  }

  getMonthlyFlowHeight(value: number): number {
    const max = 120000;
    return Math.max(0, Math.min(100, (value / max) * 100));
  }

  formatMonthlyFlowValue(value: number): string {
    return new Intl.NumberFormat('es-CL').format(value);
  }

  formatMeters(value: number | null): string {
    if (value === null) return '--';
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/(\.\d*?)0+$/, '$1');
  }

  formatPercent(value: number | null): string {
    return value === null ? '--%' : `${value}%`;
  }

  setDetailTab(tab: DetailTab): void {
    this.activeDetailTab.set(tab);
  }

  setOperationMode(mode: OperationMode): void {
    this.operationMode.set(mode);
  }

  handleQuickAction(action: { tab?: DetailTab }): void {
    if (action.tab) {
      this.setDetailTab(action.tab);
    }
  }

  previousHistoryPage(): void {
    this.historyPage.set(Math.max(1, this.historyPage() - 1));
  }

  nextHistoryPage(): void {
    this.historyPage.set(Math.min(this.historyTotalPages(), this.historyPage() + 1));
  }

  getDetailTabClass(tab: DetailTab): string {
    const active = this.activeDetailTab() === tab;
    const base = 'relative inline-flex h-9 items-center gap-2 text-xs transition-colors';
    return active
      ? `${base} font-black text-cyan-700`
      : `${base} font-bold text-slate-500 hover:text-slate-700`;
  }

  getOperationModeClass(mode: OperationMode): string {
    const active = this.operationMode() === mode;
    const base = 'inline-flex h-11 items-center gap-2 border-b-2 px-5 text-sm transition-colors';
    return active
      ? `${base} border-cyan-500 bg-cyan-50 font-black text-cyan-700`
      : `${base} border-transparent font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-700`;
  }

  private loadHydratedSite(match: SiteContext): void {
    this.companyService.getSites(match.subCompany.id).subscribe({
      next: (json: any) => {
        const hydratedSite = json.ok
          ? (json.data || []).find((site: any) => site.id === match.site.id)
          : null;

        this.siteContext.set({
          ...match,
          site: {
            ...match.site,
            ...(hydratedSite || {}),
          },
        });
        this.loading.set(false);
      },
      error: () => {
        this.siteContext.set(match);
        this.loading.set(false);
      },
    });
  }

  private loadDashboardData(siteId: string): void {
    this.dashboardLoading.set(true);
    this.dashboardError.set('');

    this.companyService.getSiteDashboardData(siteId).subscribe({
      next: (res: any) => {
        const payload = res?.ok === false ? null : (res?.data || res || null);
        this.dashboardData.set(payload);
        this.dashboardError.set(payload ? '' : 'No fue posible cargar datos del pozo.');
        this.dashboardLoading.set(false);
      },
      error: () => {
        this.dashboardData.set(null);
        this.dashboardError.set('No fue posible cargar datos del pozo.');
        this.dashboardLoading.set(false);
      },
    });
  }

  private startHistoryPolling(siteId: string): void {
    this.historyLoading.set(true);
    this.historyError.set('');
    this.historyPollingSub?.unsubscribe();

    this.historyPollingSub = timer(0, 60000).pipe(
      switchMap(() =>
        this.companyService.getSiteDashboardHistory(siteId, this.historyFetchLimit).pipe(
          catchError(() => {
            this.historyError.set('No fue posible cargar datos historicos.');
            this.historyLoading.set(false);
            return of(null);
          })
        )
      )
    ).subscribe((res: any) => {
      if (!res) return;

      const apiRows = this.extractHistoryApiRows(res);
      const mappedRows = apiRows
        .map((row) => this.mapHistoryApiRow(row))
        .filter((row): row is HistoricalTelemetryRow => row !== null);

      this.historyRows.set(mappedRows);
      this.historyError.set('');
      this.historyLoading.set(false);

      if (this.historyPage() > this.historyTotalPages()) {
        this.historyPage.set(this.historyTotalPages());
      }
    });
  }

  private extractHistoryApiRows(res: any): HistoricalTelemetryApiRow[] {
    if (res?.ok === false) return [];
    const rows = res?.data?.rows || res?.data || [];
    return Array.isArray(rows) ? rows : [];
  }

  private mapHistoryApiRow(row: HistoricalTelemetryApiRow): HistoricalTelemetryRow | null {
    const fecha = String(row?.fecha || row?.timestamp || '').trim();
    if (!fecha) return null;

    return {
      id: String(row.timestamp || fecha),
      fecha,
      caudal: this.formatHistoricalValue(row.caudal),
      totalizador: this.formatHistoricalValue(row.totalizador),
      nivelFreatico: this.formatHistoricalValue(row.nivel_freatico),
    };
  }

  private formatHistoricalValue(value: HistoricalTelemetryValue | null | undefined): string {
    if (!value || value.ok === false || value.valor === null || value.valor === undefined || value.valor === '') {
      return '--';
    }

    const numericValue = this.toNumber(value.valor);

    if (numericValue === null) {
      return String(value.valor);
    }

    return new Intl.NumberFormat('es-CL', {
      maximumFractionDigits: 3,
    }).format(numericValue);
  }

  private findAccessibleSite(tree: any[], siteId: string): SiteContext | null {
    for (const company of tree || []) {
      for (const subCompany of company.subCompanies || []) {
        const site = (subCompany.sites || []).find((item: any) => item.id === siteId);
        if (site) {
          return { company, subCompany, site };
        }
      }
    }

    return null;
  }

  private extractNivelFreatico(data: SiteDashboardData | null): number | null {
    const variables = data?.variables || [];
    const fromSummary = this.toNumber(data?.resumen?.['nivel_freatico']?.valor);
    if (fromSummary !== null) return fromSummary;

    const fromVariables = variables.find((variable) => {
      if (variable.ok === false) return false;
      const text = this.normalizeSearchText(
        variable.key,
        variable.alias,
        variable.rol_dashboard,
        variable.transformacion
      );

      return text.includes('nivel freatico');
    });

    const derivedValue = this.toNumber(fromVariables?.valor);
    if (derivedValue !== null) return derivedValue;

    const sensorDepth = this.extractPozoNumber('profundidad_sensor_m');
    const sourceLevel = variables.find((variable) => {
      if (variable.ok === false) return false;
      const text = this.normalizeSearchText(variable.key, variable.alias, variable.rol_dashboard);
      return !text.includes('freatico') && (text.includes('nivel') || text.includes('level') || text.includes('sonda'));
    });
    const sourceLevelValue = this.toNumber(sourceLevel?.valor);

    if (sensorDepth !== null && sourceLevelValue !== null) {
      return Math.round((sensorDepth - sourceLevelValue) * 1000) / 1000;
    }

    return null;
  }

  private extractPozoNumber(key: 'profundidad_pozo_m' | 'profundidad_sensor_m'): number | null {
    const dataValue = this.toNumber(this.dashboardData()?.pozo_config?.[key]);
    if (dataValue !== null) return dataValue;

    const site = this.siteContext()?.site;
    return this.toNumber(site?.pozo_config?.[key]) ?? this.toNumber(site?.[key]);
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeSearchText(...values: Array<string | null | undefined>): string {
    return values
      .map((value) => String(value ?? '').trim())
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
