import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { catchError, of } from 'rxjs';
import { VentisquerosComponent } from '../../ventisqueros/ventisqueros';
import { normalizeSiteType } from '../../../shared/site-type-ui';
import type { SiteRecord } from '@emeltec/shared';
import {
  CompanyService,
  type ContadorDiarioPoint,
  type ContadorMensualPoint,
} from '../../../services/company.service';
import { AlertaService, type EventoRow } from '../../../services/alerta.service';
import { DgaService, type DgaReviewSlot } from '../../../services/dga.service';
import { IncidenciaService, type IncidenciaRow } from '../../../services/incidencia.service';

interface KpiCard {
  label: string;
  valor: string;
  subtext: string;
  icon: string;
  tono: 'ok' | 'warn' | 'neutral';
}

interface PuntoMensual {
  mes: string;
  valores: number[];
}

interface SitioResumen {
  nombre: string;
  ubicacion: string;
  /** Número de obra DGA del pozo (pozo_config.obra_dga). NULL si no es pozo
   *  o no está registrado. Se usa como subtítulo en "Estado de sitios". */
  obraDga: string | null;
  estado: 'online' | 'sinDatos' | 'offline';
  /** Latitud derivada de UTM via proj4. NaN si el sitio no tiene UTM seteado. */
  lat: number;
  /** Longitud derivada de UTM via proj4. NaN si el sitio no tiene UTM seteado. */
  lng: number;
  /** UTM crudo del backend — usado para mostrar en popup + auditoría. */
  coord_norte: number | null;
  coord_este: number | null;
  huso: number | null;
  caudal: number;
  nivel: number;
  consumoMes: number;
  diasActivos: number;
  diasMes: number;
  m3Proyectados: number;
  tendenciaCaudal: number;
  /** Per-cell load state — true cuando la respuesta correspondiente ya llegó
   *  (con o sin datos). Sirve para esconder skeleton y mostrar valor real. */
  dashboardLoaded: boolean;
  monthlyLoaded: boolean;
  dailyLoaded: boolean;
}

interface MetricaOperacional {
  label: string;
  valor: string;
  icon: string;
  tono: 'ok' | 'warn' | 'neutral';
}

interface SitioComparacion {
  nombre: string;
  estado: 'online' | 'sinDatos' | 'offline';
  caudalA: string;
  caudalB: string;
  caudalTend: number;
  nivelA: string;
  nivelB: string;
  nivelTend: number;
  consumoA: string;
  consumoB: string;
  consumoTend: number;
}

type PeriodoPreset = 'semana' | 'mes' | '7d' | 'custom';

interface Periodo {
  label: string;
  desde: string;
  hasta: string;
}

