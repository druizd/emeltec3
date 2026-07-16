import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  HostListener,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { InlineErrorComponent } from '../../components/ui/inline-error';
import { WellDiagramSkeletonComponent } from '../../components/ui/well-diagram-skeleton';
import { KpiStripSkeletonComponent } from '../../components/ui/kpi-strip-skeleton';
import { ChartSkeletonComponent } from '../../components/ui/chart-skeleton';
import { TableSkeletonComponent } from '../../components/ui/table-skeleton';
import { WellStatCardComponent } from '../../components/ui/well-stat-card';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, of, Subscription, switchMap, timer } from 'rxjs';
import {
  CompanyService,
  type ContadorMensualPoint,
} from '../../services/company.service';
import { CompaniesSiteDetailSkeletonComponent } from './components/companies-site-detail-skeleton';
import { WaterDetailOperacionComponent } from './components/water-detail-operacion/water-detail-operacion';
import { WaterDetailAlertasComponent } from './components/water-detail-alertas/water-detail-alertas';
import { WaterDetailBitacoraComponent } from './components/water-detail-bitacora/water-detail-bitacora';
import { WaterDetailDescargaComponent } from './components/water-detail-descarga/water-detail-descarga';
import { WaterDetailDgaReporteComponent } from './components/water-detail-dga-reporte/water-detail-dga-reporte';
import { WaterDetailAnalisisComponent } from './components/water-detail-analisis/water-detail-analisis';
import { WaterDetailDgaComponent } from './components/water-detail-dga/water-detail-dga';
import { CHILE_TIME_ZONE } from '../../shared/timezone';
import { getSiteTypeUi, siteTypesForModule } from '../../shared/site-type-ui';
import { DgaGenerarReporteModalComponent } from './components/dga-generar-reporte-modal/dga-generar-reporte-modal';
import { SiteVariableSettingsPanelComponent } from './components/site-variable-settings-panel';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';
import type { ApiResponse, CompanyNode, SiteRecord } from '@emeltec/shared';
import { type SiteContext, findAccessibleSite } from '../../shared/site-context';

/**
 * Devuelve "YYYY-MM-DD" para hoy en zona Chile (UTC-4, fijo sin DST).
 */
