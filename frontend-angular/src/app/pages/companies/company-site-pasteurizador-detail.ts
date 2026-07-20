import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { CompanyNode } from '@emeltec/shared';
import { type SiteContext, findAccessibleSite } from '../../shared/site-context';
import { catchError, of, Subscription, switchMap, timer } from 'rxjs';
import { SkeletonComponent } from '../../components/ui/skeleton';
import { AuthService } from '../../services/auth.service';
import {
  CompanyService,
  type PasteurizadorDailyKpisResponse,
  type PasteurizadorHistoryResponse,
  type PasteurizadorMetric,
  type PasteurizadorRole,
  type PasteurizadorSnapshot,
} from '../../services/company.service';
import { CHILE_TIME_ZONE } from '../../shared/timezone';
import { PasteurizadorChartCardComponent } from './components/pasteurizador-dashboard/pasteurizador-chart-card';
import { PasteurizadorHeaderComponent } from './components/pasteurizador-dashboard/pasteurizador-header';
import { PasteurizadorKpiCardComponent } from './components/pasteurizador-dashboard/pasteurizador-kpi-card';
import { PasteurizadorTrendsPanelComponent } from './components/pasteurizador-dashboard/pasteurizador-trends-panel';
import type {
  PasteurChart,
  PasteurKpi,
  PasteurProcessDiagramData,
  PasteurQuickMetric,
} from './components/pasteurizador-dashboard/pasteurizador-dashboard.models';
import { PasteurizadorStatusCardComponent } from './components/pasteurizador-dashboard/pasteurizador-status-card';
import { SiteVariableSettingsPanelComponent } from './components/site-variable-settings-panel';
import { PasteurizadorProcessDiagramComponent } from './components/pasteurizador-dashboard/pasteurizador-process-diagram';
import { WaterDetailAlertasComponent } from './components/water-detail-alertas/water-detail-alertas';
import { WaterDetailAnalisisComponent } from './components/water-detail-analisis/water-detail-analisis';
import { WaterDetailBitacoraComponent } from './components/water-detail-bitacora/water-detail-bitacora';

type PasteurSection = 'monitoring' | 'operation' | 'alerts' | 'log' | 'analysis';
type PasteurOperationView = 'trends' | 'diagram' | 'history';

interface PasteurHistoryRow {
  id: string;
  timestampMs: number;
  fecha: string;
  entrada: string;
  pasteurizacion: string;
  productoTina: string;
  entradaValue: number | null;
  pasteurizacionValue: number | null;
  productoTinaValue: number | null;
  valveValue: number | null;
  erroresCriticosValue: number | null;
}

const PASTEUR_HISTORY_PAGE_SIZE = 50;
const PASTEUR_REALTIME_LIMIT = 121;
const PASTEUR_MONITOR_WINDOW_MS = 60 * 60 * 1000;
const PASTEUR_AXIS_FUTURE_PADDING_MS = 5 * 60 * 1000;
const PASTEUR_HISTORY_ROLES: PasteurizadorRole[] = [
  'temperatura_pasteurizacion',
  'temperatura_entrada',
  'salida_producto_tina',
  'estado_valvula',
  'errores_criticos',
  'presion_vapor',
  'temperatura_gases_combustion',
];

function chileToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHILE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
  return `${parts['year']}-${parts['month']}-${parts['day']}`;
}

function chileMonthStart(): string {
  return `${chileToday().slice(0, 8)}01`;
}