@Component({
  selector: 'app-companies-general-panel',
  standalone: true,
  imports: [CommonModule, VentisquerosComponent],
  template: `
    @if (coldRoomSite(); as coldSite) {
      <app-ventisqueros
        [siteId]="coldSite.id"
        [siteName]="coldSite.descripcion"
        [coldRoomSites]="coldRoomSites()"
        [embedded]="true"
        view="general"
      />
    } @else {
      <div class="space-y-4 animate-in fade-in duration-500">
        <!-- KPIs principales -->
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <article
            class="rounded-2xl border border-primary-tint-30 bg-white p-5 shadow-primary-banner"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p
                  class="text-caption-xs font-semibold uppercase tracking-widest text-primary-container"
                >
                  Flujo acumulado mensual
                </p>
                <p class="mt-2 font-mono text-h3 font-semibold leading-none text-on-surface">
                  {{ flujoAcumuladoMes() }} m³
                </p>
                <p class="mt-1 text-caption-xs text-on-surface-variant">
                  Acumulado en {{ mesActualLabel() }}
                </p>
              </div>
              <span
                class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-tint-10"
              >
                <span class="material-symbols-outlined text-[22px] text-primary-container"
                  >water_drop</span
                >
              </span>
            </div>
          </article>

          @for (k of kpisSecundarios; track k.label) {
            <article class="rounded-2xl border bg-white p-5 shadow-sm" [class]="kpiBorde(k.tono)">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p
                    class="text-caption-xs font-semibold uppercase tracking-widest text-on-surface-muted"
                  >
                    {{ k.label }}
                  </p>
                  <p class="mt-2 font-mono text-h3 font-semibold leading-none text-on-surface">
                    {{ k.valor }}
                  </p>
                  <p class="mt-1 text-caption-xs text-on-surface-muted">{{ k.subtext }}</p>
                </div>
                <span
                  [class]="kpiIconClass(k.tono)"
                  class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                >
                  <span class="material-symbols-outlined text-[22px]">{{ k.icon }}</span>
                </span>
              </div>
            </article>
          }
        </div>

        <!-- Gráfico + Lista de sitios -->
        <div class="grid gap-3 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">
          <!-- Gráfico de flujo mensual -->
          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 class="text-body-sm font-semibold text-slate-800">
                  Flujo mensual por instalación
                </h3>
                <p class="mt-0.5 text-caption-xs text-slate-500">
                  m³/mes · últimos 6 meses · clic en leyenda para ocultar
                </p>
              </div>
              <!-- Leyenda interactiva -->
              <div class="flex flex-wrap justify-end gap-1">
                @for (s of sitiosResumen; track s.nombre; let i = $index) {
                  <button
                    (click)="toggleSite(i)"
                    class="flex items-center gap-1.5 rounded-full px-2 py-1 text-caption-xs font-bold text-slate-500 transition-all hover:bg-slate-100"
                    [style.opacity]="hiddenSites().has(i) ? '0.3' : '1'"
                    [title]="hiddenSites().has(i) ? 'Mostrar ' + s.nombre : 'Ocultar ' + s.nombre"
                  >
                    <span
                      class="h-2.5 w-2.5 rounded-full"
                      [style.background]="colores[i % colores.length]"
                    ></span>
                    {{ s.nombre | slice: 0 : 12 }}{{ s.nombre.length > 12 ? '…' : '' }}
                  </button>
                }
              </div>
            </div>
            <div class="h-[220px] w-full">
              <svg viewBox="0 0 1000 220" class="h-full w-full" preserveAspectRatio="none">
                @for (tick of yTicks; track tick.y) {
                  <line
                    x1="60"
                    [attr.y1]="tick.y"
                    x2="990"
                    [attr.y2]="tick.y"
                    stroke="#f1f5f9"
                    stroke-width="1"
                  />
                  <text
                    x="54"
                    [attr.y]="tick.y + 4"
                    font-size="10"
                    fill="#94a3b8"
                    text-anchor="end"
                    font-family="monospace"
                  >
                    {{ tick.label }}
                  </text>
                }
                @for (p of puntosMensuales; track p.mes; let i = $index) {
                  <text
                    [attr.x]="60 + (930 / (puntosMensuales.length - 1)) * i"
                    y="215"
                    font-size="10"
                    fill="#94a3b8"
                    text-anchor="middle"
                  >
                    {{ p.mes }}
                  </text>
                }
                @for (s of sitiosResumen; track s.nombre; let si = $index) {
                  <polyline
                    [attr.points]="buildPolyline(si)"
                    fill="none"
                    [attr.stroke]="colores[si % colores.length]"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    [style.opacity]="hiddenSites().has(si) ? '0' : '0.85'"
                    style="transition: opacity 0.25s"
                  />
                }
              </svg>
            </div>
          </section>

          <!-- Lista de sitios: toggle + proyección por pozo -->
          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="mb-4 flex items-center justify-between gap-2">
              <h3 class="text-body-sm font-semibold text-slate-800">Estado de sitios</h3>
              <span
                class="rounded-full bg-slate-100 px-2.5 py-1 text-caption-xs font-bold text-slate-500"
                >{{ sitiosResumen.length }} sitios</span
              >
            </div>

            @if (sitiosResumen.length === 0) {
              <div class="py-8 text-center">
                <span class="material-symbols-outlined text-3xl text-slate-300">sensors_off</span>
                <p class="mt-2 text-caption font-semibold text-slate-500">Sin sitios registrados</p>
              </div>
            } @else {
              <div class="space-y-2 overflow-y-auto" style="max-height: 340px">
                @for (s of sitiosResumen; track s.nombre; let i = $index) {
                  <button
                    (click)="toggleSite(i)"
                    class="w-full rounded-xl border px-3 py-2.5 text-left transition-all hover:shadow-sm"
                    [style.opacity]="hiddenSites().has(i) ? '0.45' : '1'"
                    [class.border-slate-100]="!hiddenSites().has(i)"
                    [class.bg-slate-50]="!hiddenSites().has(i)"
                    [class.border-slate-200]="hiddenSites().has(i)"
                    [class.bg-white]="hiddenSites().has(i)"
                    [title]="hiddenSites().has(i) ? 'Mostrar en gráfico' : 'Ocultar del gráfico'"
                  >
                    <!-- Fila principal -->
                    <div class="flex items-center gap-3">
                      <span
                        class="h-2 w-2 shrink-0 rounded-full"
                        [class]="estadoDotClass(s.estado)"
                      ></span>
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-caption font-semibold text-slate-800">
                          {{ s.nombre }}
                        </p>
                        <p class="truncate font-mono text-caption-xs text-slate-500">
                          @if (s.obraDga) {
                            Obra DGA · {{ s.obraDga }}
                          } @else {
                            {{ s.ubicacion }}
                          }
                        </p>
                      </div>
                      <div class="flex flex-col items-end gap-0.5 shrink-0">
                        <span
                          class="text-caption-xs font-semibold"
                          [class]="estadoTextClass(s.estado)"
                          >{{ estadoLabel(s.estado) }}</span
                        >
                        @if (s.monthlyLoaded) {
                          <span
                            class="text-caption-xs font-bold"
                            [style.color]="s.tendenciaCaudal >= 0 ? '#16A34A' : '#DC2626'"
                          >
                            {{ s.tendenciaCaudal >= 0 ? '▲' : '▼' }}
                            {{ formatNum(s.tendenciaCaudal) }}%
                          </span>
                        } @else {
                          <span
                            class="inline-block h-2.5 w-10 animate-pulse rounded bg-slate-200"
                          ></span>
                        }
                      </div>
                    </div>

                    <!-- Proyección mensual -->
                    <div class="mt-2 space-y-1.5 border-t border-slate-100 pt-2">
                      <div class="flex items-center justify-between">
                        <span class="text-caption-xs font-semibold text-slate-500"
                          >Consumido este mes</span
                        >
                        @if (s.monthlyLoaded) {
                          <span class="font-mono text-caption-xs font-bold text-slate-700"
                            >{{ formatM3(s.consumoMes) }} m³</span
                          >
                        } @else {
                          <span
                            class="inline-block h-3 w-16 animate-pulse rounded bg-slate-200"
                          ></span>
                        }
                      </div>
                      <div class="flex items-center justify-between">
                        <span class="text-caption-xs font-semibold text-slate-500"
                          >Proyección fin de mes</span
                        >
                        @if (s.monthlyLoaded) {
                          <span class="font-mono text-caption-xs font-bold" style="color:#0dafbd"
                            >{{ formatM3(s.m3Proyectados) }} m³</span
                          >
                        } @else {
                          <span
                            class="inline-block h-3 w-16 animate-pulse rounded bg-slate-200"
                          ></span>
                        }
                      </div>
                      <div class="flex items-center justify-between">
                        <span class="text-caption-xs font-semibold text-slate-500"
                          >Días con extracción</span
                        >
                        @if (s.dailyLoaded) {
                          <span class="font-mono text-caption-xs font-bold text-slate-700"
                            >{{ s.diasActivos }}
                            <span class="font-normal text-slate-400">de {{ s.diasMes }}</span></span
                          >
                        } @else {
                          <span
                            class="inline-block h-3 w-14 animate-pulse rounded bg-slate-200"
                          ></span>
                        }
                      </div>
                    </div>
                  </button>
                }
              </div>
            }
          </section>
        </div>

        <!-- Mapa + Comparación de períodos -->
        <div class="grid gap-3 xl:grid-cols-[1fr_360px]">
          <!-- Mapa Leaflet -->
          <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div>
                <h3 class="text-body-sm font-semibold text-slate-800">Mapa de instalaciones</h3>
                <p class="mt-0.5 text-caption-xs text-slate-500">
                  Posición geográfica · clic en marcador para métricas
                </p>
              </div>
            </div>
            <div class="relative" style="height: 340px">
              <div #mapContainer style="height: 100%; width: 100%;"></div>
              @if (sitiosResumen.length === 0) {
                <div class="absolute inset-0 z-10 flex items-center justify-center bg-slate-50">
                  <div class="text-center">
                    <span class="material-symbols-outlined text-3xl text-slate-300">map</span>
                    <p class="mt-2 text-caption font-semibold text-slate-500">Sin instalaciones</p>
                  </div>
                </div>
              }
            </div>
          </section>

          <!-- Resumen operacional (panel lateral) -->
          <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="mb-4 flex items-center justify-between gap-3">
              <h3 class="text-body-sm font-semibold text-slate-800">Resumen operacional</h3>
              <span
                class="rounded-full border border-surface-container bg-surface-subtle px-3 py-1 text-caption-xs font-semibold text-on-surface-variant"
              >
                Mayo 2026
              </span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              @for (m of metricasOp; track m.label) {
                <div class="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  <div class="mb-2 flex items-center justify-between gap-1">
                    <p
                      class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400 leading-tight"
                    >
                      {{ m.label }}
                    </p>
                    <span
                      [class]="metricaOpIconClass(m.tono)"
                      class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    >
                      <span class="material-symbols-outlined text-[16px]">{{ m.icon }}</span>
                    </span>
                  </div>
                  <p class="font-mono text-h5 font-semibold text-slate-800">{{ m.valor }}</p>
                </div>
              }
            </div>
          </section>
        </div>

        <!-- Comparación de períodos (full width) -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <!-- Header -->
          <div class="mb-4 flex flex-wrap items-center gap-3">
            <div class="flex-1">
              <h3 class="text-body-sm font-semibold text-slate-800">
                Comparación de períodos por pozo
              </h3>
              <p class="mt-0.5 text-caption-xs text-slate-500">
                Período A vs Período B · caudal, nivel y consumo
              </p>
            </div>
            <!-- Period labels -->
            <div class="flex items-center gap-2">
              <div class="rounded-lg px-3 py-1.5" style="background: rgba(13,175,189,0.08)">
                <p
                  class="text-caption-xs font-semibold uppercase tracking-widest"
                  style="color: #0dafbd"
                >
                  A · {{ periodoA().label }}
                </p>
              </div>
              <span class="text-caption-xs text-slate-300">vs</span>
              <div class="rounded-lg bg-slate-100 px-3 py-1.5">
                <p class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
                  B · {{ periodoB().label }}
                </p>
              </div>
            </div>
            <button
              (click)="periodosOpen.set(!periodosOpen())"
              class="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-caption-xs font-bold text-slate-600 transition-colors hover:bg-slate-100"
            >
              <span class="material-symbols-outlined text-[14px]">date_range</span>
              Escoger períodos
            </button>
          </div>

          <!-- Selector de presets -->
          @if (periodosOpen()) {
            <div class="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
              <div class="mb-3 flex items-center justify-between gap-2">
                <p class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
                  Período de comparación
                </p>
                @if (periodoPreset() === 'custom') {
                  <span
                    class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700"
                  >
                    Personalizado
                  </span>
                }
              </div>

              <!-- Atajos rápidos -->
              <div class="mb-4 flex flex-wrap gap-2">
                @for (p of presets; track p.key) {
                  <button
                    type="button"
                    (click)="setPreset(p.key)"
                    class="rounded-lg px-3 py-1.5 text-caption-xs font-bold transition-colors"
                    [style.background]="periodoPreset() === p.key ? '#0dafbd' : 'white'"
                    [style.color]="periodoPreset() === p.key ? 'white' : '#475569'"
                    [style.border]="
                      periodoPreset() !== p.key ? '1px solid #E2E8F0' : '1px solid transparent'
                    "
                  >
                    {{ p.label }}
                  </button>
                }
              </div>

              <!-- Rango custom A vs B con date pickers. Misma UX que Resumen
                   por Período en Operación: inputs locales, recién al click
                   Aplicar se propaga al state global y se redibuja el chart. -->
              <div class="grid gap-3 md:grid-cols-2">
                <div class="rounded-lg border border-slate-200 bg-white p-3">
                  <div class="mb-2 flex items-center gap-1.5">
                    <span
                      class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                      style="background:rgba(13,175,189,0.12);color:#0899A5"
                      >A</span
                    >
                    <span
                      class="text-caption-xs font-semibold uppercase tracking-widest text-slate-500"
                      >Período principal</span
                    >
                  </div>
                  <div class="flex flex-col gap-2 text-caption text-slate-500">
                    <label class="flex items-center gap-2">
                      <span class="w-12 font-semibold">Desde</span>
                      <input
                        type="date"
                        min="2020-01-01"
                        [value]="periodoAInputDesde()"
                        (input)="periodoAInputDesde.set($any($event.target).value)"
                        class="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-caption text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                      />
                    </label>
                    <label class="flex items-center gap-2">
                      <span class="w-12 font-semibold">Hasta</span>
                      <input
                        type="date"
                        min="2020-01-01"
                        [value]="periodoAInputHasta()"
                        (input)="periodoAInputHasta.set($any($event.target).value)"
                        class="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-caption text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                      />
                    </label>
                  </div>
                </div>
                <div class="rounded-lg border border-slate-200 bg-white p-3">
                  <div class="mb-2 flex items-center gap-1.5">
                    <span
                      class="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-500"
                      >B</span
                    >
                    <span
                      class="text-caption-xs font-semibold uppercase tracking-widest text-slate-500"
                      >Período comparado</span
                    >
                  </div>
                  <div class="flex flex-col gap-2 text-caption text-slate-500">
                    <label class="flex items-center gap-2">
                      <span class="w-12 font-semibold">Desde</span>
                      <input
                        type="date"
                        min="2020-01-01"
                        [value]="periodoBInputDesde()"
                        (input)="periodoBInputDesde.set($any($event.target).value)"
                        class="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-caption text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                      />
                    </label>
                    <label class="flex items-center gap-2">
                      <span class="w-12 font-semibold">Hasta</span>
                      <input
                        type="date"
                        min="2020-01-01"
                        [value]="periodoBInputHasta()"
                        (input)="periodoBInputHasta.set($any($event.target).value)"
                        class="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-caption text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div class="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  (click)="aplicarPeriodosCustom()"
                  [disabled]="!periodosCustomPendientes()"
                  class="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-caption font-bold text-white transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <span class="material-symbols-outlined text-[14px]">check</span>
                  Aplicar
                </button>
              </div>
            </div>
          }

          <!-- Grid de pozos -->
          @if (sitiosComparacion.length === 0) {
            <div class="py-8 text-center">
              <span class="material-symbols-outlined text-3xl text-slate-300">sensors_off</span>
              <p class="mt-2 text-caption font-semibold text-slate-500">Sin datos de pozos</p>
            </div>
          } @else {
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              @for (s of sitiosComparacion; track s.nombre) {
                <div class="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <!-- Nombre del pozo -->
                  <div class="mb-3 flex items-center gap-1.5">
                    <span
                      class="h-2 w-2 shrink-0 rounded-full"
                      [class]="estadoDotClass(s.estado)"
                    ></span>
                    <span class="truncate text-caption font-bold text-slate-800"
                      >{{ s.nombre | slice: 0 : 20 }}{{ s.nombre.length > 20 ? '…' : '' }}</span
                    >
                  </div>

                  <!-- Métricas A vs B con tendencia individual -->
                  <div class="space-y-1.5">
                    <div class="rounded-lg bg-white px-3 py-2">
                      <div class="mb-1.5 flex items-center justify-between">
                        <div class="flex items-center gap-1">
                          <span class="material-symbols-outlined text-[12px] text-slate-300"
                            >speed</span
                          >
                          <p
                            class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                          >
                            Caudal
                          </p>
                        </div>
                        <span
                          class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption-xs font-bold"
                          [style.background]="
                            s.caudalTend >= 0 ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)'
                          "
                          [style.color]="s.caudalTend >= 0 ? '#16A34A' : '#DC2626'"
                        >
                          {{ s.caudalTend >= 0 ? '▲' : '▼' }} {{ formatNum(s.caudalTend) }}%
                        </span>
                      </div>
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="rounded px-1 py-0.5 text-[8px] font-semibold"
                            style="background:rgba(13,175,189,0.12);color:#0899A5"
                            >A</span
                          >
                          <span class="font-mono text-body-sm font-bold text-slate-800"
                            >{{ s.caudalA }}
                            <span class="text-caption-xs font-normal text-slate-400"
                              >L/s</span
                            ></span
                          >
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span
                            class="rounded bg-slate-200 px-1 py-0.5 text-[8px] font-semibold text-slate-500"
                            >B</span
                          >
                          <span class="font-mono text-caption font-bold text-slate-400"
                            >{{ s.caudalB }}
                            <span class="text-caption-xs font-normal">L/s</span></span
                          >
                        </div>
                      </div>
                    </div>

                    <div class="rounded-lg bg-white px-3 py-2">
                      <div class="mb-1.5 flex items-center justify-between">
                        <div class="flex items-center gap-1">
                          <span class="material-symbols-outlined text-[12px] text-slate-300"
                            >water_drop</span
                          >
                          <p
                            class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                          >
                            Nivel
                          </p>
                        </div>
                        <span
                          class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption-xs font-bold"
                          [style.background]="
                            s.nivelTend >= 0 ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)'
                          "
                          [style.color]="s.nivelTend >= 0 ? '#16A34A' : '#DC2626'"
                        >
                          {{ s.nivelTend >= 0 ? '▲' : '▼' }} {{ formatNum(s.nivelTend) }}%
                        </span>
                      </div>
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="rounded px-1 py-0.5 text-[8px] font-semibold"
                            style="background:rgba(13,175,189,0.12);color:#0899A5"
                            >A</span
                          >
                          <span class="font-mono text-body-sm font-bold text-slate-800"
                            >{{ s.nivelA }}
                            <span class="text-caption-xs font-normal text-slate-400">m</span></span
                          >
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span
                            class="rounded bg-slate-200 px-1 py-0.5 text-[8px] font-semibold text-slate-500"
                            >B</span
                          >
                          <span class="font-mono text-caption font-bold text-slate-400"
                            >{{ s.nivelB }} <span class="text-caption-xs font-normal">m</span></span
                          >
                        </div>
                      </div>
                    </div>

                    <div class="rounded-lg bg-white px-3 py-2">
                      <div class="mb-1.5 flex items-center justify-between">
                        <div class="flex items-center gap-1">
                          <span class="material-symbols-outlined text-[12px] text-slate-300"
                            >monitoring</span
                          >
                          <p
                            class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                          >
                            Consumo
                          </p>
                        </div>
                        <span
                          class="flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption-xs font-bold"
                          [style.background]="
                            s.consumoTend >= 0 ? 'rgba(34,197,94,0.10)' : 'rgba(248,113,113,0.10)'
                          "
                          [style.color]="s.consumoTend >= 0 ? '#16A34A' : '#DC2626'"
                        >
                          {{ s.consumoTend >= 0 ? '▲' : '▼' }} {{ formatNum(s.consumoTend) }}%
                        </span>
                      </div>
                      <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-1.5">
                          <span
                            class="rounded px-1 py-0.5 text-[8px] font-semibold"
                            style="background:rgba(13,175,189,0.12);color:#0899A5"
                            >A</span
                          >
                          <span class="font-mono text-body-sm font-bold text-slate-800"
                            >{{ s.consumoA }}
                            <span class="text-caption-xs font-normal text-slate-400">m³</span></span
                          >
                        </div>
                        <div class="flex items-center gap-1.5">
                          <span
                            class="rounded bg-slate-200 px-1 py-0.5 text-[8px] font-semibold text-slate-500"
                            >B</span
                          >
                          <span class="font-mono text-caption font-bold text-slate-400"
                            >{{ s.consumoB }}
                            <span class="text-caption-xs font-normal">m³</span></span
                          >
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          }
        </section>
      </div>
    }
  `,
})
export class CompaniesGeneralPanelComponent implements OnChanges, AfterViewInit, OnDestroy {
  private readonly companyService = inject(CompanyService);
  private readonly alertaService = inject(AlertaService);
  private readonly dgaService = inject(DgaService);
  private readonly incidenciaService = inject(IncidenciaService);

