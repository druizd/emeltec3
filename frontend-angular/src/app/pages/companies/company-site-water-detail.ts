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
import { catchError, firstValueFrom, of, Subscription, switchMap, timer } from 'rxjs';
import {
  CompanyService,
  type ContadorMensualPoint,
  type HistoryGranularity,
} from '../../services/company.service';
import { CompaniesSiteDetailSkeletonComponent } from './components/companies-site-detail-skeleton';
import { WaterDetailOperacionComponent } from './components/water-detail-operacion/water-detail-operacion';
import { WaterDetailAlertasComponent } from './components/water-detail-alertas/water-detail-alertas';
import { WaterDetailBitacoraComponent } from './components/water-detail-bitacora/water-detail-bitacora';
import { WaterDetailAnalisisComponent } from './components/water-detail-analisis/water-detail-analisis';
import { CHILE_TIME_ZONE } from '../../shared/timezone';
import { getSiteTypeUi, siteTypesForModule } from '../../shared/site-type-ui';
import { DgaGenerarReporteModalComponent } from './components/dga-generar-reporte-modal/dga-generar-reporte-modal';
import { SiteVariableSettingsPanelComponent } from './components/site-variable-settings-panel';
import { DatoDgaRow, DgaService } from '../../services/dga.service';
import { AuthService } from '../../services/auth.service';
import { HttpClient } from '@angular/common/http';

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

interface RealtimeMetric {
  label: string;
  value: string;
  unit: string;
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

interface DgaReportRow {
  id: string;
  recordId: string;
  fecha: string;
  dateIso: string;
  timestampMs: number;
  nivelFreatico: number | null;
  caudal: number | null;
  totalizador: number | null;
  estado: string;
  enviadoDga: string;
  respuesta: string;
  comprobante: string;
}

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
        <div class="mx-auto max-w-[1360px] space-y-3">
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
            <div
              role="tabpanel"
              id="tabpanel-dga"
              aria-labelledby="tab-dga"
              class="flex flex-col gap-6"
            >
              @if (dgaLoading()) {
                <app-kpi-strip-skeleton />
              } @else {
                <section class="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                  <!-- Enviados: cuenta en rango filtrado -->
                  <article
                    class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center shadow-sm"
                  >
                    <p
                      class="text-caption-xs font-semibold uppercase tracking-[0.2em] text-emerald-600"
                    >
                      Enviados
                    </p>
                    <p class="mt-1 text-h3 font-semibold leading-none text-emerald-600">
                      {{ dgaCountEnviados() }}
                    </p>
                    <p class="mt-1 text-caption font-semibold text-emerald-500">
                      en rango filtrado
                    </p>
                  </article>

                  <!-- Último envío: ABSOLUTE, no afectado por filtro. Card entero clickeable -->
                  @if (dgaUltimoEnvio()?.comprobante; as comp) {
                    @if (comprobanteUrl(comp); as url) {
                      <a
                        [href]="url"
                        target="_blank"
                        rel="noopener noreferrer"
                        [title]="'Abrir comprobante en SNIA · ' + comp"
                        class="group flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm transition-all hover:border-emerald-400 hover:shadow-md"
                      >
                        <div class="flex items-center gap-1.5">
                          <span class="material-symbols-outlined text-[14px] text-emerald-600"
                            >verified</span
                          >
                          <p
                            class="text-caption-xs font-semibold uppercase tracking-[0.18em] text-emerald-700"
                          >
                            Último envío aceptado
                          </p>
                        </div>
                        <p
                          class="text-center font-mono text-h4 font-semibold leading-tight text-slate-800"
                        >
                          {{ dgaUltimoEnvioFecha() }}
                        </p>
                      </a>
                    } @else {
                      <article
                        class="flex flex-col items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 shadow-sm"
                        [title]="'Carga el número de obra para habilitar el link SNIA · ' + comp"
                      >
                        <div class="flex items-center gap-1.5">
                          <span class="material-symbols-outlined text-[14px] text-emerald-600"
                            >verified</span
                          >
                          <p
                            class="text-caption-xs font-semibold uppercase tracking-[0.18em] text-emerald-700"
                          >
                            Último envío aceptado
                          </p>
                        </div>
                        <p
                          class="text-center font-mono text-h4 font-semibold leading-tight text-slate-800"
                        >
                          {{ dgaUltimoEnvioFecha() }}
                        </p>
                        <span class="truncate font-mono text-caption-xs text-slate-500">{{
                          comp
                        }}</span>
                      </article>
                    }
                  } @else {
                    <article
                      class="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-center shadow-sm"
                    >
                      <p
                        class="text-caption-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                      >
                        Último envío aceptado
                      </p>
                      <p class="font-mono text-h4 font-semibold leading-tight text-slate-400">—</p>
                      <span class="text-caption-xs italic text-slate-500">sin envíos aún</span>
                    </article>
                  }

                  <!-- Tasa éxito: enviados / (enviados + rechazados + fallidos). Color dinamico. -->
                  <article
                    [class]="
                      'relative rounded-xl border px-4 py-3 text-center shadow-sm ' +
                      dgaTasaExitoColors().border +
                      ' ' +
                      dgaTasaExitoColors().bg
                    "
                  >
                    <div class="flex items-start justify-between">
                      <p
                        [class]="
                          'flex-1 text-caption-xs font-semibold uppercase tracking-[0.2em] ' +
                          dgaTasaExitoColors().text
                        "
                      >
                        Tasa de éxito
                      </p>
                      <details class="group relative">
                        <summary
                          [class]="
                            'flex h-5 w-5 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
                            dgaTasaExitoColors().text
                          "
                          aria-label="Ver leyenda de la tasa de éxito"
                        >
                          <span class="material-symbols-outlined text-[14px]">help_outline</span>
                        </summary>
                        <div
                          class="absolute right-0 top-7 z-10 w-72 rounded-xl border border-slate-200 bg-white p-3 text-left text-caption shadow-lg"
                        >
                          <p class="mb-2 font-semibold text-slate-700">Cómo se calcula</p>
                          <p class="mb-3 text-slate-500">
                            enviados ÷ (enviados + rechazados + fallidos) × 100. Solo se cuentan
                            slots dentro del rango filtrado.
                          </p>
                          <p class="mb-2 font-semibold text-slate-700">Umbrales</p>
                          <ul class="space-y-1.5 text-slate-600">
                            <li class="flex items-center gap-2">
                              <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                              100 %: sin rechazos
                            </li>
                            <li class="flex items-center gap-2">
                              <span class="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
                              90–99 %: alerta leve
                            </li>
                            <li class="flex items-center gap-2">
                              <span class="h-2.5 w-2.5 rounded-full bg-lime-500"></span>
                              75–89 %: revisar configuración
                            </li>
                            <li class="flex items-center gap-2">
                              <span class="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
                              60–74 %: atención requerida
                            </li>
                            <li class="flex items-center gap-2">
                              <span class="h-2.5 w-2.5 rounded-full bg-orange-500"></span>
                              40–59 %: bloqueo probable
                            </li>
                            <li class="flex items-center gap-2">
                              <span class="h-2.5 w-2.5 rounded-full bg-rose-500"></span>
                              &lt; 40 %: falla persistente
                            </li>
                          </ul>
                        </div>
                      </details>
                    </div>
                    <p
                      [class]="
                        'mt-1 text-h3 font-semibold leading-none ' + dgaTasaExitoColors().text
                      "
                    >
                      {{ dgaTasaExito() === null ? '—' : dgaTasaExito() + '%' }}
                    </p>
                    <p
                      [class]="
                        'mt-1 text-caption-xs font-bold uppercase tracking-wider ' +
                        dgaTasaExitoColors().text
                      "
                    >
                      {{ dgaTasaExitoLabel() }}
                    </p>
                    <p class="text-caption-xs font-semibold text-slate-500">en rango filtrado</p>
                  </article>

                  <!-- Rechazados: cuenta en rango -->
                  <article
                    class="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-center shadow-sm"
                    title="Envíos que el portal SNIA no aceptó (Rechazado) o que fallaron antes de llegar (Fallido). Revisa la columna 'Estado' en la tabla para identificar la causa."
                  >
                    <p
                      class="text-caption-xs font-semibold uppercase tracking-[0.2em] text-rose-700"
                    >
                      Rechazados
                    </p>
                    <p class="mt-1 text-h3 font-semibold leading-none text-rose-600">
                      {{ dgaCountRechazados() }}
                    </p>
                    <p class="mt-1 text-caption font-semibold text-rose-700">
                      Rechazados por SNIA + fallidos antes del envío
                    </p>
                  </article>
                </section>
              }

              <section
                class="grid grid-cols-1 gap-5 xl:grid-cols-[520px_minmax(0,1fr)] xl:items-stretch"
              >
                <div class="flex flex-col gap-5 xl:h-full">
                  <article
                    class="flex flex-1 flex-col rounded-xl border border-primary-tint-25 bg-white p-3 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]"
                  >
                    <p
                      class="mb-3 text-caption-xs font-semibold uppercase tracking-[0.18em] text-slate-400"
                    >
                      Diagrama del pozo
                    </p>