@Component({
  selector: 'app-company-site-pasteurizador-detail',
  standalone: true,
  imports: [
    CommonModule,
    SkeletonComponent,
    PasteurizadorHeaderComponent,
    PasteurizadorKpiCardComponent,
    PasteurizadorChartCardComponent,
    PasteurizadorStatusCardComponent,
    PasteurizadorTrendsPanelComponent,
    PasteurizadorProcessDiagramComponent,
    SiteVariableSettingsPanelComponent,
    WaterDetailAlertasComponent,
    WaterDetailBitacoraComponent,
    WaterDetailAnalisisComponent,
  ],
  template: `
    <div class="scada-page">
      @if (siteContext(); as context) {
        <section class="dashboard-shell">
          <app-pasteurizador-header
            [title]="siteName(context)"
            [subtitle]="siteSubtitle(context)"
            [showSettings]="canEditSiteSettings()"
            (settingsClick)="openSettingsPanel()"
          />

          @if (settingsPanelOpen()) {
            <div class="settings-view">
              <div class="settings-back">
                <button
                  type="button"
                  (click)="closeSettingsPanel()"
                  aria-label="Volver al detalle del sitio"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
                </button>
                <p>Volver al detalle del sitio</p>
              </div>

              @defer (when settingsPanelOpen()) {
                <app-site-variable-settings-panel
                  [siteId]="context.site.id"
                  [site]="context.site"
                  [showPozoConfig]="false"
                  accentColor="#8b5cf6"
                  accentSoft="rgba(139,92,246,0.10)"
                  (variableMapChanged)="onVariableMapChanged()"
                />
              } @placeholder {
                <app-skeleton class="h-64 w-full rounded-xl" />
              }
            </div>
          } @else {
            <nav
              class="view-tabs"
              role="tablist"
              aria-label="Pestanas de Pasteurizador"
              (keydown.arrowright)="cycleSection(1); $event.preventDefault()"
              (keydown.arrowleft)="cycleSection(-1); $event.preventDefault()"
              (keydown.home)="cycleSection(0, 'first'); $event.preventDefault()"
              (keydown.end)="cycleSection(0, 'last'); $event.preventDefault()"
            >
              <button
                type="button"
                role="tab"
                [class.is-active]="activeSection() === 'monitoring'"
                [attr.aria-selected]="activeSection() === 'monitoring'"
                [attr.tabindex]="activeSection() === 'monitoring' ? 0 : -1"
                aria-controls="pasteur-monitoring"
                (click)="setActiveSection('monitoring')"
              >
                <span class="material-symbols-outlined text-[20px]" aria-hidden="true"
                  >monitoring</span
                >
                Monitoreo
              </button>
              <button
                type="button"
                role="tab"
                [class.is-active]="activeSection() === 'operation'"
                [attr.aria-selected]="activeSection() === 'operation'"
                [attr.tabindex]="activeSection() === 'operation' ? 0 : -1"
                aria-controls="pasteur-operation"
                (click)="setActiveSection('operation')"
              >
                <span class="material-symbols-outlined text-[20px]" aria-hidden="true"
                  >query_stats</span
                >
                Operacion
              </button>
              <button
                type="button"
                role="tab"
                [class.is-active]="activeSection() === 'alerts'"
                [attr.aria-selected]="activeSection() === 'alerts'"
                [attr.tabindex]="activeSection() === 'alerts' ? 0 : -1"
                aria-controls="pasteur-alerts"
                (click)="setActiveSection('alerts')"
              >
                <span class="material-symbols-outlined text-[20px]" aria-hidden="true"
                  >notifications_active</span
                >
                Alertas
              </button>
              <button
                type="button"
                role="tab"
                [class.is-active]="activeSection() === 'log'"
                [attr.aria-selected]="activeSection() === 'log'"
                [attr.tabindex]="activeSection() === 'log' ? 0 : -1"
                aria-controls="pasteur-log"
                (click)="setActiveSection('log')"
              >
                <span class="material-symbols-outlined text-[20px]" aria-hidden="true"
                  >menu_book</span
                >
                Bitacora
              </button>
              @if (isSuperAdmin()) {
                <button
                  type="button"
                  role="tab"
                  [class.is-active]="activeSection() === 'analysis'"
                  [attr.aria-selected]="activeSection() === 'analysis'"
                  [attr.tabindex]="activeSection() === 'analysis' ? 0 : -1"
                  aria-controls="pasteur-analysis"
                  (click)="setActiveSection('analysis')"
                >
                  <span class="material-symbols-outlined text-[20px]" aria-hidden="true"
                    >insights</span
                  >
                  Analisis
                  <span class="analysis-badge" title="Solo SuperAdmin" aria-label="Solo SuperAdmin">
                    !
                  </span>
                </button>
              }
            </nav>

            @if (activeSection() === 'monitoring') {
              <main id="pasteur-monitoring" class="operation-view" role="tabpanel">
                @if (activeOperationView() === 'history') {
                  <section class="history-view">
                    <div class="history-toolbar">
                      <div class="history-title">
                        <button
                          type="button"
                          class="history-back"
                          (click)="closeHistoryView()"
                          aria-label="Volver al dashboard de monitoreo"
                        >
                          <span class="material-symbols-outlined" aria-hidden="true"
                            >arrow_back</span
                          >
                        </button>
                        <span class="history-title-icon" aria-hidden="true">
                          <span class="material-symbols-outlined">database</span>
                        </span>
                        <div>
                          <p>Sitios / {{ context.subCompany.nombre }} / Datos Historicos</p>
                          <h2>{{ siteName(context) }}</h2>
                        </div>
                      </div>

                      <button type="button" class="history-download" (click)="downloadHistoryCsv()">
                        <span class="material-symbols-outlined" aria-hidden="true">download</span>
                        Descargar
                      </button>
                    </div>

                    <div class="history-filters" aria-label="Filtros historicos">
                      <label>
                        <span>Desde</span>
                        <input
                          type="date"
                          min="2020-01-01"
                          [value]="historyDateFromInput()"
                          (input)="setHistoryDateFrom($event)"
                        />
                      </label>
                      <label>
                        <span>Hasta</span>
                        <input
                          type="date"
                          min="2020-01-01"
                          [value]="historyDateToInput()"
                          (input)="setHistoryDateTo($event)"
                        />
                      </label>
                      <button type="button" class="history-apply" (click)="applyHistoryFilters()">
                        Aplicar
                      </button>
                      <button type="button" class="history-clear" (click)="clearHistoryFilters()">
                        Limpiar
                      </button>
                    </div>

                    @if (historyDateRangeError()) {
                      <p class="history-error">{{ historyDateRangeError() }}</p>
                    }

                    <div class="history-table-card">
                      <div class="history-table-head">
                        <div>
                          <h3>Datos Historicos</h3>
                          <p>Registros minuto a minuto del pasteurizador</p>
                        </div>
                        <strong>{{ currentHistoryPageCount() }} registros en esta pagina</strong>
                      </div>

                      <div class="history-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Fecha</th>
                              <th>Temperatura de entrada</th>
                              <th>Temperatura pasteurizacion</th>
                              <th>Producto a tina</th>
                            </tr>
                          </thead>
                          <tbody>
                            @if (historyLoading()) {
                              <tr>
                                <td colspan="4" class="history-empty">Cargando registros...</td>
                              </tr>
                            } @else if (historyError()) {
                              <tr>
                                <td colspan="4" class="history-empty">{{ historyError() }}</td>
                              </tr>
                            } @else {
                              @for (row of visibleHistoryRows(); track row.id) {
                                <tr>
                                  <td>
                                    <span class="history-dot"></span>
                                    {{ row.fecha }}
                                  </td>
                                  <td>{{ row.entrada }}</td>
                                  <td>{{ row.pasteurizacion }}</td>
                                  <td>{{ row.productoTina }}</td>
                                </tr>
                              } @empty {
                                <tr>
                                  <td colspan="4" class="history-empty">
                                    Sin registros disponibles para este filtro.
                                  </td>
                                </tr>
                              }
                            }
                          </tbody>
                        </table>
                      </div>

                      <div class="history-table-foot">
                        <span
                          >Filas por pagina: 50 &middot; {{ historyRangeStart() }}-{{
                            historyRangeEnd()
                          }}
                          de {{ historyTotalRows() }}</span
                        >
                        <span
                          class="inline-flex items-center gap-2"
                          aria-label="Paginacion de datos historicos"
                        >
                          <button
                            type="button"
                            class="h-8 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40 active:scale-95"
                            (click)="previousHistoryPage()"
                            [disabled]="historyPage() === 1 || historyLoading()"
                            aria-label="Pagina anterior"
                          >
                            &larr;
                          </button>
                          <span class="min-w-20 text-center text-slate-500"
                            >Pag. {{ historyPage() }} / {{ historyTotalPages() }}</span
                          >
                          <button
                            type="button"
                            class="h-8 w-9 rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40 active:scale-95"
                            (click)="nextHistoryPage()"
                            [disabled]="historyPage() === historyTotalPages() || historyLoading()"
                            aria-label="Pagina siguiente"
                          >
                            &rarr;
                          </button>
                        </span>
                      </div>
                    </div>
                  </section>
                } @else {
                  <section class="kpi-grid" aria-label="Indicadores principales">
                    @for (kpi of kpis(); track kpi.label) {
                      <app-pasteurizador-kpi-card [kpi]="kpi" />
                    }
                  </section>

                  <section class="main-grid">
                    <app-pasteurizador-chart-card [chart]="pasteurChart()" [featured]="true" />

                    <aside class="right-rail">
                      <app-pasteurizador-status-card
                        eyebrow="Informacion rapida"
                        title="Resumen operativo"
                        icon="manufacturing"
                        [metrics]="quickMetrics()"
                      />
                      <article class="history-actions-card">
                        <div class="history-actions-head">
                          <span class="history-actions-icon" aria-hidden="true">
                            <span class="material-symbols-outlined">database</span>
                          </span>
                          <div>
                            <p>Registros del sitio</p>
                            <h2>Datos operativos</h2>
                          </div>
                        </div>

                        <p class="history-actions-copy">
                          Consulta lecturas filtradas por fecha. La vista muestra maximo 50
                          registros por carga.
                        </p>

                        <div class="history-actions-buttons">
                          <button type="button" class="history-primary" (click)="openHistoryView()">
                            <span class="material-symbols-outlined" aria-hidden="true"
                              >history</span
                            >
                            Datos historicos
                          </button>
                          <button
                            type="button"
                            class="history-secondary"
                            (click)="downloadHistoryCsv()"
                          >
                            <span class="material-symbols-outlined" aria-hidden="true"
                              >download</span
                            >
                            Descargar
                          </button>
                        </div>
                      </article>
                    </aside>
                  </section>

                  <section class="secondary-grid" aria-label="Graficos secundarios">
                    <app-pasteurizador-chart-card [chart]="entradaChart()" />
                    <app-pasteurizador-chart-card [chart]="productoChart()" />
                  </section>
                }
              </main>
            } @else if (activeSection() === 'operation') {
              <main id="pasteur-operation" class="operation-view" role="tabpanel">
                <nav class="operation-tabs" aria-label="Vistas de operacion">
                  <button
                    type="button"
                    [class.is-active]="activeOperationView() === 'trends'"
                    [attr.aria-current]="activeOperationView() === 'trends' ? 'page' : null"
                    (click)="setActiveOperationView('trends')"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">show_chart</span>
                    Tendencias
                  </button>
                  <button
                    type="button"
                    [class.is-active]="activeOperationView() === 'diagram'"
                    [attr.aria-current]="activeOperationView() === 'diagram' ? 'page' : null"
                    (click)="setActiveOperationView('diagram')"
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">account_tree</span>
                    Diagrama de proceso
                  </button>
                </nav>

                @if (activeOperationView() === 'diagram') {
                  @defer (when activeOperationView() === 'diagram') {
                    <app-pasteurizador-process-diagram [data]="processDiagramData()" />
                  } @placeholder {
                    <app-skeleton class="h-[520px] w-full rounded-xl" />
                  }
                } @else {
                  @defer (
                    when activeSection() === 'operation' && activeOperationView() === 'trends'
                  ) {
                    <app-pasteurizador-trends-panel
                      [times]="trendTimes()"
                      [pasteurValues]="trendPasteurValues()"
                      [entradaValues]="trendEntradaValues()"
                      [productoValues]="trendProductoValues()"
                      [valveValues]="trendValveValues()"
                      [dailyKpis]="dailyKpis()"
                    />
                  } @placeholder {
                    <app-skeleton class="h-[520px] w-full rounded-xl" />
                  }
                }
              </main>
            } @else if (activeSection() === 'alerts') {
              <main id="pasteur-alerts" role="tabpanel">
                @defer (when activeSection() === 'alerts') {
                  <app-water-detail-alertas
                    [sitioId]="context.site.id"
                    [empresaId]="context.company.id"
                  />
                } @placeholder {
                  <app-skeleton class="h-64 w-full rounded-xl" />
                }
              </main>
            } @else if (activeSection() === 'log') {
              <main id="pasteur-log" role="tabpanel">
                @defer (when activeSection() === 'log') {
                  <app-water-detail-bitacora
                    [sitioId]="context.site.id"
                    [empresaId]="context.company.id"
                  />
                } @placeholder {
                  <app-skeleton class="h-64 w-full rounded-xl" />
                }
              </main>
            } @else if (activeSection() === 'analysis' && isSuperAdmin()) {
              <main id="pasteur-analysis" role="tabpanel">
                @defer (when activeSection() === 'analysis' && isSuperAdmin()) {
                  <app-water-detail-analisis [sitioId]="context.site.id" />
                } @placeholder {
                  <app-skeleton class="h-64 w-full rounded-xl" />
                }
              </main>
            }
          }
        </section>
      } @else {
        <div class="loading-state">
          <app-skeleton class="h-16 w-16 rounded-2xl" />
          <app-skeleton class="h-6 w-72 rounded-md" />
          <app-skeleton class="h-3 w-80 rounded" />
          <app-skeleton class="h-3 w-64 rounded" />
        </div>
      }
    </div>
  `,
  styles: [
    `
      .scada-page {
        min-height: 100%;
        overflow-x: hidden;
        padding: 0 18px 32px;
        background:
          radial-gradient(circle at 92% 0%, rgba(13, 175, 189, 0.08), transparent 24rem),
          linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
        color: #1e293b;
      }

      .dashboard-shell {
        width: min(100%, 1360px);
        margin: 0 auto;
        min-width: 0;
      }

      .view-tabs {
        display: flex;
        min-height: 58px;
        align-items: center;
        gap: 22px;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        border-right: 1px solid #e2e8f0;
        border-bottom: 1px solid #e2e8f0;
        border-left: 1px solid #e2e8f0;
        border-radius: 0 0 14px 14px;
        background: #ffffff;
        padding: 0 22px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05);
      }

      .view-tabs::-webkit-scrollbar,
      .operation-tabs::-webkit-scrollbar {
        display: none;
      }

      .view-tabs button {
        position: relative;
        display: inline-flex;
        min-height: 58px;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        color: #64748b;
        font-size: 14px;
        font-weight: 800;
        white-space: nowrap;
        transition:
          color 160ms ease,
          opacity 160ms ease;
      }

      .view-tabs button.is-active {
        color: #0899a5;
      }

      .view-tabs button.is-active::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: 0;
        right: 0;
        height: 2px;
        border-radius: 9999px;
        background: #0dafbd;
      }

      .view-tabs button:focus-visible {
        border-radius: 6px;
        outline: 2px solid rgba(13, 175, 189, 0.36);
        outline-offset: 3px;
      }

      .view-tabs .material-symbols-outlined {
        font-size: 20px;
        line-height: 1;
      }

      .analysis-badge {
        display: inline-flex;
        height: 16px;
        width: 16px;
        align-items: center;
        justify-content: center;
        border-radius: 9999px;
        background: #f97316;
        color: #ffffff;
        font-size: 10px;
        font-weight: 900;
        line-height: 1;
        transform: translate(-4px, -8px);
      }

      .settings-view {
        display: grid;
        gap: 12px;
        padding: 14px 0 28px;
      }

      .settings-back {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .settings-back button {
        display: grid;
        height: 36px;
        width: 36px;
        place-items: center;
        border-radius: 10px;
        color: #94a3b8;
        transition:
          background 160ms ease,
          color 160ms ease;
      }

      .settings-back button:hover {
        background: #f8fafc;
        color: #1e293b;
      }

      .settings-back .material-symbols-outlined {
        font-size: 20px;
      }

      .settings-back p {
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
      }

      main {
        display: grid;
        gap: 22px;
        padding: 22px 0 30px;
      }

      .operation-tabs {
        display: flex;
        align-items: center;
        gap: 12px;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        border: 1px solid #d7edf1;
        border-radius: 14px;
        background: #ffffff;
        padding: 8px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
      }

      .operation-tabs button {
        display: inline-flex;
        min-height: 42px;
        align-items: center;
        gap: 8px;
        border: 1px solid transparent;
        border-radius: 12px;
        padding: 0 16px;
        color: #64748b;
        font-size: 13px;
        font-weight: 900;
        white-space: nowrap;
      }

      .operation-tabs button.is-active {
        border-color: rgba(13, 175, 189, 0.24);
        background: rgba(13, 175, 189, 0.1);
        color: #0899a5;
      }

      .operation-tabs .material-symbols-outlined {
        font-size: 20px;
      }

      .kpi-grid {
        display: grid;
        align-items: stretch;
        gap: 16px;
        grid-template-columns: repeat(5, minmax(0, 1fr));
      }

      .main-grid {
        display: grid;
        align-items: stretch;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
      }

      .right-rail {
        display: grid;
        gap: 18px;
        grid-template-rows: minmax(320px, 1fr) auto;
      }

      .history-actions-card {
        display: grid;
        gap: 14px;
        align-content: start;
        border: 1px solid #e6ebf2;
        border-radius: 18px;
        background: #ffffff;
        padding: 17px 18px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.055);
      }

      .history-actions-head {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .history-actions-icon,
      .history-title-icon {
        display: grid;
        height: 40px;
        width: 40px;
        flex-shrink: 0;
        place-items: center;
        border-radius: 13px;
        background: rgba(13, 175, 189, 0.1);
        color: #0899a5;
      }

      .history-actions-head p,
      .history-title p {
        color: #94a3b8;
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .history-actions-head h2,
      .history-title h2 {
        margin-top: 3px;
        color: #0f172a;
        font-size: 17px;
        font-weight: 900;
      }

      .history-actions-copy {
        color: #64748b;
        font-size: 12px;
        font-weight: 750;
        line-height: 1.5;
      }

      .history-actions-buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .history-actions-buttons button,
      .history-download,
      .history-apply,
      .history-clear {
        display: inline-flex;
        min-height: 38px;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border-radius: 10px;
        font-size: 12px;
        font-weight: 900;
        transition:
          transform 140ms ease,
          background 160ms ease,
          border-color 160ms ease;
      }

      .history-actions-buttons button:active,
      .history-download:active,
      .history-apply:active,
      .history-clear:active,
      .history-back:active {
        transform: translateY(1px);
      }

      .history-primary {
        border: 1px solid rgba(13, 175, 189, 0.28);
        background: rgba(13, 175, 189, 0.1);
        color: #0899a5;
      }

      .history-primary:hover {
        background: rgba(13, 175, 189, 0.16);
      }

      .history-secondary,
      .history-download,
      .history-clear {
        border: 1px solid #dbe3ee;
        background: #ffffff;
        color: #64748b;
      }

      .history-secondary:hover,
      .history-download:hover,
      .history-clear:hover {
        background: #f8fafc;
        border-color: #cbd5e1;
      }

      .history-view {
        display: grid;
        gap: 14px;
        overflow: hidden;
        border: 1px solid #dbe3ee;
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.055);
      }

      .history-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 18px 18px 0;
      }

      .history-title {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 12px;
      }

      .history-title h2,
      .history-title p {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .history-back {
        display: grid;
        height: 38px;
        width: 38px;
        flex-shrink: 0;
        place-items: center;
        border-radius: 10px;
        color: #94a3b8;
        transition:
          background 160ms ease,
          color 160ms ease,
          transform 140ms ease;
      }

      .history-back:hover {
        background: #f8fafc;
        color: #1e293b;
      }

      .history-download {
        padding: 0 14px;
      }

      .history-filters {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: 10px;
        border-bottom: 1px solid #edf1f6;
        padding: 0 18px 16px;
      }

      .history-filters label {
        display: grid;
        gap: 5px;
        color: #64748b;
        font-size: 11px;
        font-weight: 900;
      }

      .history-filters input {
        height: 38px;
        min-width: 150px;
        border: 1px solid #dbe3ee;
        border-radius: 10px;
        background: #ffffff;
        padding: 0 11px;
        color: #1e293b;
        font-size: 12px;
        font-weight: 800;
        outline: none;
        transition:
          border-color 160ms ease,
          box-shadow 160ms ease;
      }

      .history-filters input:focus {
        border-color: rgba(13, 175, 189, 0.48);
        box-shadow: 0 0 0 3px rgba(13, 175, 189, 0.12);
      }

      .history-apply {
        border: 1px solid rgba(13, 175, 189, 0.34);
        background: rgba(13, 175, 189, 0.1);
        padding: 0 15px;
        color: #0899a5;
      }

      .history-clear {
        padding: 0 14px;
      }

      .history-error {
        margin: -5px 18px 0;
        color: #dc2626;
        font-size: 12px;
        font-weight: 850;
      }

      .history-table-card {
        overflow: hidden;
      }

      .history-table-head,
      .history-table-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 13px 18px;
      }

      .history-table-head {
        border-bottom: 1px solid #edf1f6;
      }

      .history-table-head h3 {
        color: #0f172a;
        font-size: 15px;
        font-weight: 900;
      }

      .history-table-head p,
      .history-table-head strong,
      .history-table-foot {
        color: #94a3b8;
        font-size: 11px;
        font-weight: 850;
      }

      .history-table-wrap {
        overflow-x: auto;
      }

      .history-table-wrap table {
        width: 100%;
        min-width: 900px;
        border-collapse: collapse;
        text-align: left;
        font-size: 12px;
      }

      .history-table-wrap thead {
        background: #f8fafc;
      }

      .history-table-wrap th {
        padding: 12px 18px;
        color: #94a3b8;
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .history-table-wrap td {
        border-top: 1px solid #eef2f7;
        padding: 12px 18px;
        color: #475569;
        font-weight: 850;
      }

      .history-table-wrap tbody tr:nth-child(even) {
        background: #f8fafc;
      }

      .history-table-wrap td:not(:first-child) {
        color: #0f172a;
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 900;
      }

      .history-dot {
        display: inline-block;
        height: 5px;
        width: 5px;
        margin-right: 8px;
        border-radius: 999px;
        background: rgba(13, 175, 189, 0.24);
      }

      .history-empty {
        height: 120px;
        text-align: center;
        color: #94a3b8 !important;
        font-family: var(--font-body) !important;
      }

      .history-table-foot {
        border-top: 1px solid #edf1f6;
      }

      .secondary-grid {
        display: grid;
        align-items: stretch;
        gap: 18px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .loading-state {
        grid-column: 1 / -1;
        display: flex;
        min-height: 460px;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        padding: 40px;
      }

      @media (max-width: 1320px) {
        .kpi-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .main-grid {
          grid-template-columns: 1fr;
        }

        .right-rail {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          grid-template-rows: none;
        }
      }

      @media (max-width: 1023px) {
        .scada-page {
          padding: 0 14px 28px;
        }

        main {
          padding: 18px 0;
        }
      }

      @media (max-width: 760px) {
        .scada-page {
          padding: 0 10px 24px;
        }

        .kpi-grid,
        .right-rail,
        .secondary-grid {
          grid-template-columns: 1fr;
        }

        .history-toolbar,
        .history-table-head,
        .history-table-foot {
          align-items: flex-start;
          flex-direction: column;
        }

        .history-actions-buttons {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class CompanySitePasteurizadorDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  readonly companyService = inject(CompanyService);
  private realtimePollingSub?: Subscription;
  private historyPollingSub?: Subscription;
  private dailyKpisPollingSub?: Subscription;

  siteContext = signal<SiteContext | null>(null);
  activeSection = signal<PasteurSection>('monitoring');
  activeOperationView = signal<PasteurOperationView>('trends');
  settingsPanelOpen = signal(false);
  readonly isSuperAdmin = this.auth.isSuperAdmin;
  readonly canEditSiteSettings = this.auth.canEditSiteSettings;
  readonly snapshot = signal<PasteurizadorSnapshot | null>(null);
  readonly dailyKpis = signal<PasteurizadorDailyKpisResponse | null>(null);
  readonly realtimeRows = signal<PasteurHistoryRow[]>([]);
  readonly realtimeLoading = signal(false);
  readonly realtimeError = signal('');
  readonly historyLoading = signal(false);
  readonly historyError = signal('');
  readonly historyRows = signal<PasteurHistoryRow[]>([]);
  readonly historyServerTotalRows = signal<number | null>(null);
  readonly historyPage = signal(1);
  readonly historyDateFrom = signal(chileMonthStart());
  readonly historyDateTo = signal(chileToday());
  readonly historyDateFromInput = signal(this.historyDateFrom());
  readonly historyDateToInput = signal(this.historyDateTo());
  readonly historyDateRangeError = signal('');
  readonly visibleHistoryRows = computed(() => this.historyRows());
  readonly historyTotalRows = computed(
    () => this.historyServerTotalRows() ?? this.historyRows().length,
  );
  readonly currentHistoryPageCount = computed(() => this.visibleHistoryRows().length);
  readonly historyTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.historyTotalRows() / PASTEUR_HISTORY_PAGE_SIZE)),
  );
  readonly historyRangeStart = computed(() =>
    this.historyTotalRows() ? (this.historyPage() - 1) * PASTEUR_HISTORY_PAGE_SIZE + 1 : 0,
  );
  readonly historyRangeEnd = computed(() =>
    Math.min(this.historyPage() * PASTEUR_HISTORY_PAGE_SIZE, this.historyTotalRows()),
  );
  readonly chartRows = computed(() => {
    const rows = this.sortedRealtimeRows();
    const latest = rows.at(-1)?.timestampMs ?? Date.now();
    const start = latest - PASTEUR_MONITOR_WINDOW_MS;
    return rows.filter((row) => row.timestampMs >= start && row.timestampMs <= latest);
  });
  readonly chartTimeWindow = computed(() => {
    const latest = this.chartRows().at(-1)?.timestampMs ?? Date.now();
    return {
      latestMs: latest,
      startMs: latest - PASTEUR_MONITOR_WINDOW_MS,
      endMs: latest + PASTEUR_AXIS_FUTURE_PADDING_MS,
    };
  });
  readonly chartTimestamps = computed(() => this.chartRows().map((row) => row.timestampMs));
  readonly trendRows = computed(() => this.sortedRealtimeRows().slice(-PASTEUR_REALTIME_LIMIT));
  readonly times = computed(() =>
    this.chartRows().map((row) => this.formatChileTimeShort(row.timestampMs)),
  );
  readonly pasteurValues = computed(() =>
    this.seriesFromRows(this.chartRows(), 'pasteurizacionValue'),
  );
  readonly entradaValues = computed(() => this.seriesFromRows(this.chartRows(), 'entradaValue'));
  readonly productoValues = computed(() =>
    this.seriesFromRows(this.chartRows(), 'productoTinaValue'),
  );
  readonly trendTimes = computed(() =>
    this.trendRows().map((row) => this.formatChileTimeShort(row.timestampMs)),
  );
  readonly trendPasteurValues = computed(() =>
    this.seriesFromRows(this.trendRows(), 'pasteurizacionValue'),
  );
  readonly trendEntradaValues = computed(() =>
    this.seriesFromRows(this.trendRows(), 'entradaValue'),
  );
  readonly trendProductoValues = computed(() =>
    this.seriesFromRows(this.trendRows(), 'productoTinaValue'),
  );
  readonly trendValveValues = computed(() => this.seriesFromRows(this.trendRows(), 'valveValue'));

  readonly processDiagramData = computed<PasteurProcessDiagramData>(() => {
    const vars = this.snapshot()?.variables ?? {};
    const entrada = this.metricNumber(vars['temperatura_entrada']);
    const pasteur = this.metricNumber(vars['temperatura_pasteurizacion']);
    const producto = this.metricNumber(vars['salida_producto_tina']);
    const presion = this.metricNumber(vars['presion_vapor']);
    const gases = this.metricNumber(vars['temperatura_gases_combustion']);
    const errores = this.metricNumber(vars['errores_criticos']) ?? 0;
    const valveOpen = this.metricBoolean(vars['estado_valvula']);
    const status = this.snapshot()?.estado_operativo;

    return {
      inputTank: {
        title: 'Entrada leche',
        label: 'Dato entrada',
        value: this.metricDisplay(vars['temperatura_entrada'], 1, 'C'),
        level: this.scalePercent(entrada, 20, 50),
        tone: 'blue',
      },
      pump: {
        title: 'Bomba',
        state: status?.id === 'sin_datos' ? 'inactive' : 'active',
        helper: status?.label || 'Sin datos',
      },
      pasteurizer: {
        title: 'Pasteurizador',
        label: 'Dato principal',
        value: this.metricDisplay(vars['temperatura_pasteurizacion'], 1, 'C'),
        helper: 'Objetivo 72 C',
        status:
          status?.severity === 'critical'
            ? 'critical'
            : pasteur !== null && (pasteur < 65 || pasteur > 75)
              ? 'warning'
              : 'normal',
      },
      valve: {
        title: 'Valvula',
        state: valveOpen ? 'open' : 'closed',
        label: 'Estado',
        value: valveOpen ? 'Abierta' : 'Cerrada',
      },
      outputTank: {
        title: 'Tina de salida',
        label: 'Produccion',
        value: this.metricDisplay(vars['salida_producto_tina'], 0, 'L'),
        level: this.scalePercent(producto, 0, Math.max(producto ?? 0, 5000)),
        tone: 'green',
      },
      boiler: {
        title: 'Caldera de vapor',
        active: presion !== null || gases !== null,
        metrics: [
          {
            label: 'Presion vapor',
            value: this.metricDisplay(vars['presion_vapor'], 1, 'bar'),
            tone: 'orange',
          },
          {
            label: 'Temp. gases',
            value: this.metricDisplay(vars['temperatura_gases_combustion'], 1, 'C'),
            tone: 'red',
          },
        ],
      },
      summary: {
        title: 'Resumen del proceso',
        metrics: [
          {
            label: 'C entrada',
            value: this.metricDisplay(vars['temperatura_entrada'], 1, 'C'),
            tone: 'orange',
          },
          {
            label: 'C pasteurizacion',
            value: this.metricDisplay(vars['temperatura_pasteurizacion'], 1, 'C'),
            tone: 'purple',
          },
          {
            label: 'Produccion actual',
            value: this.metricDisplay(vars['salida_producto_tina'], 0, 'L'),
            tone: 'green',
          },
          {
            label: 'Estado sistema',
            value: status?.label || 'Sin datos',
            tone: status?.severity === 'critical' ? 'red' : 'green',
          },
        ],
        alarmText:
          errores > 0 ? `${this.formatNumber(errores, 0)} errores criticos` : 'Sin alarmas activas',
        hasAlarm: errores > 0,
      },
    };
  });

  readonly kpis = computed<PasteurKpi[]>(() => {
    const vars = this.snapshot()?.variables ?? {};
    const valveOpen = this.metricBoolean(vars['estado_valvula']);
    const errores = this.metricNumber(vars['errores_criticos']) ?? 0;

    return [
      {
        label: 'Temperatura pasteurizacion',
        value: this.metricValueOrLast(vars['temperatura_pasteurizacion'], this.pasteurValues(), 1),
        unit: '°C',
        helper: 'Objetivo 72 °C',
        icon: 'device_thermostat',
        tone: 'purple',
        trend: this.pasteurValues().slice(-8),
      },
      {
        label: 'Temperatura entrada',
        value: this.metricValueOrLast(vars['temperatura_entrada'], this.entradaValues(), 1),
        unit: '°C',
        helper: 'Ingreso a proceso',
        icon: 'thermostat',
        tone: 'cyan',
        trend: this.entradaValues().slice(-8),
      },
      {
        label: 'Producto a tina',
        value: this.metricValueOrLast(vars['salida_producto_tina'], this.productoValues(), 0),
        unit: 'L',
        helper: 'Produccion acumulada',
        icon: 'water_drop',
        tone: 'green',
        trend: this.productoValues().slice(-8),
      },
      {
        label: 'Estado valvula',
        value: valveOpen ? 'Abierta' : 'Cerrada',
        helper: valveOpen ? 'Apertura activa' : 'Sin apertura activa',
        icon: 'tune',
        tone: 'orange',
        trend: this.trendValveValues().slice(-8),
      },
      {
        label: 'Errores criticos',
        value: this.formatNumber(errores, 0),
        helper: errores > 0 ? 'Revisar proceso' : 'Sin alarmas activas',
        icon: errores > 0 ? 'error' : 'verified',
        tone: errores > 0 ? 'orange' : 'success',
        trend: this.trendRows()
          .map((row) => row.erroresCriticosValue ?? 0)
          .slice(-8),
      },
    ];
  });

  readonly pasteurChart = computed<PasteurChart>(() => ({
    title: 'Temperatura Pasteurizacion (Tiempo Real)',
    subtitle: this.realtimeError() || 'Proceso principal',
    unit: '°C',
    currentValue: this.lastValue(this.pasteurValues(), 1),
    minLabel: '65 °C',
    targetLabel: '72 °C',
    maxLabel: '75 °C',
    tone: 'purple',
    values: this.pasteurValues(),
    min: 50,
    max: 90,
    referenceLines: [
      { label: 'Min. 65 °C', value: 65, tone: 'min' },
      { label: 'Objetivo 72 °C', value: 72, tone: 'target' },
      { label: 'Max. 75 °C', value: 75, tone: 'max' },
    ],
    times: this.times(),
    timestamps: this.chartTimestamps(),
    xMinMs: this.chartTimeWindow().startMs,
    xMaxMs: this.chartTimeWindow().endMs,
    latestTimestampMs: this.chartTimeWindow().latestMs,
    tooltipDateLabel: this.latestChartDateLabel(),
    tooltipMetricLabel: 'Pasteurizacion',
  }));

  readonly entradaChart = computed<PasteurChart>(() => ({
    title: 'Temperatura Entrada',
    subtitle: 'Ingreso a proceso',
    unit: '°C',
    currentValue: this.lastValue(this.entradaValues(), 1),
    tone: 'cyan',
    values: this.entradaValues(),
    min: 20,
    max: 50,
    times: this.times(),
    timestamps: this.chartTimestamps(),
    xMinMs: this.chartTimeWindow().startMs,
    xMaxMs: this.chartTimeWindow().endMs,
    latestTimestampMs: this.chartTimeWindow().latestMs,
    tooltipDateLabel: this.latestChartDateLabel(),
    tooltipMetricLabel: 'Entrada',
  }));

  readonly productoChart = computed<PasteurChart>(() => ({
    title: 'Producto a Tina Acumulado',
    subtitle: 'Produccion',
    unit: 'L',
    currentValue: this.lastValue(this.productoValues(), 0),
    tone: 'green',
    values: this.productoValues(),
    min: 0,
    max: Math.max(3500, ...this.productoValues()),
    times: this.times(),
    timestamps: this.chartTimestamps(),
    xMinMs: this.chartTimeWindow().startMs,
    xMaxMs: this.chartTimeWindow().endMs,
    latestTimestampMs: this.chartTimeWindow().latestMs,
    tooltipDateLabel: this.latestChartDateLabel(),
    tooltipMetricLabel: 'Producto a tina',
  }));

  readonly quickMetrics = computed<PasteurQuickMetric[]>(() => {
    const vars = this.snapshot()?.variables ?? {};
    const status = this.snapshot()?.estado_operativo;

    return [
      { label: 'Ultima actualizacion', value: this.formatLatestUpdate() },
      { label: 'Estado operativo', value: status?.label || 'Sin datos' },
      { label: 'Temp. promedio', value: `${this.averageValue(this.pasteurValues(), 1)} °C` },
      { label: 'Fuente', value: this.snapshot()?.metadata?.source || 'equipo' },
      { label: 'Errores criticos', value: this.metricDisplay(vars['errores_criticos'], 0, 'N') },
    ];
  });

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');
    if (!siteId) {
      this.router.navigate(['/companies']);
      return;
    }

    const cachedMatch = this.findAccessibleSite(this.companyService.visibleHierarchy(), siteId);
    if (cachedMatch) {
      this.applySiteContext(cachedMatch);
      return;
    }

    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        if (!res.ok) {
          this.router.navigate(['/companies']);
          return;
        }

        const match = this.findAccessibleSite(res.data, siteId);
        if (!match) {
          this.router.navigate(['/companies']);
          return;
        }

        this.applySiteContext(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  ngOnDestroy(): void {
    this.realtimePollingSub?.unsubscribe();
    this.historyPollingSub?.unsubscribe();
    this.dailyKpisPollingSub?.unsubscribe();
  }

  siteName(context: SiteContext): string {
    return context.site.descripcion || context.subCompany.nombre || 'Pasteurizador 1';
  }

  siteSubtitle(context: SiteContext): string {
    return context.subCompany.nombre || context.company.nombre || 'Matthei';
  }

  setActiveSection(section: PasteurSection): void {
    if (section === 'analysis' && !this.isSuperAdmin()) return;
    this.settingsPanelOpen.set(false);
    if (section !== 'monitoring') {
      this.historyPollingSub?.unsubscribe();
    }
    if (section !== 'operation') {
      this.dailyKpisPollingSub?.unsubscribe();
    }
    if (section === 'operation' && this.activeSection() !== 'operation') {
      this.activeOperationView.set('trends');
    }
    this.activeSection.set(section);

    if (section === 'operation' && this.activeOperationView() === 'trends') {
      const siteId = this.currentSiteId();
      if (siteId) this.startDailyKpisPolling(siteId);
    }
  }

  setActiveOperationView(view: PasteurOperationView): void {
    if (view !== 'history') {
      this.historyPollingSub?.unsubscribe();
    }
    if (view !== 'trends') {
      this.dailyKpisPollingSub?.unsubscribe();
    }
    this.activeOperationView.set(view);

    if (view === 'trends' && this.activeSection() === 'operation') {
      const siteId = this.currentSiteId();
      if (siteId) this.startDailyKpisPolling(siteId);
    }
  }

  openHistoryView(): void {
    const monthStart = chileMonthStart();
    const today = chileToday();
    this.historyDateFrom.set(monthStart);
    this.historyDateTo.set(today);
    this.historyDateFromInput.set(monthStart);
    this.historyDateToInput.set(today);
    this.historyDateRangeError.set('');
    this.historyPage.set(1);
    this.activeSection.set('monitoring');
    this.activeOperationView.set('history');
    const siteId = this.currentSiteId();
    if (siteId) this.startHistoryPolling(siteId);
  }

  closeHistoryView(): void {
    this.activeOperationView.set('trends');
    this.historyPollingSub?.unsubscribe();
  }

  setHistoryDateFrom(event: Event): void {
    this.historyDateFromInput.set((event.target as HTMLInputElement).value);
    this.historyDateRangeError.set('');
  }

  setHistoryDateTo(event: Event): void {
    this.historyDateToInput.set((event.target as HTMLInputElement).value);
    this.historyDateRangeError.set('');
  }

  applyHistoryFilters(): void {
    const from = this.historyDateFromInput();
    const to = this.historyDateToInput();
    const fromMs = this.parseDateInputMs(from, 'start');
    const toMs = this.parseDateInputMs(to, 'end');

    if (!from || !to) {
      this.historyDateRangeError.set('Selecciona ambas fechas.');
      return;
    }

    if (fromMs === null || toMs === null) {
      this.historyDateRangeError.set('Fechas invalidas.');
      return;
    }

    if (fromMs > toMs) {
      this.historyDateRangeError.set('La fecha desde no puede ser mayor que hasta.');
      return;
    }

    const rangeDays = Math.ceil((toMs - fromMs) / 86_400_000);
    if (rangeDays > 93) {
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

  downloadHistoryCsv(): void {
    const rows = this.visibleHistoryRows();
    if (!rows.length) return;

    const headers = [
      'Fecha',
      'Temperatura de entrada',
      'Temperatura pasteurizacion',
      'Producto a tina',
    ];
    const csvRows = rows.map((row) => [
      row.fecha,
      row.entrada,
      row.pasteurizacion,
      row.productoTina,
    ]);
    const csv = [headers, ...csvRows]
      .map((line) => line.map((cell) => this.csvCell(cell)).join(';'))
      .join('\r\n');
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pasteurizador-historico-${this.historyDateFrom()}-${this.historyDateTo()}.csv`;
    link.rel = 'noopener';
    link.click();
    URL.revokeObjectURL(url);
  }

  cycleSection(delta: 1 | -1 | 0, edge?: 'first' | 'last'): void {
    const all: PasteurSection[] = ['monitoring', 'operation', 'alerts', 'log', 'analysis'];
    const available = all.filter((section) => section !== 'analysis' || this.isSuperAdmin());
    if (!available.length) return;

    if (edge === 'first') {
      this.setActiveSection(available[0]);
      return;
    }

    if (edge === 'last') {
      this.setActiveSection(available[available.length - 1]);
      return;
    }

    const currentIndex = available.indexOf(this.activeSection());
    const nextIndex = (currentIndex + delta + available.length) % available.length;
    this.setActiveSection(available[nextIndex]);
  }

  openSettingsPanel(): void {
    if (!this.canEditSiteSettings()) return;
    this.settingsPanelOpen.set(true);
  }

  closeSettingsPanel(): void {
    this.settingsPanelOpen.set(false);
  }

  onVariableMapChanged(): void {
    this.refreshHierarchySnapshot();
    const siteId = this.currentSiteId();
    if (!siteId) return;

    this.startRealtimePolling(siteId);
    if (this.activeSection() === 'operation' && this.activeOperationView() === 'trends') {
      this.startDailyKpisPolling(siteId);
    }
  }

  private startRealtimePolling(siteId: string): void {
    this.realtimeLoading.set(true);
    this.realtimeError.set('');
    this.realtimePollingSub?.unsubscribe();

    this.realtimePollingSub = timer(0, 60000)
      .pipe(
        switchMap(() =>
          this.companyService
            .getPasteurizadorBundle(siteId, {
              limit: PASTEUR_REALTIME_LIMIT,
              granularity: '1m',
              roles: PASTEUR_HISTORY_ROLES,
            })
            .pipe(
              catchError((err) => {
                console.error('No fue posible cargar pasteurizador en tiempo real', err);
                this.realtimeError.set('No fue posible cargar datos en tiempo real.');
                this.realtimeLoading.set(false);
                return of(null);
              }),
            ),
        ),
      )
      .subscribe((res) => {
        if (!res) return;
        this.snapshot.set(res.data?.snapshot ?? null);
        this.realtimeRows.set(this.mapPasteurHistoryRows(res.data?.history ?? null));
        this.realtimeError.set('');
        this.realtimeLoading.set(false);
      });
  }

  private startHistoryPolling(siteId: string): void {
    this.historyLoading.set(true);
    this.historyError.set('');
    this.historyPollingSub?.unsubscribe();

    this.historyPollingSub = timer(0, 60000)
      .pipe(
        switchMap(() =>
          this.companyService
            .getPasteurizadorHistory(siteId, {
              from: this.historyDateFrom(),
              to: this.historyDateTo(),
              limit: PASTEUR_HISTORY_PAGE_SIZE,
              page: this.historyPage(),
              granularity: '1m',
              roles: PASTEUR_HISTORY_ROLES,
            })
            .pipe(
              catchError((err) => {
                console.error('No fue posible cargar historial del pasteurizador', err);
                this.historyError.set('No fue posible cargar datos historicos.');
                this.historyLoading.set(false);
                return of(null);
              }),
            ),
        ),
      )
      .subscribe((res) => {
        if (!res) return;

        const data = res.data ?? null;
        const mappedRows = this.mapPasteurHistoryRows(data);
        const totalRows = Number(data?.pagination?.total);

        this.historyRows.set(mappedRows);
        this.historyServerTotalRows.set(Number.isFinite(totalRows) ? totalRows : mappedRows.length);
        this.historyError.set('');
        this.historyLoading.set(false);

        if (this.historyPage() > this.historyTotalPages()) {
          this.historyPage.set(this.historyTotalPages());
        }
      });
  }

  private startDailyKpisPolling(siteId: string): void {
    this.dailyKpisPollingSub?.unsubscribe();

    this.dailyKpisPollingSub = timer(0, 60000)
      .pipe(
        switchMap(() =>
          this.companyService.getPasteurizadorDailyKpis(siteId, chileToday()).pipe(
            catchError((err) => {
              console.error('No fue posible cargar KPIs diarios del pasteurizador', err);
              return of(null);
            }),
          ),
        ),
      )
      .subscribe((res) => {
        if (!res?.ok) return;
        this.dailyKpis.set(res.data ?? null);
      });
  }

  private mapPasteurHistoryRows(data: PasteurizadorHistoryResponse | null): PasteurHistoryRow[] {
    return (data?.rows ?? [])
      .map((row, index): PasteurHistoryRow | null => {
        const date =
          this.parseTelemetryDate(row.timestamp) ?? this.parseTelemetryDate(row.received_at);
        if (!date) return null;
        return this.buildPasteurHistoryRow(row.variables ?? {}, date, `history-${index}`);
      })
      .filter((row): row is PasteurHistoryRow => row !== null);
  }

  private sortedRealtimeRows(): PasteurHistoryRow[] {
    const rows = [...this.realtimeRows()].sort((a, b) => a.timestampMs - b.timestampMs);
    const snapshotRow = this.latestSnapshotHistoryRow();
    if (!snapshotRow) return rows;

    const latestHistoryMs = rows.at(-1)?.timestampMs ?? 0;
    if (snapshotRow.timestampMs < latestHistoryMs) return rows;

    return [...rows.filter((row) => row.timestampMs !== snapshotRow.timestampMs), snapshotRow].sort(
      (a, b) => a.timestampMs - b.timestampMs,
    );
  }

  private latestSnapshotHistoryRow(): PasteurHistoryRow | null {
    const snapshot = this.snapshot();
    if (!snapshot) return null;

    const latest = snapshot.ultima_lectura;
    const rawTimestamp =
      latest?.timestamp_completo || latest?.time || latest?.received_at || snapshot.server_time;
    const date = this.parseTelemetryDate(rawTimestamp || null);
    if (!date) return null;

    return this.buildPasteurHistoryRow(snapshot.variables ?? {}, date, 'snapshot-latest');
  }

  private buildPasteurHistoryRow(
    vars: Record<string, PasteurizadorMetric>,
    date: Date,
    idSuffix: string,
  ): PasteurHistoryRow {
    const entrada = this.metricNumber(vars['temperatura_entrada']);
    const pasteurizacion = this.metricNumber(vars['temperatura_pasteurizacion']);
    const productoTina = this.metricNumber(vars['salida_producto_tina']);
    const valveOpen = this.metricBoolean(vars['estado_valvula']);
    const erroresCriticos = this.metricNumber(vars['errores_criticos']);

    return {
      id: `${date.getTime()}-${idSuffix}`,
      timestampMs: date.getTime(),
      fecha: this.formatHistoryDate(date),
      entrada: this.metricDisplay(vars['temperatura_entrada'], 1, 'C'),
      pasteurizacion: this.metricDisplay(vars['temperatura_pasteurizacion'], 1, 'C'),
      productoTina: this.metricDisplay(vars['salida_producto_tina'], 0, 'L'),
      entradaValue: entrada,
      pasteurizacionValue: pasteurizacion,
      productoTinaValue: productoTina,
      valveValue: valveOpen ? 1 : 0,
      erroresCriticosValue: erroresCriticos,
    };
  }

  private seriesFromRows(
    rows: PasteurHistoryRow[],
    field: keyof Pick<
      PasteurHistoryRow,
      'entradaValue' | 'pasteurizacionValue' | 'productoTinaValue' | 'valveValue'
    >,
  ): number[] {
    return rows.map((row) => row[field] ?? Number.NaN);
  }

  private metricNumber(metric: PasteurizadorMetric | null | undefined): number | null {
    if (!metric || metric.ok === false) return null;
    return this.toNumber(metric.valor);
  }

  private metricBoolean(metric: PasteurizadorMetric | null | undefined): boolean {
    if (!metric || metric.ok === false) return false;
    const value = metric.valor;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    return ['1', 'true', 'on', 'abierta', 'abierto', 'open'].includes(normalized);
  }

  private metricDisplay(
    metric: PasteurizadorMetric | null | undefined,
    fractionDigits: number,
    fallbackUnit: string,
  ): string {
    if (!metric || metric.ok === false || metric.valor === null || metric.valor === undefined) {
      return '--';
    }

    const numeric = this.toNumber(metric.valor);
    const unit = this.displayUnit(metric.unidad || fallbackUnit);
    if (numeric !== null) return `${this.formatNumber(numeric, fractionDigits)} ${unit}`.trim();
    if (typeof metric.valor === 'boolean') return metric.valor ? 'Activo' : 'Inactivo';
    return String(metric.valor);
  }

  private metricValueOrLast(
    metric: PasteurizadorMetric | null | undefined,
    values: number[],
    fractionDigits: number,
  ): string {
    const numeric = this.metricNumber(metric);
    if (numeric !== null) return this.formatNumber(numeric, fractionDigits);
    return this.lastValue(values, fractionDigits);
  }

  private displayUnit(unit: string | null): string {
    if (!unit) return '';
    if (unit === 'C') return '°C';
    return unit;
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const normalized = String(value).replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private scalePercent(value: number | null, min: number, max: number): number {
    if (value === null || max <= min) return 0;
    return Math.round(Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)));
  }

  private parseTelemetryDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private formatChileTimeShort(timestampMs: number): string {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).format(new Date(timestampMs));
  }

  private latestChartDateLabel(): string {
    const row = this.chartRows().at(-1) ?? this.trendRows().at(-1);
    if (!row) return this.formatHistoryDate(new Date());
    return this.formatHistoryDate(new Date(row.timestampMs));
  }

  private formatLatestUpdate(): string {
    const latest = this.snapshot()?.ultima_lectura;
    const raw =
      latest?.timestamp_completo ||
      latest?.time ||
      latest?.received_at ||
      this.snapshot()?.server_time;
    const parsed = this.parseTelemetryDate(raw || null);
    if (!parsed) return '--';
    return this.formatHistoryDate(parsed);
  }

  private lastValue(values: number[], fractionDigits: number): string {
    const value = [...values].reverse().find((item) => Number.isFinite(item));
    if (value === undefined) return '--';
    return value.toLocaleString('es-CL', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  private averageValue(values: number[], fractionDigits: number): string {
    const finiteValues = values.filter((value) => Number.isFinite(value));
    if (!finiteValues.length) return '--';
    const total = finiteValues.reduce((sum, value) => sum + value, 0);
    return (total / finiteValues.length).toLocaleString('es-CL', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  private refreshHierarchySnapshot(): void {
    const siteId = this.currentSiteId();
    if (!siteId) return;

    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        if (!res.ok) return;
        const match = this.findAccessibleSite(res.data, siteId);
        if (!match) return;

        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.companyService.selectedSiteModuleKey.set('Proceso');
        this.companyService.selectedSiteTypeFilter.set(['pasteurizador']);
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

  private applySiteContext(match: SiteContext): void {
    this.companyService.selectedSubCompanyId.set(match.subCompany.id);
    this.companyService.selectedSiteModuleKey.set('Proceso');
    this.companyService.selectedSiteTypeFilter.set(['pasteurizador']);
    this.siteContext.set(match);
    this.dailyKpis.set(null);
    this.startRealtimePolling(match.site.id);
    if (this.activeSection() === 'operation' && this.activeOperationView() === 'trends') {
      this.startDailyKpisPolling(match.site.id);
    }
  }

  private currentSiteId(): string {
    return this.siteContext()?.site?.id || this.route.snapshot.paramMap.get('siteId') || '';
  }

  private formatHistoryDate(date: Date): string {
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    })
      .format(date)
      .replace(/\./g, '');
  }

  private formatNumber(value: number, fractionDigits: number): string {
    return value.toLocaleString('es-CL', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  private parseDateInputMs(value: string, boundary: 'start' | 'end'): number | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const time = boundary === 'start' ? '00:00:00' : '23:59:59';
    const date = new Date(`${value}T${time}`);
    const ms = date.getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  private csvCell(value: string): string {
    const cleaned = String(value ?? '').replace(/"/g, '""');
    const safe = /^[=+\-@]/.test(cleaned) ? `'${cleaned}` : cleaned;
    return `"${safe}"`;
  }

  private findAccessibleSite(tree: CompanyNode[], siteId: string): SiteContext | null {
    return findAccessibleSite(tree, siteId);
  }
}