  /** Formato DGA Res 2170 §4: entero sin decimales ni separador de miles. */
  formatM3(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    return Math.trunc(value).toString();
  }
  // Forzar CD después de mutaciones a arrays no-signal (sitiosResumen,
  // puntosMensuales, metricasOp). El default CD de Angular no detecta
  // mutaciones in-place de objetos plain class fields desde callbacks async.
  private readonly cdr = inject(ChangeDetectorRef);

  /**
   * Sites de la SUB-EMPRESA seleccionada (lo que viene del parent), sin
   * expandir. La Vista General respeta la selección del árbol: elegir
   * Cervecera muestra Cervecera, no todo el grupo CCU. (Antes el setter
   * expandía a toda la empresa y filtraba KPIs/mapa/chart con sitios de
   * sub-empresas hermanas.) Los fetch por empresa_id de eventos/incidencias
   * ya se acotan client-side con `this.sites`, así que heredan este scope.
   */
  @Input() set sites(value: any[]) {
    this._sites = value || [];
    this._sitesSignal.set(value || []);
  }
  get sites(): any[] {
    return this._sites;
  }
  private _sites: any[] = [];
  private _sitesSignal = signal<any[]>([]);

  @Input() subEmpresaId = '';

  readonly coldRoomSites = computed<SiteRecord[]>(() => {
    const list = this._sitesSignal();
    return list.filter((s) => normalizeSiteType(s?.tipo_sitio) === 'camara_frio');
  });