function chileToday(): string {
  const d = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/**
 * Devuelve "YYYY-MM-01" del mes actual en zona Chile (UTC-4).
 */
function chileMonthStart(): string {
  const d = new Date(Date.now() - 4 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 8) + '01';
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
  nivel?: HistoricalTelemetryValue | null;
  totalizador?: HistoricalTelemetryValue | null;
  nivel_freatico?: HistoricalTelemetryValue | null;
}

interface HistoricalTelemetryRow {
  id: string;
  fecha: string;
  timestampMs?: number | null;
  caudal: string;
  nivel?: string;
  totalizador: string;
  nivelFreatico: string;
  caudalValue?: number | null;
  nivelValue?: number | null;
  totalizadorValue?: number | null;
  nivelFreaticoValue?: number | null;
  mock?: boolean;
}

interface MonthlyFlowPoint {
  label: string;
  value: number;
  proyeccion?: number | null;
}


interface RealtimeChartPoint {
  index: number;
  x: number;
  y: number;
  value: number;
  label: string;
  timestampMs: number;
}

interface RealtimeChartTick {
  x?: number;
  y?: number;
  label: string;
}

interface RealtimeChartTooltip {
  x: number;
  y: number;
  boxX: number;
  boxY: number;
  dateLabel: string;
  valueLabel: string;
}

interface RealtimeChartData {
  points: RealtimeChartPoint[];
  polyline: string;
  yTicks: RealtimeChartTick[];
  xTicks: RealtimeChartTick[];
  tooltip: RealtimeChartTooltip | null;
}

/**
 * Forma real que devuelve el endpoint de historial: el backend puede
 * responder con data paginada `{ rows, pagination }` o directamente con
 * el array de filas. `extractHistoryApiRows` normaliza ambas formas.
 */
type HistoryApiData =
  | { rows: HistoricalTelemetryApiRow[]; pagination?: { total?: number } }
  | HistoricalTelemetryApiRow[];

interface TelemetryStatusBadge {
  title: string;
  value: string;
  tone: 'ok' | 'warning' | 'empty';
  icon: string;
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
  server_time?: string | null;
  pozo_config?: {
    profundidad_pozo_m?: number | string | null;
    profundidad_sensor_m?: number | string | null;
  } | null;
  ultima_lectura?: {
    time?: string | null;
    timestamp_completo?: string | null;
    received_at?: string | null;
    id_serial?: string | null;
  } | null;
  resumen?: Record<
    string,
    { valor?: string | number | null; ok?: boolean; unidad?: string | null } | undefined
  >;
  variables?: DashboardVariable[];
}

type DetailTab = 'dga' | 'operacion' | 'alertas' | 'bitacora' | 'analisis';
type OperationMode = 'realtime' | 'turnos';

@Component({
  selector: 'app-company-site-water-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    A11yModule,
    CompaniesSiteDetailSkeletonComponent,
    WaterDetailOperacionComponent,
    WaterDetailAlertasComponent,
    WaterDetailBitacoraComponent,
    WaterDetailAnalisisComponent,
    WaterDetailDescargaComponent,
    WaterDetailDgaReporteComponent,
    WaterDetailDgaComponent,
    DgaGenerarReporteModalComponent,
    SiteVariableSettingsPanelComponent,
    InlineErrorComponent,
    WellDiagramSkeletonComponent,
    KpiStripSkeletonComponent,
    ChartSkeletonComponent,
    TableSkeletonComponent,
    WellStatCardComponent,
  ],
  template: `
    <div class="min-h-full bg-[#f0f2f5] px-3 pb-5 pt-3 text-slate-700 md:px-4 xl:px-5">
      @if (loading() && !siteContext()) {
        <app-companies-site-detail-skeleton />
      } @else if (siteContext(); as context) {
        <div class="anim-content-in mx-auto max-w-[1360px] space-y-3">
          <section
            class="rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
          >
            <div
              class="grid gap-3 border-b border-slate-100 px-3 py-3 xl:grid-cols-[minmax(360px,1fr)_auto] xl:items-center"
            >
              <div class="flex min-w-0 items-center gap-3">
                <a
                  routerLink="/companies"
                  class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-primary-tint-15 bg-primary-tint-08 text-primary-container transition-colors hover:bg-primary-tint-14"
                  aria-label="Volver a instalaciones"
                >
                  <span class="material-symbols-outlined text-[22px]">water_drop</span>
                </a>

                <div class="min-w-0">
                  <h1 class="truncate text-h5 font-semibold leading-tight text-slate-800">
                    {{ getSiteHeaderLabel(context) }}
                  </h1>
                  <p class="truncate text-caption-xs font-semibold text-slate-500">
                    {{ context.subCompany.nombre }}
                  </p>
                </div>
              </div>

              <div
                class="flex flex-wrap items-center gap-2 text-caption-xs font-bold xl:justify-end"
              >
                @for (badge of telemetryStatusBadges(); track badge.title) {
                  <span [class]="telemetryBadgeClass(badge.tone)">
                    <span [class]="telemetryBadgeIconClass(badge.tone)">{{ badge.icon }}</span>
                    <span class="grid leading-tight">
                      <span class="text-caption-xs font-semibold">{{ badge.title }}</span>
                      <span class="text-caption font-semibold">{{ badge.value }}</span>
                    </span>
                  </span>
                }

                @if (canEditSiteSettings()) {
                  <button
                    type="button"
                    (click)="openSettingsPanel()"
                    class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-primary-tint-30 hover:bg-primary-tint-08 hover:text-primary-container"
                    aria-label="Configuración del sitio"
                  >
                    <span class="material-symbols-outlined text-[18px]">settings</span>
                  </button>
                }
              </div>
            </div>

            <div
              class="flex items-center gap-5 px-3"
              role="tablist"
              aria-label="Pestañas de detalle del sitio"
              (keydown.arrowright)="cycleDetailTab(1); $event.preventDefault()"
              (keydown.arrowleft)="cycleDetailTab(-1); $event.preventDefault()"
              (keydown.home)="cycleDetailTab(0, 'first'); $event.preventDefault()"
              (keydown.end)="cycleDetailTab(0, 'last'); $event.preventDefault()"
            >
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('dga')"
                [class]="getDetailTabClass('dga')"
                [attr.aria-selected]="activeDetailTab() === 'dga'"
                id="tab-dga"
                aria-controls="tabpanel-dga"
                [attr.tabindex]="activeDetailTab() === 'dga' ? 0 : -1"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true">layers</span>
                DGA
                @if (activeDetailTab() === 'dga') {
                  <span
                    class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                    aria-hidden="true"
                  ></span>
                }
              </button>
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('operacion')"
                [class]="getDetailTabClass('operacion')"
                [attr.aria-selected]="activeDetailTab() === 'operacion'"
                id="tab-operacion"
                aria-controls="tabpanel-operacion"
                [attr.tabindex]="activeDetailTab() === 'operacion' ? 0 : -1"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                  >monitoring</span
                >
                Operación
                @if (activeDetailTab() === 'operacion') {
                  <span
                    class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                    aria-hidden="true"
                  ></span>
                }
              </button>
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('alertas')"
                [class]="getDetailTabClass('alertas')"
                [attr.aria-selected]="activeDetailTab() === 'alertas'"
                id="tab-alertas"
                aria-controls="tabpanel-alertas"
                [attr.tabindex]="activeDetailTab() === 'alertas' ? 0 : -1"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                  >notifications_active</span
                >
                Alertas
                @if (activeDetailTab() === 'alertas') {
                  <span
                    class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                    aria-hidden="true"
                  ></span>
                }
              </button>
              <button
                type="button"
                role="tab"
                (click)="setDetailTab('bitacora')"
                [class]="getDetailTabClass('bitacora')"
                [attr.aria-selected]="activeDetailTab() === 'bitacora'"
                id="tab-bitacora"
                aria-controls="tabpanel-bitacora"
                [attr.tabindex]="activeDetailTab() === 'bitacora' ? 0 : -1"
              >
                <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                  >menu_book</span
                >
                Bitácora
                @if (activeDetailTab() === 'bitacora') {
                  <span
                    class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                    aria-hidden="true"
                  ></span>
                }
              </button>
              @if (isSuperAdmin()) {
                <button
                  type="button"
                  role="tab"
                  (click)="setDetailTab('analisis')"
                  [class]="getDetailTabClass('analisis')"
                  [attr.aria-selected]="activeDetailTab() === 'analisis'"
                  id="tab-analisis"
                  aria-controls="tabpanel-analisis"
                  [attr.tabindex]="activeDetailTab() === 'analisis' ? 0 : -1"
                >
                  <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                    >insights</span
                  >
                  Análisis
                  <span
                    class="relative -mt-3 -ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-caption-xs font-semibold leading-none text-white shadow-sm"
                    title="Solo SuperAdmin"
                    aria-label="Solo SuperAdmin"
                  >
                    !
                  </span>
                  @if (activeDetailTab() === 'analisis') {
                    <span
                      class="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary"
                      aria-hidden="true"
                    ></span>
                  }
                </button>
              }
            </div>
          </section>

          @if (settingsPanelOpen()) {
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  (click)="closeSettingsPanel()"
                  class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                  aria-label="Volver al detalle del sitio"
                >
                  <span class="material-symbols-outlined text-[20px]">arrow_back</span>
                </button>
                <p class="text-caption font-semibold text-slate-500">Volver al detalle del sitio</p>
              </div>
              <app-site-variable-settings-panel
                [siteId]="context.site?.id || ''"
                [site]="context.site"
                [showDgaReporteButton]="true"
                (openDgaReporte)="abrirDgaReporteModal()"
                (variableMapChanged)="onVariableMapChanged()"
              />
            </div>
          } @else if (historyPanelOpen()) {
            <section
              class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
            >
              <div class="border-b border-slate-100 px-4 py-3">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div class="flex min-w-0 items-center gap-3">
                    <button
                      type="button"
                      (click)="closeHistoryView()"
                      class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                      aria-label="Volver al detalle del pozo"
                    >
                      <span class="material-symbols-outlined text-[20px]">arrow_back</span>
                    </button>
                    <span
                      class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-tint-08 text-primary-container"
                    >
                      <span class="material-symbols-outlined text-[22px]">database</span>
                    </span>
                    <div class="min-w-0">
                      <p class="truncate text-caption-xs font-bold text-slate-500">
                        Sitios / {{ context.subCompany.nombre }} / Datos Historicos
                      </p>
                      <h2 class="truncate text-h5 font-semibold leading-none text-slate-800">
                        {{ getSiteName(context) }}
                      </h2>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-2 text-caption font-bold">
                    <button
                      type="button"
                      (click)="openDownloadModal()"
                      class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-slate-600 transition-colors hover:bg-slate-50"
                    >
                      <span class="material-symbols-outlined text-[16px]">download</span>
                      Descargar
                    </button>
                    <button
                      type="button"
                      class="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50"
                      aria-label="Opciones de historico"
                    >
                      <span class="material-symbols-outlined text-[18px]">settings</span>
                    </button>
                  </div>
                </div>

                <div
                  class="mt-4 flex flex-wrap items-end gap-2 text-caption font-bold text-slate-500"
                >
                  <label class="grid gap-1">
                    <span>Desde</span>
                    <input
                      type="date"
                      min="2020-01-01"
                      [value]="historyDateFromInput()"
                      (input)="setHistoryDateFrom($event)"
                      class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    />
                  </label>
                  <label class="grid gap-1">
                    <span>Hasta</span>
                    <input
                      type="date"
                      min="2020-01-01"
                      [value]="historyDateToInput()"
                      (input)="setHistoryDateTo($event)"
                      class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    />
                  </label>
                  <button
                    type="button"
                    (click)="confirmHistoryDateRange()"
                    class="h-9 rounded-lg border border-primary-tint-55 bg-primary-tint-08 px-4 text-caption-xs font-semibold uppercase tracking-wide text-primary-container transition-colors hover:bg-primary-tint-15"
                  >
                    Confirmar
                  </button>
                  <button
                    type="button"
                    (click)="clearHistoryFilters()"
                    class="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-caption-xs font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
                  >
                    Limpiar
                  </button>
                </div>
                @if (historyDateRangeError()) {
                  <p class="mt-2 text-caption font-semibold text-rose-500">
                    {{ historyDateRangeError() }}
                  </p>
                }
              </div>

              <div
                class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3"
              >
                <div>
                  <h3 class="text-body-sm font-semibold text-slate-800">Datos Historicos</h3>
                  <p class="mt-0.5 text-caption font-semibold text-slate-500">
                    @if (historyLoading()) {
                      Actualizando registros...
                    } @else if (isHistoryMock()) {
                      Vista referencial para pozos sin telemetria activa
                    } @else {
                      Registros minuto a minuto
                    }
                  </p>
                </div>
                <p class="text-caption font-semibold text-slate-500">
                  {{ currentHistoryPageCount() }} registros en esta pagina
                </p>
              </div>

              <div class="overflow-x-auto">
                <table class="responsive-table w-full text-left text-caption md:min-w-[1040px]">
                  <thead class="bg-slate-50">
                    <tr
                      class="text-caption-xs font-semibold uppercase tracking-[0.16em] text-slate-400"
                    >
                      <th class="px-4 py-3">FECHA</th>
                      <th class="px-4 py-3">CAUDAL</th>
                      <th class="px-4 py-3">NIVEL</th>
                      <th class="px-4 py-3">TOTALIZADOR</th>
                      <th class="px-4 py-3">NIVEL FRE&Aacute;TICO</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of paginatedHistoryRows(); track row.id) {
                      <tr
                        class="border-t border-slate-100 text-body-sm font-semibold text-slate-600 odd:bg-white even:bg-slate-50/60"
                      >
                        <td class="px-4 py-3" data-label="Fecha">
                          <span class="inline-flex items-center gap-2">
                            <span class="h-1.5 w-1.5 rounded-full bg-primary/10"></span>
                            {{ row.fecha }}
                          </span>
                        </td>
                        <td class="px-4 py-3" data-label="Caudal">{{ row.caudal }}</td>
                        <td class="px-4 py-3" data-label="Nivel">{{ row.nivel || '--' }}</td>
                        <td class="px-4 py-3" data-label="Totalizador">{{ row.totalizador }}</td>
                        <td class="px-4 py-3" data-label="Nivel freático">
                          {{ row.nivelFreatico }}
                        </td>
                      </tr>
                    } @empty {
                      <tr
                        class="border-t border-slate-100 text-caption font-semibold text-slate-500"
                      >
                        <td class="px-4 py-8 text-center" colspan="5" data-label="">
                          Sin registros disponibles para este filtro.
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <div
                class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-caption font-semibold text-slate-500"
              >
                <span
                  >Filas por pagina: 50 &middot; {{ historyRangeStart() }}-{{
                    historyRangeEnd()
                  }}
                  de {{ historyTotalRows() }}</span
                >
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    (click)="previousHistoryPage()"
                    [disabled]="historyPage() === 1"
                    class="h-8 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    &larr;
                  </button>
                  <span class="min-w-16 text-center"
                    >Pag. {{ historyPage() }} / {{ historyTotalPages() }}</span
                  >
                  <button
                    type="button"
                    (click)="nextHistoryPage()"
                    [disabled]="historyPage() === historyTotalPages()"
                    class="h-8 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    &rarr;
                  </button>
                </div>
              </div>
            </section>
          } @else if (activeDetailTab() === 'dga') {
            <app-water-detail-dga
              [siteId]="siteContext()?.site?.id ?? ''"
              [obraDga]="siteContext()?.site?.pozo_config?.obra_dga ?? null"
              [dashboardData]="dashboardData()"
              [dashboardLoading]="dashboardLoading()"
              [latestDeviceTimeLabel]="latestDeviceTimeLabel()"
              [latestDeviceDateLabel]="latestDeviceDateLabel()"
              [latestDeviceTimestampLabel]="latestDeviceTimestampLabel()"
              (openDgaReporteModal)="abrirDgaReporteModal()"
            />
          } @else if (activeDetailTab() === 'alertas') {
            <div role="tabpanel" id="tabpanel-alertas" aria-labelledby="tab-alertas">
              <app-water-detail-alertas
                [sitioId]="siteContext()?.site?.id || ''"
                [empresaId]="siteContext()?.company?.id || ''"
              />
            </div>
          } @else if (activeDetailTab() === 'bitacora') {
            <div role="tabpanel" id="tabpanel-bitacora" aria-labelledby="tab-bitacora">
              <app-water-detail-bitacora
                [sitioId]="siteContext()?.site?.id || ''"
                [empresaId]="siteContext()?.company?.id || ''"
              />
            </div>
          } @else if (activeDetailTab() === 'analisis' && isSuperAdmin()) {
            <div role="tabpanel" id="tabpanel-analisis" aria-labelledby="tab-analisis">
              <app-water-detail-analisis [sitioId]="siteContext()?.site?.id || ''" />
            </div>
          }

          <div
            role="tabpanel"
            id="tabpanel-operacion"
            aria-labelledby="tab-operacion"
            [class.hidden]="activeDetailTab() !== 'operacion'"
          >
            <app-water-detail-operacion />
          </div>
        </div>
      } @else {
        <app-inline-error
          message="No se encontró la instalación solicitada."
          actionLabel="Volver al listado"
          actionIcon="arrow_back"
          (action)="volverAListado()"
        />
      }


      @if (downloadModalOpen()) {
        <app-water-detail-descarga
          [siteId]="siteContext()?.site?.id ?? ''"
          [siteName]="siteContext() ? getSiteName(siteContext()!) : ''"
          [monthlyFlowMonths]="monthlyFlowMonths()"
          (closed)="downloadModalOpen.set(false)"
        />
      }

      @if (dgaReportModalOpen()) {
        <app-water-detail-dga-reporte
          [siteId]="siteContext()?.site?.id ?? ''"
          [siteName]="siteContext() ? getSiteName(siteContext()!) : ''"
          [monthlyFlowMonths]="monthlyFlowMonths()"
          [obraDga]="currentSiteObraDga()"
          (closed)="closeDgaReportModal()"
        />
      }

      <app-dga-generar-reporte-modal
        [open]="dgaReporteModalOpen()"
        [siteId]="siteContext()?.site?.id ?? ''"
        [siteName]="siteContext() ? getSiteName(siteContext()!) : ''"
        (closed)="cerrarDgaReporteModal()"
        (configChanged)="onDgaConfigChanged()"
      ></app-dga-generar-reporte-modal>
    </div>
  `,
  styles: [
    `
      @keyframes dga-wave-drift {
        from {
          transform: translateX(-28%) rotate(0deg);
        }
        to {
          transform: translateX(2%) rotate(0deg);
        }
      }

      @keyframes dga-wave-bob {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(4px);
        }
      }

      @keyframes dga-shine {
        0% {
          transform: translateX(-110%);
          opacity: 0;
        }
        35% {
          opacity: 0.35;
        }
        70% {
          opacity: 0.12;
        }
        100% {
          transform: translateX(130%);
          opacity: 0;
        }
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
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.38) 48%,
          transparent 76%
        );
        animation: dga-shine 5.8s ease-in-out infinite;
        pointer-events: none;
      }

      /* Custom keyframes (dga-shine, dga-wave-drift, dga-wave-bob, wdiagWave1/2,
         wdiagBubble) no caen bajo el global rule de styles.css que solo cubre
         animate-pulse/spin/ping/skeleton. Guard explícito acá para WCAG 2.3.3
         + usuarios con vestibular disorder. */
      @media (prefers-reduced-motion: reduce) {
        .dga-water-column,
        .dga-water-wave-a,
        .dga-water-wave-b,
        .dga-water-shine {
          animation: none !important;
        }
      }
    `,
  ],
})
export class CompanySiteWaterDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly companyService = inject(CompanyService);
  private readonly httpClient = inject(HttpClient);
  private readonly authService = inject(AuthService);
  readonly isSuperAdmin = this.authService.canViewAdvancedAnalysis;
  readonly canEditSiteSettings = this.authService.canEditSiteSettings;
  private clockSub?: Subscription;
  private dashboardPollingSub?: Subscription;
  private historyPollingSub?: Subscription;

  siteContext = signal<SiteContext | null>(null);
  loading = signal(true);
  dashboardLoading = signal(true);
  dashboardError = signal('');
  dashboardData = signal<SiteDashboardData | null>(null);
  dashboardLastLoadedAt = signal<Date | null>(null);
  serverClockOffsetMs = signal(0);
  currentTime = signal(new Date());
  activeDetailTab = signal<DetailTab>('dga');
  historyPanelOpen = signal(false);
  settingsPanelOpen = signal(false);
  dgaReporteModalOpen = signal(false);
  operationMode = signal<OperationMode>('realtime');
  historyLoading = signal(true);
  historyError = signal('');
  historyRows = signal<HistoricalTelemetryRow[]>([]);
  historyServerTotalRows = signal<number | null>(null);
  historyPage = signal(1);
  historyDateFrom = signal('');
  historyDateTo = signal('');
  /** Input state for date pickers (no aplica hasta Confirmar). */
  historyDateFromInput = signal('');
  historyDateToInput = signal('');
  historyDateRangeError = signal('');
  historyRecordLimit = signal(500);
  hoveredRealtimePointIndex = signal<number | null>(null);
  downloadModalOpen = signal(false);
  dgaReportModalOpen = signal(false);
  readonly historyPageSize = 50;
  readonly historyRecordLimitOptions = [50, 100, 250, 500];

  dashboardRefreshLabel = computed(() =>
    this.formatDashboardRefresh(this.dashboardLastLoadedAt(), this.currentTime()),
  );
  latestDeviceReadingLabel = computed(() =>
    this.formatLatestDeviceReading(this.dashboardData()?.ultima_lectura),
  );
  currentServerTime = computed(
    () => new Date(this.currentTime().getTime() + this.serverClockOffsetMs()),
  );
  telemetryStatusBadges = computed<TelemetryStatusBadge[]>(() => []);
  latestDeviceTimestampLabel = computed(() => {
    const reading = this.dashboardData()?.ultima_lectura;
    const raw = String(reading?.timestamp_completo || reading?.time || '').trim();
    if (!raw) return 'Sin dato';
    return this.formatChileDateTime(raw);
  });
  latestDeviceTimeLabel = computed(() => {
    const raw = String(
      this.dashboardData()?.ultima_lectura?.timestamp_completo ||
        this.dashboardData()?.ultima_lectura?.time ||
        '',
    ).trim();
    if (!raw) return '—';
    const parsed = this.parseUtcTimestamp(raw);
    if (!parsed) return '—';
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).format(parsed);
  });
  latestDeviceDateLabel = computed(() => {
    const raw = String(
      this.dashboardData()?.ultima_lectura?.timestamp_completo ||
        this.dashboardData()?.ultima_lectura?.time ||
        '',
    ).trim();
    if (!raw) return '';
    const parsed = this.parseUtcTimestamp(raw);
    if (!parsed) return '';
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(parsed);
  });
  monthlyCountersData = signal<ContadorMensualPoint[]>([]);
  monthlyCountersLoading = signal(false);
  private monthlyCountersSub: Subscription | null = null;

  private readonly monthShortNames = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];

  monthlyFlowMonths = computed<MonthlyFlowPoint[]>(() => {
    const points = this.monthlyCountersData();
    if (points.length === 0) return this.monthlyFlowFallback;
    return points.map((p) => {
      const date = new Date(`${p.mes}T00:00:00-04:00`);
      const mes = this.monthShortNames[date.getUTCMonth()] ?? '';
      const yr = String(date.getUTCFullYear()).slice(2);
      return {
        label: `${mes} '${yr}`,
        value: p.delta ?? 0,
        proyeccion: p.proyeccion ?? null,
      };
    });
  });

  monthlyFlowMax = computed<number>(() => {
    const months = this.monthlyFlowMonths();
    let max = 0;
    for (const m of months) {
      if (m.value > max) max = m.value;
      if (m.proyeccion && m.proyeccion > max) max = m.proyeccion;
    }
    if (max <= 0) return 100;
    // Pad 5% para no dejar la barra pegada al borde.
    const padded = max * 1.05;
    // Escalera "lindos" mas densa que {1,2,5,10}: evita saltos como 201→500
    // (antes), ahora 201→250. Cubre el caso del usuario donde el eje quedaba
    // 2-3x mas grande que la barra real.
    const ladder = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    const magnitude = Math.pow(10, Math.floor(Math.log10(padded)));
    const norm = padded / magnitude;
    const nice = ladder.find((n) => norm <= n) ?? 10;
    return nice * magnitude;
  });

  monthlyFlowTicks = computed<string[]>(() => {
    const max = this.monthlyFlowMax();
    const fmt = new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
    return [1, 0.75, 0.5, 0.25, 0].map((f) => fmt.format(max * f));
  });

  monthlyFlowUnit = computed<string>(() => this.monthlyCountersData()[0]?.unidad ?? 'm³');

  private readonly monthlyFlowFallback: MonthlyFlowPoint[] = [
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
    { label: '—', value: 0 },
  ];

  historySourceRows = computed(() => {
    if (this.historyRows().length) return this.historyRows();
    return this.historyLoading() ? [] : this.historyMockRows;
  });
  historyFilteredRows = computed(() => {
    if (this.historyServerTotalRows() !== null) return this.historySourceRows();

    const from = this.parseDateInputMs(this.historyDateFrom(), 'start');
    const to = this.parseDateInputMs(this.historyDateTo(), 'end');

    return this.historySourceRows()
      .filter((row) => {
        if (from === null && to === null) return true;
        if (row.timestampMs === null || row.timestampMs === undefined) return false;
        if (from !== null && row.timestampMs < from) return false;
        if (to !== null && row.timestampMs > to) return false;
        return true;
      })
      .slice(0, this.historyRecordLimit());
  });
  paginatedHistoryRows = computed(() => {
    if (this.historyServerTotalRows() !== null) return this.historyFilteredRows();

    const start = (this.historyPage() - 1) * this.historyPageSize;
    return this.historyFilteredRows().slice(start, start + this.historyPageSize);
  });
  historyTotalRows = computed(
    () => this.historyServerTotalRows() ?? this.historyFilteredRows().length,
  );
  currentHistoryPageCount = computed(() => this.paginatedHistoryRows().length);
  historyTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.historyTotalRows() / this.historyPageSize)),
  );
  historyRangeStart = computed(() =>
    this.historyTotalRows() ? (this.historyPage() - 1) * this.historyPageSize + 1 : 0,
  );
  historyRangeEnd = computed(() =>
    Math.min(this.historyPage() * this.historyPageSize, this.historyTotalRows()),
  );
  isHistoryMock = computed(() => !this.historyLoading() && this.historyRows().length === 0);

  readonly dgaDatePresets = [
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: 'last7', label: 'Ultimos 7 dias' },
    { id: 'last30', label: 'Ultimos 30 dias' },
    { id: 'thisMonth', label: 'Este mes' },
    { id: 'previousMonth', label: 'Mes anterior' },
  ];

  readonly quickActions = [
    {
      icon: 'database',
      title: 'Datos Historicos',
      subtitle: 'Ver registros',
      color: 'text-primary-container',
      openHistory: true,
    },
    {
      icon: 'download',
      title: 'Descargar',
      subtitle: 'Exportar CSV',
      color: 'text-emerald-600',
      openDownload: true,
    },
    {
      icon: 'open_in_new',
      title: 'Ver en DGA',
      subtitle: 'Portal oficial',
      color: 'text-primary-container',
      openDga: true,
    },
    {
      icon: 'description',
      title: 'Reporte DGA',
      subtitle: 'Formato oficial',
      color: 'text-accent',
      openDgaReport: true,
    },
  ];

  readonly downloadPresets = [
    { id: 'last7', label: 'Últimos 7 días' },
    { id: 'last30', label: 'Últimos 30 días' },
    { id: 'last90', label: 'Últimos 90 días' },
    { id: 'thisYear', label: 'Este año' },
    { id: 'lastYear', label: 'Año pasado' },
  ];

  readonly downloadMonthNames = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  readonly historyMockRows: HistoricalTelemetryRow[] = [
    {
      id: 'mock-2026-04-01-06-00',
      fecha: '01/04/2026 06:00',
      caudal: '0',
      totalizador: '531.100',
      nivelFreatico: '1.6',
      mock: true,
    },
    {
      id: 'mock-2026-04-01-05-00',
      fecha: '01/04/2026 05:00',
      caudal: '19.75',
      totalizador: '531.060,063',
      nivelFreatico: '3.3',
      mock: true,
    },
    {
      id: 'mock-2026-04-01-04-00',
      fecha: '01/04/2026 04:00',
      caudal: '0',
      totalizador: '531.038,375',
      nivelFreatico: '1.5',
      mock: true,
    },
    {
      id: 'mock-2026-04-01-03-00',
      fecha: '01/04/2026 03:00',
      caudal: '19.75',
      totalizador: '531.009,375',
      nivelFreatico: '3.3',
      mock: true,
    },
    {
      id: 'mock-2026-04-01-02-00',
      fecha: '01/04/2026 02:00',
      caudal: '19.63',
      totalizador: '530.986,75',
      nivelFreatico: '3.4',
      mock: true,
    },
    {
      id: 'mock-2026-04-01-01-00',
      fecha: '01/04/2026 01:00',
      caudal: '19.88',
      totalizador: '530.956,188',
      nivelFreatico: '3.1',
      mock: true,
    },
    {
      id: 'mock-2026-04-01-00-00',
      fecha: '01/04/2026 00:00',
      caudal: '0',
      totalizador: '530.921,625',
      nivelFreatico: '1.5',
      mock: true,
    },
    {
      id: 'mock-2026-03-31-23-00',
      fecha: '31/03/2026 23:00',
      caudal: '19.75',
      totalizador: '530.900,188',
      nivelFreatico: '3.4',
      mock: true,
    },
    {
      id: 'mock-2026-03-31-22-00',
      fecha: '31/03/2026 22:00',
      caudal: '19.75',
      totalizador: '530.858,938',
      nivelFreatico: '3.5',
      mock: true,
    },
    {
      id: 'mock-2026-03-31-21-00',
      fecha: '31/03/2026 21:00',
      caudal: '19.75',
      totalizador: '530.806,375',
      nivelFreatico: '3.2',
      mock: true,
    },
  ];

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');

    if (!siteId) {
      this.router.navigate(['/companies']);
      return;
    }

    this.clockSub = timer(0, 1000).subscribe(() => this.currentTime.set(new Date()));
    this.startDashboardPolling(siteId);
    // historyPolling pidía dashboard-history cada 60s (limit=50, ~3s en
    // cold path) solo para llenar la modal "Historial" que está cerrada
    // por default. Ahora se arranca lazy desde openHistoryView() y se
    // detiene en closeHistoryView(). Win primer paint: -1 request pesada.
    this.startMonthlyCountersPolling(siteId);

    this.companyService.fetchHierarchy().subscribe({
      next: (res: ApiResponse<CompanyNode[]>) => {
        if (!res.ok) {
          this.router.navigate(['/companies']);
          return;
        }

        const match = this.findAccessibleSite(res.data, siteId);

        if (!match) {
          this.router.navigate(['/companies']);
          return;
        }

        const moduleKey = getSiteTypeUi(match.site.tipo_sitio).moduleKey;
        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.companyService.selectedSiteModuleKey.set(moduleKey);
        this.companyService.selectedSiteTypeFilter.set(siteTypesForModule(moduleKey));
        this.loadHydratedSite(match);

        // DGA tab data is loaded by the child component (app-water-detail-dga).
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  ngOnDestroy(): void {
    this.clockSub?.unsubscribe();
    this.dashboardPollingSub?.unsubscribe();
    this.historyPollingSub?.unsubscribe();
    this.monthlyCountersSub?.unsubscribe();
  }

  getSiteName(context: SiteContext): string {
    return context.site?.descripcion || context.subCompany?.nombre || 'Instalación de agua';
  }

  /** Header largo: "Nombre · OB-XXXX-XXX" si el sitio tiene obra_dga. */
  getSiteHeaderLabel(context: SiteContext): string {
    const name = this.getSiteName(context);
    const obra = context.site?.pozo_config?.obra_dga?.trim();
    return obra ? `${name} · ${obra}` : name;
  }


  formatPercent(value: number | null): string {
    return value === null ? '--%' : `${value}%`;
  }

  private buildTelemetryBadge(
    title: string,
    rawTimestamp: string,
    now: Date,
    display: 'relative' | 'datetime',
    icon: string,
  ): TelemetryStatusBadge {
    const parsed = rawTimestamp ? this.parseUtcTimestamp(rawTimestamp) : null;

    if (!parsed) {
      return {
        title,
        value: 'Sin dato',
        tone: 'empty',
        icon,
      };
    }

    const elapsedMs = Math.max(0, now.getTime() - parsed.getTime());

    return {
      title,
      value:
        display === 'relative'
          ? this.formatDetailedRelativeTime(parsed, now)
          : this.formatChileDateTime(parsed),
      tone: elapsedMs < 60 * 60 * 1000 ? 'ok' : 'warning',
      icon,
    };
  }

  telemetryBadgeClass(tone: TelemetryStatusBadge['tone']): string {
    const base = 'inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2';
    if (tone === 'ok') return `${base} border-emerald-200 bg-emerald-50 text-emerald-700`;
    if (tone === 'warning') return `${base} border-amber-300 bg-amber-50 text-amber-700`;
    return `${base} border-slate-200 bg-slate-50 text-slate-500`;
  }

  telemetryBadgeIconClass(tone: TelemetryStatusBadge['tone']): string {
    const base = 'material-symbols-outlined text-[16px]';
    if (tone === 'ok') return `${base} text-emerald-600`;
    if (tone === 'warning') return `${base} text-amber-500`;
    return `${base} text-slate-400`;
  }

  private formatDetailedRelativeTime(date: Date, now: Date): string {
    const elapsedSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));

    if (elapsedSeconds < 60) return `hace ${elapsedSeconds} segundos`;

    const elapsedMinutes = Math.floor(elapsedSeconds / 60);
    if (elapsedMinutes < 60) return `hace ${elapsedMinutes} min`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const remainingMinutes = elapsedMinutes % 60;
    if (elapsedHours < 24) {
      return remainingMinutes
        ? `hace ${elapsedHours}h ${remainingMinutes}m`
        : `hace ${elapsedHours}h`;
    }

    const elapsedDays = Math.floor(elapsedHours / 24);
    const remainingHours = elapsedHours % 24;
    return remainingHours ? `hace ${elapsedDays}d ${remainingHours}h` : `hace ${elapsedDays}d`;
  }

  private syncServerClock(rawServerTime: string | null | undefined): void {
    const serverTime = rawServerTime ? this.parseUtcTimestamp(String(rawServerTime)) : null;
    if (!serverTime) return;
    this.serverClockOffsetMs.set(serverTime.getTime() - Date.now());
  }

  private formatDashboardRefresh(loadedAt: Date | null, now: Date): string {
    if (!loadedAt) return 'Sin datos';
    return this.formatDetailedRelativeTime(loadedAt, now);
  }

  private formatLatestDeviceReading(
    reading: SiteDashboardData['ultima_lectura'] | undefined,
  ): string {
    const raw = String(reading?.timestamp_completo || reading?.time || '').trim();
    if (!raw) return 'Equipo sin dato';
    return `Ultimo dato equipo ${this.formatChileDateTime(raw)}`;
  }

  private formatChileDateTime(value: Date | string): string {
    const parsed = value instanceof Date ? value : this.parseUtcTimestamp(value);

    if (!parsed || Number.isNaN(parsed.getTime())) {
      return typeof value === 'string' ? value : '--';
    }

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).format(parsed);
  }

  private parseUtcTimestamp(value: string): Date | null {
    const raw = value.trim();
    if (!raw) return null;

    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const withTimeZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
      ? normalized
      : `${normalized}Z`;
    const parsed = new Date(withTimeZone);

    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private parseDateInputMs(value: string, boundary: 'start' | 'end'): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = boundary === 'start' ? 0 : 23;
    const minute = boundary === 'start' ? 0 : 59;
    const second = boundary === 'start' ? 0 : 59;
    const millisecond = boundary === 'start' ? 0 : 999;
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    const chileParts = new Intl.DateTimeFormat('en-US', {
      timeZone: CHILE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(new Date(utcGuess));
    const part = (type: string) =>
      Number(chileParts.find((item) => item.type === type)?.value || 0);
    const chileAsUtc = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
      millisecond,
    );

    return utcGuess - (chileAsUtc - utcGuess);
  }


  /** Empty-state recovery: navigate back to the installations list. */
  volverAListado(): void {
    this.router.navigate(['/companies']);
  }

  openSettingsPanel(): void {
    this.historyPanelOpen.set(false);
    this.settingsPanelOpen.set(true);
  }

  closeSettingsPanel(): void {
    this.settingsPanelOpen.set(false);
  }

  /** Called by <app-site-variable-settings-panel> after a save/delete so the well diagram + sidebar stay in sync. */
  onVariableMapChanged(): void {
    const siteId = this.currentSiteId();
    if (siteId) {
      this.companyService.invalidateSiteCache(siteId);
      this.refreshDashboardSnapshot(siteId);
      if (this.historyPanelOpen()) this.startHistoryPolling(siteId);
    }
    this.refreshHierarchySnapshot();
  }

  abrirDgaReporteModal(): void {
    this.dgaReporteModalOpen.set(true);
  }

  cerrarDgaReporteModal(): void {
    this.dgaReporteModalOpen.set(false);
  }

  onDgaConfigChanged(): void {
    // El modal hace el persist; la actualización de "Último envío" la maneja
    // el componente hijo app-water-detail-dga directamente.
  }

  setDetailTab(tab: DetailTab): void {
    if (tab === 'analisis' && !this.isSuperAdmin()) return;
    this.historyPanelOpen.set(false);
    this.settingsPanelOpen.set(false);
    this.activeDetailTab.set(tab);
  }

  /**
   * WAI-ARIA tablist nav. ArrowLeft/Right cyclan, Home/End van a primero/
   * último. Análisis se incluye solo si el rol lo permite — un usuario
   * non-SuperAdmin no debe poder llegar via teclado a una tab que no debe
   * ver. Roving tabindex en el template asegura que solo el tab activo es
   * focusable via Tab.
   */
  cycleDetailTab(delta: 1 | -1 | 0, edge?: 'first' | 'last'): void {
    const all: DetailTab[] = ['dga', 'operacion', 'alertas', 'bitacora', 'analisis'];
    const available = all.filter((t) => t !== 'analisis' || this.isSuperAdmin());
    if (available.length === 0) return;
    if (edge === 'first') {
      this.setDetailTab(available[0]);
      return;
    }
    if (edge === 'last') {
      this.setDetailTab(available[available.length - 1]);
      return;
    }
    const idx = available.indexOf(this.activeDetailTab());
    const nextIdx = (idx + delta + available.length) % available.length;
    this.setDetailTab(available[nextIdx]);
  }

  setOperationMode(mode: OperationMode): void {
    this.operationMode.set(mode);
  }

  setRealtimeChartHover(index: number): void {
    this.hoveredRealtimePointIndex.set(index);
  }

  clearRealtimeChartHover(): void {
    this.hoveredRealtimePointIndex.set(null);
  }

  handleQuickAction(action: {
    tab?: DetailTab;
    openHistory?: boolean;
    openDownload?: boolean;
    openDgaReport?: boolean;
    openDga?: boolean;
  }): void {
    if (action.openHistory) {
      this.openHistoryView();
      return;
    }
    if (action.openDownload) {
      this.openDownloadModal();
      return;
    }
    if (action.openDgaReport) {
      this.openDgaReportModal();
      return;
    }
    if (action.openDga) {
      const obra = this.currentSiteObraDga();
      if (!obra) return; // disabled cuando no hay obra; el click no debería llegar igual
      window.open(
        `https://snia.mop.gob.cl/cExtracciones2/#/consultaQR/${encodeURIComponent(obra)}`,
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    if (action.tab) {
      this.setDetailTab(action.tab);
    }
  }

  /** obra_dga del sitio actual, o null si no está cargada. */
  currentSiteObraDga(): string | null {
    const raw = this.siteContext()?.site?.pozo_config?.obra_dga;
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    return trimmed || null;
  }

  /** true si la acción debe mostrarse deshabilitada (gris + sin click). */
  quickActionDisabled(action: { openDga?: boolean }): boolean {
    return action.openDga === true && !this.currentSiteObraDga();
  }

  /** Tooltip para el botón. Solo informa cuando está deshabilitado. */
  quickActionTitle(action: { openDga?: boolean }): string {
    if (action.openDga && !this.currentSiteObraDga()) {
      return 'Sin número de obra asignado';
    }
    return '';
  }

  openHistoryView(): void {
    this.settingsPanelOpen.set(false);
    this.historyPanelOpen.set(true);
    this.historyPage.set(1);
    const monthStart = chileMonthStart();
    const today = chileToday();
    this.historyDateFrom.set(monthStart);
    this.historyDateTo.set(today);
    this.historyDateFromInput.set(monthStart);
    this.historyDateToInput.set(today);
    this.historyDateRangeError.set('');
    const siteId = this.currentSiteId();
    if (siteId) this.startHistoryPolling(siteId);
  }

  closeHistoryView(): void {
    this.historyPanelOpen.set(false);
    this.historyPollingSub?.unsubscribe();
  }

  openDownloadModal(): void {
    this.downloadModalOpen.set(true);
  }

  closeDownloadModal(): void {
    this.downloadModalOpen.set(false);
  }

  openDgaReportModal(): void {
    this.dgaReportModalOpen.set(true);
  }

  closeDgaReportModal(): void {
    this.dgaReportModalOpen.set(false);
  }

  setHistoryDateFrom(event: Event): void {
    this.historyDateFromInput.set((event.target as HTMLInputElement).value);
    this.historyDateRangeError.set('');
  }

  setHistoryDateTo(event: Event): void {
    this.historyDateToInput.set((event.target as HTMLInputElement).value);
    this.historyDateRangeError.set('');
  }

  confirmHistoryDateRange(): void {
    const from = this.historyDateFromInput();
    const to = this.historyDateToInput();
    if (!from || !to) {
      this.historyDateRangeError.set('Selecciona ambas fechas.');
      return;
    }
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const toMs = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      this.historyDateRangeError.set('Fechas invalidas.');
      return;
    }
    if (fromMs > toMs) {
      this.historyDateRangeError.set('La fecha desde no puede ser mayor que hasta.');
      return;
    }
    const days = Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
    if (days > 93) {
      this.historyDateRangeError.set('Rango maximo: 3 meses (93 dias).');
      return;
    }
    this.historyDateRangeError.set('');
    this.historyDateFrom.set(from);
    this.historyDateTo.set(to);
    this.historyPage.set(1);
    const siteId = this.currentSiteId();
    if (siteId) this.startHistoryPolling(siteId);
  }

  clearHistoryFilters(): void {
    const monthStart = chileMonthStart();
    const today = chileToday();
    this.historyDateFrom.set(monthStart);
    this.historyDateTo.set(today);
    this.historyDateFromInput.set(monthStart);
    this.historyDateToInput.set(today);
    this.historyDateRangeError.set('');
    this.historyPage.set(1);
    const siteId = this.currentSiteId();
    if (siteId) this.startHistoryPolling(siteId);
  }


  /**
   * Closes whichever modal/panel is currently open when the user presses
   * Escape. Order = newest visible layer first (date filter sits above the
   * detail panel; download / DGA-report are siblings). Each handler is a
   * no-op if its modal is already closed, so the order only affects which
   * one wins when multiple are somehow open simultaneously.
   */
  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    if (this.dgaReportModalOpen()) {
      this.closeDgaReportModal();
      return;
    }
    if (this.downloadModalOpen()) {
      this.closeDownloadModal();
      return;
    }
    if (this.dgaReporteModalOpen()) {
      this.cerrarDgaReporteModal();
      return;
    }
    if (this.settingsPanelOpen()) {
      this.closeSettingsPanel();
      return;
    }
    if (this.historyPanelOpen()) {
      this.closeHistoryView();
      return;
    }
  }

  previousHistoryPage(): void {
    this.historyPage.set(Math.max(1, this.historyPage() - 1));
    this.refreshHistoryPage();
  }

  nextHistoryPage(): void {
    this.historyPage.set(Math.min(this.historyTotalPages(), this.historyPage() + 1));
    this.refreshHistoryPage();
  }

  private refreshHistoryPage(): void {
    const siteId = this.currentSiteId();
    if (siteId) this.startHistoryPolling(siteId);
  }

  getDetailTabClass(tab: DetailTab): string {
    const active = this.activeDetailTab() === tab;
    const base =
      'relative inline-flex h-9 items-center gap-2 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded';
    return active
      ? `${base} font-semibold text-primary-container`
      : `${base} font-bold text-slate-500 hover:text-slate-700`;
  }

  getOperationModeClass(mode: OperationMode): string {
    const active = this.operationMode() === mode;
    const base =
      'inline-flex h-11 items-center gap-2 border-b-2 px-5 text-body-sm transition-colors';
    return active
      ? `${base} border-primary-tint-55 bg-primary-tint-08 font-semibold text-primary-container`
      : `${base} border-transparent font-bold text-slate-500 hover:bg-slate-50 hover:text-slate-700`;
  }

  private refreshDashboardSnapshot(siteId: string): void {
    this.companyService.getSiteDashboardData(siteId).subscribe({
      next: (res: ApiResponse<SiteDashboardData>) => {
        const payload = res?.ok === false ? null : res?.data || null;
        if (!payload) return;
        this.syncServerClock(payload.server_time);
        this.dashboardData.set(payload);
        this.dashboardLastLoadedAt.set(new Date());
        this.dashboardError.set('');
      },
      error: () => undefined,
    });
  }

  private refreshHierarchySnapshot(): void {
    const siteId = this.currentSiteId();
    if (!siteId) return;

    this.companyService.fetchHierarchy().subscribe({
      next: (res: ApiResponse<CompanyNode[]>) => {
        if (!res.ok) return;
        const match = this.findAccessibleSite(res.data, siteId);
        if (!match) return;
        const moduleKey = getSiteTypeUi(match.site.tipo_sitio).moduleKey;
        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.companyService.selectedSiteModuleKey.set(moduleKey);
        this.companyService.selectedSiteTypeFilter.set(siteTypesForModule(moduleKey));
        this.siteContext.update((current) =>
          current
            ? {
                ...current,
                company: match.company,
                subCompany: match.subCompany,
                site: { ...current.site, ...match.site },
              }
            : match,
        );
      },
      error: () => undefined,
    });
  }

  private currentSiteId(): string {
    return this.siteContext()?.site?.id || this.route.snapshot.paramMap.get('siteId') || '';
  }

  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const payload = err.error as { message?: string; error?: string } | string | undefined;
      if (typeof payload === 'string') return payload;
      return payload?.message || payload?.error || fallback;
    }

    return fallback;
  }

  private loadHydratedSite(match: SiteContext): void {
    this.companyService.getSites(match.subCompany.id).subscribe({
      next: (json: ApiResponse<SiteRecord[]>) => {
        const hydratedSite = json.ok
          ? (json.data || []).find((site: SiteRecord) => site.id === match.site.id)
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

  private startDashboardPolling(siteId: string): void {
    this.dashboardLoading.set(!this.dashboardData());
    this.dashboardError.set('');
    this.dashboardPollingSub?.unsubscribe();

    this.dashboardPollingSub = timer(0, 60000)
      .pipe(
        switchMap(() =>
          this.companyService.getSiteDashboardData(siteId).pipe(
            catchError(() => {
              this.dashboardError.set('No fue posible cargar datos del pozo.');
              this.dashboardLoading.set(false);
              return of(null);
            }),
          ),
        ),
      )
      .subscribe((res: ApiResponse<SiteDashboardData> | null) => {
        if (!res) return;

        const payload = res?.ok === false ? null : res?.data || null;
        this.syncServerClock(payload?.server_time);
        this.dashboardData.set(payload);
        this.dashboardLastLoadedAt.set(new Date());
        this.dashboardError.set(payload ? '' : 'No fue posible cargar datos del pozo.');
        this.dashboardLoading.set(false);
      });
  }

  private startMonthlyCountersPolling(siteId: string): void {
    this.monthlyCountersLoading.set(true);
    this.monthlyCountersSub?.unsubscribe();

    // 1 fetch al cargar + refresh cada 10 min (el worker corre c/1h, no hace falta mas).
    this.monthlyCountersSub = timer(0, 10 * 60_000)
      .pipe(
        switchMap(() =>
          this.companyService
            .getSiteMonthlyCounters(siteId, { rol: 'totalizador', meses: 12 })
            .pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((res) => {
        this.monthlyCountersLoading.set(false);
        if (!res || !res.ok) return;
        this.monthlyCountersData.set(res.data ?? []);
      });
  }

  private startHistoryPolling(siteId: string): void {
    this.historyLoading.set(true);
    this.historyError.set('');
    this.historyPollingSub?.unsubscribe();

    this.historyPollingSub = timer(0, 60000)
      .pipe(
        switchMap(() => {
          const from = this.historyDateFrom();
          const to = this.historyDateTo();
          const useRange = Boolean(from && to);
          return this.companyService
            .getSiteDashboardHistory(siteId, this.historyPageSize, {
              from: useRange ? from : undefined,
              to: useRange ? to : undefined,
              granularity: '1m',
              page: this.historyPage(),
            })
            .pipe(
              catchError(() => {
                this.historyError.set('No fue posible cargar datos historicos.');
                this.historyLoading.set(false);
                return of(null);
              }),
            );
        }),
      )
      .subscribe((rawRes) => {
        if (!rawRes) return;
        // El endpoint puede devolver { rows, pagination } o directamente el array;
        // la firma del servicio no captura esta dualidad, así que casteamos aquí.
        const res = rawRes as unknown as ApiResponse<HistoryApiData>;
        const apiRows = this.extractHistoryApiRows(res);
        const paginatedData = !Array.isArray(res?.data) ? res?.data : null;
        const totalRows = Number((paginatedData as { pagination?: { total?: number } } | null)?.pagination?.total);
        const mappedRows = apiRows
          .map((row, index) => this.mapHistoryApiRow(row, index))
          .filter((row): row is HistoricalTelemetryRow => row !== null);

        this.historyRows.set(mappedRows);
        this.historyServerTotalRows.set(Number.isFinite(totalRows) ? totalRows : null);
        this.historyError.set('');
        this.historyLoading.set(false);

        if (this.historyPage() > this.historyTotalPages()) {
          this.historyPage.set(this.historyTotalPages());
        }
      });
  }

  private extractHistoryApiRows(res: ApiResponse<HistoryApiData>): HistoricalTelemetryApiRow[] {
    if (res?.ok === false) return [];
    const data = res?.data;
    if (!data) return [];
    if (Array.isArray(data)) return data;
    const rows = (data as { rows?: HistoricalTelemetryApiRow[] }).rows;
    return Array.isArray(rows) ? rows : [];
  }

  private mapHistoryApiRow(
    row: HistoricalTelemetryApiRow,
    index: number,
  ): HistoricalTelemetryRow | null {
    const rawTimestamp = String(row?.timestamp || row?.fecha || '').trim();
    if (!rawTimestamp) return null;

    const parsedTimestamp = this.parseUtcTimestamp(rawTimestamp);
    const timestampMs = parsedTimestamp?.getTime() ?? null;

    return {
      id: `${rawTimestamp}-${index}`,
      fecha: parsedTimestamp ? this.formatChileDateTime(parsedTimestamp) : rawTimestamp,
      timestampMs,
      caudal: this.formatHistoricalValue(row.caudal),
      nivel: this.formatHistoricalValue(row.nivel),
      totalizador: this.formatHistoricalValue(row.totalizador),
      nivelFreatico: this.formatHistoricalValue(row.nivel_freatico),
      caudalValue: this.extractHistoricalNumber(row.caudal),
      nivelValue: this.extractHistoricalNumber(row.nivel),
      totalizadorValue: this.extractHistoricalNumber(row.totalizador),
      nivelFreaticoValue: this.extractHistoricalNumber(row.nivel_freatico),
    };
  }

  private extractHistoricalNumber(
    value: HistoricalTelemetryValue | null | undefined,
  ): number | null {
    if (!value || value.ok === false) return null;
    return this.toNumber(value.valor);
  }

  private formatHistoricalValue(value: HistoricalTelemetryValue | null | undefined): string {
    if (
      !value ||
      value.ok === false ||
      value.valor === null ||
      value.valor === undefined ||
      value.valor === ''
    ) {
      return '--';
    }

    const numericValue = this.toNumber(value.valor);

    if (numericValue === null) {
      return String(value.valor);
    }

    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericValue);
  }

  private findDashboardNumber(role: string): number | null {
    const summaryValue = this.toNumber(this.dashboardData()?.resumen?.[role]?.valor);
    if (summaryValue !== null) return summaryValue;

    const variable = (this.dashboardData()?.variables || []).find((item) => {
      if (item.ok === false) return false;
      const text = this.normalizeSearchText(item.key, item.alias, item.rol_dashboard);
      if (role === 'nivel' && text.includes('freatico')) return false;
      return item.key === role || item.rol_dashboard === role || text.includes(role);
    });

    return this.toNumber(variable?.valor);
  }

  private findDashboardTransformNumber(transformacion: string): number | null {
    const variable = (this.dashboardData()?.variables || []).find(
      (item) => item.ok !== false && item.transformacion === transformacion,
    );
    return this.toNumber(variable?.valor);
  }

  private latestHistoryNumber(
    field: 'caudalValue' | 'totalizadorValue' | 'nivelFreaticoValue',
  ): number | null {
    return this.historyRows().find((row) => this.toNumber(row[field]) !== null)?.[field] ?? null;
  }

  private latestRealtimeTimestamp(): Date | null {
    const latestHistory = this.historyRows().find(
      (row) => row.timestampMs !== null && row.timestampMs !== undefined,
    );
    if (latestHistory?.timestampMs) return new Date(latestHistory.timestampMs);

    const reading = this.dashboardData()?.ultima_lectura;
    const parsed = this.parseUtcTimestamp(
      String(reading?.timestamp_completo || reading?.time || '').trim(),
    );
    return parsed;
  }

  private calculateTodayConsumption(): number {
    const todayKey = this.formatChileDateKey(this.currentTime());
    const rows = this.historyRows()
      .filter(
        (row) =>
          row.timestampMs !== null &&
          row.timestampMs !== undefined &&
          row.totalizadorValue !== null &&
          row.totalizadorValue !== undefined &&
          this.formatChileDateKey(new Date(row.timestampMs)) === todayKey,
      )
      .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0));

    if (rows.length < 2) return 0;

    const first = rows[0].totalizadorValue ?? 0;
    const last = rows[rows.length - 1].totalizadorValue ?? first;
    return Math.max(0, last - first);
  }

  private buildRealtimeChart(): RealtimeChartData {
    const chartLeft = 58;
    const chartRight = 1092;
    const chartTop = 24;
    const chartBottom = 156;
    const rows = this.historyRows()
      .filter(
        (row) =>
          row.timestampMs !== null &&
          row.timestampMs !== undefined &&
          row.caudalValue !== null &&
          row.caudalValue !== undefined,
      )
      .sort((a, b) => (a.timestampMs || 0) - (b.timestampMs || 0))
      .slice(-60);

    if (!rows.length) {
      return {
        points: [],
        polyline: '',
        yTicks: [],
        xTicks: [],
        tooltip: null,
      };
    }

    const values = rows.map((row) => row.caudalValue ?? 0);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const step = this.niceChartStep(
      (maxValue - minValue) / 4 || Math.max(Math.abs(maxValue) * 0.005, 0.05),
    );
    const yMin = Math.floor((minValue - step * 0.2) / step) * step;
    let yMax = Math.ceil((maxValue + step * 0.2) / step) * step;

    if (yMax <= yMin) {
      yMax = yMin + step;
    }

    const yRange = yMax - yMin || 1;
    const minTime = rows[0].timestampMs || 0;
    const maxTime = rows[rows.length - 1].timestampMs || minTime;
    const timeRange = Math.max(1000, maxTime - minTime);

    const points = rows.map((row, index) => {
      const value = row.caudalValue ?? 0;
      const timestampMs = row.timestampMs || minTime;
      const x =
        rows.length > 1
          ? chartLeft + ((timestampMs - minTime) / timeRange) * (chartRight - chartLeft)
          : (chartLeft + chartRight) / 2;
      const y = chartBottom - ((value - yMin) / yRange) * (chartBottom - chartTop);

      return {
        index,
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        value,
        label: row.fecha,
        timestampMs,
      };
    });

    const yTickPositions = [24, 57, 90, 123, 156];
    const yTicks = yTickPositions.map((y, index) => {
      const ratio = index / (yTickPositions.length - 1);
      const value = yMax - ratio * yRange;
      return { y, label: this.formatChartNumber(value) };
    });

    const xTicks = this.buildFiveMinuteTicks(minTime, maxTime, chartLeft, chartRight);
    const hoveredIndex = this.hoveredRealtimePointIndex();
    const tooltipPoint =
      points.find((point) => point.index === hoveredIndex) || points[points.length - 1] || null;
    const tooltip = tooltipPoint
      ? {
          x: tooltipPoint.x,
          y: tooltipPoint.y,
          boxX: this.clamp(tooltipPoint.x + 12, 8, 944),
          boxY: this.clamp(tooltipPoint.y - 62, 8, 132),
          dateLabel: this.formatChartTooltipDate(new Date(tooltipPoint.timestampMs)),
          valueLabel: this.formatChartNumber(tooltipPoint.value),
        }
      : null;

    return {
      points,
      polyline: points.map((point) => `${point.x},${point.y}`).join(' '),
      yTicks,
      xTicks,
      tooltip,
    };
  }

  private buildFiveMinuteTicks(
    minTime: number,
    maxTime: number,
    chartLeft: number,
    chartRight: number,
  ): RealtimeChartTick[] {
    const intervalMs = 5 * 60 * 1000;
    const timeRange = Math.max(1000, maxTime - minTime);
    const firstTick = Math.ceil(minTime / intervalMs) * intervalMs;
    const ticks: RealtimeChartTick[] = [];

    for (let tick = firstTick; tick <= maxTime; tick += intervalMs) {
      ticks.push({
        x: Math.round(chartLeft + ((tick - minTime) / timeRange) * (chartRight - chartLeft)),
        label: this.formatChileTimeShort(new Date(tick)),
      });
    }

    if (!ticks.length) {
      return [
        { x: chartLeft, label: this.formatChileTimeShort(new Date(minTime)) },
        {
          x: chartRight - 30,
          label: this.formatChileTimeShort(new Date(maxTime)),
        },
      ];
    }

    return ticks;
  }

  private niceChartStep(value: number): number {
    const raw = Math.max(Math.abs(value), 0.01);
    const exponent = Math.floor(Math.log10(raw));
    const magnitude = 10 ** exponent;
    const normalized = raw / magnitude;
    const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return nice * magnitude;
  }

  private formatRealtimeNumber(value: number | null, maximumFractionDigits: number): string {
    if (value === null) return '--';
    // Formato DGA Res 2170 §4: punto decimal, sin separador miles.
    return value.toFixed(maximumFractionDigits);
  }

  formatChartNumber(value: number): string {
    // Formato DGA: punto decimal, sin separador miles.
    return value.toFixed(Math.abs(value) >= 100 ? 0 : 2);
  }

  private formatChileTimeShort(value: Date): string {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).format(value);
  }

  private formatChartTooltipDate(value: Date): string {
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
    const month = get('month');
    const cleanMonth = month ? `${month.charAt(0).toUpperCase()}${month.slice(1)}` : '';
    return `${get('day')} ${cleanMonth} ${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
  }

  private formatChileDateKey(value: Date): string {
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private findAccessibleSite(tree: CompanyNode[], siteId: string): SiteContext | null {
    return findAccessibleSite(tree, siteId);
  }


  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(String(value).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeSearchText(...values: (string | null | undefined)[]): string {
    return values
      .map((value) => String(value ?? '').trim())
      .filter((value) => value.length > 0)
      .join(' ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }
}
