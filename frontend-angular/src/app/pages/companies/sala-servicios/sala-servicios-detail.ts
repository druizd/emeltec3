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

type RangoHistorico = '12h' | '24h' | '7d' | '30d' | 'personalizado';
type GranularidadHistorico = '1m' | '1h';

/** El periodo que alimenta tendencias e historico, ya resuelto a instantes. */
interface VentanaHistorico {
  desdeMs: number;
  hastaMs: number;
  granularidad: GranularidadHistorico;
  etiqueta: string;
  /** Solo los rangos personalizados: fechas YYYY-MM-DD que pide el backend. */
  fechas?: { desde: string; hasta: string };
}

const POLL_EN_VIVO_MS = 60_000;
/** 12 horas a 1 lectura por minuto: la vista por defecto, la que precalienta el cache. */
const LECTURAS_TENDENCIA = 720;
const FILAS_POR_PAGINA = 50;
const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
/**
 * La plataforma trata a Chile como UTC-4 fijo (CHILE_TIME_ZONE = 'Etc/GMT+4'),
 * y el backend corta los rangos por fecha con esa misma zona.
 */
const OFFSET_CHILE_MS = 4 * HORA_MS;
/** Topes del endpoint: 93 dias por rango y 3.500 filas por respuesta. */
const MAX_DIAS_RANGO = 93;
const MAX_FILAS_RANGO = 3500;
/**
 * Hasta 2 dias se pide minuto a minuto (2.880 filas, bajo el tope). Mas alla
 * se pide por hora: 93 dias son 2.232 filas, asi que nunca se trunca.
 */
const MAX_DIAS_POR_MINUTO = 2;
/** Mas que esto sin lectura y la linea se corta en vez de inventar una recta. */
const HUECO_MAXIMO_MS: Record<GranularidadHistorico, number> = {
  '1m': 10 * 60_000,
  '1h': 3 * HORA_MS,
};