  readonly coldRoomSite = computed<SiteRecord | null>(() => {
    // Si hay sitios cold-room, mostramos el general AGREGADO de todos los TAPs
    // (coldRoomSites alimenta el bundle). No exigimos que TODOS los sitios sean
    // cold-room: evita forzar la selección de un TAP cuando hay mezcla.
    const cold = this.coldRoomSites();
    return cold.length > 0 ? cold[0] : null;
  });

  @ViewChild('mapContainer') mapContainer?: ElementRef<HTMLDivElement>;

  readonly colores = ['#0DAFBD', '#22C55E', '#6366F1', '#F59E0B', '#F97316'];

  // UI signals
  hiddenSites = signal<Set<number>>(new Set());
  periodosOpen = signal(false);
  periodoPreset = signal<PeriodoPreset>('semana');
  periodoA = signal<Periodo>({ label: 'Esta semana', desde: '2026-05-11', hasta: '2026-05-11' });
  periodoB = signal<Periodo>({
    label: 'Semana anterior',
    desde: '2026-05-04',
    hasta: '2026-05-10',
  });

  // Inputs locales para edición custom de fechas. El operador edita estos
  // sin disparar fetch; recién al click Aplicar se propaga a periodoA/B y
  // se redibuja el chart. Sincronizados con periodoA/B en setPreset.
  readonly periodoAInputDesde = signal(this.periodoA().desde);
  readonly periodoAInputHasta = signal(this.periodoA().hasta);
  readonly periodoBInputDesde = signal(this.periodoB().desde);
  readonly periodoBInputHasta = signal(this.periodoB().hasta);

  readonly periodosCustomPendientes = computed(
    () =>
      this.periodoAInputDesde() !== this.periodoA().desde ||
      this.periodoAInputHasta() !== this.periodoA().hasta ||
      this.periodoBInputDesde() !== this.periodoB().desde ||
      this.periodoBInputHasta() !== this.periodoB().hasta,
  );

  readonly presets: { key: PeriodoPreset; label: string }[] = [
    { key: 'semana', label: 'Esta semana vs semana anterior' },
    { key: 'mes', label: 'Este mes vs mes anterior' },
    { key: '7d', label: 'Últimos 7 días vs 7 días anteriores' },
  ];

  sitiosResumen: SitioResumen[] = [];
  kpisSecundarios: KpiCard[] = [];
  sitiosComparacion: SitioComparacion[] = [];

  private readonly MOCK_SITE_GEO = [
    {
      lat: -29.9027,
      lng: -71.2517,
      caudal: 4.8,
      nivel: -12.3,
      consumoMes: 2400,
      diasActivos: 9,
      tendenciaCaudal: 5.2,
    },
    {
      lat: -30.0453,
      lng: -71.1067,
      caudal: 3.2,
      nivel: -8.7,
      consumoMes: 1900,
      diasActivos: 8,
      tendenciaCaudal: -2.1,
    },
    {
      lat: -29.7823,
      lng: -71.3156,
      caudal: 2.1,
      nivel: -15.1,
      consumoMes: 1400,
      diasActivos: 7,
      tendenciaCaudal: 7.4,
    },
    {
      lat: -30.1234,
      lng: -70.9845,
      caudal: 1.6,
      nivel: -6.2,
      consumoMes: 1000,
      diasActivos: 9,
      tendenciaCaudal: -0.5,
    },
    {
      lat: -29.5678,
      lng: -71.4012,
      caudal: 1.1,
      nivel: -9.8,
      consumoMes: 800,
      diasActivos: 6,
      tendenciaCaudal: 3.8,
    },
  ];

  // Labels de meses generados en runtime para reflejar los meses reales.
  // Se rellena en buildMonthLabels() con los últimos 6 meses ending hoy.
  puntosMensuales: PuntoMensual[] = [];

  // Y-axis ticks recalculados según max real (rebuildYTicks). Inicial
  // placeholder a [0, 100] mientras la primera fetch llega.
  yTicks: { y: number; label: string }[] = [];

  // Índices [0] Uptime y [1] Tiempo respuesta quedan como placeholder ('—')
  // hasta que se implementen fases posteriores (requieren queries más
  // pesadas sobre samples + timestamps de eventos resueltos). [2] y [3] se
  // pueblan en fetchRealData desde incidencias.
  metricasOp: MetricaOperacional[] = [
    { label: 'Uptime promedio', valor: '—', icon: 'wifi', tono: 'neutral' },
    { label: 'Tiempo respuesta', valor: '—', icon: 'timer', tono: 'neutral' },
    { label: 'Visitas técnicas', valor: '—', icon: 'engineering', tono: 'neutral' },
    { label: 'Resolución', valor: '—', icon: 'check_circle', tono: 'neutral' },
  ];

  // Y-axis ticks tope fijo (legacy, no usar — se sobrescribe via rebuildYTicks).
  private readonly yTicksLegacy = [
    { y: 10, label: '2500' },
    { y: 73, label: '1875' },
    { y: 137, label: '1250' },
    { y: 200, label: '0' },
  ];

  private readonly chartX0 = 60;
  private readonly chartY0 = 10;
  private readonly chartW = 930;
  private readonly chartH = 190;

  /**
   * Días reales transcurridos del mes actual (1..31) y total del mes
   * (28..31). Recalculados al renderear porque el componente puede vivir
   * varios días sin re-instanciarse. Usados para calcular `m3Proyectados`:
   *   proyeccion = consumoMes * DIAS_MES / DIAS_TRANSCURRIDOS
   * Antes estaban hardcoded en 11 y 31 → inflaba la proyección ~3x cuando
   * el mes estaba más avanzado.
   */
  private get DIAS_TRANSCURRIDOS(): number {
    return Math.max(1, new Date().getDate());
  }
  private get DIAS_MES(): number {
    const hoy = new Date();
    return new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  }

  /**
   * Suma del consumo del mes actual de todos los sitios visibles. Formato
   * "es-CL" con separador de miles. Se recalcula en cada render porque
   * `sitiosResumen` se reasigna al llegar respuestas async de
   * fetchRealData → bindings re-evalúan.
   */
  flujoAcumuladoMes(): string {
    const total = this.sitiosResumen.reduce((acc, s) => acc + (s.consumoMes || 0), 0);
    return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(Math.round(total));
  }

