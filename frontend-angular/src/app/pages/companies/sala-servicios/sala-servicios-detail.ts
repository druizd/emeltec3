import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type {
  DashboardVariable,
  SiteDashboardData,
  SiteDashboardHistoryEntry,
} from '@emeltec/shared';
import { Subscription, timer } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import { CompanyService } from '../../../services/company.service';
import { CHILE_TIME_ZONE } from '../../../shared/timezone';
import { type SiteContext, findAccessibleSite } from '../../../shared/site-context';
import { getSiteTypeUi } from '../../../shared/site-type-ui';
import { SiteVariableSettingsPanelComponent } from '../components/site-variable-settings-panel';
import {
  TelemetryLineChartCardComponent,
  type TelemetryLineChart,
} from '../components/telemetry-line-chart-card';
import {
  WaterDetailDescargaComponent,
  type DownloadDataType,
} from '../components/water-detail-descarga/water-detail-descarga';
import { WaterDetailAlertasComponent } from '../components/water-detail-alertas/water-detail-alertas';

type SeccionSala = 'monitoreo' | 'tendencias' | 'historico' | 'alertas';

/** Una variable analogica del sitio, ya resuelta contra el reg_map. */
interface VariableSala {
  key: string;
  alias: string;
  unidad: string | null;
  rol: string;
}

/** Una fila del historico con las analogicas indexadas por clave. */
interface FilaSala {
  timestampMs: number;
  fecha: string;
  valores: Record<string, number | null>;
  digitales: Record<string, number | null>;
  /** Alias, unidad y rol que vinieron con cada variable en esta fila. */
  meta: Record<string, { alias: string; unidad: string | null; rol: string }>;
}

const POLL_EN_VIVO_MS = 60_000;
/** 12 horas a 1 lectura por minuto. Es lo que alimenta las tendencias. */
const LECTURAS_TENDENCIA = 720;
const FILAS_POR_PAGINA = 50;
/** Mas series que esto en un grafico y no se distingue ninguna. */
const MAX_SERIES_GRAFICO = 4;

const COLORES_SERIE = ['#6366f1', '#0dafbd', '#f59e0b', '#22c55e', '#f87171', '#8b5cf6'];

/**
 * Los servicios de una sala, en el orden en que se muestran. El servicio sale
 * del prefijo del rol que se le asigno a cada variable en la configuracion del
 * sitio, no del alias: el alias lo escribe quien instala y no hay dos iguales.
 * Una variable sin rol de servicio cae en "Otras variables".
 */
const SERVICIOS = [
  { id: 'vapor', label: 'Vapor', icono: 'humidity_high', tono: 'orange' as const },
  { id: 'frio', label: 'Frío', icono: 'ac_unit', tono: 'cyan' as const },
  { id: 'aire', label: 'Aire comprimido', icono: 'air', tono: 'blue' as const },
] as const;

const GRUPO_OTRAS = {
  id: 'otras',
  label: 'Otras variables',
  icono: 'sensors',
  tono: 'purple' as const,
};

/** Como se llama la magnitud segun el sufijo del rol, para titular el grafico. */
const MAGNITUDES: Record<string, string> = {
  presion: 'presión',
  temperatura: 'temperatura',
  caudal: 'caudal',
};

/**
 * Campos que ofrece el modal de descarga en un sitio de proceso. No hay
 * caudal ni totalizador: las variables van todas por el pseudo-campo
 * `analogicas`, que el backend expande a una columna por variable del reg_map.
 */
const CAMPOS_DESCARGA: DownloadDataType[] = [
  { id: 'analogicas', label: 'Variables analógicas', unit: '—' },
  { id: 'digitales', label: 'Señales digitales', unit: '0/1' },
];