                    @if (dashboardLoading()) {
                      <app-well-diagram-skeleton />
                    } @else {
                      <div class="flex gap-3 items-start">
                        <!-- SVG Well Diagram (flex:1) -->
                        <div style="flex:1;min-width:0;overflow:visible">
                          <svg
                            [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH"
                            style="width:100%;height:auto;display:block;overflow:visible"
                          >
                            <style>
                              @keyframes wdiagWave1 {
                                0%,
                                100% {
                                  transform: translateX(0);
                                }
                                50% {
                                  transform: translateX(-7px);
                                }
                              }
                              @keyframes wdiagWave2 {
                                0%,
                                100% {
                                  transform: translateX(0);
                                }
                                50% {
                                  transform: translateX(6px);
                                }
                              }
                              @keyframes wdiagBubble {
                                0% {
                                  opacity: 0;
                                  transform: translateY(0);
                                }
                                8% {
                                  opacity: 0.62;
                                }
                                78% {
                                  opacity: 0.22;
                                }
                                100% {
                                  opacity: 0;
                                  transform: translateY(-580px);
                                }
                              }
                              .wdiag-w1 {
                                animation: wdiagWave1 3s ease-in-out infinite;
                              }
                              .wdiag-w2 {
                                animation: wdiagWave2 4.8s ease-in-out infinite;
                              }
                              .wdiag-b {
                                animation-name: wdiagBubble;
                                animation-timing-function: ease-in;
                                animation-iteration-count: infinite;
                                animation-fill-mode: both;
                                animation-duration: var(--d, 4s);
                                animation-delay: var(--e, 0s);
                              }
                              @media (prefers-reduced-motion: reduce) {
                                .wdiag-w1,
                                .wdiag-w2,
                                .wdiag-b {
                                  animation: none !important;
                                }
                              }
                            </style>
                            <defs>
                              <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#8EEAF1" stop-opacity="0.85" />
                                <stop offset="18%" stop-color="#0DAFBD" stop-opacity="0.92" />
                                <stop offset="65%" stop-color="#067D88" stop-opacity="0.97" />
                                <stop offset="100%" stop-color="#034851" stop-opacity="1" />
                              </linearGradient>
                              <radialGradient id="shimmer" cx="40%" cy="25%" r="55%">
                                <stop offset="0%" stop-color="white" stop-opacity="0.22" />
                                <stop offset="100%" stop-color="white" stop-opacity="0" />
                              </radialGradient>
                              <pattern
                                id="dots"
                                x="0"
                                y="0"
                                width="8"
                                height="8"
                                patternUnits="userSpaceOnUse"
                              >
                                <rect width="8" height="8" fill="#F5EDD8" />
                                <circle cx="3" cy="3" r="1" fill="#C4A882" opacity="0.6" />
                                <circle cx="7" cy="7" r="0.7" fill="#C4A882" opacity="0.4" />
                              </pattern>
                              <clipPath id="wellClip">
                                <rect
                                  [attr.x]="svgWellL + 4"
                                  [attr.y]="svgWellTop"
                                  [attr.width]="svgWellR - svgWellL - 8"
                                  [attr.height]="svgWellH"
                                />
                              </clipPath>
                            </defs>

                            <!-- Soil left -->
                            <rect
                              x="0"
                              [attr.y]="svgWellTop"
                              [attr.width]="svgWellL"
                              [attr.height]="svgWellH"
                              fill="url(#dots)"
                            />
                            <!-- Soil right (extended to SVG edge so annotation zone has background) -->
                            <rect
                              [attr.x]="svgWellR"
                              [attr.y]="svgWellTop"
                              [attr.width]="svgW - svgWellR"
                              [attr.height]="svgWellH"
                              fill="url(#dots)"
                            />

                            <!-- Ground surface band -->
                            <rect
                              x="0"
                              y="0"
                              [attr.width]="svgW"
                              [attr.height]="svgWellTop"
                              fill="#8B7355"
                              opacity="0.15"
                            />
                            <line
                              x1="0"
                              [attr.y1]="svgWellTop"
                              [attr.x2]="svgW"
                              [attr.y2]="svgWellTop"
                              stroke="#8B7355"
                              stroke-width="2"
                            />

                            <!-- Grass marks -->
                            @for (gx of svgGrassX; track gx) {
                              <line
                                [attr.x1]="gx"
                                [attr.y1]="svgWellTop"
                                [attr.x2]="gx - 3"
                                [attr.y2]="svgWellTop - 7"
                                stroke="#6B9B37"
                                stroke-width="1.5"
                                stroke-linecap="round"
                              />
                            }

                            <!-- Well casing — empty air gap -->
                            <rect
                              [attr.x]="svgWellL + 4"
                              [attr.y]="svgWellTop"
                              [attr.width]="svgWellR - svgWellL - 8"
                              [attr.height]="svgWaterY - svgWellTop"
                              fill="#F0F9FF"
                              opacity="0.9"
                            />

                            <!-- Water fill (gradient) -->
                            <rect
                              [attr.x]="svgWellL + 4"
                              [attr.y]="svgWaterY"
                              [attr.width]="svgWellR - svgWellL - 8"
                              [attr.height]="svgWellBot - svgWaterY"
                              fill="url(#wg)"
                              clip-path="url(#wellClip)"
                            />
                            <!-- Water shimmer overlay -->
                            <rect
                              [attr.x]="svgWellL + 4"
                              [attr.y]="svgWaterY"
                              [attr.width]="svgWellR - svgWellL - 8"
                              [attr.height]="svgWellBot - svgWaterY"
                              fill="url(#shimmer)"
                              clip-path="url(#wellClip)"
                            />
                            <!-- Surface refraction stripe -->
                            <rect
                              [attr.x]="svgWellL + 7"
                              [attr.y]="svgWaterY + 3"
                              [attr.width]="svgWellR - svgWellL - 16"
                              height="4"
                              fill="white"
                              opacity="0.28"
                              rx="2"
                              clip-path="url(#wellClip)"
                            />
                            <!-- Caustic light patches near bottom -->
                            <ellipse
                              [attr.cx]="svgTextCX - 9"
                              [attr.cy]="svgWellBot - 24"
                              rx="9"
                              ry="3"
                              fill="white"
                              opacity="0.07"
                              clip-path="url(#wellClip)"
                            />
                            <ellipse
                              [attr.cx]="svgTextCX + 7"
                              [attr.cy]="svgWellBot - 40"
                              rx="6"
                              ry="2"
                              fill="white"
                              opacity="0.05"
                              clip-path="url(#wellClip)"
                            />

                            <!-- Wave surface (primary, animated) -->
                            <g class="wdiag-w1" clip-path="url(#wellClip)">
                              <path
                                [attr.d]="svgWavePath"
                                fill="none"
                                stroke="rgba(255,255,255,0.65)"
                                stroke-width="2"
                                stroke-linecap="round"
                              />
                            </g>
                            <!-- Wave surface (secondary, animated opposite direction) -->
                            <g class="wdiag-w2" clip-path="url(#wellClip)">
                              <path
                                [attr.d]="svgWave2Path"
                                fill="none"
                                stroke="rgba(13,175,189,0.45)"
                                stroke-width="1.2"
                              />
                            </g>
                            <!-- Bubbles rising from bottom -->
                            <g clip-path="url(#wellClip)">
                              <circle
                                class="wdiag-b"
                                style="--d:4s;--e:0s"
                                cx="97"
                                [attr.cy]="svgWellBot - 22"
                                r="2"
                                fill="rgba(255,255,255,0.82)"
                              />
                              <circle
                                class="wdiag-b"
                                style="--d:5.5s;--e:1.4s"
                                cx="131"
                                [attr.cy]="svgWellBot - 40"
                                r="1.5"
                                fill="rgba(255,255,255,0.70)"
                              />
                              <circle
                                class="wdiag-b"
                                style="--d:3.8s;--e:2.7s"
                                cx="113"
                                [attr.cy]="svgWellBot - 13"
                                r="2.5"
                                fill="rgba(255,255,255,0.75)"
                              />
                              <circle
                                class="wdiag-b"
                                style="--d:5s;--e:0.6s"
                                cx="145"
                                [attr.cy]="svgWellBot - 52"
                                r="1.8"
                                fill="rgba(255,255,255,0.65)"
                              />
                              <circle
                                class="wdiag-b"
                                style="--d:4.3s;--e:3.8s"
                                cx="104"
                                [attr.cy]="svgWellBot - 30"
                                r="1.2"
                                fill="rgba(255,255,255,0.80)"
                              />
                              <circle
                                class="wdiag-b"
                                style="--d:6s;--e:2s"
                                cx="122"
                                [attr.cy]="svgWellBot - 8"
                                r="1.8"
                                fill="rgba(255,255,255,0.68)"
                              />
                            </g>

                            <!-- Fill % label inside water -->
                            @if (svgFillPct > 12) {
                              <text
                                [attr.x]="svgTextCX"
                                [attr.y]="svgTextWaterY"
                                font-size="15"
                                font-weight="700"
                                fill="white"
                                text-anchor="middle"
                                font-family="JetBrains Mono"
                                opacity="0.9"
                              >
                                {{ svgFillPct }}%
                              </text>
                            }

                            <!-- Well walls -->
                            <rect
                              [attr.x]="svgWellL"
                              [attr.y]="svgWellTop"
                              width="8"
                              [attr.height]="svgWellH"
                              fill="#94A3B8"
                              rx="2"
                            />
                            <rect
                              [attr.x]="svgWellR - 8"
                              [attr.y]="svgWellTop"
                              width="8"
                              [attr.height]="svgWellH"
                              fill="#94A3B8"
                              rx="2"
                            />
                            <rect
                              [attr.x]="svgWellL"
                              [attr.y]="svgWellBot - 6"
                              [attr.width]="svgWellR - svgWellL"
                              height="7"
                              fill="#64748B"
                              rx="2"
                            />

                            <!-- Sensor: only shown when depth data exists, right wall, proportional -->
                            @if (wellSensorDepth() !== null) {
                              <!-- Vertical depth guide from well top to sensor -->
                              <line
                                [attr.x1]="svgWellR - 4"
                                [attr.y1]="svgWellTop"
                                [attr.x2]="svgWellR - 4"
                                [attr.y2]="svgSensorY"
                                stroke="#F97316"
                                stroke-width="1"
                                stroke-dasharray="3 3"
                                opacity="0.35"
                              />
                              <!-- Horizontal indicator from right wall outward -->
                              <line
                                [attr.x1]="svgWellR"
                                [attr.y1]="svgSensorY"
                                [attr.x2]="svgWellR + 18"
                                [attr.y2]="svgSensorY"
                                stroke="#F97316"
                                stroke-width="1.5"
                                stroke-dasharray="3 2"
                              />
                              <!-- Sensor marker -->
                              <rect
                                [attr.x]="svgWellR + 18"
                                [attr.y]="svgSensorY - 5"
                                width="9"
                                height="10"
                                fill="#F97316"
                                rx="2"
                              />
                              <!-- Sensor label -->
                              <text
                                [attr.x]="svgWellR + 30"
                                [attr.y]="svgSensorY + 5"
                                font-size="12"
                                fill="#F97316"
                                font-family="DM Sans"
                                font-weight="600"
                              >
                                Sensor
                              </text>
                            }

                            <!-- RIGHT BRACKET: Superficie → Nivel Freático (dynamic) -->
                            <!-- Superficie circle (at ground level) -->
                            <circle
                              [attr.cx]="svgAnnotX"
                              [attr.cy]="svgWellTop"
                              r="3"
                              fill="#64748B"
                            />
                            <!-- Superficie label: left-center, higher above line -->
                            <text
                              x="124"
                              [attr.y]="svgWellTop - 16"
                              font-size="9"
                              fill="#64748B"
                              font-family="DM Sans"
                              font-weight="600"
                              text-anchor="middle"
                            >
                              Superficie
                            </text>

                            <!-- Vertical dashed line: Superficie → Nivel Freático -->
                            <line
                              [attr.x1]="svgAnnotX"
                              [attr.y1]="svgWellTop + 3"
                              [attr.x2]="svgAnnotX"
                              [attr.y2]="svgWaterY - 3"
                              stroke="#0DAFBD"
                              stroke-width="1.5"
                              stroke-dasharray="4 3"
                            />

                            <!-- Nivel Freático circle + horizontal line into well -->
                            <circle
                              [attr.cx]="svgAnnotX"
                              [attr.cy]="svgWaterY"
                              r="3"
                              fill="#0DAFBD"
                            />
                            <line
                              [attr.x1]="svgAnnotX"
                              [attr.y1]="svgWaterY"
                              [attr.x2]="svgWellR - 5"
                              [attr.y2]="svgWaterY"
                              stroke="#0DAFBD"
                              stroke-width="1.5"
                              stroke-dasharray="4 2"
                            />
                            <!-- Nivel Freático label: centered above the horizontal dashed line -->
                            <text
                              [attr.x]="(svgAnnotX + svgWellR - 5) / 2"
                              [attr.y]="svgWaterY - 7"
                              font-size="12"
                              fill="#0DAFBD"
                              font-family="DM Sans"
                              font-weight="700"
                              text-anchor="middle"
                            >
                              Nv. Freático
                            </text>

                            <!-- Left depth arrow -->
                            <line
                              [attr.x1]="svgWellL - 10"
                              [attr.y1]="svgWellTop + 2"
                              [attr.x2]="svgWellL - 10"
                              [attr.y2]="svgWellBot - 2"
                              stroke="#CBD5E1"
                              stroke-width="1"
                            />
                            <line
                              [attr.x1]="svgWellL - 14"
                              [attr.y1]="svgWellTop + 2"
                              [attr.x2]="svgWellL - 6"
                              [attr.y2]="svgWellTop + 2"
                              stroke="#CBD5E1"
                              stroke-width="1"
                            />
                            <line
                              [attr.x1]="svgWellL - 14"
                              [attr.y1]="svgWellBot - 2"
                              [attr.x2]="svgWellL - 6"
                              [attr.y2]="svgWellBot - 2"
                              stroke="#CBD5E1"
                              stroke-width="1"
                            />
                            <text
                              [attr.x]="svgWellL - 12"
                              [attr.y]="svgDepthMidY + 4"
                              font-size="13"
                              fill="#94A3B8"
                              font-family="JetBrains Mono"
                              text-anchor="middle"
                              [attr.transform]="
                                'rotate(-90,' + (svgWellL - 12) + ',' + svgDepthMidY + ')'
                              "
                            >
                              {{ wellTotalDepth() ?? 18 }}m prof.
                            </text>
                          </svg>
                        </div>
                        <!-- Stats column (derecha) -->
                        <div class="flex w-[124px] shrink-0 flex-col gap-2">
                          <app-well-stat-card
                            tone="primary"
                            label="Nv. Freático"
                            [value]="formatMeters(wellNivelFreatico())"
                            unit="m"
                            helper="desde superficie"
                          />
                          <app-well-stat-card
                            tone="neutral"
                            label="Llenado"
                            [value]="svgFillPct"
                            unit="%"
                          >
                            <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
                              <div
                                class="h-full rounded-full bg-gradient-to-r from-primary-container to-emerald-500"
                                [style.width.%]="wellFillStylePercent()"
                              ></div>
                            </div>
                          </app-well-stat-card>
                          <app-well-stat-card
                            tone="neutral"
                            size="md"
                            label="Prof. Total"
                            [value]="formatMeters(wellTotalDepth()) + ' m'"
                          />
                          <app-well-stat-card
                            tone="orange"
                            size="md"
                            label="Sensor"
                            [value]="formatMeters(wellSensorDepth()) + ' m'"
                          />
                          @if (wellSignalPercent() !== null) {
                            <app-well-stat-card
                              tone="blue"
                              label="% Señal"
                              [value]="wellSignalPercent() ?? ''"
                              unit="%"
                            >
                              <div class="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  class="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-500"
                                  [style.width.%]="wellSignalPercent()"
                                ></div>
                              </div>
                            </app-well-stat-card>
                          }
                          <app-well-stat-card
                            tone="neutral"
                            size="sm"
                            label="Último dato recibido"
                            [value]="latestDeviceTimeLabel()"
                            [helper]="latestDeviceDateLabel()"
                          />
                        </div>
                      </div>
                    }
                  </article>
                </div>

                <div class="flex flex-col gap-5 xl:h-full">
                  <article
                    class="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_0_0_1px_rgba(8,145,178,0.04),0_12px_30px_rgba(15,23,42,0.06)]"
                  >
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="flex min-w-0 items-center gap-3">
                        <span
                          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"
                        >
                          <span class="material-symbols-outlined text-[22px]">bar_chart</span>
                        </span>
                        <div class="min-w-0">
                          <h2 class="truncate text-h5 font-semibold leading-none text-slate-800">
                            Flujo Mensual
                          </h2>
                          <p class="mt-1 text-body-sm font-bold text-slate-500">
                            Volumen acumulado en {{ monthlyFlowUnit() }}
                          </p>
                        </div>
                      </div>

                      <div class="flex items-center gap-3 text-caption font-bold text-slate-500">
                        <span class="inline-flex items-center gap-1.5">
                          <span class="material-symbols-outlined text-[16px]">info</span>
                          Últimos 12 meses
                        </span>
                        <button
                          type="button"
                          class="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-slate-50"
                          aria-label="Opciones de grafico"
                        >
                          <span class="material-symbols-outlined text-[18px]">more_vert</span>
                        </button>
                      </div>
                    </div>

                    @if (monthlyCountersLoading()) {
                      <div class="mt-5">
                        <app-chart-skeleton [bars]="12" [height]="250" />
                      </div>
                    } @else {
                      <div class="mt-5 grid grid-cols-[58px_minmax(0,1fr)] gap-2">
                        <div
                          class="grid h-[250px] grid-rows-5 text-right text-caption font-semibold text-slate-400"
                        >
                          @for (tick of monthlyFlowTicks(); track $index) {
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

                          <div
                            class="absolute inset-x-2 bottom-0 top-0 flex items-end justify-between gap-2"
                          >
                            @for (month of monthlyFlowMonths(); track $index) {
                              <div
                                class="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
                              >
                                <div
                                  class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1.5 text-caption-xs font-semibold text-white shadow-lg group-hover:block"
                                >
                                  <div class="font-bold">{{ month.label }}</div>
                                  <div class="font-mono">
                                    {{ formatMonthlyFlowValue(month.value) }}
                                    {{ monthlyFlowUnit() }}
                                  </div>
                                  @if (month.proyeccion) {
                                    <div class="font-mono text-slate-300">
                                      proy. {{ formatMonthlyFlowValue(month.proyeccion) }}
                                      {{ monthlyFlowUnit() }}
                                    </div>
                                  }
                                  <div
                                    class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-800"
                                  ></div>
                                </div>
                                <div
                                  class="mx-auto flex w-full max-w-[28px] flex-col justify-end overflow-hidden rounded-t"
                                  [style.height.%]="
                                    month.proyeccion && month.proyeccion > month.value
                                      ? getMonthlyFlowHeight(month.proyeccion)
                                      : getMonthlyFlowHeight(month.value)
                                  "
                                >
                                  @if (month.proyeccion && month.proyeccion > month.value) {
                                    <div
                                      class="w-full bg-[#5874c8]/30"
                                      [style.height.%]="getMonthlyFlowProjectionExtra(month)"
                                    ></div>
                                  }
                                  <div
                                    class="w-full bg-[#5874c8] shadow-sm transition-opacity group-hover:opacity-85"
                                    [style.flex]="'1 1 auto'"
                                  ></div>
                                </div>
                              </div>
                            }
                          </div>
                        </div>
                      </div>

                      <div
                        class="ml-[66px] mt-2 flex h-10 justify-between gap-2 px-2 text-caption-xs font-bold text-slate-400"
                      >
                        @for (month of monthlyFlowMonths(); track $index) {
                          <div class="relative h-full min-w-0 flex-1">
                            <span
                              class="absolute right-1/2 top-1 origin-top-right -rotate-45 whitespace-nowrap"
                              >{{ month.label }}</span
                            >
                          </div>
                        }
                      </div>
                    }
                  </article>

                  <article
                    class="flex flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <p class="mb-2 text-body-sm font-semibold text-slate-700">Acciones Rápidas</p>
                    <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                      @for (action of quickActions; track action.title) {
                        <button
                          type="button"
                          (click)="handleQuickAction(action)"
                          [disabled]="quickActionDisabled(action)"
                          [title]="quickActionTitle(action)"
                          [class]="
                            quickActionDisabled(action)
                              ? 'rounded-lg px-3 py-2 text-left opacity-50 cursor-not-allowed'
                              : 'rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary-tint-06 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30'
                          "
                        >
                          <span
                            [class]="
                              quickActionDisabled(action)
                                ? 'material-symbols-outlined text-[20px] text-slate-400'
                                : 'material-symbols-outlined text-[20px] ' + action.color
                            "
                            >{{ action.icon }}</span
                          >
                          <p
                            [class]="
                              quickActionDisabled(action)
                                ? 'mt-0.5 text-body-sm font-semibold text-slate-500'
                                : 'mt-0.5 text-body-sm font-semibold text-slate-800'
                            "
                          >
                            {{ action.title }}
                          </p>
                          <p class="text-caption font-medium text-slate-500">
                            {{ action.subtitle }}
                          </p>
                          @if (quickActionDisabled(action)) {
                            <p class="mt-1 text-caption-xs italic text-amber-600">
                              {{ quickActionTitle(action) }}
                            </p>
                          }
                        </button>
                      }
                    </div>
                  </article>
                </div>
              </section>
              <!-- Registros DGA -->
              <section
                class="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
              >
                <div
                  class="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div>
                    <h2 class="text-body-sm font-semibold text-slate-800">Detalle de Registros</h2>
                    <p class="mt-1 text-caption font-semibold text-slate-500">
                      Reportes completos enviados a la DGA
                    </p>
                  </div>

                  <div class="flex flex-wrap items-center gap-2 text-caption font-bold">
                    <button
                      type="button"
                      (click)="openDgaDateFilter()"
                      class="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-slate-600 transition-colors hover:border-primary-tint-30 hover:bg-primary-tint-08 hover:text-primary-container"
                    >
                      <span class="material-symbols-outlined text-[16px]">calendar_month</span>
                      {{ dgaSelectedRangeLabel() }}
                    </button>
                    <span class="text-slate-500">{{ dgaTotalRecordsLabel() }}</span>
                  </div>
                </div>

                <div class="overflow-x-auto">
                  @if (dgaLoading()) {
                    <div class="p-3">
                      <app-table-skeleton [rows]="6" [columns]="5" [showHeader]="false" />
                    </div>
                  } @else {
                    <table class="responsive-table w-full text-left text-body-sm md:min-w-[960px]">
                      <thead class="bg-slate-50">
                        <tr class="border-b border-slate-100">
                          @for (
                            h of [
                              'Fecha',
                              'Nv. Freático [m]',
                              'Caudal [l/s]',
                              'Totalizador [m³]',
                              'Estado',
                            ];
                            track h
                          ) {
                            <th class="dga-table-header">{{ h }}</th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (report of paginatedDgaReports(); track report.id) {
                          <tr class="border-b border-slate-100">
                            <td class="dga-table-cell dga-table-cell--muted" data-label="Fecha">
                              {{ report.fecha }}
                            </td>
                            <td class="dga-table-cell" data-label="Nv. freático">
                              {{ formatDgaNumber(report.nivelFreatico) }}
                            </td>
                            <td class="dga-table-cell" data-label="Caudal">
                              {{ formatDgaNumber(report.caudal) }}
                            </td>
                            <td class="dga-table-cell" data-label="Totalizador">
                              {{ formatDgaInteger(report.totalizador) }}
                            </td>
                            <td class="px-4 py-3" data-label="Estado">
                              <div class="flex flex-col gap-1">
                                <div class="inline-flex items-center gap-2">
                                  <button
                                    type="button"
                                    (click)="openDgaReportDetail(report)"
                                    class="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-caption-xs font-semibold transition-colors"
                                    [style.background]="getDgaStatusBg(report.estado)"
                                    [style.border-color]="getDgaStatusBorder(report.estado)"
                                    [style.color]="getDgaStatusColor(report.estado)"
                                  >
                                    <span
                                      class="h-[5px] w-[5px] rounded-full"
                                      [style.background]="getDgaStatusColor(report.estado)"
                                    ></span>
                                    {{ report.estado }}
                                    <span class="material-symbols-outlined text-[13px]"
                                      >chevron_right</span
                                    >
                                  </button>
                                  @if (
                                    report.estado === 'Enviado' &&
                                      comprobanteUrl(report.comprobante);
                                    as snia
                                  ) {
                                    <a
                                      [href]="snia"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      (click)="$event.stopPropagation()"
                                      [title]="'Ver comprobante en SNIA: ' + report.comprobante"
                                      class="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 transition-colors hover:bg-emerald-100"
                                    >
                                      <span class="material-symbols-outlined text-[14px]"
                                        >receipt_long</span
                                      >
                                    </a>
                                  }
                                </div>
                                @if (
                                  report.estado === 'Rechazado' ||
                                  report.estado === 'Fallido' ||
                                  report.estado === 'Revisar'
                                ) {
                                  <p
                                    class="max-w-[420px] text-caption-xs font-medium leading-snug text-slate-500"
                                  >
                                    {{ report.respuesta }}
                                  </p>
                                }
                              </div>
                            </td>
                          </tr>
                        } @empty {
                          <tr>
                            <td
                              colspan="5"
                              class="px-4 py-8 text-center text-body-sm font-semibold text-slate-500"
                              data-label=""
                            >
                              Sin registros para el periodo seleccionado.
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  }
                </div>

                <div
                  class="flex flex-wrap items-center justify-end gap-5 border-t border-slate-100 px-4 py-3 text-caption font-semibold text-slate-500"
                >
                  <label class="inline-flex items-center gap-2">
                    Filas por pagina:
                    <select
                      [value]="dgaRowsPerPage()"
                      (change)="setDgaRowsPerPage($event)"
                      class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-slate-600 outline-none focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    >
                      @for (size of dgaRowsPerPageOptions; track size) {
                        <option [value]="size">{{ size }}</option>
                      }
                    </select>
                  </label>
                  <span
                    >{{ dgaRangeStart() }} - {{ dgaRangeEnd() }} de {{ dgaDisplayedTotal() }}</span
                  >
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      (click)="previousDgaPage()"
                      [disabled]="dgaPage() === 1"
                      class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Pagina anterior"
                    >
                      <span class="material-symbols-outlined text-[18px]">chevron_left</span>
                    </button>
                    <button
                      type="button"
                      (click)="nextDgaPage()"
                      [disabled]="dgaPage() === dgaTotalPages()"
                      class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Pagina siguiente"
                    >
                      <span class="material-symbols-outlined text-[18px]">chevron_right</span>
                    </button>
                  </div>
                </div>
              </section>
            </div>
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

      @if (dgaDateFilterOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]"
          (click)="closeDgaDateFilter()"
        >
          <section
            class="w-full max-w-[820px] overflow-hidden rounded-2xl bg-white shadow-2xl"
            (click)="$event.stopPropagation()"
            role="dialog"
            cdkTrapFocus
            cdkTrapFocusAutoCapture
            aria-modal="true"
            aria-labelledby="dga-date-filter-title"
          >
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-tint-08 text-primary-container"
                >
                  <span class="material-symbols-outlined text-[20px]">calendar_month</span>
                </span>
                <div>
                  <h2 id="dga-date-filter-title" class="text-h6 font-semibold text-slate-800">
                    Filtrar por Período
                  </h2>
                  <p class="text-caption font-semibold text-slate-500">Registros DGA</p>
                </div>
              </div>
              <button
                type="button"
                (click)="closeDgaDateFilter()"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                aria-label="Cerrar"
              >
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
              <!-- Left: presets + months -->
              <div class="border-b border-slate-100 px-5 py-5 md:border-b-0 md:border-r">
                <p
                  class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Períodos rápidos
                </p>
                <div class="grid gap-0.5">
                  @for (preset of downloadPresets; track preset.id) {
                    <button
                      type="button"
                      (click)="applyDgaDatePreset(preset.id)"
                      [class]="
                        dgaSelectedPreset() === preset.id
                          ? 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm font-bold bg-primary-tint-08 text-primary-container border border-primary-tint-25'
                          : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm font-semibold text-slate-600 hover:bg-slate-50'
                      "
                    >
                      @if (dgaSelectedPreset() === preset.id) {
                        <span class="h-1.5 w-1.5 rounded-full bg-primary/10 flex-shrink-0"></span>
                      }
                      {{ preset.label }}
                    </button>
                  }
                </div>

                <p
                  class="mb-2 mt-5 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Meses {{ 'de ' + (dgaDateFrom() || '2026').slice(0, 4) }}
                </p>
                <div class="grid grid-cols-3 gap-1.5">
                  @for (month of downloadMonthNames; track month; let i = $index) {
                    <button
                      type="button"
                      (click)="applyDgaMonth(i)"
                      [class]="
                        !dgaMonthHasData(i)
                          ? 'rounded-lg py-1.5 text-caption-xs font-semibold bg-slate-50 text-slate-300 cursor-not-allowed select-none'
                          : dgaSelectedMonths().includes(i)
                            ? 'rounded-lg py-1.5 text-caption-xs font-bold bg-primary text-white ring-2 ring-[rgba(13,175,189,0.45)]'
                            : 'rounded-lg py-1.5 text-caption-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors'
                      "
                    >
                      {{ month.slice(0, 3) }}
                    </button>
                  }
                </div>
                <p class="mt-2 text-caption-xs font-semibold text-slate-300">
                  Verde = datos disponibles
                </p>
              </div>

              <!-- Right: range display + date inputs -->
              <div class="px-6 py-5">
                <div
                  class="mb-5 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p class="text-caption-xs font-bold uppercase tracking-wide text-slate-400">
                      Rango seleccionado
                    </p>
                    <p class="mt-0.5 text-body-sm font-semibold text-slate-700">
                      {{ dgaModalRangeLabel() }}
                    </p>
                  </div>
                  <span
                    class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-caption-xs font-bold text-slate-500"
                  >
                    {{ dgaModalDaysCount() > 0 ? dgaModalDaysCount() + ' días' : '—' }}
                  </span>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <label class="grid gap-1.5 text-caption font-bold text-slate-600">
                    Desde
                    <input
                      type="date"
                      min="2020-01-01"
                      [value]="dgaDateFrom()"
                      (input)="
                        setDgaDateFrom($event);
                        dgaSelectedPreset.set('custom');
                        dgaSelectedMonths.set([])
                      "
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    />
                  </label>
                  <label class="grid gap-1.5 text-caption font-bold text-slate-600">
                    Hasta
                    <input
                      type="date"
                      min="2020-01-01"
                      [value]="dgaDateTo()"
                      (input)="
                        setDgaDateTo($event);
                        dgaSelectedPreset.set('custom');
                        dgaSelectedMonths.set([])
                      "
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4 text-body-sm font-semibold"
            >
              <button
                type="button"
                (click)="
                  clearDgaDateFilter(); dgaSelectedPreset.set(null); dgaSelectedMonths.set([])
                "
                class="text-slate-500 transition-colors hover:text-slate-800"
              >
                Limpiar selección
              </button>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  (click)="closeDgaDateFilter()"
                  class="rounded-lg px-4 py-2 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  (click)="applyDgaDateFilter()"
                  class="rounded-lg bg-primary px-4 py-2 font-semibold text-white transition-colors hover:bg-[var(--color-primary-container)]"
                >
                  Aplicar filtro
                </button>
              </div>
            </div>
          </section>
        </div>
      }

      @if (downloadModalOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]"
          (click)="closeDownloadModal()"
        >
          <section
            class="w-full max-w-[820px] overflow-hidden rounded-2xl bg-white shadow-2xl"
            (click)="$event.stopPropagation()"
            role="dialog"
            cdkTrapFocus
            cdkTrapFocusAutoCapture
            aria-modal="true"
            aria-labelledby="download-modal-title"
          >
            <!-- Modal header -->
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"
                >
                  <span class="material-symbols-outlined text-[20px]">download</span>
                </span>
                <div>
                  <h2 id="download-modal-title" class="text-h6 font-semibold text-slate-800">
                    Exportar Datos
                  </h2>
                  @if (siteContext(); as ctx) {
                    <p class="text-caption font-semibold text-slate-500">
                      {{ getSiteName(ctx) }}
                    </p>
                  }
                </div>
              </div>
              <button
                type="button"
                (click)="closeDownloadModal()"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                aria-label="Cerrar"
              >
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
              <!-- Left panel: presets + month selector -->
              <div class="border-b border-slate-100 px-5 py-5 md:border-b-0 md:border-r">
                <p
                  class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Períodos rápidos
                </p>
                <div class="grid gap-0.5">
                  @for (preset of downloadPresets; track preset.id) {
                    <button
                      type="button"
                      (click)="applyDownloadPreset(preset.id)"
                      [class]="
                        downloadSelectedPreset() === preset.id
                          ? 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm font-bold bg-primary-tint-08 text-primary-container border border-primary-tint-25'
                          : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm font-semibold text-slate-600 hover:bg-slate-50'
                      "
                    >
                      @if (downloadSelectedPreset() === preset.id) {
                        <span class="h-1.5 w-1.5 rounded-full bg-primary/10 flex-shrink-0"></span>
                      }
                      {{ preset.label }}
                    </button>
                  }
                </div>

                <p
                  class="mb-2 mt-5 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Meses {{ 'de ' + (downloadDateFrom() || '2026').slice(0, 4) }}
                </p>
                <div class="grid grid-cols-3 gap-1.5">
                  @for (month of downloadMonthNames; track month; let i = $index) {
                    <button
                      type="button"
                      (click)="applyDownloadMonth(i)"
                      [class]="
                        !downloadMonthHasData(i)
                          ? 'rounded-lg py-1.5 text-caption-xs font-semibold bg-slate-50 text-slate-300 cursor-not-allowed select-none'
                          : downloadSelectedMonths().includes(i)
                            ? 'rounded-lg py-1.5 text-caption-xs font-bold bg-primary text-white ring-2 ring-[rgba(13,175,189,0.45)]'
                            : 'rounded-lg py-1.5 text-caption-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors'
                      "
                    >
                      {{ month.slice(0, 3) }}
                    </button>
                  }
                </div>
                <p class="mt-2 text-caption-xs font-semibold text-slate-300">
                  Verde = datos disponibles
                </p>
              </div>

              <!-- Right panel: date range + data types + format -->
              <div class="px-6 py-5">
                <!-- Selected range pill -->
                <div
                  class="mb-5 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3"
                >
                  <div>
                    <p class="text-caption-xs font-bold uppercase tracking-wide text-slate-400">
                      Rango seleccionado
                    </p>
                    <p class="mt-0.5 text-body-sm font-semibold text-slate-700">
                      {{ downloadRangeLabel() }}
                    </p>
                  </div>
                  <span
                    class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-caption-xs font-bold text-slate-500"
                  >
                    {{ downloadDaysCount() > 0 ? downloadDaysCount() + ' días' : '—' }}
                  </span>
                </div>

                <!-- Custom date range -->
                <div class="mb-5 grid gap-3 sm:grid-cols-2">
                  <label class="grid gap-1.5 text-caption font-bold text-slate-600">
                    Desde
                    <input
                      type="date"
                      min="2020-01-01"
                      [value]="downloadDateFrom()"
                      (input)="
                        downloadDateFrom.set($any($event.target).value);
                        downloadSelectedPreset.set('custom');
                        downloadSelectedMonths.set([])
                      "
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    />
                  </label>
                  <label class="grid gap-1.5 text-caption font-bold text-slate-600">
                    Hasta
                    <input
                      type="date"
                      min="2020-01-01"
                      [value]="downloadDateTo()"
                      (input)="
                        downloadDateTo.set($any($event.target).value);
                        downloadSelectedPreset.set('custom');
                        downloadSelectedMonths.set([])
                      "
                      class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                    />
                  </label>
                </div>

                <!-- Data types -->
                <p
                  class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Datos a incluir
                </p>
                <div class="mb-5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  @for (dtype of downloadDataTypeOptions; track dtype.id) {
                    <button
                      type="button"
                      (click)="toggleDownloadDataType(dtype.id)"
                      [class]="
                        isDownloadTypeSelected(dtype.id)
                          ? 'rounded-lg border border-primary-tint-55 bg-primary-tint-08 px-3 py-2.5 text-center text-body-sm font-bold text-primary-container transition-all'
                          : 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-center text-body-sm font-semibold text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50'
                      "
                    >
                      {{ dtype.label }}
                    </button>
                  }
                </div>

                <!-- Granularity -->
                <p
                  class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Granularidad
                </p>
                <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  @for (gran of downloadGranularityOptions; track gran.id) {
                    <button
                      type="button"
                      (click)="downloadGranularity.set(gran.id)"
                      [title]="gran.hint"
                      [class]="
                        downloadGranularity() === gran.id
                          ? 'rounded-lg border border-primary-tint-55 bg-primary-tint-08 px-2 py-2 text-center text-caption font-bold text-primary-container transition-all'
                          : 'rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-caption font-semibold text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50'
                      "
                    >
                      {{ gran.label }}
                    </button>
                  }
                </div>
                <div
                  class="mb-5 mt-3 flex items-start gap-2 rounded-xl border border-primary-tint-25 bg-primary-tint-08 px-3 py-2.5 text-caption font-semibold text-primary-container"
                >
                  <span class="material-symbols-outlined mt-0.5 text-[16px]">schedule</span>
                  <span>{{ downloadWorkloadLabel() }}</span>
                </div>

                <!-- Format -->
                <p
                  class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
                >
                  Formato de archivo
                </p>
                <div class="flex gap-2">
                  <button
                    type="button"
                    (click)="downloadFormat.set('csv')"
                    [class]="
                      downloadFormat() === 'csv'
                        ? 'flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-body-sm font-bold text-emerald-700'
                        : 'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-body-sm font-semibold text-slate-600 hover:bg-slate-50'
                    "
                  >
                    <span class="material-symbols-outlined text-[16px]">csv</span>
                    CSV
                  </button>
                </div>
              </div>
            </div>

            <!-- Modal footer -->
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4"
            >
              @if (downloadError()) {
                <p class="basis-full text-caption font-semibold text-rose-500">
                  {{ downloadError() }}
                </p>
              }
              <p
                class="text-caption font-semibold"
                [class]="downloadError() ? 'text-rose-500' : 'text-slate-500'"
              >
                {{
                  downloadSelectedTypes().length === 0
                    ? 'Selecciona al menos un dato'
                    : downloadSelectedTypes().length +
                      ' variable' +
                      (downloadSelectedTypes().length > 1 ? 's' : '') +
                      ' · ' +
                      downloadFormat().toUpperCase()
                }}
              </p>
              <div class="flex items-center gap-3">
                <button
                  type="button"
                  (click)="closeDownloadModal()"
                  class="rounded-lg px-4 py-2 text-body-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  (click)="executeDownload()"
                  [disabled]="
                    downloadBusy() ||
                    downloadSelectedTypes().length === 0 ||
                    !downloadDateFrom() ||
                    !downloadDateTo()
                  "
                  class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span class="material-symbols-outlined text-[17px]">download</span>
                  {{ downloadBusy() ? 'Generando...' : 'Descargar' }}
                </button>
              </div>
            </div>
          </section>
        </div>
      }

      @if (dgaReportModalOpen()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]"
          (click)="closeDgaReportModal()"
        >
          <section
            class="w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-2xl"
            (click)="$event.stopPropagation()"
            role="dialog"
            cdkTrapFocus
            cdkTrapFocusAutoCapture
            aria-modal="true"
            aria-labelledby="dga-report-modal-title"
          >
            <!-- Header -->
            <div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"
                >
                  <span class="material-symbols-outlined text-[18px]">description</span>
                </span>
                <div>
                  <h2 id="dga-report-modal-title" class="text-body font-semibold text-slate-800">
                    Reporte DGA
                  </h2>
                  <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                    Formato oficial · período a exportar
                  </p>
                </div>
              </div>
              <button
                type="button"
                (click)="closeDgaReportModal()"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
              >
                <span class="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <!-- Presets rápidos -->
            <div class="px-5 pt-4">
              <p
                class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              >
                Período rápido
              </p>
              <div class="grid grid-cols-3 gap-1.5">
                @for (preset of downloadPresets; track preset.id) {
                  <button
                    type="button"
                    (click)="applyDgaReportPreset(preset.id)"
                    [class]="
                      dgaReportSelectedPreset() === preset.id
                        ? 'rounded-lg border border-accent/30 bg-accent/10 px-2 py-2 text-center text-caption-xs font-bold text-accent-deep transition-all'
                        : 'rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-caption-xs font-semibold text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50'
                    "
                  >
                    {{ preset.label }}
                  </button>
                }
              </div>
            </div>

            <!-- Meses -->
            <div class="px-5 pt-4">
              <p
                class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
              >
                Meses {{ 'de ' + (dgaReportDateFrom() || '2026').slice(0, 4) }}
              </p>
              <div class="grid grid-cols-6 gap-1.5">
                @for (month of downloadMonthNames; track month; let i = $index) {
                  <button
                    type="button"
                    (click)="applyDgaReportMonth(i)"
                    [class]="
                      !dgaMonthHasData(i)
                        ? 'rounded-lg py-1.5 text-caption-xs font-semibold bg-slate-50 text-slate-300 cursor-not-allowed'
                        : dgaReportSelectedMonths().includes(i)
                          ? 'rounded-lg py-1.5 text-caption-xs font-bold bg-accent-container text-white ring-2 ring-accent/30'
                          : 'rounded-lg py-1.5 text-caption-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors'
                    "
                  >
                    {{ month.slice(0, 3) }}
                  </button>
                }
              </div>
            </div>

            <!-- Rango manual -->
            <div class="grid grid-cols-2 gap-3 px-5 pt-4">
              <label class="grid gap-1.5 text-caption-xs font-bold text-slate-500">
                Desde
                <input
                  type="date"
                  min="2020-01-01"
                  [value]="dgaReportDateFrom()"
                  (input)="
                    dgaReportDateFrom.set($any($event.target).value);
                    dgaReportSelectedPreset.set('custom');
                    dgaReportSelectedMonths.set([])
                  "
                  class="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-700 outline-none transition-colors focus:border-accent/30 focus:ring-2 focus:ring-accent/10"
                />
              </label>
              <label class="grid gap-1.5 text-caption-xs font-bold text-slate-500">
                Hasta
                <input
                  type="date"
                  min="2020-01-01"
                  [value]="dgaReportDateTo()"
                  (input)="
                    dgaReportDateTo.set($any($event.target).value);
                    dgaReportSelectedPreset.set('custom');
                    dgaReportSelectedMonths.set([])
                  "
                  class="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-700 outline-none transition-colors focus:border-accent/30 focus:ring-2 focus:ring-accent/10"
                />
              </label>
            </div>

            <!-- Granularidad del CSV -->
            <div class="mt-4 border-t border-slate-100 px-5 pt-4 pb-2">
              <label class="text-caption-xs uppercase tracking-wider font-semibold text-slate-500">
                Granularidad de los datos en el CSV
              </label>
              <div class="mt-2 grid grid-cols-5 gap-2">
                @for (opt of dgaReportBucketOptions; track opt.value) {
                  <button
                    type="button"
                    (click)="dgaReportBucket.set(opt.value)"
                    [class]="
                      dgaReportBucket() === opt.value
                        ? 'rounded-lg border border-accent bg-accent/10 px-2 py-1.5 text-caption-xs font-semibold text-accent-container'
                        : 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-caption-xs font-semibold text-slate-600 hover:border-accent/20 hover:text-accent-container'
                    "
                  >
                    {{ opt.label }}
                  </button>
                }
              </div>
              <p class="mt-1 text-caption-xs text-slate-500">
                1 fila por bucket. La medición es la más reciente dentro del bucket.
              </p>
            </div>

            <!-- Orden de los datos -->
            <div class="px-5 pt-2 pb-2">
              <label class="text-caption-xs uppercase tracking-wider font-semibold text-slate-500">
                Orden de los datos
              </label>
              <div class="mt-2 grid grid-cols-2 gap-2">
                @for (opt of dgaReportOrdenOptions; track opt.value) {
                  <button
                    type="button"
                    (click)="dgaReportOrden.set(opt.value)"
                    [class]="
                      dgaReportOrden() === opt.value
                        ? 'rounded-lg border border-accent bg-accent/10 px-2 py-1.5 text-caption-xs font-semibold text-accent-container'
                        : 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-caption-xs font-semibold text-slate-600 hover:border-accent/20 hover:text-accent-container'
                    "
                  >
                    {{ opt.label }}
                  </button>
                }
              </div>
            </div>

            <!-- Errores generales del modal de reporte -->
            @if (dgaReportError()) {
              <div
                class="mx-5 mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-caption text-red-700"
              >
                <span class="material-symbols-outlined text-[16px]">error</span>
                <span>{{ dgaReportError() }}</span>
              </div>
            }
            <p class="px-5 py-2 text-caption-xs text-slate-500 italic">
              Para configurar informantes, transport y caudal máx del pozo, usá el botón
              <span class="font-semibold text-primary-container">Configurar reporte DGA</span> del
              panel de Settings del pozo.
            </p>

            <!-- Footer: rango + acción -->
            <div
              class="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4"
            >
              <div>
                <p class="text-caption font-semibold text-slate-700">
                  {{ dgaReportRangeLabel() }}
                </p>
                <p class="text-caption-xs font-semibold text-slate-500">
                  {{ dgaReportDaysCount() > 0 ? dgaReportDaysCount() + ' días' : '—' }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  (click)="closeDgaReportModal()"
                  [disabled]="dgaReportDownloading()"
                  class="rounded-lg px-3 py-2 text-body-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  (click)="generateDgaReport()"
                  [disabled]="!dgaReportDateFrom() || !dgaReportDateTo() || dgaReportDownloading()"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-accent-container px-4 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-40"
                >
                  @if (dgaReportDownloading()) {
                    <span class="material-symbols-outlined animate-spin text-[16px]">sync</span>
                    Descargando
                  } @else {
                    <span class="material-symbols-outlined text-[16px]">download</span>
                    Descargar CSV DGA
                  }
                </button>
              </div>
            </div>
          </section>
        </div>
      }

      @if (selectedDgaReport(); as report) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-[2px]"
          (click)="closeDgaReportDetail()"
        >
          <section
            class="w-full max-w-[740px] overflow-hidden rounded-2xl bg-white shadow-2xl"
            (click)="$event.stopPropagation()"
            role="dialog"
            cdkTrapFocus
            cdkTrapFocusAutoCapture
            aria-modal="true"
            aria-labelledby="dga-report-detail-title"
          >
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <h2
                id="dga-report-detail-title"
                class="text-h5 font-semibold uppercase tracking-wide text-slate-800"
              >
                Seguimiento de envío
              </h2>
              <button
                type="button"
                (click)="closeDgaReportDetail()"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                aria-label="Cerrar seguimiento"
              >
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="bg-slate-50 p-6">
              <div class="mx-auto max-w-[620px]">
                <div class="mb-5 flex items-center gap-3">
                  <span
                    class="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-tint-14 text-primary-container"
                  >
                    <span class="material-symbols-outlined text-[22px]">assignment</span>
                  </span>
                  <div>
                    <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                      Registro {{ report.recordId }}
                    </p>
                    <p class="text-h6 font-semibold text-slate-800">
                      {{ report.fecha }}
                    </p>
                  </div>
                </div>

                <div
                  class="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3"
                >
                  <div class="px-5 py-5 text-center">
                    <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                      Nivel freatico
                    </p>
                    <p class="mt-2 text-h4 font-semibold text-slate-800">
                      {{ formatDgaNumber(report.nivelFreatico) }}
                    </p>
                    <p class="mt-1 text-caption font-bold text-slate-400">m</p>
                  </div>
                  <div
                    class="border-y border-slate-100 px-5 py-5 text-center sm:border-x sm:border-y-0"
                  >
                    <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                      Caudal
                    </p>
                    <p class="mt-2 text-h4 font-semibold text-slate-800">
                      {{ formatDgaNumber(report.caudal) }}
                    </p>
                    <p class="mt-1 text-caption font-bold text-slate-400">l/s</p>
                  </div>
                  <div class="px-5 py-5 text-center">
                    <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                      Totalizado
                    </p>
                    <p class="mt-2 text-h4 font-semibold text-slate-800">
                      {{ formatDgaInteger(report.totalizador) }}
                    </p>
                    <p class="mt-1 text-caption font-bold text-slate-400">m&sup3;</p>
                  </div>
                </div>

                <div class="mt-6 flex items-center justify-between gap-4">
                  <div class="flex items-center gap-3">
                    <span
                      class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"
                    >
                      <span class="material-symbols-outlined text-[22px]">send</span>
                    </span>
                    <div>
                      <p
                        class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400"
                      >
                        Envío a DGA
                      </p>
                      <p class="text-body-sm font-semibold text-slate-800">
                        {{ report.enviadoDga }}
                      </p>
                    </div>
                  </div>

                  <span
                    class="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-caption font-semibold text-emerald-700"
                  >
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    Completado
                  </span>
                </div>

                <div class="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                    Respuesta del software de DGA
                  </p>
                  <p class="mt-4 text-body-sm font-semibold text-slate-700">Respuesta</p>
                  <p class="mt-1 text-body-sm text-slate-600">
                    {{ report.respuesta }}
                  </p>
                  <p class="mt-4 text-body-sm font-semibold text-slate-700">N&deg; Comprobante</p>
                  @if (report.comprobante) {
                    @if (comprobanteUrl(report.comprobante); as url) {
                      <a
                        [href]="url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="mt-1 inline-flex items-center gap-2 text-body-sm font-bold text-primary-container hover:text-primary-container hover:underline"
                        [title]="'Abrir en portal SNIA: ' + url"
                      >
                        <span class="font-mono">{{ report.comprobante }}</span>
                        <span class="material-symbols-outlined text-[16px]">open_in_new</span>
                      </a>
                    } @else {
                      <p
                        class="mt-1 inline-flex items-center gap-2 text-body-sm font-bold text-slate-600"
                        [title]="'Carga el número de obra del pozo para habilitar el link al portal SNIA'"
                      >
                        <span class="font-mono">{{ report.comprobante }}</span>
                      </p>
                    }
                  } @else {
                    <p class="mt-1 text-body-sm italic text-slate-500">sin comprobante</p>
                  }
                </div>
              </div>
            </div>
          </section>
        </div>
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
  private readonly dgaService = inject(DgaService);
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
  dgaReportDownloading = signal<boolean>(false);
  dgaReportError = signal<string>('');
  dgaReportBucket = signal<'minuto' | 'hora' | 'dia' | 'semana' | 'mes'>('hora');
  readonly dgaReportBucketOptions: {
    value: 'minuto' | 'hora' | 'dia' | 'semana' | 'mes';
    label: string;
  }[] = [
    { value: 'minuto', label: 'Cada minuto' },
    { value: 'hora', label: 'Cada hora' },
    { value: 'dia', label: 'Cada día' },
    { value: 'semana', label: 'Cada semana' },
    { value: 'mes', label: 'Cada mes' },
  ];
  dgaReportOrden = signal<'asc' | 'desc'>('asc');
  readonly dgaReportOrdenOptions: { value: 'asc' | 'desc'; label: string }[] = [
    { value: 'asc', label: 'Ascendente (antiguo → reciente)' },
    { value: 'desc', label: 'Descendente (reciente → antiguo)' },
  ];
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
  dgaDateFilterOpen = signal(false);
  selectedDgaReport = signal<DgaReportRow | null>(null);
  /** Default = primer día del mes actual y hoy (Chile UTC-4). Evita hardcodes que dejan la tabla vacía. */
  dgaDateFrom = signal(chileMonthStart());
  dgaDateTo = signal(chileToday());
  dgaRowsPerPage = signal(10);
  dgaPage = signal(1);
  downloadModalOpen = signal(false);
  downloadSelectedPreset = signal<string | null>('last30');
  downloadSelectedMonths = signal<number[]>([]);
  downloadDateFrom = signal('');
  downloadDateTo = signal('');
  downloadFormat = signal<'xlsx' | 'csv'>('csv');
  downloadSelectedTypes = signal<string[]>(['caudal', 'nivel', 'totalizador', 'nivel_freatico']);
  downloadGranularity = signal<HistoryGranularity>('1m');
  downloadBusy = signal(false);
  downloadError = signal('');
  dgaSelectedPreset = signal<string | null>(null);
  dgaSelectedMonths = signal<number[]>([]);
  dgaReportModalOpen = signal(false);
  dgaReportSelectedPreset = signal<string | null>('last30');
  dgaReportSelectedMonths = signal<number[]>([]);
  dgaReportDateFrom = signal('');
  dgaReportDateTo = signal('');
  readonly historyPageSize = 50;
  readonly historyRecordLimitOptions = [50, 100, 250, 500];
  readonly dgaRowsPerPageOptions = [10, 25, 50];
  dgaReportRows = signal<DgaReportRow[]>([]);
  dgaLoading = signal(false);
  /** Último envío SNIA (absoluto, NO afecta filtro de fecha del UI). */
  dgaUltimoEnvio = signal<{ ts: string; comprobante: string | null } | null>(null);

  /** Cuenta de slots enviados en el rango filtrado. */
  dgaCountEnviados = computed(
    () => this.dgaReportRows().filter((r) => r.estado === 'Enviado').length,
  );
  /** Cuenta de slots rechazados+fallidos en el rango. */
  dgaCountRechazados = computed(
    () =>
      this.dgaReportRows().filter((r) => r.estado === 'Rechazado' || r.estado === 'Fallido').length,
  );
  /** Tasa de éxito = enviados / (enviados + rechazados + fallidos) × 100. Sin denominador → null. */
  dgaTasaExito = computed<number | null>(() => {
    const enviados = this.dgaCountEnviados();
    const malos = this.dgaCountRechazados();
    const denom = enviados + malos;
    if (denom === 0) return null;
    return Math.round((enviados / denom) * 1000) / 10; // 1 decimal
  });
  /**
   * Color de la tasa de éxito según %. Escala verde→naranja→rojo.
   * - 100% verde fuerte
   * - 90-99% emerald
   * - 75-89% lime
   * - 60-74% amber
   * - 40-59% orange
   * - <40% red
   * - null (sin denominador) → slate.
   */
  dgaTasaExitoColors = computed<{ text: string; border: string; bg: string }>(() => {
    const t = this.dgaTasaExito();
    if (t === null) return { text: 'text-slate-400', border: 'border-slate-200', bg: 'bg-white' };
    if (t >= 100)
      return { text: 'text-emerald-600', border: 'border-emerald-300', bg: 'bg-emerald-50' };
    if (t >= 90)
      return { text: 'text-emerald-500', border: 'border-emerald-200', bg: 'bg-emerald-50' };
    if (t >= 75) return { text: 'text-lime-600', border: 'border-lime-200', bg: 'bg-lime-50' };
    if (t >= 60) return { text: 'text-amber-600', border: 'border-amber-200', bg: 'bg-amber-50' };
    if (t >= 40)
      return { text: 'text-orange-600', border: 'border-orange-200', bg: 'bg-orange-50' };
    return { text: 'text-rose-600', border: 'border-rose-300', bg: 'bg-rose-50' };
  });

  /** Label de acción para Tasa de éxito. Reduce dependencia del color (a11y). */
  dgaTasaExitoLabel = computed<string>(() => {
    const t = this.dgaTasaExito();
    if (t === null) return 'Sin datos';
    if (t >= 100) return 'Sin rechazos';
    if (t >= 90) return 'Alerta leve';
    if (t >= 75) return 'Revisar config';
    if (t >= 60) return 'Atención requerida';
    if (t >= 40) return 'Bloqueo probable';
    return 'Falla persistente';
  });

  /** Formato corto fecha+hora del último envío (Chile UTC-4). */
  dgaUltimoEnvioFecha = computed<string>(() => {
    const u = this.dgaUltimoEnvio();
    if (!u) return '—';
    const d = new Date(new Date(u.ts).getTime() - 4 * 3600 * 1000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const HH = String(d.getUTCHours()).padStart(2, '0');
    const MM = String(d.getUTCMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${HH}:${MM}`;
  });

  wellNivelFreatico = computed(() => this.extractNivelFreatico(this.dashboardData()));
  wellTotalDepth = computed(() => this.extractPozoNumber('profundidad_pozo_m'));
  wellSensorDepth = computed(() => this.extractPozoNumber('profundidad_sensor_m'));
  wellSignalPercent = computed<number | null>(() => {
    const raw = this.findDashboardNumber('señal');
    if (raw === null) return null;
    return Math.round(this.clamp(raw, 0, 100));
  });
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

  // SVG Well Diagram — dimensions & layout
  readonly svgW = 300;
  readonly svgH = 476;
  readonly svgWellL = 80;
  readonly svgWellR = 168;
  readonly svgWellTop = 40;
  readonly svgWellBot = 464;
  readonly svgWellH = 424;
  readonly svgAnnotX = 272; // x del bracket derecho Superficie→Nivel Freático
  readonly svgGrassX = [
    6, 14, 22, 30, 42, 52, 176, 186, 198, 210, 222, 234, 246, 258, 270, 282, 292,
  ];

  // nivelFreatico = profundidad desde superficie → waterY = top + (nivel/totalDepth)*H
  get svgWaterY(): number {
    const d = this.wellTotalDepth() ?? 18;
    const f = this.wellNivelFreatico() ?? 0;
    const safe = d > 0 ? d : 18;
    return Math.round(this.svgWellTop + Math.min(1, Math.max(0, f / safe)) * this.svgWellH);
  }
  get svgSensorY(): number {
    const d = this.wellTotalDepth() ?? 18;
    const s = this.wellSensorDepth() ?? 0;
    const safe = d > 0 ? d : 18;
    return Math.round(this.svgWellTop + Math.min(1, Math.max(0, s / safe)) * this.svgWellH);
  }
  get svgFillPct(): number {
    return this.wellFillStylePercent();
  }
  get svgWavePath(): string {
    const L = this.svgWellL + 4,
      y = this.svgWaterY;
    return `M${L},${y} q13,-9 26,0 q13,9 25,0 q12,-6 25,0`;
  }
  get svgWave2Path(): string {
    const L = this.svgWellL + 4,
      y = this.svgWaterY + 6;
    return `M${L},${y} q19,5 38,0 q19,-5 38,0`;
  }
  get svgTextCX(): number {
    return Math.round((this.svgWellL + this.svgWellR) / 2);
  }
  get svgTextWaterY(): number {
    return Math.round(this.svgWaterY + (this.svgWellBot - this.svgWaterY) * 0.45 + 6);
  }
  get svgDepthMidY(): number {
    return Math.round((this.svgWellTop + this.svgWellBot) / 2);
  }

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
  downloadRangeLabel = computed(() => {
    const from = this.downloadDateFrom();
    const to = this.downloadDateTo();
    if (!from && !to) return 'Sin rango seleccionado';
    const fmt = (s: string) => (s ? s.split('-').reverse().join('/') : '—');
    return `${fmt(from)} — ${fmt(to)}`;
  });
  downloadDaysCount = computed(() => {
    const f = this.downloadDateFrom();
    const t = this.downloadDateTo();
    if (!f || !t) return 0;
    return Math.round((+new Date(t) - +new Date(f)) / 86400000) + 1;
  });
  downloadWorkloadLabel = computed(() => {
    if (this.downloadBusy()) {
      return 'Generando archivo. Si el rango es largo, puede tardar unos minutos.';
    }
    if (this.downloadGranularity() !== '1m' || this.downloadDaysCount() < 30) {
      return 'Exportación directa desde datos procesados.';
    }
    return 'Rangos largos minuto a minuto pueden tardar unos minutos. Mantén esta pestaña abierta.';
  });
  dgaModalDaysCount = computed(() => {
    const f = this.dgaDateFrom();
    const t = this.dgaDateTo();
    if (!f || !t) return 0;
    return Math.round((+new Date(t) - +new Date(f)) / 86400000) + 1;
  });
  dgaModalRangeLabel = computed(() => {
    const from = this.dgaDateFrom();
    const to = this.dgaDateTo();
    if (!from && !to) return 'Sin rango seleccionado';
    const fmt = (s: string) => (s ? s.split('-').reverse().join('/') : '—');
    return `${fmt(from)} — ${fmt(to)}`;
  });
  dgaReportDaysCount = computed(() => {
    const f = this.dgaReportDateFrom();
    const t = this.dgaReportDateTo();
    if (!f || !t) return 0;
    return Math.round((+new Date(t) - +new Date(f)) / 86400000) + 1;
  });
  dgaReportRangeLabel = computed(() => {
    const from = this.dgaReportDateFrom();
    const to = this.dgaReportDateTo();
    if (!from && !to) return 'Selecciona un período';
    const fmt = (s: string) => (s ? s.split('-').reverse().join('/') : '—');
    return `${fmt(from)} — ${fmt(to)}`;
  });
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
  realtimeMetrics = computed<RealtimeMetric[]>(() => {
    const caudal = this.findDashboardNumber('caudal') ?? this.latestHistoryNumber('caudalValue');
    const totalizador =
      this.findDashboardNumber('totalizador') ??
      this.findDashboardTransformNumber('uint32_registros') ??
      this.latestHistoryNumber('totalizadorValue');
    const nivel =
      this.findDashboardNumber('nivel') ?? this.latestHistoryNumber('nivelFreaticoValue');
    const consumoHoy = this.calculateTodayConsumption();

    return [
      {
        label: 'Caudal Actual',
        value: this.formatRealtimeNumber(caudal, 2),
        unit: 'L/s',
      },
      {
        label: 'Totalizador',
        value: this.formatRealtimeNumber(totalizador, 0),
        unit: 'm³',
      },
      {
        label: 'Nivel de Agua',
        value: this.formatRealtimeNumber(nivel, 2),
        unit: 'm',
      },
      {
        label: 'Consumo Hoy',
        value: this.formatRealtimeNumber(consumoHoy, 1),
        unit: 'm³',
      },
    ];
  });
  latestRealtimeTimestampLabel = computed(() => {
    const latest = this.latestRealtimeTimestamp();
    return latest ? this.formatChileDateTime(latest) : 'Sin registros';
  });
  realtimeChart = computed<RealtimeChartData>(() => this.buildRealtimeChart());
  dgaFilteredReports = computed(() => {
    const from = this.parseDateInputMs(this.dgaDateFrom(), 'start');
    const to = this.parseDateInputMs(this.dgaDateTo(), 'end');
    return this.dgaReportRows().filter((row) => {
      if (from !== null && row.timestampMs < from) return false;
      if (to !== null && row.timestampMs > to) return false;
      return true;
    });
  });
  paginatedDgaReports = computed(() => {
    const start = (this.dgaPage() - 1) * this.dgaRowsPerPage();
    return this.dgaFilteredReports().slice(start, start + this.dgaRowsPerPage());
  });
  dgaTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.dgaFilteredReports().length / this.dgaRowsPerPage())),
  );
  dgaRangeStart = computed(() =>
    this.dgaFilteredReports().length ? (this.dgaPage() - 1) * this.dgaRowsPerPage() + 1 : 0,
  );
  dgaRangeEnd = computed(() =>
    this.paginatedDgaReports().length
      ? this.dgaRangeStart() + this.paginatedDgaReports().length - 1
      : 0,
  );
  dgaDisplayedTotal = computed(() => this.dgaFilteredReports().length);
  dgaTotalRecordsLabel = computed(() => `${this.dgaDisplayedTotal()} registros en el periodo`);
  dgaSelectedRangeLabel = computed(
    () =>
      `${this.formatDgaDateInputShort(this.dgaDateFrom())} - ${this.formatDgaDateInputShort(this.dgaDateTo())}`,
  );
  dgaSelectedRangeLongLabel = computed(
    () =>
      `${this.formatDgaDateInputLong(this.dgaDateFrom())} - ${this.formatDgaDateInputLong(this.dgaDateTo())}`,
  );
  dgaSelectedDaysLabel = computed(() => `${this.countDgaSelectedDays()} dias`);

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
  readonly downloadMonthShort = [
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

  readonly downloadDataTypeOptions = [
    { id: 'caudal', label: 'Caudal', unit: 'L/s' },
    { id: 'nivel', label: 'Nivel', unit: 'm' },
    { id: 'totalizador', label: 'Totalizador', unit: 'm³' },
    { id: 'nivel_freatico', label: 'Nivel Freático', unit: 'm' },
  ];

  readonly downloadGranularityOptions: {
    id: HistoryGranularity;
    label: string;
    hint: string;
  }[] = [
    { id: '1m', label: '1 minuto', hint: 'Detalle máximo' },
    { id: '1h', label: '1 hora', hint: 'Resumen por hora' },
    { id: '1d', label: '1 día', hint: 'Resumen diario' },
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

        const moduleKey = getSiteTypeUi(match.site.tipo_sitio).moduleKey;
        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.companyService.selectedSiteModuleKey.set(moduleKey);
        this.companyService.selectedSiteTypeFilter.set(siteTypesForModule(moduleKey));
        this.loadHydratedSite(match);

        // Tab DGA es default — carga inicial de "Detalle de Registros" sin
        // requerir que admin re-clickee la tab. setDetailTab solo dispara
        // loadDgaReports en cambio de tab, no en mount inicial.
        if (this.activeDetailTab() === 'dga') {
          void this.loadDgaReports();
        }
        this.loadUltimoEnvio(siteId);
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

  getDgaStatusBg(estado: string): string {
    if (estado === 'Enviado') return '#F0FDF4';
    if (estado === 'Pendiente' || estado === 'Enviando') return '#FFFBEB';
    if (estado === 'Revisar') return '#FEF3C7';
    // Rechazado / Fallido
    return '#FEF2F2';
  }

  getDgaStatusBorder(estado: string): string {
    if (estado === 'Enviado') return '#BBF7D0';
    if (estado === 'Pendiente' || estado === 'Enviando') return '#FDE68A';
    if (estado === 'Revisar') return '#FCD34D';
    return '#FECACA';
  }

  getDgaStatusColor(estado: string): string {
    if (estado === 'Enviado') return '#16A34A';
    if (estado === 'Pendiente' || estado === 'Enviando') return '#D97706';
    if (estado === 'Revisar') return '#B45309';
    return '#DC2626';
  }

  getMonthlyFlowHeight(value: number | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const max = this.monthlyFlowMax();
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, (value / max) * 100));
  }

  getMonthlyFlowProjectionExtra(month: MonthlyFlowPoint): number {
    if (!month.proyeccion || month.proyeccion <= month.value) return 0;
    return this.getMonthlyFlowHeight(month.proyeccion) - this.getMonthlyFlowHeight(month.value);
  }

  formatMonthlyFlowValue(value: number): string {
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }

  formatMeters(value: number | null): string {
    if (value === null) return '--';
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
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

  private async loadDgaReports(): Promise<void> {
    const siteId = this.currentSiteId();
    if (!siteId) return;
    this.dgaLoading.set(true);
    try {
      // Rango default = últimos 30 días si no se seleccionó nada.
      const from = this.dgaDateFrom()
        ? this.toChileStartIso(this.dgaDateFrom())
        : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const to = this.dgaDateTo() ? this.toChileEndIso(this.dgaDateTo()) : new Date().toISOString();
      // Lee de dato_dga (pipeline nuevo) — trae estatus real + comprobante SNIA.
      const rows = await firstValueFrom(this.dgaService.consultarDatoBySite(siteId, from, to));
      this.dgaReportRows.set(rows.map((r, i) => this.datoDgaToRow(r, i)));
    } catch {
      this.dgaReportRows.set([]);
    } finally {
      this.dgaLoading.set(false);
    }
  }

  /**
   * Mapea una fila de dato_dga al modelo de la tabla "Detalle de Registros".
   * Convierte el estatus técnico del pipeline a la etiqueta humana que
   * muestra el badge: vacio→Pendiente, requires_review→Revisar, etc.
   */
  private datoDgaToRow(r: DatoDgaRow, idx: number): DgaReportRow {
    const estadoMap: Record<DatoDgaRow['estatus'], string> = {
      vacio: 'Pendiente',
      pendiente: 'Pendiente',
      requires_review: 'Revisar',
      enviando: 'Enviando',
      enviado: 'Enviado',
      rechazado: 'Rechazado',
      fallido: 'Fallido',
    };
    const respuestaMap: Record<DatoDgaRow['estatus'], string> = {
      vacio: 'Slot pre-seedeado, aún sin telemetría rellenada',
      pendiente: 'Pendiente de envío a SNIA',
      requires_review: 'Anomalías detectadas — esperando decisión admin',
      enviando: 'Envío a SNIA en curso',
      enviado: 'Medición subterránea ingresada correctamente',
      rechazado: 'Rechazado por MIA-DGA — reintentará en 24h',
      fallido: 'Reintentos agotados — requiere intervención manual',
    };
    return {
      id: `dga-${idx}-${r.ts}`,
      recordId: `${r.fecha}-${r.hora.replace(/:/g, '')}`,
      fecha: `${r.fecha} ${r.hora}`,
      dateIso: r.ts,
      timestampMs: new Date(r.ts).getTime(),
      nivelFreatico: r.nivel_freatico == null ? null : Number(r.nivel_freatico),
      caudal: r.caudal_instantaneo == null ? null : Number(r.caudal_instantaneo),
      totalizador: r.flujo_acumulado == null ? null : Number(r.flujo_acumulado),
      estado: estadoMap[r.estatus] ?? 'Pendiente',
      enviadoDga: r.estatus === 'enviado' ? `${r.fecha} ${r.hora}` : '',
      respuesta: respuestaMap[r.estatus] ?? 'Pendiente',
      comprobante: r.comprobante ?? '',
    };
  }

  private toChileStartIso(dateStr: string): string {
    return `${dateStr}T04:00:00.000Z`;
  }

  private toChileEndIso(dateStr: string): string {
    const d = new Date(`${dateStr}T04:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return new Date(d.getTime() - 1).toISOString();
  }

  private createDgaReportRow(
    id: string,
    recordId: string,
    dateIso: string,
    fecha: string,
    nivelFreatico: number,
    caudal: number,
    totalizador: number,
  ): DgaReportRow {
    return {
      id,
      recordId,
      dateIso,
      fecha,
      timestampMs: new Date(dateIso).getTime(),
      nivelFreatico,
      caudal,
      totalizador,
      estado: 'Enviado',
      enviadoDga: '30/04/2026 20:00',
      respuesta: 'Medición subterránea ingresada correctamente',
      comprobante: '3qaonemdN5SkOozAE9TZAdjFo3CVr4Wg',
    };
  }

  private formatDgaDateInputShort(value: string): string {
    const date = this.dateInputToUtcDate(value);
    if (!date) return '--';

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
    }).format(date);
  }

  private formatDgaDateInputLong(value: string): string {
    const date = this.dateInputToUtcDate(value);
    if (!date) return '--';

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  private countDgaSelectedDays(): number {
    const from = this.dateInputToUtcDate(this.dgaDateFrom());
    const to = this.dateInputToUtcDate(this.dgaDateTo());
    if (!from || !to) return 0;

    const diff = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
    return Math.max(0, diff);
  }

  private dateInputToUtcDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }

  private toDateInputValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addDays(value: Date, days: number): Date {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
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
    // El modal hace el persist; refrescamos el "Último envío" por si el cambio
    // de transport/activación afecta lo enviado.
    const siteId = this.currentSiteId();
    if (siteId) this.loadUltimoEnvio(siteId);
  }

  private loadUltimoEnvio(siteId: string): void {
    this.dgaService.getUltimoEnvio(siteId).subscribe({
      next: (row) => this.dgaUltimoEnvio.set(row),
      error: () => this.dgaUltimoEnvio.set(null),
    });
  }

  /**
   * URL al portal APIMee SNIA con el comprobante. Requiere obra_dga
   * del sitio actual. Devuelve null si falta cualquiera de los 2.
   */
  comprobanteUrl(comprobante: string | null | undefined): string | null {
    if (!comprobante) return null;
    const obra = this.currentSiteObraDga();
    if (!obra) return null;
    return `https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas?codigoObra=${encodeURIComponent(obra)}&numeroComprobante=${encodeURIComponent(comprobante)}`;
  }

  /**
   * Valor crudo en vivo del registro d1 elegido, para la "Calculadora de
   * prueba". Antes el input era editable; ahora es read-only y refleja
   * la última lectura real del equipo.
   */
  setDetailTab(tab: DetailTab): void {
    if (tab === 'analisis' && !this.isSuperAdmin()) return;
    this.historyPanelOpen.set(false);
    this.settingsPanelOpen.set(false);
    this.activeDetailTab.set(tab);
    if (tab === 'dga') void this.loadDgaReports();
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
    this.downloadSelectedMonths.set([]);
    this.downloadError.set('');
    this.downloadFormat.set('csv');
    this.downloadGranularity.set('1m');
    this.applyDownloadPreset('last30');
    this.downloadModalOpen.set(true);
  }

  closeDownloadModal(): void {
    this.downloadModalOpen.set(false);
  }

  applyDownloadPreset(presetId: string): void {
    this.downloadSelectedMonths.set([]);
    const now = new Date();
    const y = now.getFullYear();
    let from: Date, to: Date;
    switch (presetId) {
      case 'last7':
        from = new Date(now);
        from.setDate(from.getDate() - 6);
        to = now;
        break;
      case 'last30':
        from = new Date(now);
        from.setDate(from.getDate() - 29);
        to = now;
        break;
      case 'last90':
        from = new Date(now);
        from.setDate(from.getDate() - 89);
        to = now;
        break;
      case 'thisYear':
        from = new Date(y, 0, 1);
        to = now;
        break;
      case 'lastYear':
        from = new Date(y - 1, 0, 1);
        to = new Date(y - 1, 11, 31);
        break;
      default:
        return;
    }
    this.downloadDateFrom.set(this.toDateInputValue(from));
    this.downloadDateTo.set(this.toDateInputValue(to));
    this.downloadSelectedPreset.set(presetId);
  }

  applyDownloadMonth(monthIndex: number): void {
    if (!this.downloadMonthHasData(monthIndex)) return;
    const current = this.downloadSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter((m) => m !== monthIndex)
      : [...current, monthIndex].sort((a, b) => a - b);
    this.downloadSelectedMonths.set(next);
    this.downloadSelectedPreset.set(null);
    if (next.length === 0) return;
    const year = new Date().getFullYear();
    const from = new Date(year, Math.min(...next), 1);
    const to = new Date(year, Math.max(...next) + 1, 0);
    this.downloadDateFrom.set(this.toDateInputValue(from));
    this.downloadDateTo.set(this.toDateInputValue(to));
  }

  downloadMonthHasData(monthIndex: number): boolean {
    const year = new Date().getFullYear();
    const shortMonth = this.downloadMonthShort[monthIndex];
    const shortYear = String(year).slice(2);
    const match = this.monthlyFlowMonths().find((m) =>
      m.label.startsWith(`${shortMonth} '${shortYear}`),
    );
    return match ? match.value > 0 : false;
  }

  toggleDownloadDataType(typeId: string): void {
    const current = this.downloadSelectedTypes();
    if (current.includes(typeId)) {
      this.downloadSelectedTypes.set(current.filter((t) => t !== typeId));
    } else {
      this.downloadSelectedTypes.set([...current, typeId]);
    }
  }

  isDownloadTypeSelected(typeId: string): boolean {
    return this.downloadSelectedTypes().includes(typeId);
  }

  executeDownload(): void {
    const siteId = this.currentSiteId();
    const from = this.downloadDateFrom();
    const to = this.downloadDateTo();
    const fields = this.downloadSelectedTypes();

    if (!siteId) {
      this.downloadError.set('No se encontró el sitio actual.');
      return;
    }

    if (!from || !to || fields.length === 0) {
      this.downloadError.set('Selecciona rango y datos para exportar.');
      return;
    }

    this.downloadBusy.set(true);
    this.downloadError.set('');

    this.companyService
      .downloadSiteDashboardHistory(siteId, {
        from,
        to,
        fields,
        format: 'csv',
        granularity: this.downloadGranularity(),
      })
      .subscribe({
        next: (response) => {
          const blob = response.body;
          if (!blob) {
            this.downloadBusy.set(false);
            this.downloadError.set('No se recibio el archivo.');
            return;
          }

          const filename =
            this.filenameFromContentDisposition(response.headers.get('content-disposition')) ||
            `historico_${siteId}_${from}_${to}.csv`;
          this.saveBlob(blob, filename);
          this.downloadBusy.set(false);
          this.closeDownloadModal();
        },
        error: (err: unknown) => {
          this.downloadBusy.set(false);
          this.downloadError.set(
            this.errorMessage(err, 'No fue posible descargar los datos historicos.'),
          );
        },
      });
  }

  private filenameFromContentDisposition(value: string | null): string | null {
    if (!value) return null;
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(value);
    return match?.[1] ? decodeURIComponent(match[1].replace(/"/g, '')) : null;
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  openDgaReportModal(): void {
    this.dgaReportSelectedMonths.set([]);
    this.applyDgaReportPreset('last30');
    this.dgaReportError.set('');
    this.dgaReportModalOpen.set(true);
  }

  closeDgaReportModal(): void {
    this.dgaReportModalOpen.set(false);
  }

  applyDgaReportPreset(presetId: string): void {
    this.dgaReportSelectedMonths.set([]);
    this.dgaReportSelectedPreset.set(presetId);
    const now = new Date();
    const y = now.getFullYear();
    let from = new Date(now),
      to = new Date(now);
    switch (presetId) {
      case 'last7':
        from = this.addDays(now, -6);
        break;
      case 'last30':
        from = this.addDays(now, -29);
        break;
      case 'last90':
        from = this.addDays(now, -89);
        break;
      case 'thisYear':
        from = new Date(y, 0, 1);
        break;
      case 'lastYear':
        from = new Date(y - 1, 0, 1);
        to = new Date(y - 1, 11, 31);
        break;
    }
    this.dgaReportDateFrom.set(this.toDateInputValue(from));
    this.dgaReportDateTo.set(this.toDateInputValue(to));
  }

  applyDgaReportMonth(monthIndex: number): void {
    if (!this.dgaMonthHasData(monthIndex)) return;
    const current = this.dgaReportSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter((m) => m !== monthIndex)
      : [...current, monthIndex].sort((a, b) => a - b);
    this.dgaReportSelectedMonths.set(next);
    this.dgaReportSelectedPreset.set(null);
    if (next.length === 0) return;
    const year = new Date().getFullYear();
    const from = new Date(year, Math.min(...next), 1);
    const to = new Date(year, Math.max(...next) + 1, 0);
    this.dgaReportDateFrom.set(this.toDateInputValue(from));
    this.dgaReportDateTo.set(this.toDateInputValue(to));
  }

  generateDgaReport(): void {
    const siteId = this.siteContext()?.site?.id;
    const from = this.dgaReportDateFrom();
    const to = this.dgaReportDateTo();
    if (!siteId) {
      this.dgaReportError.set('No se pudo determinar el sitio.');
      return;
    }
    if (!from || !to) {
      this.dgaReportError.set('Seleccioná un rango de fechas.');
      return;
    }

    // Rango interpretado en hora Chile UTC-4. `hasta` exclusivo: día siguiente 00:00.
    const desdeIso = `${from}T00:00:00-04:00`;
    const hastaDate = new Date(`${to}T00:00:00-04:00`);
    hastaDate.setUTCDate(hastaDate.getUTCDate() + 1);
    const hastaIso = hastaDate.toISOString();

    const url = this.dgaService.exportCsvUrlDirecto(
      siteId,
      desdeIso,
      hastaIso,
      this.dgaReportBucket(),
      this.dgaReportOrden(),
    );
    const filename = `reporte_dga_${siteId}_${this.dgaReportBucket()}_${from}_${to}.csv`;

    this.dgaReportDownloading.set(true);
    this.dgaReportError.set('');
    this.httpClient.get(url, { responseType: 'blob' }).subscribe({
      next: (blob: Blob) => {
        this.dgaReportDownloading.set(false);
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
        this.closeDgaReportModal();
      },
      error: (err) => {
        this.dgaReportDownloading.set(false);
        this.dgaReportError.set(
          err?.error?.error?.message ?? err?.message ?? 'Error al descargar el reporte.',
        );
      },
    });
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

  openDgaDateFilter(): void {
    this.dgaDateFilterOpen.set(true);
  }

  closeDgaDateFilter(): void {
    this.dgaDateFilterOpen.set(false);
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
    if (this.selectedDgaReport()) {
      this.closeDgaReportDetail();
      return;
    }
    if (this.dgaReportModalOpen()) {
      this.closeDgaReportModal();
      return;
    }
    if (this.downloadModalOpen()) {
      this.closeDownloadModal();
      return;
    }
    if (this.dgaDateFilterOpen()) {
      this.closeDgaDateFilter();
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

  applyDgaDateFilter(): void {
    this.dgaPage.set(1);
    this.closeDgaDateFilter();
    void this.loadDgaReports();
  }

  clearDgaDateFilter(): void {
    this.dgaDateFrom.set(chileMonthStart());
    this.dgaDateTo.set(chileToday());
    this.dgaPage.set(1);
  }

  setDgaDateFrom(event: Event): void {
    this.dgaDateFrom.set((event.target as HTMLInputElement).value);
    this.dgaPage.set(1);
  }

  setDgaDateTo(event: Event): void {
    this.dgaDateTo.set((event.target as HTMLInputElement).value);
    this.dgaPage.set(1);
  }

  applyDgaDatePreset(presetId: string): void {
    this.dgaSelectedMonths.set([]);
    this.dgaSelectedPreset.set(presetId);
    const now = new Date();
    const y = now.getFullYear();
    let from = new Date(now);
    let to = new Date(now);
    switch (presetId) {
      case 'last7':
        from = this.addDays(now, -6);
        break;
      case 'last30':
        from = this.addDays(now, -29);
        break;
      case 'last90':
        from = this.addDays(now, -89);
        break;
      case 'thisYear':
        from = new Date(y, 0, 1);
        break;
      case 'lastYear':
        from = new Date(y - 1, 0, 1);
        to = new Date(y - 1, 11, 31);
        break;
    }
    this.dgaDateFrom.set(this.toDateInputValue(from));
    this.dgaDateTo.set(this.toDateInputValue(to));
    this.dgaPage.set(1);
  }

  applyDgaMonth(monthIndex: number): void {
    if (!this.dgaMonthHasData(monthIndex)) return;
    const current = this.dgaSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter((m) => m !== monthIndex)
      : [...current, monthIndex].sort((a, b) => a - b);
    this.dgaSelectedMonths.set(next);
    this.dgaSelectedPreset.set(null);
    if (next.length === 0) return;
    const year = new Date().getFullYear();
    const from = new Date(year, Math.min(...next), 1);
    const to = new Date(year, Math.max(...next) + 1, 0);
    this.dgaDateFrom.set(this.toDateInputValue(from));
    this.dgaDateTo.set(this.toDateInputValue(to));
    this.dgaPage.set(1);
  }

  dgaMonthHasData(_monthIndex: number): boolean {
    // Todos los meses seleccionables. El rango lo valida el backend al
    // consultar `dato_dga`; si no hay data, el CSV queda con header solo.
    return true;
  }

  setDgaRowsPerPage(event: Event): void {
    const parsed = Number((event.target as HTMLSelectElement).value);
    this.dgaRowsPerPage.set(this.dgaRowsPerPageOptions.includes(parsed) ? parsed : 10);
    this.dgaPage.set(1);
  }

  previousDgaPage(): void {
    this.dgaPage.set(Math.max(1, this.dgaPage() - 1));
  }

  nextDgaPage(): void {
    this.dgaPage.set(Math.min(this.dgaTotalPages(), this.dgaPage() + 1));
  }

  openDgaReportDetail(report: DgaReportRow): void {
    this.selectedDgaReport.set(report);
  }

  closeDgaReportDetail(): void {
    this.selectedDgaReport.set(null);
  }

  formatDgaNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    // Formato DGA Res 2170 §4: punto decimal, sin separador miles.
    return value.toFixed(2);
  }

  formatDgaInteger(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    // Formato DGA Res 2170 §4: entero sin decimales ni separador de miles.
    return Math.trunc(value).toString();
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
      next: (res: any) => {
        const payload = res?.ok === false ? null : res?.data || res || null;
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
      next: (res: any) => {
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
      .subscribe((res: any) => {
        if (!res) return;

        const payload = res?.ok === false ? null : res?.data || res || null;
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
      .subscribe((res: any) => {
        if (!res) return;

        const apiRows = this.extractHistoryApiRows(res);
        const totalRows = Number(res?.data?.pagination?.total);
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

  private extractHistoryApiRows(res: any): HistoricalTelemetryApiRow[] {
    if (res?.ok === false) return [];
    const rows = res?.data?.rows || res?.data || [];
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
        variable.transformacion,
      );

      return text.includes('nivel freatico');
    });

    const derivedValue = this.toNumber(fromVariables?.valor);
    if (derivedValue !== null) return derivedValue;

    const sensorDepth = this.extractPozoNumber('profundidad_sensor_m');
    const totalDepth = this.extractPozoNumber('profundidad_pozo_m');
    const sourceLevel = variables.find((variable) => {
      if (variable.ok === false) return false;
      const text = this.normalizeSearchText(variable.key, variable.alias, variable.rol_dashboard);
      return (
        !text.includes('freatico') &&
        (text.includes('nivel') || text.includes('level') || text.includes('sonda'))
      );
    });
    const sourceLevelValue = this.toNumber(sourceLevel?.valor);
    const baseDelSensor = sensorDepth !== null && sensorDepth > 0 ? sensorDepth : totalDepth;

    if (
      baseDelSensor !== null &&
      baseDelSensor > 0 &&
      sourceLevelValue !== null &&
      sourceLevelValue >= 0 &&
      sourceLevelValue <= baseDelSensor
    ) {
      return Math.round((baseDelSensor - sourceLevelValue) * 1000) / 1000;
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