  /**
   * Label del mes actual en español, ej. "mayo 2026". Usado como subtitle
   * del KPI "Flujo acumulado mensual" para evitar el hardcoded "mayo 2026".
   */
  mesActualLabel(): string {
    const meses = [
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ];
    const hoy = new Date();
    return `${meses[hoy.getMonth()]} ${hoy.getFullYear()}`;
  }

  private map: any = null;
  private mapMarkers: any[] = [];
  private L: any = null;
  private viewReady = false;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  ngOnChanges(): void {
    this.sitiosResumen = this.sites.map((s, i) => {
      // UTM real desde backend. Si no hay UTM, fallback al geo mock por
      // sitio (centros Coquimbo) — solo afecta posición del pin en el mapa.
      const geo = this.MOCK_SITE_GEO[i % this.MOCK_SITE_GEO.length];
      const norte = this.toNumberOrNull(s.coord_norte);
      const este = this.toNumberOrNull(s.coord_este);
      const huso = this.toNumberOrNull(s.huso);
      // Métricas inicializadas en 0 / null — `fetchRealData` los llena con
      // datos reales del backend. Si el sitio no es pozo o no tiene
      // contadores configurados, quedan en 0.
      return {
        nombre: s.descripcion || s.nombre || s.id_serial || 'Instalación',
        ubicacion: s.ubicacion || 'Sin ubicación',
        obraDga: s.pozo_config?.obra_dga || null,
        estado: (s.activo ? 'online' : 'sinDatos') as SitioResumen['estado'],
        lat: norte !== null && este !== null && huso !== null ? NaN : geo.lat,
        lng: norte !== null && este !== null && huso !== null ? NaN : geo.lng,
        coord_norte: norte,
        coord_este: este,
        huso,
        caudal: 0,
        nivel: 0,
        consumoMes: 0,
        diasActivos: 0,
        diasMes: this.DIAS_MES,
        m3Proyectados: 0,
        tendenciaCaudal: 0,
        dashboardLoaded: false,
        monthlyLoaded: false,
        dailyLoaded: false,
      };
    });

    const total = this.sites.length;
    const activos = this.sites.filter((s) => s.activo).length;
    const inactivos = total - activos;

    this.kpisSecundarios = [
      {
        label: 'Sitios activos',
        valor: `${activos}/${total}`,
        subtext: inactivos > 0 ? `${inactivos} sin datos` : 'Todos operativos',
        icon: 'sensors',
        tono: activos === total ? 'ok' : 'warn',
      },
      {
        label: 'Alertas activas',
        valor: '3',
        subtext: '1 crítica en seguimiento',
        icon: 'notifications_active',
        tono: 'warn',
      },
      {
        label: 'DGA pendientes',
        valor: '1',
        subtext: 'Mayo 2026 — en plazo',
        icon: 'shield',
        tono: 'neutral',
      },
    ];

    // Inicializa chart con últimos 6 meses reales (labels) y valores en 0.
    // fetchRealData los llena con deltas reales del monthly counter.
    this.puntosMensuales = this.buildMonthLabels(6);
    this.rebuildYTicks();

    this.buildMetricasComparacion();

    if (this.viewReady) {
      if (this.map) this.updateMarkers();
      else this.initMap();
    }

    // Fetch datos reales en background. UI se actualiza por mutación
    // directa de sitiosResumen / puntosMensuales / kpisSecundarios cuando
    // las respuestas llegan.
    this.fetchRealData();
  }

