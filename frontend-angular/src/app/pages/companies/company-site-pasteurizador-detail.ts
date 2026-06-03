import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { CompanyNode, SiteRecord, SubCompanyNode } from '@emeltec/shared';
import { SkeletonComponent } from '../../components/ui/skeleton';
import { AuthService } from '../../services/auth.service';
import { CompanyService } from '../../services/company.service';
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

interface SiteContext {
  company: CompanyNode;
  subCompany: SubCompanyNode;
  site: SiteRecord;
}

type PasteurSection = 'monitoring' | 'operation' | 'alerts' | 'log' | 'analysis';
type PasteurOperationView = 'trends' | 'diagram' | 'history';

interface PasteurHistoryRow {
  id: string;
  timestampMs: number;
  fecha: string;
  entrada: string;
  pasteurizacion: string;
  productoTina: string;
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
                  <span class="material-symbols-outlined">arrow_back</span>
                </button>
                <p>Volver al detalle del sitio</p>
              </div>

              <app-site-variable-settings-panel
                [siteId]="context.site.id"
                [site]="context.site"
                [showPozoConfig]="false"
                accentColor="#8b5cf6"
                accentSoft="rgba(139,92,246,0.10)"
                (variableMapChanged)="onVariableMapChanged()"
              />
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
                <span class="material-symbols-outlined text-[20px]">monitoring</span>
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
                <span class="material-symbols-outlined text-[20px]">query_stats</span>
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
                <span class="material-symbols-outlined text-[20px]">notifications_active</span>
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
                <span class="material-symbols-outlined text-[20px]">menu_book</span>
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
                  <span class="material-symbols-outlined text-[20px]">insights</span>
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
                          <span class="material-symbols-outlined">arrow_back</span>
                        </button>
                        <span class="history-title-icon">
                          <span class="material-symbols-outlined">database</span>
                        </span>
                        <div>
                          <p>Sitios / {{ context.subCompany.nombre }} / Datos Historicos</p>
                          <h2>{{ siteName(context) }}</h2>
                        </div>
                      </div>

                      <button type="button" class="history-download" (click)="downloadHistoryCsv()">
                        <span class="material-symbols-outlined">download</span>
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
                        <strong>{{ visibleHistoryRows().length }} registros en esta vista</strong>
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
                          </tbody>
                        </table>
                      </div>