@Component({
  selector: 'app-sala-servicios-detail',
  standalone: true,
  imports: [
    CommonModule,
    TelemetryLineChartCardComponent,
    WaterDetailDescargaComponent,
    WaterDetailAlertasComponent,
    SiteVariableSettingsPanelComponent,
  ],
  template: `
    <div class="sala-page">
      @if (siteContext(); as context) {
        <section class="dashboard-shell">
          <header class="site-head">
            <div class="site-head__id">
              <span class="site-head__icon">
                <span class="material-symbols-outlined" aria-hidden="true">{{ tipoIcono() }}</span>
              </span>
              <div class="min-w-0">
                <p class="site-head__eyebrow">
                  {{ context.company.nombre }} · {{ context.subCompany.nombre }} ·
                  {{ tipoLabel() }}
                </p>
                <h1 class="site-head__title">{{ context.site.descripcion || context.site.id }}</h1>
                <p class="site-head__meta">
                  {{ context.site.id }}
                  @if (context.site.id_serial) {
                    · serial {{ context.site.id_serial }}
                  }
                  · {{ variables().length }}
                  {{ variables().length === 1 ? 'variable' : 'variables' }}
                </p>
              </div>
            </div>

            <div class="site-head__actions">
              <span class="freshness" [class.freshness--stale]="datoViejo()">
                <span class="freshness__dot"></span>
                {{ frescuraLabel() }}
              </span>
              <button type="button" class="btn-descarga" (click)="descargaAbierta.set(true)">
                <span class="material-symbols-outlined" aria-hidden="true">download</span>
                Descargar
              </button>
              @if (canEditSiteSettings()) {
                <button
                  type="button"
                  class="btn-config"
                  [attr.aria-pressed]="configAbierta()"
                  (click)="configAbierta.set(!configAbierta())"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">settings</span>
                  Configuración
                </button>
              }
            </div>
          </header>

          @if (configAbierta()) {
            <section class="panel">
              <button type="button" class="volver" (click)="configAbierta.set(false)">
                <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
                Volver al detalle del sitio
              </button>
              <app-site-variable-settings-panel
                [siteId]="context.site.id"
                [site]="context.site"
                [showPozoConfig]="false"
                accentColor="#6366f1"
                accentSoft="rgba(99,102,241,0.10)"
                (variableMapChanged)="onVariablesCambiadas()"
              />
            </section>
          } @else {
            <nav class="view-tabs" role="tablist" aria-label="Secciones del sitio de proceso">
              @for (tab of tabs; track tab.id) {
                <button
                  type="button"
                  role="tab"
                  [class.is-active]="activeSection() === tab.id"
                  [attr.aria-selected]="activeSection() === tab.id"
                  [attr.tabindex]="activeSection() === tab.id ? 0 : -1"
                  (click)="setActiveSection(tab.id)"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">{{ tab.icon }}</span>
                  {{ tab.label }}
                </button>
              }
            </nav>

            @if (activeSection() === 'monitoreo') {
              <section class="panel">
                @if (cargandoEnVivo() && !variables().length) {
                  <p class="panel__hint">Cargando variables del sitio…</p>
                } @else if (!variables().length) {
                  <div class="vacio">
                    <span class="material-symbols-outlined" aria-hidden="true">sensors_off</span>
                    <strong>Este sitio no tiene variables configuradas</strong>
                    <span
                      >Hay que mapear los registros del equipo en la configuración de variables
                      antes de que esta pantalla muestre algo.</span
                    >
                  </div>
                } @else {
                  @for (grupo of grupos(); track grupo.id) {
                    <h2 class="panel__titulo">
                      <span class="material-symbols-outlined" aria-hidden="true">{{
                        grupo.icono
                      }}</span>
                      {{ grupo.label }}
                    </h2>
                    <div class="tiles">
                      @for (tile of grupo.tiles; track tile.key) {
                        <article class="tile" [class.tile--sin-dato]="tile.valor === null">
                          <p class="tile__label">{{ tile.label }}</p>
                          <p class="tile__valor">
                            {{ tile.valor === null ? '—' : tile.valor }}
                            @if (tile.unidad) {
                              <span class="tile__unidad">{{ tile.unidad }}</span>
                            }
                          </p>
                          <p class="tile__pie">{{ tile.pie }}</p>
                        </article>
                      }
                    </div>
                  }

                  @if (digitales().length) {
                    <h2 class="panel__titulo">Señales digitales</h2>
                    <div class="bits">
                      @for (bit of digitales(); track bit.key) {
                        <span class="bit" [class.bit--on]="bit.valor === 1">
                          <span class="bit__dot"></span>
                          {{ bit.alias }}
                        </span>
                      }
                    </div>
                  }
                }
              </section>
            } @else if (activeSection() === 'tendencias') {
              @if (cargandoHistorico()) {
                <section class="panel">
                  <p class="panel__hint">Cargando histórico…</p>
                </section>
              } @else if (errorHistorico()) {
                <section class="panel">
                  <p class="panel__error">{{ errorHistorico() }}</p>
                </section>
              } @else {
                @if (graficosPorServicio().length) {
                  <div class="graficos">
                    @for (grafico of graficosPorServicio(); track grafico.id) {
                      <app-telemetry-line-chart-card [chart]="grafico.chart" />
                    }
                  </div>
                }
              }

              <section class="panel">
                <div class="selector">
                  <p class="selector__label">
                    {{
                      graficosPorServicio().length
                        ? 'Comparar variables (gráfico libre)'
                        : 'Variables en el gráfico'
                    }}
                  </p>
                  <div class="selector__chips">
                    @for (variable of variables(); track variable.key) {
                      <button
                        type="button"
                        [class.is-on]="seleccionadas().includes(variable.key)"
                        [disabled]="
                          !seleccionadas().includes(variable.key) &&
                          seleccionadas().length >= maxSeries
                        "
                        (click)="toggleSerie(variable.key)"
                      >
                        {{ variable.alias }}
                      </button>
                    }
                  </div>
                  <p class="selector__hint">
                    Hasta {{ maxSeries }} series a la vez. Ventana: últimas 12 horas.
                  </p>
                </div>

                @if (cargandoHistorico()) {
                  <p class="panel__hint">Cargando histórico…</p>
                } @else if (errorHistorico()) {
                  <p class="panel__error">{{ errorHistorico() }}</p>
                } @else {
                  <app-telemetry-line-chart-card [chart]="grafico()" />
                }
              </section>
            } @else if (activeSection() === 'historico') {
              <section class="panel">
                @if (cargandoHistorico()) {
                  <p class="panel__hint">Cargando histórico…</p>
                } @else if (errorHistorico()) {
                  <p class="panel__error">{{ errorHistorico() }}</p>
                } @else if (!filas().length) {
                  <div class="vacio">
                    <span class="material-symbols-outlined" aria-hidden="true">table_rows</span>
                    <strong>Sin lecturas en la ventana consultada</strong>
                    <span>El equipo no ha reportado en las últimas 12 horas.</span>
                  </div>
                } @else {
                  <div class="tabla-wrap">
                    <table class="tabla">
                      <thead>
                        <tr>
                          <th scope="col">FECHA/HORA</th>
                          @for (variable of variables(); track variable.key) {
                            <th scope="col">
                              {{ variable.alias | uppercase }}
                              @if (variable.unidad) {
                                <span class="tabla__unidad">[{{ variable.unidad }}]</span>
                              }
                            </th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (fila of filasPagina(); track fila.timestampMs) {
                          <tr>
                            <td class="tabla__fecha">{{ fila.fecha }}</td>
                            @for (variable of variables(); track variable.key) {
                              <td class="tabla__valor">
                                {{ formatearValor(fila.valores[variable.key]) }}
                              </td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>

                  <div class="paginador">
                    <button type="button" [disabled]="pagina() === 1" (click)="irAPagina(-1)">
                      Anterior
                    </button>
                    <span>
                      {{ rangoDesde() }}–{{ rangoHasta() }} de {{ filas().length }} lecturas
                    </span>
                    <button
                      type="button"
                      [disabled]="pagina() >= totalPaginas()"
                      (click)="irAPagina(1)"
                    >
                      Siguiente
                    </button>
                  </div>
                }
              </section>
            } @else {
              <app-water-detail-alertas
                [sitioId]="context.site.id"
                [empresaId]="context.company.id"
              />
            }
          }
        </section>

        @if (descargaAbierta()) {
          <app-water-detail-descarga
            [siteId]="context.site.id"
            [siteName]="context.site.descripcion || context.site.id"
            [dataTypeOptions]="camposDescarga"
            (closed)="descargaAbierta.set(false)"
          />
        }
      } @else {
        <section class="dashboard-shell">
          <p class="panel__hint">Cargando sitio…</p>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .sala-page {
        min-height: 100%;
        overflow-x: hidden;
        padding: 0 18px 32px;
        background:
          radial-gradient(circle at 92% 0%, rgba(99, 102, 241, 0.08), transparent 24rem),
          linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
        color: #1e293b;
      }

      .dashboard-shell {
        width: min(100%, 1360px);
        margin: 0 auto;
        min-width: 0;
      }

      .site-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        border: 1px solid #e2e8f0;
        border-bottom: 0;
        border-radius: 14px 14px 0 0;
        background: #ffffff;
        padding: 18px 22px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05);
      }

      .site-head__id {
        display: flex;
        align-items: center;
        gap: 14px;
        min-width: 0;
      }

      .site-head__icon {
        display: inline-flex;
        height: 44px;
        width: 44px;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        background: rgba(99, 102, 241, 0.1);
        color: #6366f1;
      }

      .site-head__eyebrow {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
      }

      .site-head__title {
        font-size: 20px;
        font-weight: 700;
        line-height: 1.2;
        color: #1e293b;
      }

      .site-head__meta {
        font-size: 12px;
        color: #64748b;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
      }

      .site-head__actions {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .freshness {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 9999px;
        background: rgba(34, 197, 94, 0.1);
        border: 1px solid rgba(34, 197, 94, 0.25);
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 700;
        color: #16a34a;
      }

      .freshness--stale {
        background: rgba(251, 191, 36, 0.1);
        border-color: rgba(251, 191, 36, 0.25);
        color: #d97706;
      }

      .freshness__dot {
        height: 6px;
        width: 6px;
        border-radius: 9999px;
        background: currentColor;
      }

      .btn-descarga {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border-radius: 6px;
        background: #6366f1;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
        transition: background 160ms ease;
      }

      .btn-descarga:hover {
        background: #4f46e5;
      }

      .btn-descarga .material-symbols-outlined,
      .btn-config .material-symbols-outlined,
      .volver .material-symbols-outlined {
        font-size: 18px;
      }

      .btn-config {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 700;
        color: #475569;
        transition:
          border-color 160ms ease,
          color 160ms ease;
      }

      .btn-config[aria-pressed='true'] {
        border-color: rgba(99, 102, 241, 0.35);
        background: rgba(99, 102, 241, 0.08);
        color: #4f46e5;
      }

      .volver {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 14px;
        font-size: 13px;
        font-weight: 700;
        color: #64748b;
      }

      .volver:hover {
        color: #4f46e5;
      }

      .view-tabs {
        display: flex;
        min-height: 54px;
        align-items: center;
        gap: 22px;
        overflow-x: auto;
        scrollbar-width: none;
        border: 1px solid #e2e8f0;
        border-radius: 0 0 14px 14px;
        background: #ffffff;
        padding: 0 22px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05);
      }

      .view-tabs::-webkit-scrollbar {
        display: none;
      }

      .view-tabs button {
        position: relative;
        display: inline-flex;
        min-height: 54px;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        color: #64748b;
        font-size: 14px;
        font-weight: 800;
        white-space: nowrap;
        transition: color 160ms ease;
      }

      .view-tabs button.is-active {
        color: #4f46e5;
      }

      .view-tabs button.is-active::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: 0;
        right: 0;
        height: 2px;
        border-radius: 9999px;
        background: #6366f1;
      }

      .view-tabs button:focus-visible {
        border-radius: 6px;
        outline: 2px solid rgba(99, 102, 241, 0.36);
        outline-offset: 3px;
      }

      .panel {
        margin-top: 16px;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        background: #ffffff;
        padding: 20px 22px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
      }

      .panel__titulo {
        display: flex;
        align-items: center;
        gap: 7px;
        margin: 22px 0 10px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
      }

      .panel__titulo:first-child {
        margin-top: 0;
      }

      .panel__titulo .material-symbols-outlined {
        font-size: 16px;
        color: #6366f1;
      }

      .panel__hint {
        font-size: 13px;
        color: #64748b;
      }

      .panel__error {
        font-size: 13px;
        font-weight: 600;
        color: #dc2626;
      }

      .tiles {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
      }

      .tile {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #f8fafc;
        padding: 14px 16px;
      }

      .tile--sin-dato {
        opacity: 0.62;
      }

      .tile__label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tile__valor {
        margin-top: 6px;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 26px;
        font-weight: 600;
        line-height: 1.1;
        color: #6366f1;
      }

      .tile__unidad {
        margin-left: 4px;
        font-size: 12px;
        color: #64748b;
      }

      .tile__pie {
        margin-top: 6px;
        font-size: 11px;
        color: #94a3b8;
      }

      .bits {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .bit {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border-radius: 9999px;
        border: 1px solid #e2e8f0;
        background: #f8fafc;
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 700;
        color: #64748b;
      }

      .bit--on {
        border-color: rgba(34, 197, 94, 0.25);
        background: rgba(34, 197, 94, 0.1);
        color: #16a34a;
      }

      .bit__dot {
        height: 6px;
        width: 6px;
        border-radius: 9999px;
        background: currentColor;
      }

      .graficos {
        display: grid;
        gap: 16px;
        margin-top: 16px;
        grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
      }

      @media (max-width: 900px) {
        .graficos {
          grid-template-columns: 1fr;
        }
      }

      .selector {
        margin-bottom: 18px;
      }

      .selector__label {
        margin-bottom: 8px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
      }

      .selector__chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .selector__chips button {
        border-radius: 9999px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 700;
        color: #64748b;
        transition:
          border-color 160ms ease,
          color 160ms ease;
      }

      .selector__chips button.is-on {
        border-color: rgba(99, 102, 241, 0.35);
        background: rgba(99, 102, 241, 0.08);
        color: #4f46e5;
      }

      .selector__chips button:disabled {
        opacity: 0.4;
      }

      .selector__hint {
        margin-top: 8px;
        font-size: 11px;
        color: #94a3b8;
      }

      .tabla-wrap {
        overflow-x: auto;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
      }

      .tabla {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .tabla th {
        position: sticky;
        top: 0;
        background: #f8fafc;
        padding: 10px 12px;
        text-align: left;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #64748b;
        white-space: nowrap;
        border-bottom: 1px solid #e2e8f0;
      }

      .tabla__unidad {
        margin-left: 3px;
        color: #94a3b8;
      }

      .tabla td {
        padding: 8px 12px;
        border-bottom: 1px solid #f1f5f9;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        color: #334155;
        white-space: nowrap;
      }

      .tabla__fecha {
        color: #64748b;
      }

      .tabla__valor {
        text-align: right;
      }

      .paginador {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: 12px;
        font-size: 12px;
        color: #64748b;
      }

      .paginador button {
        border-radius: 6px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        padding: 6px 14px;
        font-weight: 700;
        color: #475569;
      }

      .paginador button:disabled {
        opacity: 0.45;
      }

      .vacio {
        display: grid;
        justify-items: center;
        gap: 6px;
        padding: 40px 16px;
        text-align: center;
        color: #64748b;
      }

      .vacio strong {
        font-size: 14px;
        color: #334155;
      }

      .vacio span:last-child {
        max-width: 460px;
        font-size: 12px;
      }
    `,
  ],
})
export class SalaServiciosDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly companyService = inject(CompanyService);

  private pollSub?: Subscription;

  readonly maxSeries = MAX_SERIES_GRAFICO;
  readonly camposDescarga = CAMPOS_DESCARGA;
  readonly tabs: { id: SeccionSala; label: string; icon: string }[] = [
    { id: 'monitoreo', label: 'Monitoreo', icon: 'monitoring' },
    { id: 'tendencias', label: 'Tendencias', icon: 'query_stats' },
    { id: 'historico', label: 'Histórico', icon: 'table_rows' },
    { id: 'alertas', label: 'Alertas', icon: 'notifications_active' },
  ];

  readonly siteContext = signal<SiteContext | null>(null);
  readonly activeSection = signal<SeccionSala>('monitoreo');
  readonly descargaAbierta = signal(false);
  readonly configAbierta = signal(false);
  readonly canEditSiteSettings = this.auth.canEditSiteSettings;

  /** Encabezado segun el tipo del sitio: la misma vista sirve proceso y sala de servicios. */
  private readonly tipoUi = computed(() => getSiteTypeUi(this.siteContext()?.site.tipo_sitio));
  readonly tipoIcono = computed(() => this.tipoUi().icon);
  readonly tipoLabel = computed(() => this.tipoUi().label);

  readonly enVivo = signal<SiteDashboardData | null>(null);
  readonly cargandoEnVivo = signal(false);
  /** Orden cronologico: es el que necesita el grafico. */
  readonly filasCronologicas = signal<FilaSala[]>([]);
  /** La tabla se lee al reves: arriba la lectura mas nueva. */
  readonly filas = computed(() => [...this.filasCronologicas()].reverse());
  readonly cargandoHistorico = signal(false);
  readonly errorHistorico = signal('');
  readonly pagina = signal(1);
  private readonly seleccionManual = signal<string[] | null>(null);

  /**
   * Las columnas del grafico y de la tabla salen del historico, no del vivo:
   * ahi la clave de cada variable es la que el backend ya uso para indexarla.
   * Derivarla de nuevo en el cliente era adivinar la misma normalizacion —
   * y no cubria el sufijo que el backend agrega cuando dos alias chocan.
   * El vivo solo entra como respaldo, para poder listar las variables antes de
   * que llegue el historico.
   */
  readonly variables = computed<VariableSala[]>(() => {
    const desdeHistorico = new Map<string, VariableSala>();
    for (const fila of this.filasCronologicas()) {
      for (const [key, meta] of Object.entries(fila.meta)) {
        if (!desdeHistorico.has(key)) desdeHistorico.set(key, { key, ...meta });
      }
    }

    if (desdeHistorico.size) {
      return [...desdeHistorico.values()].sort((a, b) => a.alias.localeCompare(b.alias, 'es-CL'));
    }

    return this.conClaveUnica(this.enVivo()?.variables || [])
      .filter(({ variable }) => variable.transformacion !== 'bit')
      .map(({ variable, key }) => ({
        key,
        alias: variable.alias || variable.key || '—',
        unidad: variable.unidad || null,
        rol: variable.rol_dashboard || 'generico',
      }))
      .sort((a, b) => a.alias.localeCompare(b.alias, 'es-CL'));
  });

  readonly digitales = computed(() =>
    this.conClaveUnica(this.enVivo()?.variables || [])
      .filter(({ variable }) => variable.transformacion === 'bit')
      .map(({ variable, key }) => ({
        key,
        alias: variable.alias || variable.key || '—',
        valor: this.aNumero(variable.valor),
      })),
  );

  /** Los tiles son la lectura en vivo, sin pasar por el historico. */
  readonly tiles = computed(() =>
    this.conClaveUnica(this.enVivo()?.variables || [])
      .filter(({ variable }) => variable.transformacion !== 'bit')
      .map(({ variable, key }) => {
        const valor = variable.ok === false ? null : this.aNumero(variable.valor);
        const rol = variable.rol_dashboard || 'generico';
        return {
          key,
          label: (variable.alias || variable.key || '—').toUpperCase(),
          valor: valor === null ? null : this.formatearValor(valor),
          unidad: variable.unidad || null,
          servicio: SERVICIOS.find((s) => rol.startsWith(`${s.id}_`))?.id ?? GRUPO_OTRAS.id,
          pie:
            valor === null
              ? 'Sin lectura válida'
              : rol === 'generico'
                ? 'Sin rol asignado'
                : `Rol ${rol}`,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'es-CL')),
  );

  /**
   * Monitoreo agrupado por servicio. Un grupo sin variables no se dibuja, asi
   * que un sitio de proceso comun —donde nadie asigno roles de servicio— ve
   * una sola seccion y la pantalla queda igual que antes.
   */
  readonly grupos = computed(() => {
    const tiles = this.tiles();
    return [...SERVICIOS, GRUPO_OTRAS]
      .map((grupo) => ({
        id: grupo.id,
        label: grupo.label,
        icono: grupo.icono,
        tiles: tiles.filter((tile) => tile.servicio === grupo.id),
      }))
      .filter((grupo) => grupo.tiles.length > 0);
  });

  readonly seleccionadas = computed<string[]>(() => {
    const manual = this.seleccionManual();
    if (manual) return manual;
    // Por defecto, las primeras variables que tengan algun dato en la ventana:
    // abrir el grafico vacio no le dice nada a nadie.
    const conDato = this.variables().filter((variable) =>
      this.filasCronologicas().some((fila) => fila.valores[variable.key] !== null),
    );
    return (conDato.length ? conDato : this.variables())
      .slice(0, MAX_SERIES_GRAFICO)
      .map((variable) => variable.key);
  });

  /**
   * Un grafico por servicio y magnitud, armado solo desde los roles.
   *
   * La division por magnitud no es cosmetica: una presion en bar y una
   * temperatura en °C en el mismo eje dejan a una de las dos pegada al borde.
   * En cambio las variables que comparten servicio y magnitud —las cuatro
   * temperaturas de los circuitos de frio, por ejemplo— sirven juntas: ahi se
   * lee de un vistazo el salto termico entre entrada y salida.
   *
   * Un sitio sin roles de servicio no genera ninguno y la pestana queda con el
   * grafico libre de siempre.
   */
  readonly graficosPorServicio = computed(() => {
    const filas = this.filasCronologicas();
    if (!filas.length) return [];

    const timestamps = filas.map((fila) => fila.timestampMs);
    const grupos = new Map<
      string,
      { servicio: (typeof SERVICIOS)[number]; magnitud: string; vars: VariableSala[] }
    >();

    for (const variable of this.variables()) {
      const servicio = SERVICIOS.find((s) => variable.rol.startsWith(`${s.id}_`));
      if (!servicio) continue;
      const magnitud = variable.rol.slice(servicio.id.length + 1);
      const clave = `${servicio.id}|${magnitud}`;
      const grupo = grupos.get(clave) || { servicio, magnitud, vars: [] };
      grupo.vars.push(variable);
      grupos.set(clave, grupo);
    }

    return [...grupos.entries()]
      .map(([id, grupo]) => {
        const conDato = grupo.vars.filter((variable) =>
          filas.some((fila) => fila.valores[variable.key] !== null),
        );
        if (!conDato.length) return null;

        const unidad = conDato.find((variable) => variable.unidad)?.unidad || '';
        const chart: TelemetryLineChart = {
          title: `${grupo.servicio.label} — ${MAGNITUDES[grupo.magnitud] || grupo.magnitud}`,
          subtitle: unidad ? `Últimas 12 horas · ${unidad}` : 'Últimas 12 horas',
          tone: grupo.servicio.tono,
          timestamps,
          series: conDato.map((variable, i) => ({
            label: variable.alias,
            color: COLORES_SERIE[i % COLORES_SERIE.length],
            values: filas.map((fila) => fila.valores[variable.key] ?? null),
            unit: variable.unidad || undefined,
            precision: 2,
            missingValue: 'gap' as const,
          })),
          emptyText: 'El equipo no ha reportado estas variables en la ventana consultada.',
        };
        return { id, chart };
      })
      .filter((item): item is { id: string; chart: TelemetryLineChart } => item !== null)
      .sort((a, b) => a.id.localeCompare(b.id, 'es-CL'));
  });

  readonly grafico = computed<TelemetryLineChart>(() => {
    const filas = this.filasCronologicas();
    const elegidas = this.seleccionadas();
    const porClave = new Map(this.variables().map((variable) => [variable.key, variable]));

    return {
      title: 'Variables de proceso',
      subtitle: 'Últimas 12 horas',
      tone: 'purple',
      timestamps: filas.map((fila) => fila.timestampMs),
      series: elegidas.map((key, i) => {
        const variable = porClave.get(key);
        return {
          label: variable?.alias || key,
          color: COLORES_SERIE[i % COLORES_SERIE.length],
          values: filas.map((fila) => fila.valores[key] ?? null),
          unit: variable?.unidad || undefined,
          precision: 2,
          missingValue: 'gap' as const,
        };
      }),
      emptyText: 'El equipo no ha reportado estas variables en la ventana consultada.',
    };
  });

  readonly totalPaginas = computed(() =>
    Math.max(1, Math.ceil(this.filas().length / FILAS_POR_PAGINA)),
  );
  readonly filasPagina = computed(() => {
    const inicio = (this.pagina() - 1) * FILAS_POR_PAGINA;
    return this.filas().slice(inicio, inicio + FILAS_POR_PAGINA);
  });
  readonly rangoDesde = computed(() =>
    this.filas().length ? (this.pagina() - 1) * FILAS_POR_PAGINA + 1 : 0,
  );
  readonly rangoHasta = computed(() =>
    Math.min(this.pagina() * FILAS_POR_PAGINA, this.filas().length),
  );

  private readonly ultimaLecturaMs = computed(() => {
    const time =
      this.enVivo()?.ultima_lectura?.timestamp_completo || this.enVivo()?.ultima_lectura?.time;
    if (!time) return null;
    const ms = new Date(time).getTime();
    return Number.isFinite(ms) ? ms : null;
  });

  /** Dos veces el periodo de reporte del equipo: a los 3 minutos ya es viejo. */
  readonly datoViejo = computed(() => {
    const ms = this.ultimaLecturaMs();
    return ms === null || Date.now() - ms > 3 * 60_000;
  });

  readonly frescuraLabel = computed(() => {
    const ms = this.ultimaLecturaMs();
    if (ms === null) return 'Sin lecturas';
    const minutos = Math.floor((Date.now() - ms) / 60_000);
    if (minutos <= 1) return 'En línea';
    if (minutos < 60) return `Hace ${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `Hace ${horas} h`;
    return `Hace ${Math.floor(horas / 24)} d`;
  });

  ngOnInit(): void {
    const siteId = this.route.snapshot.paramMap.get('siteId');
    if (!siteId) {
      this.router.navigate(['/companies']);
      return;
    }

    const enCache = findAccessibleSite(this.companyService.visibleHierarchy(), siteId);
    if (enCache) {
      this.aplicarContexto(enCache);
      return;
    }

    this.companyService.fetchHierarchy().subscribe({
      next: (res) => {
        const match = res.ok ? findAccessibleSite(res.data, siteId) : null;
        if (!match) {
          this.router.navigate(['/companies']);
          return;
        }
        this.aplicarContexto(match);
      },
      error: () => this.router.navigate(['/companies']),
    });
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  setActiveSection(section: SeccionSala): void {
    this.activeSection.set(section);
  }

  toggleSerie(key: string): void {
    const actual = this.seleccionadas();
    if (actual.includes(key)) {
      this.seleccionManual.set(actual.filter((item) => item !== key));
      return;
    }
    if (actual.length >= MAX_SERIES_GRAFICO) return;
    this.seleccionManual.set([...actual, key]);
  }

  /**
   * Tras editar el reg_map hay que rearmar todo: cambiar una escala o un rol
   * cambia los valores, las unidades y hasta que columnas existen.
   */
  onVariablesCambiadas(): void {
    const siteId = this.siteContext()?.site.id;
    if (!siteId) return;
    this.companyService.invalidateSiteCache(siteId);
    this.cargarEnVivo(siteId);
    this.cargarHistorico(siteId);
  }

  irAPagina(delta: number): void {
    const siguiente = this.pagina() + delta;
    if (siguiente < 1 || siguiente > this.totalPaginas()) return;
    this.pagina.set(siguiente);
  }

  formatearValor(valor: number | null | undefined): string {
    if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
    // Los enteros no ganan nada con dos decimales, y las variables de proceso
    // mezclan cuentas del ADC (enteras) con float de temperatura.
    return Number.isInteger(valor)
      ? valor.toLocaleString('es-CL')
      : valor.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private aplicarContexto(context: SiteContext): void {
    this.siteContext.set(context);
    this.cargarHistorico(context.site.id);
    this.pollSub?.unsubscribe();
    this.pollSub = timer(0, POLL_EN_VIVO_MS).subscribe(() => this.cargarEnVivo(context.site.id));
  }

  private cargarEnVivo(siteId: string): void {
    this.cargandoEnVivo.set(true);
    this.companyService.getSiteDashboardData(siteId).subscribe({
      next: (res) => {
        this.cargandoEnVivo.set(false);
        if (res.ok) this.enVivo.set(res.data);
      },
      error: () => this.cargandoEnVivo.set(false),
    });
  }

  private cargarHistorico(siteId: string): void {
    this.cargandoHistorico.set(true);
    this.errorHistorico.set('');
    this.companyService
      .getSiteDashboardHistory(siteId, LECTURAS_TENDENCIA, { analogicas: true })
      .subscribe({
        next: (res) => {
          this.cargandoHistorico.set(false);
          if (!res.ok) {
            this.errorHistorico.set('No fue posible cargar el histórico del sitio.');
            return;
          }
          this.filasCronologicas.set(this.aFilas(res.data?.rows || []));
          this.pagina.set(1);
        },
        error: () => {
          this.cargandoHistorico.set(false);
          this.errorHistorico.set('No fue posible cargar el histórico del sitio.');
        },
      });
  }

  /**
   * El endpoint devuelve las filas de la mas nueva a la mas vieja. El grafico
   * necesita el orden cronologico; la tabla se lee al reves, pero mostrar la
   * ultima lectura arriba es lo que espera el operador, asi que la tabla usa
   * este mismo arreglo invertido al paginar.
   */
  private aFilas(rows: SiteDashboardHistoryEntry[]): FilaSala[] {
    return rows
      .map((row) => {
        const ms = new Date(row.timestamp).getTime();
        const valores: Record<string, number | null> = {};
        for (const [key, analog] of Object.entries(row.analogicas || {})) {
          valores[key] = analog?.ok === false ? null : this.aNumero(analog?.valor);
        }
        const meta: FilaSala['meta'] = {};
        for (const [key, analog] of Object.entries(row.analogicas || {})) {
          meta[key] = {
            alias: analog?.alias || key,
            unidad: analog?.unidad || null,
            rol: analog?.rol || 'generico',
          };
        }
        const digitales: Record<string, number | null> = {};
        for (const [key, digital] of Object.entries(row.digitales || {})) {
          digitales[key] = digital?.ok === false ? null : this.aNumero(digital?.valor);
        }
        return {
          timestampMs: Number.isFinite(ms) ? ms : 0,
          fecha: this.formatearFecha(ms),
          valores,
          digitales,
          meta,
        };
      })
      .filter((fila) => fila.timestampMs > 0)
      .sort((a, b) => a.timestampMs - b.timestampMs);
  }

  /**
   * Le pone a cada variable en vivo una clave unica derivada del alias.
   *
   * `dashboard-data` usa el ROL como clave cuando no es generico, y en una sala
   * de servicios el rol se repite: las cuatro temperaturas de frio llegarian
   * todas como `frio_temperatura`. Repetir una clave en un `track` de Angular
   * es un error en runtime, no un detalle cosmetico. Se normaliza igual que el
   * backend para las analogicas del historico, asi que ademas coinciden.
   */
  private conClaveUnica(
    variables: DashboardVariable[],
  ): { variable: DashboardVariable; key: string }[] {
    const usadas = new Set<string>();
    return variables.map((variable) => {
      const base =
        (variable.alias || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') ||
        variable.key ||
        'variable';
      let key = base;
      let n = 2;
      while (usadas.has(key)) key = `${base}_${n++}`;
      usadas.add(key);
      return { variable, key };
    });
  }

  private aNumero(valor: unknown): number | null {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }

  private formatearFecha(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const partes = new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(new Date(ms))
      .reduce<Record<string, string>>((acc, parte) => {
        if (parte.type !== 'literal') acc[parte.type] = parte.value;
        return acc;
      }, {});
    return `${partes['day']}/${partes['month']}/${partes['year']} ${partes['hour']}:${partes['minute']}`;
  }
}