  /**
   * Fetch en paralelo de:
   *   - dashboard-data por sitio (caudal/nivel actual)
   *   - monthly counters por sitio (consumo + tendencia)
   *   - alertas activas por empresa (KPI)
   *   - incidencias por empresa (visitas técnicas + resolución)
   *
   * Mock fallback se mantiene si alguna call falla — UI siempre tiene algo.
   */
  private fetchRealData(): void {
    if (!this.sites.length) return;
    const empresaId = this.sites[0]?.empresa_id;

    // Accumulator para uptime promedio (se calcula cuando llegaron todas las
    // responses daily). Indexado por i del site, valor en %.
    const uptimePorSitio: number[] = new Array(this.sites.length).fill(NaN);
    let pendingDailyResponses = this.sites.length;

    const flushArrays = (): void => {
      this.sitiosResumen = [...this.sitiosResumen];
      this.cdr.markForCheck();
    };

    // Render parcial: las 3 calls per-site corren independientes. Cada
    // respuesta actualiza solo su slice del SitioResumen — el operador ve
    // caudal/nivel apenas llega dashboard sin esperar monthly+daily, y la
    // tabla de consumo aparece sola si monthly responde antes.
    this.sites.forEach((site, i) => {
      // 1a. Dashboard → caudal + nivel actual.
      this.companyService
        .getSiteDashboardData(site.id)
        .pipe(catchError(() => of(null)))
        .subscribe((res) => {
          if (!this.sitiosResumen[i]) return;
          const dash = (
            res as { data?: { resumen?: Record<string, { valor?: unknown } | undefined> } } | null
          )?.data;
          const caudalRaw = Number(dash?.resumen?.['caudal']?.valor ?? NaN);
          const nivelRaw = Number(
            dash?.resumen?.['nivel_freatico']?.valor ?? dash?.resumen?.['nivel']?.valor ?? NaN,
          );
          const caudal = Number.isFinite(caudalRaw) ? Math.round(caudalRaw * 10) / 10 : 0;
          const nivel = Number.isFinite(nivelRaw) ? Math.round(nivelRaw * 10) / 10 : 0;
          this.sitiosResumen[i] = {
            ...this.sitiosResumen[i],
            caudal,
            nivel,
            dashboardLoaded: true,
          };
          flushArrays();
        });

      // 1b. Monthly counters → consumo del mes + tendencia + chart.
      this.companyService
        .getSiteMonthlyCounters(site.id, { rol: 'totalizador', meses: 7 })
        .pipe(catchError(() => of({ ok: false, data: [] as ContadorMensualPoint[] })))
        .subscribe((res) => {
          if (!this.sitiosResumen[i]) return;
          const monthly = (res?.ok ? res.data : []) as ContadorMensualPoint[];
          const mesActual = monthly[monthly.length - 1];
          const mesPrev = monthly[monthly.length - 2];
          const consumoMes = Number(mesActual?.delta ?? 0);
          let tendencia = 0;
          const prevDelta = Number(mesPrev?.delta ?? 0);
          if (prevDelta > 0) {
            tendencia = Math.round(((consumoMes - prevDelta) / prevDelta) * 1000) / 10;
          }
          this.sitiosResumen[i] = {
            ...this.sitiosResumen[i],
            consumoMes: Math.round(consumoMes),
            tendenciaCaudal: tendencia,
            m3Proyectados: Math.round(
              (consumoMes / Math.max(1, this.DIAS_TRANSCURRIDOS)) * this.DIAS_MES,
            ),
            monthlyLoaded: true,
          };
          // Chart: últimos N meses.
          const slots = this.puntosMensuales.length;
          for (let mi = 0; mi < slots; mi++) {
            const offset = slots - 1 - mi;
            const m = monthly[monthly.length - 1 - offset];
            this.puntosMensuales[mi].valores[i] =
              m?.delta != null ? Math.round(Number(m.delta)) : 0;
          }
          this.puntosMensuales = this.puntosMensuales.map((p) => ({
            ...p,
            valores: [...p.valores],
          }));
          this.rebuildYTicks();
          this.buildMetricasComparacion();
          flushArrays();
        });

      // 1c. Daily counters → días activos (uptime).
      this.companyService
        .getSiteDailyCounters(site.id, { rol: 'totalizador', dias: 60 })
        .pipe(catchError(() => of({ ok: false, data: [] as ContadorDiarioPoint[] })))
        .subscribe((res) => {
          if (!this.sitiosResumen[i]) {
            pendingDailyResponses--;
            return;
          }
          const daily = (res?.ok ? res.data : []) as ContadorDiarioPoint[];
          const last30 = daily.slice(-30);
          const diasActivos = last30.filter((d) => d.muestras > 0).length;
          this.sitiosResumen[i] = {
            ...this.sitiosResumen[i],
            diasActivos,
            dailyLoaded: true,
          };
          uptimePorSitio[i] = Math.round((diasActivos / 30) * 100);
          flushArrays();

          pendingDailyResponses--;
          if (pendingDailyResponses === 0) {
            const validUptimes = uptimePorSitio.filter((u) => Number.isFinite(u));
            if (validUptimes.length > 0) {
              const promedio = Math.round(
                validUptimes.reduce((a, b) => a + b, 0) / validUptimes.length,
              );
              this.metricasOp[0] = {
                label: 'Uptime promedio',
                valor: `${promedio}%`,
                icon: 'wifi',
                tono: promedio >= 95 ? 'ok' : promedio >= 80 ? 'neutral' : 'warn',
              };
              this.metricasOp = [...this.metricasOp];
              this.cdr.markForCheck();
            }
          }
        });
    });

    // 2. Alertas activas por empresa.
    if (empresaId) {
      this.alertaService
        .listarEventos({ empresa_id: empresaId, resuelta: false, limit: 200 })
        .pipe(catchError(() => of([] as EventoRow[])))
        .subscribe((eventos) => {
          // Backend ya filtró por empresa_id + resuelta=false. Acotamos a la
          // sub-vista actual (puede que el usuario esté viendo solo un módulo
          // del árbol — ej. solo pozos).
          const siteIds = new Set(this.sites.map((s) => s.id));
          const activos = eventos.filter((e) => siteIds.has(e.sitio_id));
          const criticas = activos.filter((e) => e.severidad === 'critica').length;
          this.kpisSecundarios[1] = {
            label: 'Alertas activas',
            valor: String(activos.length),
            subtext:
              activos.length === 0
                ? 'Sin eventos activos'
                : criticas > 0
                  ? `${criticas} crítica${criticas > 1 ? 's' : ''} en seguimiento`
                  : `${activos.length} en revisión`,
            icon: 'notifications_active',
            tono: criticas > 0 ? 'warn' : activos.length > 0 ? 'neutral' : 'ok',
          };
          this.kpisSecundarios = [...this.kpisSecundarios];
          this.cdr.markForCheck();
        });

      // 3. Tiempo respuesta promedio: eventos resueltos del último mes.
      // delta = resuelta_at - triggered_at. Promediamos en horas.
      const hoy = new Date();
      const haceUnMes = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000);
      this.alertaService
        .listarEventos({
          empresa_id: empresaId,
          resuelta: true,
          desde: haceUnMes.toISOString(),
          hasta: hoy.toISOString(),
          limit: 500,
        })
        .pipe(catchError(() => of([] as EventoRow[])))
        .subscribe((eventos) => {
          const siteIds = new Set(this.sites.map((s) => s.id));
          const horas = eventos
            .filter((e) => siteIds.has(e.sitio_id) && e.resuelta_at && e.triggered_at)
            .map((e) => {
              const t0 = new Date(e.triggered_at).getTime();
              const t1 = new Date(e.resuelta_at!).getTime();
              return (t1 - t0) / 1000 / 60 / 60; // horas
            })
            .filter((h) => Number.isFinite(h) && h >= 0);

          if (horas.length === 0) {
            this.metricasOp[1] = {
              label: 'Tiempo respuesta',
              valor: '—',
              icon: 'timer',
              tono: 'neutral',
            };
          } else {
            const promHoras = horas.reduce((a, b) => a + b, 0) / horas.length;
            // Formato: < 1h muestra minutos, < 48h muestra horas, sino días.
            const valor =
              promHoras < 1
                ? `${Math.round(promHoras * 60)} min`
                : promHoras < 48
                  ? `${Math.round(promHoras * 10) / 10} h`
                  : `${Math.round((promHoras / 24) * 10) / 10} d`;
            this.metricasOp[1] = {
              label: 'Tiempo respuesta',
              valor,
              icon: 'timer',
              // < 4h verde, < 24h neutral, > 24h warn.
              tono: promHoras < 4 ? 'ok' : promHoras < 24 ? 'neutral' : 'warn',
            };
          }
          this.metricasOp = [...this.metricasOp];
          this.cdr.markForCheck();
        });

      // 4. DGA pendientes: review-queue global filtrado a sitios visibles.
      // Solo aplica si la empresa tiene sitios tipo 'pozo' (los que reportan
      // DGA). Si no hay pozos en la vista → KPI a 0.
      const sitiosPozo = this.sites.filter((s) => s.tipo_sitio === 'pozo');
      if (sitiosPozo.length === 0) {
        this.kpisSecundarios[2] = {
          label: 'DGA pendientes',
          valor: '0',
          subtext: 'Sin pozos en esta vista',
          icon: 'shield',
          tono: 'neutral',
        };
        this.kpisSecundarios = [...this.kpisSecundarios];
      } else {
        this.dgaService
          .listReviewQueue(undefined, 500)
          .pipe(catchError(() => of([] as DgaReviewSlot[])))
          .subscribe((queue) => {
            const siteIds = new Set(sitiosPozo.map((s) => s.id));
            const pendientes = queue.filter((slot) => siteIds.has(slot.site_id));
            // Etiqueta del mes actual para el subtext.
            const mesActual = new Date().toLocaleDateString('es-CL', {
              month: 'long',
              year: 'numeric',
            });
            this.kpisSecundarios[2] = {
              label: 'DGA pendientes',
              valor: String(pendientes.length),
              subtext:
                pendientes.length === 0
                  ? `${mesActual.charAt(0).toUpperCase() + mesActual.slice(1)} — al día`
                  : `${pendientes.length} en cola de revisión`,
              icon: 'shield',
              tono: pendientes.length === 0 ? 'ok' : pendientes.length > 10 ? 'warn' : 'neutral',
            };
            this.kpisSecundarios = [...this.kpisSecundarios];
            this.cdr.markForCheck();
          });
      }

      // 5. Incidencias por empresa → visitas técnicas + resolución.
      this.incidenciaService
        .listar({ empresa_id: empresaId, limit: 200 })
        .pipe(catchError(() => of([] as IncidenciaRow[])))
        .subscribe((incs) => {
          // Filtrar al subset de sitios visibles.
          const siteIds = new Set(this.sites.map((s) => s.id));
          const local = incs.filter((i) => siteIds.has(i.sitio_id));
          const total = local.length;
          const resueltas = local.filter(
            (i) => i.estado === 'resuelta' || i.estado === 'cerrada',
          ).length;
          const ratio = total > 0 ? Math.round((resueltas / total) * 100) : 0;
          this.metricasOp[2] = {
            label: 'Visitas técnicas',
            valor: String(total),
            icon: 'engineering',
            tono: 'neutral',
          };
          this.metricasOp[3] = {
            label: 'Resolución',
            valor: total > 0 ? `${ratio}%` : '—',
            icon: 'check_circle',
            tono: ratio >= 80 ? 'ok' : ratio >= 60 ? 'neutral' : 'warn',
          };
          this.metricasOp = [...this.metricasOp];
          this.cdr.markForCheck();
        });
    }
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.initMap();
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
  }

  // ── Public ─────────────────────────────────────────────────────────────────

  toggleSite(i: number): void {
    const next = new Set(this.hiddenSites());
    if (next.has(i)) next.delete(i);
    else next.add(i);
    this.hiddenSites.set(next);
  }

  setPreset(preset: PeriodoPreset): void {
    if (preset === 'custom') {
      this.periodoPreset.set('custom');
      return;
    }
    this.periodoPreset.set(preset);
    if (preset === 'semana') {
      this.periodoA.set({ label: 'Esta semana', desde: '2026-05-11', hasta: '2026-05-11' });
      this.periodoB.set({ label: 'Semana anterior', desde: '2026-05-04', hasta: '2026-05-10' });
    } else if (preset === 'mes') {
      this.periodoA.set({ label: 'Mayo 2026', desde: '2026-05-01', hasta: '2026-05-11' });
      this.periodoB.set({ label: 'Abril 2026', desde: '2026-04-01', hasta: '2026-04-11' });
    } else if (preset === '7d') {
      this.periodoA.set({ label: 'Últimos 7 días', desde: '2026-05-05', hasta: '2026-05-11' });
      this.periodoB.set({ label: '7 días anteriores', desde: '2026-04-28', hasta: '2026-05-04' });
    }
    // Sincronizar inputs locales con los nuevos valores del preset para que
    // el botón Aplicar quede deshabilitado (no hay cambios pendientes).
    this.periodoAInputDesde.set(this.periodoA().desde);
    this.periodoAInputHasta.set(this.periodoA().hasta);
    this.periodoBInputDesde.set(this.periodoB().desde);
    this.periodoBInputHasta.set(this.periodoB().hasta);
    this.buildMetricasComparacion();
  }

  /**
   * Aplica las fechas custom de los inputs locales a periodoA/B y redibuja
   * el chart de comparación. Marca preset como 'custom' para que el badge
   * "Personalizado" sea visible y ningún botón de preset quede activo.
   */
  aplicarPeriodosCustom(): void {
    const aDesde = this.periodoAInputDesde();
    const aHasta = this.periodoAInputHasta();
    const bDesde = this.periodoBInputDesde();
    const bHasta = this.periodoBInputHasta();
    if (!aDesde || !aHasta || !bDesde || !bHasta) return;
    if (aDesde > aHasta || bDesde > bHasta) return;
    this.periodoA.set({
      label: this.formatRangoLabel(aDesde, aHasta),
      desde: aDesde,
      hasta: aHasta,
    });
    this.periodoB.set({
      label: this.formatRangoLabel(bDesde, bHasta),
      desde: bDesde,
      hasta: bHasta,
    });
    this.periodoPreset.set('custom');
    this.buildMetricasComparacion();
  }

  /**
   * Genera label corto para un rango "DD/MM → DD/MM" usado en el chip de
   * periodoA/B del header de "Comparación de períodos".
   */
  private formatRangoLabel(desde: string, hasta: string): string {
    const fmt = (iso: string): string => {
      const [, m, d] = iso.split('-');
      return `${d}/${m}`;
    };
    return desde === hasta ? fmt(desde) : `${fmt(desde)} → ${fmt(hasta)}`;
  }

  /** Tope dinámico del Y-axis. Se recalcula en rebuildYTicks() cada vez que
   *  llegan datos nuevos para mantener el chart escalado. */
  private chartMaxVal = 1;

  buildPolyline(siteIndex: number): string {
    const n = this.puntosMensuales.length;
    if (n < 2) return '';
    const step = this.chartW / (n - 1);
    const maxVal = this.chartMaxVal || 1;
    return this.puntosMensuales
      .map((p, i) => {
        const x = this.chartX0 + i * step;
        const y = this.chartY0 + this.chartH - ((p.valores[siteIndex] ?? 0) / maxVal) * this.chartH;
        return `${x},${y}`;
      })
      .join(' ');
  }

  /**
   * Inicializa puntosMensuales con labels reales de los últimos 6 meses,
   * ending mes actual. Se llama al recibir respuestas de monthly counters
   * para reemplazar los meses hardcoded.
   */
  private buildMonthLabels(monthsAgo: number): PuntoMensual[] {
    const meses = [
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
    const hoy = new Date();
    const slots: PuntoMensual[] = [];
    for (let i = monthsAgo - 1; i >= 0; i--) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const label = `${meses[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
      slots.push({ mes: label, valores: new Array(this.sites.length).fill(0) });
    }
    return slots;
  }

  /**
   * Recalcula `chartMaxVal` y `yTicks` desde los valores actuales del chart
   * para que la escala Y se adapte al rango real (no quede pegada en 2500
   * si la empresa consume 80 m³/mes).
   */
  private rebuildYTicks(): void {
    let max = 0;
    for (const p of this.puntosMensuales) {
      for (const v of p.valores) {
        if (v > max) max = v;
      }
    }
    // Margen 20% arriba del max + ronda a número "limpio" para labels legibles.
    const padded = max * 1.2;
    const scale = Math.pow(10, Math.floor(Math.log10(padded || 1)));
    const niceMax = Math.ceil(padded / scale) * scale || 100;
    this.chartMaxVal = niceMax;
    const nTicks = 4;
    this.yTicks = Array.from({ length: nTicks }, (_, i) => ({
      y: Math.round(this.chartY0 + this.chartH - (i / (nTicks - 1)) * this.chartH),
      label: i === 0 ? '0' : Math.round((niceMax * i) / (nTicks - 1)).toLocaleString('es-CL'),
    }));
  }

  formatNum(n: number): string {
    if (!isFinite(n) || isNaN(n)) return '0.0';
    return Math.abs(n).toFixed(1);
  }

  estadoDotClass(e: SitioResumen['estado']): string {
    if (e === 'online') return 'bg-emerald-500';
    if (e === 'offline') return 'bg-rose-500';
    return 'bg-slate-300';
  }

  estadoTextClass(e: SitioResumen['estado']): string {
    if (e === 'online') return 'text-emerald-600';
    if (e === 'offline') return 'text-rose-500';
    return 'text-slate-400';
  }

  estadoLabel(e: SitioResumen['estado']): string {
    if (e === 'online') return 'En línea';
    if (e === 'offline') return 'Fuera de línea';
    return 'Sin datos';
  }

  kpiBorde(tono: KpiCard['tono']): string {
    if (tono === 'warn') return 'border-amber-200';
    if (tono === 'ok') return 'border-emerald-100';
    return 'border-slate-200';
  }

  kpiIconClass(tono: KpiCard['tono']): string {
    if (tono === 'warn') return 'bg-amber-50 text-amber-600';
    if (tono === 'ok') return 'bg-emerald-50 text-emerald-600';
    return 'bg-slate-100 text-slate-500';
  }

  metricaOpIconClass(tono: MetricaOperacional['tono']): string {
    if (tono === 'warn') return 'bg-amber-50 text-amber-600';
    if (tono === 'ok') return 'bg-primary-tint-10 text-primary-container';
    return 'bg-slate-100 text-slate-500';
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildMetricasComparacion(): void {
    const baseMult =
      this.periodoPreset() === 'semana' ? 0.93 : this.periodoPreset() === 'mes' ? 0.91 : 0.95;
    // Slight variation per site to simulate realistic data
    const siteOffset = [0.02, -0.03, 0.01, -0.02, 0.015];
    const pct = (a: number, b: number): number =>
      b !== 0 ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : 0;

    this.sitiosComparacion = this.sitiosResumen.map((s, i) => {
      const mult = baseMult + (siteOffset[i % siteOffset.length] ?? 0);
      const caudalB = s.caudal * mult;
      const nivelB = s.nivel * (1 - 0.03 * (i % 2 === 0 ? 1 : -1));
      const consumoB = Math.round(s.consumoMes * mult);

      return {
        nombre: s.nombre,
        estado: s.estado,
        caudalA: s.caudal.toFixed(1),
        caudalB: caudalB.toFixed(1),
        caudalTend: pct(s.caudal, caudalB),
        nivelA: s.nivel.toFixed(1),
        nivelB: nivelB.toFixed(1),
        nivelTend: pct(s.nivel, nivelB),
        consumoA: Math.trunc(s.consumoMes).toString(),
        consumoB: Math.trunc(consumoB).toString(),
        consumoTend: pct(s.consumoMes, consumoB),
      };
    });
  }

  private async loadLeaflet(): Promise<any> {
    const m = await import('leaflet');
    return m.default ?? m;
  }

  /**
   * Helper para convertir number | string | null | undefined a number | null.
   * El backend pg-numeric vuelve como string en algunos casos; lo aceptamos.
   */
  private toNumberOrNull(v: unknown): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Lazy load proj4. Solo se importa cuando el mapa se inicializa.
   */
  private proj4Lib: any = null;
  private async loadProj4(): Promise<any> {
    if (this.proj4Lib) return this.proj4Lib;
    const m = await import('proj4');
    this.proj4Lib = m.default ?? m;
    return this.proj4Lib;
  }

  /**
   * Convierte UTM (norte, este, huso) → [lat, lng] WGS84 usando proj4.
   * Chile está en hemisferio sur → flag +south.
   */
  private utmToLatLng(
    este: number,
    norte: number,
    huso: number,
  ): { lat: number; lng: number } | null {
    if (!this.proj4Lib) return null;
    try {
      const utmProj = `+proj=utm +zone=${huso} +south +ellps=WGS84 +datum=WGS84 +units=m +no_defs`;
      const [lng, lat] = this.proj4Lib(utmProj, 'WGS84', [este, norte]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { lat, lng };
    } catch {
      return null;
    }
  }

  private async initMap(): Promise<void> {
    if (!this.mapContainer || this.map) return;
    // Cargamos leaflet + proj4 en paralelo. proj4 es necesario para convertir
    // UTM del backend a lat/lng que entiende leaflet.
    this.L = await this.loadLeaflet();
    await this.loadProj4();
    if (!this.mapContainer || this.map) return; // guard against re-entry after await

    const L: any = this.L;

    this.map = L.map(this.mapContainer.nativeElement, {
      scrollWheelZoom: false,
      zoomControl: true,
    });

    // Capas: Esri World Imagery (satelital) default + CartoDB Voyager (calle)
    // como alternativa. User pidió satélite por default — los pozos se ven
    // en contexto real de terreno (caminos, agua, vegetación).
    const satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Tiles © Esri, Maxar, Earthstar Geographics, USDA, USGS',
        maxZoom: 19,
      },
    );

    const street = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
      },
    );

    satellite.addTo(this.map);
    L.control
      .layers(
        { Satelital: satellite, Calle: street },
        {},
        { position: 'topright', collapsed: false },
      )
      .addTo(this.map);

    this.updateMarkers();

    // invalidateSize: leaflet calcula el tamaño del contenedor al init. Si el
    // contenedor estaba oculto o cambiando dimensiones, las tiles se
    // posicionan mal (parecen cuadrados sueltos). Forzamos un recalc después
    // de un tick para garantizar layout estable.
    setTimeout(() => this.map?.invalidateSize(), 0);
    setTimeout(() => this.map?.invalidateSize(), 200);
  }

  private updateMarkers(): void {
    if (!this.map || !this.L) return;
    const L: any = this.L;

    this.mapMarkers.forEach((m) => m.remove());
    this.mapMarkers = [];

    if (this.sitiosResumen.length === 0) return;

    const bounds: [number, number][] = [];

    this.sitiosResumen.forEach((s, i) => {
      // Si el sitio tiene UTM, lo convertimos a lat/lng acá (just-in-time)
      // y sobrescribimos s.lat/s.lng para que el marker apunte al lugar real.
      if (
        s.coord_norte !== null &&
        s.coord_este !== null &&
        s.huso !== null &&
        Number.isNaN(s.lat)
      ) {
        const result = this.utmToLatLng(s.coord_este, s.coord_norte, s.huso);
        if (result) {
          s.lat = result.lat;
          s.lng = result.lng;
        } else {
          // Conversión falló (huso inválido, etc.) → fallback genérico.
          s.lat = -29.9027;
          s.lng = -71.2517;
        }
      }
      const color = this.colores[i % this.colores.length];
      const dotColor =
        s.estado === 'online' ? '#22C55E' : s.estado === 'offline' ? '#F87171' : '#94A3B8';
      const tendSign = s.tendenciaCaudal >= 0 ? '+' : '';
      const tendColor = s.tendenciaCaudal >= 0 ? '#16A34A' : '#DC2626';

      // Pin estilo Google Maps: gota con punta hacia abajo, badge de estado
      // arriba a la derecha. SVG inline para nitidez en cualquier zoom.
      const pinSvg = `
        <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="shadow${i}" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/>
              <feOffset dx="0" dy="2"/>
              <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <path d="M16 0 C7.16 0 0 7.16 0 16 c0 12 16 26 16 26 s16 -14 16 -26 c0 -8.84 -7.16 -16 -16 -16 z"
                fill="${color}" filter="url(#shadow${i})"/>
          <circle cx="16" cy="16" r="6.5" fill="white"/>
          <circle cx="16" cy="16" r="3.5" fill="${color}"/>
        </svg>`;
      const icon = L.divIcon({
        html: `
          <div style="position:relative;width:32px;height:42px;">
            ${pinSvg}
            <div style="position:absolute;top:2px;right:0;width:10px;height:10px;border-radius:50%;background:${dotColor};border:2px solid white;box-shadow:0 1px 2px rgba(0,0,0,0.3);"></div>
          </div>`,
        className: 'emeltec-marker',
        iconSize: [32, 42],
        iconAnchor: [16, 42],
        popupAnchor: [0, -38],
      });

      // Link Google Maps: maps.google.com/?q=lat,lng → muestra el pin.
      // En móvil abre la app si está instalada. Desde ahí el usuario decide
      // si pedir rutas con el botón "Direcciones" nativo de Google Maps.
      const gmapsView = `https://maps.google.com/?q=${s.lat},${s.lng}`;
      const popupHtml = `
        <div style="font-family:'DM Sans',sans-serif;min-width:220px;padding:2px;">
          <p style="font-weight:800;font-size:12px;color:#1E293B;margin:0 0 8px;padding-bottom:6px;border-bottom:1px solid #E2E8F0;">${s.nombre}</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;">
            <div>
              <p style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Caudal</p>
              <p style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#0DAFBD;margin:0;">${s.caudal} L/s</p>
            </div>
            <div>
              <p style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Nivel</p>
              <p style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#1E293B;margin:0;">${s.nivel} m</p>
            </div>
            <div>
              <p style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Consumo mes</p>
              <p style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:#1E293B;margin:0;">${s.consumoMes.toLocaleString()} m³</p>
            </div>
            <div>
              <p style="font-size:9px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 2px;">Tendencia</p>
              <p style="font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700;color:${tendColor};margin:0;">${tendSign}${s.tendenciaCaudal}%</p>
            </div>
          </div>
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid #E2E8F0;">
            <a href="${gmapsView}" target="_blank" rel="noopener noreferrer"
               style="display:flex;align-items:center;justify-content:center;gap:6px;padding:7px 10px;border-radius:6px;background:#0DAFBD;color:white;font-size:11px;font-weight:700;text-decoration:none;">
              <span style="font-family:'Material Symbols Outlined';font-size:14px;">map</span>
              Ver en Maps
            </a>
          </div>
        </div>
      `;

      const marker = L.marker([s.lat, s.lng], { icon })
        .bindPopup(L.popup({ closeButton: true, maxWidth: 260 }).setContent(popupHtml))
        .bindTooltip(s.nombre, {
          permanent: true,
          direction: 'top',
          offset: [0, -38],
          className: 'emeltec-marker-label',
        })
        .addTo(this.map);

      this.mapMarkers.push(marker);
      bounds.push([s.lat, s.lng]);
    });

    if (bounds.length > 0) {
      // Calculamos extensión diagonal de los bounds. Si los pozos están en
      // un radio pequeño (< 5 km) hacemos zoom cercano (16) — útil para
      // sitios en la misma faena. Si están dispersos por la región, zoom
      // más bajo para overview. Padding 60px en todos los casos.
      const diagKm = this.boundsDiagonalKm(bounds);
      const maxZoom = diagKm < 1 ? 17 : diagKm < 5 ? 16 : diagKm < 20 ? 14 : diagKm < 100 ? 12 : 10;
      this.map.fitBounds(bounds, { padding: [60, 60], maxZoom });
    }
  }

  /**
   * Distancia diagonal aproximada (km) de un set de bounds [[lat, lng], ...].
   * Usa Haversine entre el primer y último punto + sweep para encontrar el
   * span máximo. Suficiente para decidir el zoom inicial sin precisión
   * cartográfica.
   */
  private boundsDiagonalKm(bounds: [number, number][]): number {
    if (bounds.length < 2) return 0;
    let minLat = Infinity,
      maxLat = -Infinity,
      minLng = Infinity,
      maxLng = -Infinity;
    for (const [lat, lng] of bounds) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    const R = 6371; // radio Tierra km
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(maxLat - minLat);
    const dLng = toRad(maxLng - minLng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(minLat)) * Math.cos(toRad(maxLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}