const RANGOS_PREDEFINIDOS: {
  id: Exclude<RangoHistorico, 'personalizado'>;
  label: string;
  horas: number;
  etiqueta: string;
}[] = [
  { id: '12h', label: '12 h', horas: 12, etiqueta: 'Últimas 12 horas' },
  { id: '24h', label: '24 h', horas: 24, etiqueta: 'Últimas 24 horas' },
  { id: '7d', label: '7 días', horas: 7 * 24, etiqueta: 'Últimos 7 días' },
  { id: '30d', label: '30 días', horas: 30 * 24, etiqueta: 'Últimos 30 días' },
];
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
                        <article
                          class="tile"
                          [class.tile--sin-dato]="tile.valor === null"
                          [class.tile--fuera]="tile.fueraDeRango"
                        >
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
              <ng-container [ngTemplateOutlet]="barraRango" />
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
                  <p class="selector__hint">Hasta {{ maxSeries }} series a la vez.</p>
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
              <ng-container [ngTemplateOutlet]="barraRango" />
              <section class="panel">
                @if (cargandoHistorico()) {
                  <p class="panel__hint">Cargando histórico…</p>
                } @else if (errorHistorico()) {
                  <p class="panel__error">{{ errorHistorico() }}</p>
                } @else if (!filas().length) {
                  <div class="vacio">
                    <span class="material-symbols-outlined" aria-hidden="true">table_rows</span>
                    <strong>Sin lecturas en el período consultado</strong>
                    <span
                      >El equipo no reportó entre el {{ ventanaDesde() }} y el
                      {{ ventanaHasta() }}.</span
                    >
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

        <ng-template #barraRango>
          <section class="panel rango" aria-label="Período consultado">
            <div class="rango__fila">
              <div class="rango__opciones" role="group" aria-label="Elegir período">
                @for (opcion of rangosPredefinidos; track opcion.id) {
                  <button
                    type="button"
                    [class.is-on]="rango() === opcion.id && !personalizadoAbierto()"
                    [attr.aria-pressed]="rango() === opcion.id && !personalizadoAbierto()"
                    (click)="elegirRango(opcion.id)"
                  >
                    {{ opcion.label }}
                  </button>
                }
                <button
                  type="button"
                  [class.is-on]="rango() === 'personalizado' || personalizadoAbierto()"
                  [attr.aria-pressed]="rango() === 'personalizado' || personalizadoAbierto()"
                  (click)="abrirPersonalizado()"
                >
                  <span class="material-symbols-outlined" aria-hidden="true">calendar_month</span>
                  Personalizado
                </button>
              </div>
              <p class="rango__resumen">
                <span class="material-symbols-outlined" aria-hidden="true">schedule</span>
                <span class="rango__fechas-texto">{{ ventanaDesde() }} → {{ ventanaHasta() }}</span>
                <span class="rango__detalle">{{ ventanaDetalle() }}</span>
              </p>
            </div>

            @if (personalizadoAbierto()) {
              <form class="rango__form" (submit)="$event.preventDefault(); aplicarPersonalizado()">
                <label>
                  <span>DESDE</span>
                  <input
                    type="date"
                    [value]="fechaDesde()"
                    [max]="fechaHasta() || hoy()"
                    (input)="fechaDesde.set($any($event.target).value)"
                  />
                </label>
                <label>
                  <span>HASTA</span>
                  <input
                    type="date"
                    [value]="fechaHasta()"
                    [min]="fechaDesde()"
                    [max]="hoy()"
                    (input)="fechaHasta.set($any($event.target).value)"
                  />
                </label>
                <button type="submit" class="rango__aplicar">Aplicar</button>
                <button type="button" class="rango__cancelar" (click)="cancelarPersonalizado()">
                  Cancelar
                </button>
              </form>
              <p class="rango__ayuda">
                Hasta {{ maxDiasRango }} días. Sobre {{ maxDiasPorMinuto }} días el gráfico usa una
                lectura por hora.
              </p>
              @if (errorRango()) {
                <p class="panel__error">{{ errorRango() }}</p>
              }
            }
          </section>
        </ng-template>
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
        /* Acento del modulo Proceso para los controles de los graficos (zoom). */
        --chart-accent: #6366f1;
        --chart-accent-strong: #4f46e5;
        min-height: 100%;
        overflow-x: hidden;
        padding: 0 18px 32px;
        background:
          radial-gradient(circle at 92% 0%, rgba(99, 102, 241, 0.08), transparent 24rem),
          linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
        color: var(--color-on-surface);
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
        border: 1px solid var(--color-outline-variant);
        border-bottom: 0;
        border-radius: 14px 14px 0 0;
        background: var(--color-surface);
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
        color: var(--color-on-surface-muted);
      }

      .site-head__title {
        font-family: var(--font-josefin);
        font-size: var(--text-h4);
        font-weight: 700;
        line-height: 1.2;
        color: var(--color-on-surface);
      }

      .site-head__meta {
        font-size: 12px;
        color: var(--color-on-surface-variant);
        font-family: var(--font-mono);
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
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
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
        color: var(--color-on-surface-variant);
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
        border: 1px solid var(--color-outline-variant);
        border-radius: 0 0 14px 14px;
        background: var(--color-surface);
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
        color: var(--color-on-surface-variant);
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
        border: 1px solid var(--color-outline-variant);
        border-radius: 12px;
        background: var(--color-surface);
        padding: 20px 22px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
      }

      .panel__titulo {
        display: flex;
        font-family: var(--font-josefin);
        align-items: center;
        gap: 7px;
        margin: 22px 0 10px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--color-on-surface-muted);
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
        color: var(--color-on-surface-variant);
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
        border: 1px solid var(--color-outline-variant);
        border-radius: 10px;
        background: var(--color-surface-subtle);
        padding: 14px 16px;
      }

      .tile--sin-dato {
        opacity: 0.62;
      }

      /* Lazo fuera de escala: el numero es creible pero no es una medicion. */
      .tile--fuera {
        border-color: rgba(251, 191, 36, 0.25);
        background: rgba(251, 191, 36, 0.06);
      }

      .tile--fuera .tile__valor,
      .tile--fuera .tile__pie {
        color: #d97706;
      }

      .tile__label {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--color-on-surface-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tile__valor {
        margin-top: 6px;
        font-family: var(--font-mono);
        font-size: 26px;
        font-weight: 600;
        line-height: 1.1;
        color: var(--color-on-surface);
      }

      .tile__unidad {
        margin-left: 4px;
        font-size: 12px;
        color: var(--color-on-surface-variant);
      }

      .tile__pie {
        margin-top: 6px;
        font-size: 11px;
        color: var(--color-on-surface-muted);
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
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface-subtle);
        padding: 3px 10px;
        font-size: 11px;
        font-weight: 700;
        color: var(--color-on-surface-variant);
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
        grid-template-columns: repeat(auto-fit, minmax(520px, 1fr));
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
        color: var(--color-on-surface-muted);
      }

      .selector__chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .selector__chips button {
        border-radius: 9999px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 5px 12px;
        font-size: 12px;
        font-weight: 700;
        color: var(--color-on-surface-variant);
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
        color: var(--color-on-surface-muted);
      }

      .rango {
        padding: 14px 18px;
      }

      .rango__fila {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .rango__opciones {
        display: inline-flex;
        flex-wrap: wrap;
        gap: 4px;
        border: 1px solid var(--color-outline-variant);
        border-radius: 8px;
        background: var(--color-surface-subtle);
        padding: 3px;
      }

      .rango__opciones button {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border-radius: 6px;
        padding: 6px 12px;
        font-size: 12px;
        font-weight: 700;
        color: var(--color-on-surface-variant);
        transition:
          background 160ms ease,
          color 160ms ease;
      }

      .rango__opciones button:hover {
        color: #4f46e5;
      }

      .rango__opciones button.is-on {
        background: var(--color-surface);
        color: #4f46e5;
        box-shadow:
          0 0 0 1px rgba(99, 102, 241, 0.25),
          0 1px 3px rgba(15, 23, 42, 0.08);
      }

      .rango__opciones button:focus-visible,
      .rango__form button:focus-visible,
      .rango__form input:focus-visible {
        outline: 2px solid rgba(99, 102, 241, 0.36);
        outline-offset: 2px;
      }

      .rango__opciones .material-symbols-outlined,
      .rango__resumen .material-symbols-outlined {
        font-size: 16px;
      }

      .rango__resumen {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 10px;
        font-size: 12px;
        color: var(--color-on-surface-variant);
      }

      .rango__resumen .material-symbols-outlined {
        color: #6366f1;
      }

      .rango__fechas-texto {
        font-family: var(--font-mono);
        font-weight: 600;
        color: #334155;
      }

      .rango__detalle {
        border-radius: 9999px;
        background: rgba(99, 102, 241, 0.08);
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 700;
        color: #4f46e5;
      }

      .rango__form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 10px;
        margin-top: 14px;
        border-top: 1px solid var(--color-outline-variant);
        padding-top: 14px;
      }

      .rango__form label {
        display: grid;
        gap: 4px;
      }

      .rango__form label span {
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.1em;
        color: var(--color-on-surface-muted);
      }

      .rango__form input {
        height: 36px;
        border: 1px solid var(--color-outline-variant);
        border-radius: 6px;
        background: var(--color-surface);
        padding: 0 10px;
        font-family: var(--font-mono);
        font-size: 13px;
        color: #334155;
      }

      .rango__aplicar,
      .rango__cancelar {
        height: 36px;
        border-radius: 6px;
        padding: 0 14px;
        font-size: 13px;
        font-weight: 700;
      }

      .rango__aplicar {
        background: #6366f1;
        color: #ffffff;
        transition: background 160ms ease;
      }

      .rango__aplicar:hover {
        background: #4f46e5;
      }

      .rango__cancelar {
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        color: #475569;
      }

      .rango__ayuda {
        margin-top: 8px;
        font-size: 11px;
        color: var(--color-on-surface-muted);
      }

      .rango .panel__error {
        margin-top: 6px;
      }

      @media (max-width: 640px) {
        .rango__form label {
          flex: 1 1 140px;
        }

        .rango__form input {
          width: 100%;
        }
      }

      .tabla-wrap {
        overflow-x: auto;
        border: 1px solid var(--color-outline-variant);
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
        background: var(--color-surface-subtle);
        padding: 10px 12px;
        text-align: left;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: var(--color-on-surface-variant);
        white-space: nowrap;
        border-bottom: 1px solid var(--color-outline-variant);
      }

      .tabla__unidad {
        margin-left: 3px;
        color: var(--color-on-surface-muted);
      }

      .tabla td {
        padding: 8px 12px;
        border-bottom: 1px solid #f1f5f9;
        font-family: var(--font-mono);
        color: #334155;
        white-space: nowrap;
      }

      .tabla__fecha {
        color: var(--color-on-surface-variant);
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
        color: var(--color-on-surface-variant);
      }

      .paginador button {
        border-radius: 6px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
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
        color: var(--color-on-surface-variant);
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
  private historicoSub?: Subscription;

  readonly maxSeries = MAX_SERIES_GRAFICO;
  readonly maxDiasRango = MAX_DIAS_RANGO;
  readonly maxDiasPorMinuto = MAX_DIAS_POR_MINUTO;
  readonly rangosPredefinidos = RANGOS_PREDEFINIDOS;
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

  /** El periodo aplicado: lo que muestran los graficos y la tabla ahora. */
  readonly rango = signal<RangoHistorico>('12h');
  readonly ventana = signal<VentanaHistorico>(this.ventanaPredefinida('12h'));
  /** El formulario de fechas se edita sin tocar el periodo hasta "Aplicar". */
  readonly personalizadoAbierto = signal(false);
  readonly fechaDesde = signal('');
  readonly fechaHasta = signal('');
  readonly errorRango = signal('');
  readonly hoy = signal(this.fechaChile(Date.now()));

  readonly ventanaDesde = computed(() => this.formatearFecha(this.ventana().desdeMs));
  readonly ventanaHasta = computed(() => this.formatearFecha(this.ventana().hastaMs));
  readonly ventanaDetalle = computed(() => {
    const ventana = this.ventana();
    // equipo_hourly guarda la ultima lectura de cada hora, no un promedio.
    const resolucion =
      ventana.granularidad === '1m' ? '1 lectura por minuto' : '1 lectura por hora';
    return `${ventana.etiqueta} · ${resolucion}`;
  });

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
        const rango = variable.rango || null;
        // Un lazo por debajo de 4 mA no da cero: la escala extrapola y da un
        // numero menor que el minimo del instrumento. Sin esto, el operador ve
        // -50 grados C como si fuera una temperatura.
        const fueraDeRango =
          valor !== null && rango ? valor < rango.min || valor > rango.max : false;
        return {
          key,
          label: (variable.alias || variable.key || '—').toUpperCase(),
          valor: valor === null ? null : this.formatearValor(valor),
          unidad: variable.unidad || null,
          servicio: SERVICIOS.find((s) => rol.startsWith(`${s.id}_`))?.id ?? GRUPO_OTRAS.id,
          fueraDeRango,
          pie: this.pieDelTile({ valor, rol, rango, fueraDeRango }),
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
          ...this.ejeTemporal(),
          title: `${grupo.servicio.label} — ${MAGNITUDES[grupo.magnitud] || grupo.magnitud}`,
          subtitle: unidad ? `${this.ventana().etiqueta} · ${unidad}` : this.ventana().etiqueta,
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
          emptyText: 'El equipo no ha reportado estas variables en el período elegido.',
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
      ...this.ejeTemporal(),
      title: 'Variables de proceso',
      subtitle: this.ventana().etiqueta,
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
      emptyText: 'El equipo no ha reportado estas variables en el período elegido.',
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
    this.historicoSub?.unsubscribe();
  }

  elegirRango(id: Exclude<RangoHistorico, 'personalizado'>): void {
    this.personalizadoAbierto.set(false);
    this.errorRango.set('');
    this.rango.set(id);
    this.ventana.set(this.ventanaPredefinida(id));
    this.recargarHistorico();
  }

  abrirPersonalizado(): void {
    this.hoy.set(this.fechaChile(Date.now()));
    if (!this.fechaDesde() || !this.fechaHasta()) {
      // Arranca con la semana en curso: el caso tipico es revisar algo de dias atras.
      this.fechaHasta.set(this.hoy());
      this.fechaDesde.set(this.fechaChile(Date.now() - 6 * DIA_MS));
    }
    this.errorRango.set('');
    this.personalizadoAbierto.set(true);
  }

  cancelarPersonalizado(): void {
    this.personalizadoAbierto.set(false);
    this.errorRango.set('');
  }

  aplicarPersonalizado(): void {
    const desde = this.fechaDesde();
    const hasta = this.fechaHasta();
    const error = this.validarFechas(desde, hasta);
    this.errorRango.set(error);
    if (error) return;

    const desdeMs = this.inicioDelDiaChile(desde);
    const finMs = this.inicioDelDiaChile(hasta) + DIA_MS;
    const dias = Math.round((finMs - desdeMs) / DIA_MS);
    this.rango.set('personalizado');
    this.ventana.set({
      desdeMs,
      hastaMs: Math.min(finMs, Date.now()),
      granularidad: dias <= MAX_DIAS_POR_MINUTO ? '1m' : '1h',
      etiqueta: dias === 1 ? `Día ${this.fechaCorta(desde)}` : `${dias} días`,
      fechas: { desde, hasta },
    });
    this.personalizadoAbierto.set(false);
    this.recargarHistorico();
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

  private recargarHistorico(): void {
    const siteId = this.siteContext()?.site.id;
    if (siteId) this.cargarHistorico(siteId);
  }

  /**
   * Las ventanas predefinidas se recalculan contra la hora actual en cada
   * carga: "ultimas 24 horas" pedidas a las 10:00 no son las mismas a las 15:00.
   */
  private cargarHistorico(siteId: string): void {
    if (this.rango() !== 'personalizado') {
      this.ventana.set(
        this.ventanaPredefinida(this.rango() as Exclude<RangoHistorico, 'personalizado'>),
      );
    }
    const ventana = this.ventana();

    // 12 h es la consulta en vivo de siempre: sin rango, la que precalienta el
    // cache. El resto pide por fecha, y el backend corta por dia completo, asi
    // que lo que cae fuera de la ventana se descarta al llegar.
    const consulta =
      this.rango() === '12h'
        ? this.companyService.getSiteDashboardHistory(siteId, LECTURAS_TENDENCIA, {
            analogicas: true,
          })
        : this.companyService.getSiteDashboardHistory(siteId, MAX_FILAS_RANGO, {
            from: ventana.fechas?.desde ?? this.fechaChile(ventana.desdeMs),
            to: ventana.fechas?.hasta ?? this.fechaChile(ventana.hastaMs),
            granularity: ventana.granularidad,
            analogicas: true,
          });

    // Cambiar de periodo rapido no puede dejar que una respuesta vieja pise a la nueva.
    this.historicoSub?.unsubscribe();
    this.cargandoHistorico.set(true);
    this.errorHistorico.set('');
    this.historicoSub = consulta.subscribe({
      next: (res) => {
        this.cargandoHistorico.set(false);
        if (!res.ok) {
          this.errorHistorico.set('No fue posible cargar el histórico del sitio.');
          return;
        }
        this.filasCronologicas.set(
          this.aFilas(res.data?.rows || []).filter(
            (fila) => fila.timestampMs >= ventana.desdeMs && fila.timestampMs <= ventana.hastaMs,
          ),
        );
        this.pagina.set(1);
      },
      error: (err) => {
        this.cargandoHistorico.set(false);
        this.errorHistorico.set(
          err?.error?.message || 'No fue posible cargar el histórico del sitio.',
        );
      },
    });
  }

  private ventanaPredefinida(id: Exclude<RangoHistorico, 'personalizado'>): VentanaHistorico {
    const rango = RANGOS_PREDEFINIDOS.find((item) => item.id === id) ?? RANGOS_PREDEFINIDOS[0]!;
    const hastaMs = Date.now();
    return {
      desdeMs: hastaMs - rango.horas * HORA_MS,
      hastaMs,
      granularidad: rango.horas <= MAX_DIAS_POR_MINUTO * 24 ? '1m' : '1h',
      etiqueta: rango.etiqueta,
    };
  }

  /** Mismo eje X, cortes de linea y densidad para todos los graficos de la pantalla. */
  private ejeTemporal(): Pick<
    TelemetryLineChart,
    'xMin' | 'xMax' | 'maxGapMs' | 'maxVisiblePoints' | 'tall' | 'zoomable'
  > {
    const ventana = this.ventana();
    return {
      xMin: ventana.desdeMs,
      xMax: ventana.hastaMs,
      maxGapMs: HUECO_MAXIMO_MS[ventana.granularidad],
      // Sin trazo de puntos Chart.js dibuja 1.500 sin esfuerzo, y muestrear mas
      // fino esconde los picos que el operador viene a buscar.
      maxVisiblePoints: 1500,
      tall: true,
      zoomable: true,
    };
  }

  private validarFechas(desde: string, hasta: string): string {
    if (!desde || !hasta) return 'Elige la fecha desde y la fecha hasta.';
    if (desde > hasta) return 'La fecha desde no puede ser posterior a la fecha hasta.';
    if (hasta > this.fechaChile(Date.now())) return 'La fecha hasta no puede ser futura.';
    const dias = Math.round(
      (this.inicioDelDiaChile(hasta) - this.inicioDelDiaChile(desde)) / DIA_MS + 1,
    );
    if (dias > MAX_DIAS_RANGO) return `El rango máximo es de ${MAX_DIAS_RANGO} días.`;
    return '';
  }

  /** 'YYYY-MM-DD' del instante en hora de Chile. */
  private fechaChile(ms: number): string {
    return new Date(ms - OFFSET_CHILE_MS).toISOString().slice(0, 10);
  }

  /** Instante en que empieza el dia 'YYYY-MM-DD' en hora de Chile. */
  private inicioDelDiaChile(fecha: string): number {
    const [anio, mes, dia] = fecha.split('-').map(Number);
    return Date.UTC(anio!, mes! - 1, dia!) + OFFSET_CHILE_MS;
  }

  /** 'YYYY-MM-DD' a 'DD/MM/YYYY'. */
  private fechaCorta(fecha: string): string {
    const [anio, mes, dia] = fecha.split('-');
    return `${dia}/${mes}/${anio}`;
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

  private pieDelTile(t: {
    valor: number | null;
    rol: string;
    rango: { min: number; max: number } | null;
    fueraDeRango: boolean;
  }): string {
    if (t.valor === null) return 'Sin lectura válida';
    if (t.fueraDeRango && t.rango) {
      const fuera = t.valor < t.rango.min ? 'bajo el mínimo' : 'sobre el máximo';
      return `Fuera de rango (${fuera} de ${this.formatearValor(t.rango.min)} a ${this.formatearValor(t.rango.max)})`;
    }
    if (t.rango) {
      return `Rango ${this.formatearValor(t.rango.min)} a ${this.formatearValor(t.rango.max)}`;
    }
    return t.rol === 'generico' ? 'Sin rol asignado' : `Rol ${t.rol}`;
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