                      <div class="history-table-foot">
                        <span>Filas por pagina: 50</span>
                        <span
                          >{{ visibleHistoryRows().length }} de
                          {{ filteredHistoryRows().length }}</span
                        >
                      </div>
                    </div>
                  </section>
                } @else {
                  <section class="kpi-grid" aria-label="Indicadores principales">
                    @for (kpi of kpis; track kpi.label) {
                      <app-pasteurizador-kpi-card [kpi]="kpi" />
                    }
                  </section>

                  <section class="main-grid">
                    <app-pasteurizador-chart-card [chart]="pasteurChart" [featured]="true" />

                    <aside class="right-rail">
                      <app-pasteurizador-status-card
                        eyebrow="Informacion rapida"
                        title="Resumen operativo"
                        icon="manufacturing"
                        [metrics]="quickMetrics"
                      />
                      <article class="history-actions-card">
                        <div class="history-actions-head">
                          <span class="history-actions-icon">
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
                            <span class="material-symbols-outlined">history</span>
                            Datos historicos
                          </button>
                          <button
                            type="button"
                            class="history-secondary"
                            (click)="downloadHistoryCsv()"
                          >
                            <span class="material-symbols-outlined">download</span>
                            Descargar
                          </button>
                        </div>
                      </article>
                    </aside>
                  </section>

                  <section class="secondary-grid" aria-label="Graficos secundarios">
                    <app-pasteurizador-chart-card [chart]="entradaChart" />
                    <app-pasteurizador-chart-card [chart]="productoChart" />
                  </section>
                }
              </main>
            } @else if (activeSection() === 'operation') {
              <main id="pasteur-operation" class="operation-view" role="tabpanel">
                <nav class="operation-tabs" aria-label="Vistas de operacion">
                  <button
                    type="button"
                    [class.is-active]="activeOperationView() === 'trends'"
                    (click)="setActiveOperationView('trends')"
                  >
                    <span class="material-symbols-outlined">show_chart</span>
                    Tendencias
                  </button>
                  <button
                    type="button"
                    [class.is-active]="activeOperationView() === 'diagram'"
                    (click)="setActiveOperationView('diagram')"
                  >
                    <span class="material-symbols-outlined">account_tree</span>
                    Diagrama de proceso
                  </button>
                </nav>

                @if (activeOperationView() === 'diagram') {
                  <app-pasteurizador-process-diagram [data]="processDiagramData" />
                } @else {
                  <app-pasteurizador-trends-panel
                    [times]="trendTimes"
                    [pasteurValues]="trendPasteurValues"
                    [entradaValues]="trendEntradaValues"
                    [productoValues]="trendProductoValues"
                    [valveValues]="trendValveValues"
                  />
                }
              </main>
            } @else if (activeSection() === 'alerts') {
              <main id="pasteur-alerts" role="tabpanel">
                <app-water-detail-alertas
                  [sitioId]="context.site.id"
                  [empresaId]="context.company.id"
                />
              </main>
            } @else if (activeSection() === 'log') {
              <main id="pasteur-log" role="tabpanel">
                <app-water-detail-bitacora
                  [sitioId]="context.site.id"
                  [empresaId]="context.company.id"
                />
              </main>
            } @else if (activeSection() === 'analysis' && isSuperAdmin()) {
              <main id="pasteur-analysis" role="tabpanel">
                <app-water-detail-analisis [sitioId]="context.site.id" />
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
export class CompanySitePasteurizadorDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  readonly companyService = inject(CompanyService);

  siteContext = signal<SiteContext | null>(null);
  activeSection = signal<PasteurSection>('monitoring');
  activeOperationView = signal<PasteurOperationView>('trends');
  settingsPanelOpen = signal(false);
  readonly isSuperAdmin = this.auth.isSuperAdmin;
  readonly canEditSiteSettings = this.auth.canEditSiteSettings;
  readonly times = this.buildMinuteLabels(17, 11, 61);
  readonly pasteurValues = this.buildPasteurSeries(this.times.length);
  readonly entradaValues = this.buildEntradaSeries(this.times.length);
  readonly productoValues = this.buildProductoSeries(this.times.length);
  readonly trendTimes = this.buildMinuteLabels(16, 19, 121);
  readonly trendPasteurValues = this.buildTrendPasteurSeries(this.trendTimes.length);
  readonly trendEntradaValues = this.buildTrendEntradaSeries(this.trendTimes.length);
  readonly trendProductoValues = this.buildTrendProductoSeries(this.trendTimes.length);
  readonly trendValveValues = this.buildTrendValveSeries(this.trendTimes.length);
  readonly historyDateFrom = signal(this.isoTodayMinus(0));
  readonly historyDateTo = signal(this.isoTodayMinus(0));
  readonly historyDateFromInput = signal(this.historyDateFrom());
  readonly historyDateToInput = signal(this.historyDateTo());
  readonly historyDateRangeError = signal('');
  readonly historyRows = signal<PasteurHistoryRow[]>(this.buildHistoryRows(180));
  readonly filteredHistoryRows = computed(() => {
    const from = this.parseDateInputMs(this.historyDateFrom(), 'start');
    const to = this.parseDateInputMs(this.historyDateTo(), 'end');
    if (from === null || to === null) return [];

    return this.historyRows().filter((row) => row.timestampMs >= from && row.timestampMs <= to);
  });
  readonly visibleHistoryRows = computed(() => this.filteredHistoryRows().slice(0, 50));

  readonly processDiagramData: PasteurProcessDiagramData = {
    inputTank: {
      title: 'Entrada leche',
      label: 'Dato entrada',
      value: '39,3 C',
      level: 65,
      tone: 'blue',
    },
    pump: {
      title: 'Bomba',
      state: 'active',
      helper: 'Modo automatico',
    },
    pasteurizer: {
      title: 'Pasteurizador',
      label: 'Dato principal',
      value: '69,8 C',
      helper: 'Referencia mock 72 C',
      status: 'normal',
    },
    valve: {
      title: 'Valvula',
      state: 'closed',
      label: 'Estado',
      value: 'Apertura 0%',
    },
    outputTank: {
      title: 'Tina de salida',
      label: 'Produccion',
      value: '3.118 L',
      level: 62,
      tone: 'green',
    },
    boiler: {
      title: 'Caldera de vapor',
      active: true,
      metrics: [
        { label: 'Presion vapor', value: '2,5 bar', tone: 'orange' },
        { label: 'Temp. vapor', value: '185 C', tone: 'red' },
      ],
    },
    summary: {
      title: 'Resumen del proceso',
      metrics: [
        { label: 'Tiempo en proceso', value: '27 min' },
        { label: 'C entrada', value: '39,3 C', tone: 'orange' },
        { label: 'C pasteurizacion', value: '69,8 C', tone: 'purple' },
        { label: 'Produccion actual', value: '3.118 L', tone: 'green' },
        { label: 'Estado sistema', value: 'ACTIVO', tone: 'green' },
      ],
      alarmText: 'Sin alarmas activas',
      hasAlarm: false,
    },
  };

  readonly kpis: PasteurKpi[] = [
    {
      label: 'Temperatura pasteurizacion',
      value: this.lastValue(this.pasteurValues, 1),
      unit: '°C',
      helper: 'Objetivo 72 °C',
      icon: 'device_thermostat',
      tone: 'purple',
      trend: this.pasteurValues.slice(-8),
    },
    {
      label: 'Temperatura entrada',
      value: this.lastValue(this.entradaValues, 1),
      unit: '°C',
      helper: 'Ingreso a proceso',
      icon: 'thermostat',
      tone: 'cyan',
      trend: this.entradaValues.slice(-8),
    },
    {
      label: 'Producto a tina',
      value: this.lastValue(this.productoValues, 0),
      unit: 'L',
      helper: 'Produccion acumulada',
      icon: 'water_drop',
      tone: 'green',
      trend: this.productoValues.slice(-8),
    },
    {
      label: 'Estado valvula',
      value: 'Cerrada',
      helper: 'Sin apertura activa',
      icon: 'tune',
      tone: 'orange',
      trend: [0, 0, 0, 0, 0, 0, 0],
    },
    {
      label: 'Calidad senal',
      value: 'Good',
      helper: 'Sin alarmas activas',
      icon: 'verified',
      tone: 'success',
      trend: [1, 1, 1, 1, 1, 1, 1],
    },
  ];

  readonly pasteurChart: PasteurChart = {
    title: 'Temperatura Pasteurizacion (Tiempo Real)',
    subtitle: 'Proceso principal',
    unit: '°C',
    currentValue: this.lastValue(this.pasteurValues, 1),
    minLabel: '65 °C',
    targetLabel: '72 °C',
    maxLabel: '75 °C',
    tone: 'purple',
    values: this.pasteurValues,
    min: 50,
    max: 90,
    referenceLines: [
      { label: 'Min. 65 °C', value: 65, tone: 'min' },
      { label: 'Objetivo 72 °C', value: 72, tone: 'target' },
      { label: 'Max. 75 °C', value: 75, tone: 'max' },
    ],
    times: this.times,
    tooltipDateLabel: '02 Junio 2026',
    tooltipMetricLabel: 'Pasteurizacion',
  };

  readonly entradaChart: PasteurChart = {
    title: 'Temperatura Entrada',
    subtitle: 'Ingreso a proceso',
    unit: '°C',
    currentValue: this.lastValue(this.entradaValues, 1),
    tone: 'cyan',
    values: this.entradaValues,
    min: 20,
    max: 50,
    times: this.times,
    tooltipDateLabel: '02 Junio 2026',
    tooltipMetricLabel: 'Entrada',
  };

  readonly productoChart: PasteurChart = {
    title: 'Producto a Tina Acumulado',
    subtitle: 'Produccion',
    unit: 'L',
    currentValue: this.lastValue(this.productoValues, 0),
    tone: 'green',
    values: this.productoValues,
    min: 0,
    max: 3500,
    times: this.times,
    tooltipDateLabel: '02 Junio 2026',
    tooltipMetricLabel: 'Producto a tina',
  };

  readonly quickMetrics: PasteurQuickMetric[] = [
    { label: 'Ultima actualizacion', value: '18:11:00' },
    { label: 'Tiempo en proceso', value: '60 min' },
    { label: 'Temp. promedio', value: `${this.averageValue(this.pasteurValues, 1)} °C` },
    { label: 'N° cierre valvula', value: '5' },
    { label: 'Errores criticos', value: '0' },
  ];

  readonly diagramSteps: {
    label: string;
    value: string;
    helper: string;
    icon: string;
    tone: PasteurKpi['tone'];
  }[] = [
    {
      label: 'Entrada',
      value: `${this.lastValue(this.entradaValues, 1)} °C`,
      helper: 'Producto antes de pasteurizar',
      icon: 'input_circle',
      tone: 'cyan',
    },
    {
      label: 'Pasteurizacion',
      value: `${this.lastValue(this.pasteurValues, 1)} °C`,
      helper: 'Control principal del proceso',
      icon: 'device_thermostat',
      tone: 'purple',
    },
    {
      label: 'Valvula',
      value: 'Cerrada',
      helper: 'Sin apertura activa',
      icon: 'tune',
      tone: 'orange',
    },
    {
      label: 'Tina',
      value: `${this.lastValue(this.productoValues, 0)} L`,
      helper: 'Produccion acumulada',
      icon: 'water_drop',
      tone: 'green',
    },
  ];

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');
    if (!siteId) {
      this.router.navigate(['/companies']);
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

        this.companyService.selectedSubCompanyId.set(match.subCompany.id);
        this.companyService.selectedSiteModuleKey.set('Proceso');
        this.companyService.selectedSiteTypeFilter.set(['pasteurizador']);
        this.siteContext.set(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
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
    if (section === 'operation' && this.activeSection() !== 'operation') {
      this.activeOperationView.set('trends');
    }
    this.activeSection.set(section);
  }

  setActiveOperationView(view: PasteurOperationView): void {
    this.activeOperationView.set(view);
  }

  openHistoryView(): void {
    this.historyDateRangeError.set('');
    this.activeSection.set('monitoring');
    this.activeOperationView.set('history');
  }

  closeHistoryView(): void {
    this.activeOperationView.set('trends');
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
    if (rangeDays > 31) {
      this.historyDateRangeError.set('Rango maximo: 31 dias.');
      return;
    }

    this.historyDateRangeError.set('');
    this.historyDateFrom.set(from);
    this.historyDateTo.set(to);
  }

  clearHistoryFilters(): void {
    const today = this.isoTodayMinus(0);
    this.historyDateFrom.set(today);
    this.historyDateTo.set(today);
    this.historyDateFromInput.set(today);
    this.historyDateToInput.set(today);
    this.historyDateRangeError.set('');
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
  }

  private buildMinuteLabels(startHour: number, startMinute: number, total: number): string[] {
    return Array.from({ length: total }, (_, index) => {
      const totalMinutes = startHour * 60 + startMinute + index;
      const hour = Math.floor(totalMinutes / 60) % 24;
      const minute = totalMinutes % 60;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    });
  }

  private buildPasteurSeries(total: number): number[] {
    return Array.from({ length: total }, (_, index) => {
      const ramp = Math.min(index, 42) * 0.19;
      const wave = Math.sin(index / 3.2) * 1.25 + Math.cos(index / 8) * 0.65;
      const correction = index > 43 ? (index - 43) * 0.12 : 0;
      const spike = index > 18 && index < 25 ? (index - 18) * 0.85 : 0;
      const cooling = index >= 25 && index < 34 ? (34 - index) * 0.33 : 0;
      const value = 63.4 + ramp + wave + spike + cooling - correction;
      return Number(Math.min(76.4, Math.max(58.8, value)).toFixed(1));
    });
  }

  private buildEntradaSeries(total: number): number[] {
    return Array.from({ length: total }, (_, index) => {
      const value = 28.8 + index * 0.18 + Math.sin(index / 7) * 0.8;
      return Number(Math.min(42.6, value).toFixed(1));
    });
  }

  private buildProductoSeries(total: number): number[] {
    return Array.from({ length: total }, (_, index) => {
      const value = Math.pow(index / Math.max(total - 1, 1), 1.12) * 3118;
      return Math.round(value);
    });
  }

  private buildTrendPasteurSeries(total: number): number[] {
    return Array.from({ length: total }, (_, index) => {
      let value = 62 - Math.min(index, 18) * 0.18 + Math.sin(index / 4) * 0.9;

      if (index >= 22 && index < 58) {
        value = 70 + Math.sin(index / 5) * 2.1 + Math.cos(index / 2.7) * 0.7;
      }

      if (index >= 58 && index < 78) {
        value = 72 - (index - 58) * 0.18 + Math.sin(index / 3) * 1.2;
      }

      if (index >= 78 && index < 98) {
        value = 68 + (index - 78) * 1.05 + Math.sin(index / 2.6) * 1.6;
      }

      if (index >= 98) {
        value = 69 + Math.sin(index / 3.5) * 1.4 + Math.cos(index / 6) * 0.8;
      }

      return Number(Math.min(88.5, Math.max(55, value)).toFixed(1));
    });
  }

  private buildTrendEntradaSeries(total: number): number[] {
    return Array.from({ length: total }, (_, index) => {
      const value = 37.8 + Math.sin(index / 12) * 1.3 + Math.min(index, 90) * 0.025;
      return Number(Math.min(43.5, Math.max(34, value)).toFixed(1));
    });
  }

  private buildTrendProductoSeries(total: number): number[] {
    return Array.from({ length: total }, (_, index) => {
      if (index < 38) return 0;
      if (index < 94) return Math.round(((index - 38) / 56) * 8377);
      return Math.round(((index - 94) / Math.max(total - 94, 1)) * 3118);
    });
  }

  private buildTrendValveSeries(total: number): number[] {
    return Array.from({ length: total }, (_, index) => {
      if (index >= 38 && index <= 94) return 1;
      if (index >= 106 && index <= 110) return 1;
      return 0;
    });
  }

  private lastValue(values: number[], fractionDigits: number): string {
    return (values[values.length - 1] || 0).toLocaleString('es-CL', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  private averageValue(values: number[], fractionDigits: number): string {
    const total = values.reduce((sum, value) => sum + value, 0);
    return (total / Math.max(values.length, 1)).toLocaleString('es-CL', {
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

  private currentSiteId(): string {
    return this.siteContext()?.site?.id || this.route.snapshot.paramMap.get('siteId') || '';
  }

  private buildHistoryRows(total: number): PasteurHistoryRow[] {
    const now = new Date();
    now.setSeconds(0, 0);

    return Array.from({ length: total }, (_, index) => {
      const timestamp = new Date(now.getTime() - index * 60_000);
      const entrada = 38.8 + Math.sin(index / 12) * 1.1 + Math.cos(index / 17) * 0.4;
      const pasteurizacion = 69.4 + Math.sin(index / 8) * 2.1 + Math.cos(index / 19) * 0.9;
      const producto = Math.max(0, 3118 - index * 18 + Math.sin(index / 9) * 24);

      return {
        id: `${timestamp.getTime()}-${index}`,
        timestampMs: timestamp.getTime(),
        fecha: this.formatHistoryDate(timestamp),
        entrada: `${this.formatNumber(entrada, 1)} C`,
        pasteurizacion: `${this.formatNumber(pasteurizacion, 1)} C`,
        productoTina: `${this.formatNumber(producto, 0)} L`,
      };
    });
  }

  private formatHistoryDate(date: Date): string {
    const months = [
      'ene',
      'feb',
      'mar',
      'abr',
      'may',
      'jun',
      'jul',
      'ago',
      'sept',
      'oct',
      'nov',
      'dic',
    ];
    const day = String(date.getDate()).padStart(2, '0');
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${day} ${month} ${year}, ${hour}:${minute}`;
  }

  private formatNumber(value: number, fractionDigits: number): string {
    return value.toLocaleString('es-CL', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  }

  private isoTodayMinus(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return this.toIsoDate(date);
  }

  private toIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
    for (const company of tree) {
      for (const subCompany of company.subCompanies || []) {
        const site = (subCompany.sites || []).find((item) => item.id === siteId);
        if (site) return { company, subCompany, site };
      }
    }

    return null;
  }
}
