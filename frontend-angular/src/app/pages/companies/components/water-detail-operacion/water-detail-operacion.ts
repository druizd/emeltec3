import { CommonModule } from '@angular/common';
import { InlineErrorComponent } from '../../../../components/ui/inline-error';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { catchError, of, Subscription, switchMap, timer } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { CompanyService } from '../../../../services/company.service';
import { CHILE_TIME_ZONE } from '../../../../shared/timezone';
import { OperacionGraficosHistoricosComponent } from './operacion-graficos-historicos';
import { OperacionResumenPeriodoComponent } from './operacion-resumen-periodo';
import { type HistoricalRow, WaterOperacionStateService } from './water-operacion-state';

type OperacionModo = 'hoy' | 'historico' | 'resumen';

interface MetricaTiempoReal {
  label: string;
  valor: string;
  unidad: string;
}

interface TurnoCard {
  nombre: string;
  horario: string;
  consumo: number | null;
  activo: boolean;
  esTotal?: boolean;
}

interface TurnoDistribucion {
  nombre: string;
  consumo: number;
  pct: number;
  barClass: string;
}

interface DashboardValue {
  valor?: string | number | null;
  unidad?: string | null;
  ok?: boolean;
}

interface DashboardData {
  ultima_lectura?: {
    time?: string | null;
    timestamp_completo?: string | null;
    received_at?: string | null;
  } | null;
  resumen?: Record<string, DashboardValue | undefined>;
}

interface HistoricalValue {
  valor?: string | number | null;
  unidad?: string | null;
  ok?: boolean;
}

interface HistoricalApiRow {
  timestamp?: string | null;
  fecha?: string | null;
  caudal?: HistoricalValue | null;
  nivel?: HistoricalValue | null;
  totalizador?: HistoricalValue | null;
  nivel_freatico?: HistoricalValue | null;
}

interface RealtimeChartPoint {
  timestampMs: number;
  caudal: number;
  x: number;
  y: number;
  xPct: number;
  yPct: number;
  dateLabel: string;
  caudalLabel: string;
}

@Component({
  selector: 'app-water-detail-operacion',
  standalone: true,
  imports: [
    CommonModule,
    InlineErrorComponent,
    OperacionGraficosHistoricosComponent,
    OperacionResumenPeriodoComponent,
  ],
  providers: [WaterOperacionStateService],
  template: `
    <div class="space-y-3">
      <!-- Toggle de modo -->
      <nav
        class="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-2 shadow-sm"
        aria-label="Selector de modo de operación"
        role="tablist"
        (keydown.arrowright)="cycleModo(1); $event.preventDefault()"
        (keydown.arrowleft)="cycleModo(-1); $event.preventDefault()"
        (keydown.home)="modo.set('hoy'); $event.preventDefault()"
        (keydown.end)="modo.set('resumen'); $event.preventDefault()"
      >
        <button
          type="button"
          role="tab"
          (click)="modo.set('hoy')"
          [class]="modoClass('hoy')"
          [attr.aria-selected]="modo() === 'hoy'"
          [attr.tabindex]="modo() === 'hoy' ? 0 : -1"
        >
          <span class="material-symbols-outlined text-[17px]" aria-hidden="true">today</span>
          Hoy en tiempo real
        </button>
        <button
          type="button"
          role="tab"
          (click)="modo.set('historico')"
          [class]="modoClass('historico')"
          [attr.aria-selected]="modo() === 'historico'"
          [attr.tabindex]="modo() === 'historico' ? 0 : -1"
        >
          <span class="material-symbols-outlined text-[17px]" aria-hidden="true">query_stats</span>
          Gráficos Históricos
        </button>
        <button
          type="button"
          role="tab"
          (click)="modo.set('resumen')"
          [class]="modoClass('resumen')"
          [attr.aria-selected]="modo() === 'resumen'"
          [attr.tabindex]="modo() === 'resumen' ? 0 : -1"
        >
          <span class="material-symbols-outlined text-[17px]" aria-hidden="true"
            >calendar_view_month</span
          >
          Resumen por Período
        </button>
        <p class="ml-auto flex items-center gap-1 text-caption-xs font-semibold text-slate-500">
          <span class="material-symbols-outlined text-[14px]" aria-hidden="true">info</span>
          Puede presentar desfases momentáneos
        </p>
      </nav>

      @if (loadError()) {
        <app-inline-error
          [message]="loadError()"
          actionLabel="Reintentar"
          actionIcon="refresh"
          (action)="retryLoad()"
        />
      }

      <!-- Hoy en tiempo real (fusión realtime + turnos) -->
      @if (modo() === 'hoy') {
        <!-- Banner tiempo real -->
        <div
          class="rounded-2xl border border-primary-tint-25 bg-white p-5 shadow-primary-banner-soft"
          [attr.aria-busy]="loading()"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2.5">
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-tint-10"
              >
                <span
                  class="material-symbols-outlined text-[18px] text-primary-container"
                  aria-hidden="true"
                  >bolt</span
                >
              </span>
              <div>
                <p class="text-body font-semibold text-on-surface">Datos en tiempo real</p>
                <p class="mt-0.5 text-caption-xs text-on-surface-variant">
                  actualización cada minuto
                </p>
              </div>
            </div>
            <span class="flex items-center gap-2 text-caption-xs font-bold">
              @if (loading()) {
                <span
                  class="material-symbols-outlined animate-spin text-[14px] text-primary-container"
                  aria-hidden="true"
                  >progress_activity</span
                >
                <span class="text-primary-container">Actualizando…</span>
              } @else {
                <span class="h-2 w-2 animate-pulse rounded-full bg-emerald-500"></span>
                <span class="text-emerald-700">{{ latestTimestampLabel() }}</span>
              }
            </span>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            @for (m of metricas(); track m.label) {
              <div class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <p
                  class="text-caption-xs font-bold uppercase tracking-widest text-on-surface-muted"
                >
                  {{ m.label }}
                </p>
                <p class="mt-1 font-mono text-h4 font-semibold leading-none text-on-surface">
                  {{ m.valor
                  }}<span class="ml-1 text-body-sm font-bold text-on-surface-muted">{{
                    m.unidad
                  }}</span>
                </p>
              </div>
            }
          </div>
        </div>

        <!-- Hoy por turnos + Sparkline en grid -->
        <div class="grid gap-3 xl:grid-cols-[1fr_auto]">
          <!-- Turno cards -->
          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <p class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
                  Acumulado por turno
                </p>
                <button
                  type="button"
                  (click)="turnosSettingsOpen.update((v) => !v)"
                  class="flex h-6 w-6 items-center justify-center rounded-lg transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  [class]="
                    turnosSettingsOpen()
                      ? 'bg-primary-tint-14 text-primary-container'
                      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                  "
                  aria-label="Configurar horarios de turno"
                  [attr.aria-expanded]="turnosSettingsOpen()"
                >
                  <span class="material-symbols-outlined text-[15px]" aria-hidden="true"
                    >settings</span
                  >
                </button>
              </div>
              <!-- Navegación de fecha -->
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  (click)="diaOffset.update((v) => v - 1)"
                  class="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Día anterior"
                >
                  <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                    >chevron_left</span
                  >
                </button>
                <span class="flex items-center gap-1.5 text-body-sm font-bold text-slate-700">
                  {{ fechaDiaReal() }}
                  @if (esHoy()) {
                    <span
                      class="rounded-full bg-primary-tint-14 px-2 py-0.5 text-caption-xs font-semibold text-primary-container"
                      >Hoy</span
                    >
                  }
                </span>
                <button
                  type="button"
                  (click)="diaOffset.update((v) => v + 1)"
                  [disabled]="esHoy()"
                  [attr.aria-disabled]="esHoy()"
                  aria-label="Día siguiente"
                  class="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                    >chevron_right</span
                  >
                </button>
                @if (!esHoy()) {
                  <button
                    type="button"
                    (click)="diaOffset.set(0)"
                    class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-caption-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 active:scale-95"
                  >
                    Hoy
                  </button>
                }
              </div>
            </div>

            <!-- Panel de configuración de turnos -->
            @if (turnosSettingsOpen()) {
              <div
                class="overflow-hidden rounded-xl border border-primary-tint-25 bg-primary-tint-08 p-4 shadow-sm"
              >
                <div class="mb-3 flex items-center justify-between">
                  <p
                    class="text-caption-xs font-semibold uppercase tracking-[0.12em] text-slate-600"
                  >
                    Configurar horarios
                  </p>
                  <div
                    class="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-caption-xs font-bold"
                    role="group"
                    aria-label="Cantidad de turnos"
                  >
                    <button
                      type="button"
                      (click)="numTurnos.set(2)"
                      class="px-3 py-1.5 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      [class]="
                        numTurnos() === 2
                          ? 'bg-primary text-white'
                          : 'text-slate-500 hover:bg-slate-50'
                      "
                      [attr.aria-pressed]="numTurnos() === 2"
                    >
                      2 turnos
                    </button>
                    <button
                      type="button"
                      (click)="numTurnos.set(3)"
                      class="px-3 py-1.5 transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      [class]="
                        numTurnos() === 3
                          ? 'bg-primary text-white'
                          : 'text-slate-500 hover:bg-slate-50'
                      "
                      [attr.aria-pressed]="numTurnos() === 3"
                    >
                      3 turnos
                    </button>
                  </div>
                </div>
                <div
                  class="grid items-center gap-x-2 gap-y-1.5"
                  style="grid-template-columns: 8px 1fr 82px 82px"
                >
                  <span></span>
                  <span
                    class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                    >Nombre</span
                  >
                  <span
                    class="text-center text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                    >Inicio</span
                  >
                  <span
                    class="text-center text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                    >Fin</span
                  >
                  @for (t of turnosConfig().slice(0, numTurnos()); track t.nombre; let i = $index) {
                    <span class="h-2 w-2 rounded-full" [class]="turnoDot(i)"></span>
                    <input
                      type="text"
                      [value]="t.nombre"
                      (change)="updateTurnoConfig(i, 'nombre', $any($event.target).value)"
                      [attr.aria-label]="'Nombre del turno ' + (i + 1)"
                      class="h-8 rounded-lg border border-slate-200 bg-white px-3 text-caption font-semibold text-slate-700 outline-none focus:border-primary-tint-55 focus:ring-1 focus:ring-primary-tint-20"
                    />
                    <input
                      type="time"
                      [value]="t.inicio"
                      (change)="updateTurnoConfig(i, 'inicio', $any($event.target).value)"
                      [attr.aria-label]="'Hora de inicio del turno ' + (i + 1)"
                      class="h-8 rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-caption-xs text-slate-700 outline-none focus:border-primary-tint-55 focus:ring-1 focus:ring-primary-tint-20"
                    />
                    <input
                      type="time"
                      [value]="t.fin"
                      (change)="updateTurnoConfig(i, 'fin', $any($event.target).value)"
                      [attr.aria-label]="'Hora de fin del turno ' + (i + 1)"
                      class="h-8 rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-caption-xs text-slate-700 outline-none focus:border-primary-tint-55 focus:ring-1 focus:ring-primary-tint-20"
                    />
                  }
                </div>
                <button
                  type="button"
                  (click)="turnosSettingsOpen.set(false)"
                  class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-95"
                >
                  <span class="material-symbols-outlined text-[14px]" aria-hidden="true">check</span>
                  Listo
                </button>
              </div>
            }

            <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
              @for (turno of turnosReal(); track turno.nombre; let i = $index) {
                @if (turno.esTotal) {
                  <div
                    class="rounded-2xl border border-primary-tint-30 bg-white p-4 shadow-[0_0_0_1px_rgba(13,175,189,0.04),0_2px_8px_rgba(13,175,189,0.06)]"
                  >
                    <p
                      class="text-caption-xs font-semibold uppercase tracking-widest text-primary-container"
                    >
                      {{ turno.nombre }}
                    </p>
                    <p class="mt-0.5 text-caption-xs text-on-surface-variant">
                      {{ turno.horario }}
                    </p>
                    <p class="mt-3 font-mono text-h3 font-semibold text-on-surface">
                      {{ formatTurnoConsumo(turno.consumo)
                      }}<span class="ml-1 text-body-sm font-bold text-on-surface-muted">m³</span>
                    </p>
                    <div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                      <div class="h-full w-full rounded-full bg-primary"></div>
                    </div>
                  </div>
                } @else if (turno.activo) {
                  <div class="rounded-2xl border p-4 shadow-sm" [class]="turnoActivoClass(i)">
                    <div class="flex items-start justify-between gap-1">
                      <div>
                        <p
                          class="text-caption-xs font-semibold uppercase tracking-widest"
                          [class]="turnoActivoLabelClass(i)"
                        >
                          {{ turno.nombre }}
                        </p>
                        <p class="mt-0.5 text-caption-xs" [class]="turnoActivoSubLabelClass(i)">
                          {{ turno.horario }}
                        </p>
                      </div>
                      <button
                        type="button"
                        class="flex h-6 w-6 items-center justify-center rounded-lg bg-white/60 text-slate-600 transition-colors hover:bg-white active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label="Descargar datos del turno"
                      >
                        <span class="material-symbols-outlined text-[13px]" aria-hidden="true"
                          >download</span
                        >
                      </button>
                    </div>
                    <p
                      class="mt-3 font-mono text-h3 font-semibold"
                      [class]="turnoActivoValueClass(i)"
                    >
                      {{ formatTurnoConsumo(turno.consumo)
                      }}<span
                        class="ml-1 text-body-sm font-bold"
                        [class]="turnoActivoSubLabelClass(i)"
                        >m³</span
                      >
                    </p>
                  </div>
                } @else {
                  <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 opacity-60">
                    <p
                      class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                    >
                      {{ turno.nombre }}
                    </p>
                    <p class="mt-0.5 text-caption-xs text-slate-500">{{ turno.horario }}</p>
                    <p class="mt-3 text-body-sm font-bold text-slate-500">No iniciado</p>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Distribución lateral (solo xl) -->
          <section
            class="hidden xl:flex w-52 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p class="mb-3 text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Distribución
            </p>
            <div class="flex flex-1 flex-col justify-center gap-3">
              @for (d of distribucionReal(); track d.nombre) {
                <div>
                  <div class="mb-1 flex items-center justify-between gap-1">
                    <span class="text-caption-xs font-semibold text-slate-600">{{ d.nombre }}</span>
                    <span class="font-mono text-caption-xs text-slate-500">{{ d.pct }}%</span>
                  </div>
                  <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      class="h-full rounded-full transition-[width]"
                      [class]="d.barClass"
                      [style.width]="d.pct + '%'"
                    ></div>
                  </div>
                  <p class="mt-0.5 text-right font-mono text-caption-xs text-slate-500">
                    {{ formatTurnoConsumo(d.consumo) }} m³
                  </p>
                </div>
              }
            </div>
          </section>
        </div>

        <!-- Distribución móvil (solo < xl) -->
        <section class="xl:hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Distribución de consumo por turno
            </h3>
            <span class="text-caption-xs font-semibold text-slate-500">% del total diario</span>
          </div>
          <div class="space-y-3">
            @for (d of distribucionReal(); track d.nombre) {
              <div class="flex items-center gap-3">
                <span class="w-14 shrink-0 text-caption font-semibold text-slate-600">{{
                  d.nombre
                }}</span>
                <div class="flex-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    class="h-full rounded-full transition-[width]"
                    [class]="d.barClass"
                    [style.width]="d.pct + '%'"
                  ></div>
                </div>
                <span class="w-8 shrink-0 text-right font-mono text-caption-xs text-slate-500"
                  >{{ d.pct }}%</span
                >
                <span class="w-16 shrink-0 text-right font-mono text-caption-xs text-slate-500"
                  >{{ formatTurnoConsumo(d.consumo) }} m³</span
                >
              </div>
            }
          </div>
        </section>

        <!-- Sparkline caudal real-time -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-body-sm font-semibold text-slate-800">
              Caudal en <span class="text-primary-container">Tiempo Real</span>
            </h3>
            <span class="text-caption-xs font-semibold text-slate-500"
              >Últimos {{ realtimePoints().length }} registros</span
            >
          </div>
          <div class="relative h-28 w-full">
            <svg
              viewBox="0 0 1120 80"
              class="h-full w-full cursor-crosshair select-none"
              preserveAspectRatio="none"
              (mousemove)="selectRealtimePoint($event)"
              (mouseleave)="clearRealtimePoint()"
              aria-label="Gráfico de caudal en tiempo real"
            >
              <defs>
                <linearGradient id="rtFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#0DAFBD" stop-opacity="0.22" />
                  <stop offset="100%" stop-color="#0DAFBD" stop-opacity="0.02" />
                </linearGradient>
              </defs>
              <polygon [attr.points]="chartFill(realtimePoints())" fill="url(#rtFill)" />
              @if (selectedRealtimePoint(); as point) {
                <line
                  [attr.x1]="point.x"
                  [attr.x2]="point.x"
                  y1="6"
                  y2="74"
                  stroke="#CBD5E1"
                  stroke-width="1.5"
                  stroke-dasharray="5 5"
                />
              }
              <polyline
                [attr.points]="chartPolyline(realtimePoints())"
                fill="none"
                stroke="#0DAFBD"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              @if (selectedRealtimePoint(); as point) {
                <circle
                  [attr.cx]="point.x"
                  [attr.cy]="point.y"
                  r="5"
                  fill="#ffffff"
                  stroke="#0DAFBD"
                  stroke-width="3"
                />
              }
            </svg>

            @if (selectedRealtimePoint(); as point) {
              <div
                class="pointer-events-none absolute z-10 min-w-[190px] rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-body-sm shadow-xl ring-1 ring-slate-900/5"
                [style.left.%]="tooltipLeftPercent(point)"
                [style.top.%]="tooltipTopPercent(point)"
                [style.transform]="tooltipTransform(point)"
              >
                <p class="text-body-sm font-semibold text-slate-600">{{ point.dateLabel }}</p>
                <div class="mt-2 flex items-center gap-2 text-slate-600">
                  <span class="h-2.5 w-2.5 rounded-full bg-primary"></span>
                  <span class="font-semibold">Caudal (L/s)</span>
                  <span class="ml-auto font-semibold text-slate-800">{{ point.caudalLabel }}</span>
                </div>
              </div>
            }
          </div>
          <div class="mt-1 flex justify-between font-mono text-caption-xs text-slate-400">
            @for (label of realtimeChartLabels(); track $index) {
              <span>{{ label }}</span>
            }
          </div>
        </section>
      }

      <!-- Histórico -->
      @if (modo() === 'historico') {
        <app-operacion-graficos-historicos />
      }

      <!-- Resumen por período -->
      @if (modo() === 'resumen') {
        <app-operacion-resumen-periodo />
      }
    </div>
  `,
})
export class WaterDetailOperacionComponent implements OnInit, OnDestroy {
  private readonly state = inject(WaterOperacionStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly companyService = inject(CompanyService);
  private pollingSub?: Subscription;
  private dayHistorySub?: Subscription;
  private readonly CHILE_TIME_ZONE = CHILE_TIME_ZONE;
  // Bundle realtime (hoy operativo) usa 1500 buckets ≈ 25h: cubre jornada
  // completa (24h máx) + margen. Para queries con range (días no actuales)
  // se usa `historyRangeLimit` que cubre 2 días + cross-midnight.
  private readonly historyLimit = 1500;
  private readonly historyRangeLimit = 2500;
  private readonly chartWidth = 1120;
  private readonly chartHeight = 74;

  readonly modo = signal<OperacionModo>('hoy');
  readonly turnosSettingsOpen = signal(false);
  readonly dashboardData = signal<DashboardData | null>(null);
  // `historyRows` SIEMPRE contiene datos realtime (hoy operativo) traídos del
  // bundle. Drive sparkline + métricas top + último timestamp. Aunque el
  // operador navegue a un día anterior, este signal NO se sobrescribe —
  // mantenemos la lectura de caudal/nivel/totalizador en tiempo real.
  readonly historyRows = this.state.historyRows;
  // Local: filas históricas del día seleccionado cuando el operador navegó
  // con las flechas a un día distinto de hoy. Solo se usa para calcular las
  // cards de turno + Total del Día.
  readonly dayHistoryRows = signal<HistoricalRow[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');
  readonly selectedRealtimeTimestamp = signal<number | null>(null);

  readonly diaOffset = this.state.diaOffset;
  readonly numTurnos = this.state.numTurnos;
  readonly turnosConfig = this.state.turnosConfig;
  readonly jornadaInicio = this.state.jornadaInicio;

  // Wall-clock tick: refresca cada 60s para que selectedDayKey rote sola al
  // cambiar de jornada operativa (ej. medianoche / 07:00) sin esperar a que
  // llegue telemetría nueva.
  private readonly nowTick = signal(Date.now());
  private nowTickSub?: Subscription;

  // Observable de selectedDayKey para acoplar al fetch de history: cuando el
  // operador cambia de día con las flechas debemos re-fetchear historicos con
  // el rango correcto (no quedarnos con la ventana realtime de ~36h).
  // toObservable requiere injection context → capturado en field init.
  // Wrap en computed para defer la lectura del field `selectedDayKey` (que se
  // inicializa más abajo) hasta el momento de subscripción.
  private readonly selectedDayKey$ = toObservable(computed(() => this.selectedDayKey()));

  readonly latestTelemetryDate = computed(() => {
    const latest = this.dashboardData()?.ultima_lectura;
    const raw = latest?.timestamp_completo || latest?.time || latest?.received_at || '';
    const parsed = this.parseDate(raw);
    if (parsed) return parsed;

    const row = this.historyRows().find((item) => item.timestampMs !== null);
    return row?.timestampMs ? new Date(row.timestampMs) : null;
  });

  // Ancla "día operativo actual": si la jornada arranca a las 07:00, una hora
  // del muro 02:00 todavía pertenece a la jornada del día calendario anterior.
  // Restamos el offset de inicio de jornada al wall-clock antes de calcular el
  // dayKey en TZ Chile.
  readonly currentJornadaDayKey = computed(() => {
    const jornadaStartMin = this.parseTimeMinutes(this.jornadaInicio() || '00:00');
    const offsetMs = jornadaStartMin * 60_000;
    return this.chileDayKey(new Date(this.nowTick() - offsetMs));
  });

  readonly selectedDayKey = computed(() =>
    this.addDayKey(this.currentJornadaDayKey(), this.diaOffset()),
  );

  // Date sintética (UTC mediodía) para labels: en TZ Chile (UTC-3/-4) sigue
  // siendo el mismo día calendario que el dayKey, evita flips de zona horaria.
  readonly selectedOperationDate = computed(() => {
    const [year, month, day] = this.selectedDayKey().split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 12));
  });

  /**
   * Filas históricas usadas para calcular cards de turno + Total del Día.
   * Si el día seleccionado es hoy operativo → usa `historyRows` (realtime que
   * ya pollea el bundle). Si es otro día → usa `dayHistoryRows` que se llena
   * con la query de range cuando el operador navega con las flechas. Así el
   * "Caudal Actual" del banner top + sparkline + última lectura SIEMPRE
   * reflejan el momento presente, sin contaminarse con datos antiguos.
   */
  private readonly effectiveDayRows = computed<HistoricalRow[]>(() =>
    this.selectedDayKey() === this.currentJornadaDayKey()
      ? this.historyRows()
      : this.dayHistoryRows(),
  );

  readonly metricas = computed<MetricaTiempoReal[]>(() => {
    const caudal = this.dashboardNumber('caudal') ?? this.latestHistoryNumber('caudal');
    const totalizador =
      this.dashboardNumber('totalizador') ?? this.latestHistoryNumber('totalizador');
    const nivel =
      this.dashboardNumber('nivel') ??
      this.latestHistoryNumber('nivel') ??
      this.latestHistoryNumber('nivelFreatico');
    const consumoHoy = this.totalDayConsumption();

    return [
      { label: 'Caudal Actual', valor: this.formatNumber(caudal, 2), unidad: 'L/s' },
      { label: 'Totalizador', valor: this.formatNumber(totalizador, 0), unidad: 'm³' },
      { label: 'Nivel de Agua', valor: this.formatNumber(nivel, 2), unidad: 'm' },
      { label: 'Consumo Hoy', valor: this.formatNumber(consumoHoy, 1), unidad: 'm³' },
    ];
  });

  readonly realtimeChartRows = computed(() =>
    this.historyRows()
      .filter((row) => row.timestampMs !== null && row.caudal !== null)
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
      .slice(-60),
  );

  readonly realtimePoints = computed(() => {
    const points = this.realtimeChartRows().map((row) => row.caudal ?? 0);
    return points.length ? points : [0, 0];
  });

  readonly realtimeChartPoints = computed<RealtimeChartPoint[]>(() => {
    const rows = this.realtimeChartRows();
    if (!rows.length) return [];

    const values = rows.map((row) => row.caudal ?? 0);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = rows.length > 1 ? this.chartWidth / (rows.length - 1) : 0;

    return rows
      .filter(
        (row): row is HistoricalRow & { timestampMs: number; caudal: number } =>
          row.timestampMs !== null && row.caudal !== null,
      )
      .map((row, index) => {
        const x = rows.length > 1 ? index * step : this.chartWidth / 2;
        const y = this.chartHeight - ((row.caudal - min) / range) * (this.chartHeight - 10);
        return {
          timestampMs: row.timestampMs,
          caudal: row.caudal,
          x,
          y,
          xPct: (x / this.chartWidth) * 100,
          yPct: (y / 80) * 100,
          dateLabel: this.formatChileChartDate(row.timestampMs),
          caudalLabel: this.formatNumber(row.caudal, 1),
        };
      });
  });

  readonly selectedRealtimePoint = computed(() => {
    const timestamp = this.selectedRealtimeTimestamp();
    if (timestamp === null) return null;
    return this.realtimeChartPoints().find((point) => point.timestampMs === timestamp) ?? null;
  });

  readonly realtimeChartLabels = computed(() => {
    const rows = this.realtimeChartRows();
    if (!rows.length) return ['--', '--', '--', '--', '--'];

    return [0, 0.25, 0.5, 0.75, 1].map((pct) => {
      const index = Math.round((rows.length - 1) * pct);
      return this.formatChileTime(rows[index]?.timestampMs ?? null);
    });
  });

  readonly latestTimestampLabel = computed(() => {
    const latest = this.latestTelemetryDate();
    return latest ? this.formatChileDateTime(latest) : 'Sin registros';
  });

  private readonly barClasses = ['bg-primary', 'bg-primary-container', 'bg-slate-400'];

  // Cards de turno + Total del Día. Cada card calcula su consumo desde
  // `rowsForShift`, que ya maneja cruce de medianoche (ej. 23:00→06:59 atraviesa
  // a `dayKey + 1`). Total del Día = suma de turnos para garantizar
  // consistencia matemática (suma turnos == total mostrado), incluso cuando la
  // jornada operativa no coincide con el día calendario.
  readonly turnosReal = computed<TurnoCard[]>(() => {
    const cfg = this.turnosConfig().slice(0, this.numTurnos());
    const selectedDay = this.selectedDayKey();
    const cards: TurnoCard[] = cfg.map((c) => {
      const rows = this.rowsForShift(selectedDay, c.inicio, c.fin);
      const consumo = this.consumptionFromTotalizer(rows);
      return {
        nombre: c.nombre,
        horario: this.formatTurnoHorario(c.inicio, c.fin),
        consumo,
        activo: rows.length > 0,
      };
    });

    const totalTurnos = cards.reduce((acc, t) => acc + (t.consumo ?? 0), 0);
    cards.push({
      nombre: 'Total del Día',
      horario: this.formatJornadaHorario(),
      consumo: totalTurnos,
      activo: true,
      esTotal: true,
    });
    return cards;
  });

  readonly totalDayConsumption = computed(
    () => this.turnosReal().find((t) => t.esTotal)?.consumo ?? 0,
  );

  readonly distribucionReal = computed<TurnoDistribucion[]>(() => {
    const turnos = this.turnosReal().filter((turno) => !turno.esTotal);
    const total = turnos.reduce((sum, turno) => sum + (turno.consumo ?? 0), 0);

    return turnos.map((turno, i) => {
      const consumo = turno.consumo ?? 0;
      return {
        nombre: turno.nombre,
        consumo,
        pct: total > 0 ? Math.round((consumo / total) * 100) : 0,
        barClass: this.barClasses[i] ?? 'bg-slate-400',
      };
    });
  });

  readonly fechaDiaReal = computed(() =>
    this.selectedOperationDate().toLocaleDateString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: this.CHILE_TIME_ZONE,
    }),
  );

  readonly esHoy = computed(() => this.diaOffset() === 0);

  ngOnInit(): void {
    const siteId = this.resolveSiteId();
    if (!siteId) {
      this.loadError.set('No se encontró el sitio actual.');
      return;
    }

    this.state.startCountersPolling(siteId);
    this.startPolling(siteId);
    this.nowTickSub = timer(60_000, 60_000).subscribe(() => this.nowTick.set(Date.now()));
  }

  ngOnDestroy(): void {
    this.pollingSub?.unsubscribe();
    this.dayHistorySub?.unsubscribe();
    this.nowTickSub?.unsubscribe();
    this.state.stopCountersPolling();
  }

  /** User-triggered retry when the load banner is showing. Unsubscribes the
   * current timer (which may still be ticking against a dead siteId) and
   * starts a fresh one immediately. */
  retryLoad(): void {
    const siteId = this.resolveSiteId();
    if (!siteId) {
      this.loadError.set('No se encontró el sitio actual.');
      return;
    }
    this.pollingSub?.unsubscribe();
    this.dayHistorySub?.unsubscribe();
    this.loadError.set('');
    this.startPolling(siteId);
  }

  private startPolling(siteId: string): void {
    this.loading.set(true);

    // Poll A: realtime SIEMPRE. Cada 60s pide bundle (dashboard + history).
    // Mantiene actualizado: caudal actual, totalizador, nivel, sparkline,
    // último timestamp, "Consumo Hoy" (cuando hoy operativo está seleccionado).
    // Independiente del día navegado por el operador.
    this.pollingSub = timer(0, 60000)
      .pipe(
        switchMap(() =>
          this.companyService.getSiteOperacionBundle(siteId, this.historyLimit).pipe(
            catchError((err) => {
              console.error('No fue posible cargar operación del pozo', err);
              this.loadError.set('No fue posible cargar datos de operación.');
              this.loading.set(false);
              return of(null);
            }),
          ),
        ),
      )
      .subscribe((res) => {
        if (!res || !res.data) return;
        const bundle = res.data;
        this.dashboardData.set(bundle.dashboard || null);
        this.historyRows.set(this.mapHistoryRows({ data: bundle.history }));
        this.loadError.set('');
        this.loading.set(false);
      });

    // Poll B: day history. Solo se dispara cuando el operador navega a un día
    // distinto de hoy operativo. Trae filas del día seleccionado (con range
    // día-1, día+1 para cubrir Turno 3 cross-midnight). Cuando vuelve a hoy
    // operativo, limpia dayHistoryRows — turnos leen historyRows directamente.
    this.dayHistorySub = this.selectedDayKey$
      .pipe(
        switchMap((dayKey) => {
          if (dayKey === this.currentJornadaDayKey()) {
            this.dayHistoryRows.set([]);
            return of(null);
          }
          this.loading.set(true);
          const range = { from: this.addDayKey(dayKey, -1), to: this.addDayKey(dayKey, 1) };
          return this.companyService
            .getSiteDashboardHistory(siteId, this.historyRangeLimit, range)
            .pipe(
              catchError((err) => {
                console.error('No fue posible cargar histórico del día', err);
                this.loadError.set('No fue posible cargar datos del día seleccionado.');
                this.loading.set(false);
                return of(null);
              }),
            );
        }),
      )
      .subscribe((res) => {
        if (!res) return;
        this.dayHistoryRows.set(this.mapHistoryRows(res));
        this.loadError.set('');
        this.loading.set(false);
      });
  }

  updateTurnoConfig(index: number, field: 'nombre' | 'inicio' | 'fin', value: string): void {
    this.state.updateTurnoConfig(index, field, value);
  }

  selectRealtimePoint(event: MouseEvent): void {
    const points = this.realtimeChartPoints();
    const svg = event.currentTarget as SVGSVGElement | null;
    const rect = svg?.getBoundingClientRect();
    if (!points.length || !rect || rect.width === 0) return;

    const clickX = ((event.clientX - rect.left) / rect.width) * this.chartWidth;
    const closest = points.reduce((best, point) =>
      Math.abs(point.x - clickX) < Math.abs(best.x - clickX) ? point : best,
    );

    this.selectedRealtimeTimestamp.set(closest.timestampMs);
  }

  clearRealtimePoint(): void {
    this.selectedRealtimeTimestamp.set(null);
  }

  tooltipLeftPercent(point: RealtimeChartPoint): number {
    return Math.min(92, Math.max(8, point.xPct));
  }

  tooltipTopPercent(point: RealtimeChartPoint): number {
    return point.yPct < 38 ? Math.min(90, point.yPct + 8) : Math.max(10, point.yPct - 8);
  }

  tooltipTransform(point: RealtimeChartPoint): string {
    const x =
      point.xPct > 78
        ? 'translateX(-100%)'
        : point.xPct < 22
          ? 'translateX(0)'
          : 'translateX(-50%)';
    const y = point.yPct < 38 ? 'translateY(0)' : 'translateY(-100%)';
    return `${x} ${y}`;
  }

  chartPolyline(points: number[]): string {
    const W = this.chartWidth,
      H = this.chartHeight;
    const safePoints = points.length > 1 ? points : [points[0] ?? 0, points[0] ?? 0];
    const min = Math.min(...safePoints),
      max = Math.max(...safePoints);
    const range = max - min || 1;
    const step = W / (safePoints.length - 1);
    return safePoints.map((v, i) => `${i * step},${H - ((v - min) / range) * (H - 10)}`).join(' ');
  }

  chartFill(points: number[]): string {
    const W = this.chartWidth,
      H = this.chartHeight;
    const safePoints = points.length > 1 ? points : [points[0] ?? 0, points[0] ?? 0];
    const min = Math.min(...safePoints),
      max = Math.max(...safePoints);
    const range = max - min || 1;
    const step = W / (safePoints.length - 1);
    const coords = safePoints
      .map((v, i) => `${i * step},${H - ((v - min) / range) * (H - 10)}`)
      .join(' ');
    return `0,${H} ${coords} ${(safePoints.length - 1) * step},${H}`;
  }

  /**
   * Active turno styling. Different turno indices get different semantic
   * colour roles so an operator can scan which shift is running. We avoid
   * gradients — solid tinted background + colored text matches the rest
   * of the design system.
   */
  turnoActivoClass(index: number): string {
    if (index === 0) return 'border-primary-tint-35 bg-primary-tint-10';
    if (index === 1) return 'border-emerald-200 bg-emerald-50';
    return 'border-slate-200 bg-slate-50';
  }

  turnoActivoLabelClass(index: number): string {
    if (index === 0) return 'text-primary-container';
    if (index === 1) return 'text-emerald-700';
    return 'text-slate-600';
  }

  turnoActivoSubLabelClass(index: number): string {
    if (index === 0) return 'text-primary-container/70';
    if (index === 1) return 'text-emerald-700/70';
    return 'text-slate-500';
  }

  turnoActivoValueClass(index: number): string {
    if (index === 0) return 'text-primary-container';
    if (index === 1) return 'text-emerald-700';
    return 'text-slate-800';
  }

  turnoDot(index: number): string {
    return this.barClasses[index] ?? 'bg-slate-400';
  }

  /**
   * Roving-tabindex WAI-ARIA tablist nav: ArrowLeft/Right cycle modo() and
   * Home/End jump to first/last. The active tab keeps focus through the
   * change because Angular re-applies tabindex=0 on the newly-selected
   * button after the signal update — the user keeps tabbing forward into
   * the panel naturally.
   */
  cycleModo(delta: 1 | -1): void {
    const order: OperacionModo[] = ['hoy', 'historico', 'resumen'];
    const idx = order.indexOf(this.modo());
    const nextIdx = (idx + delta + order.length) % order.length;
    this.modo.set(order[nextIdx]);
  }

  modoClass(m: OperacionModo): string {
    const active = this.modo() === m;
    return [
      'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-body-sm font-bold transition active:scale-95',
      active
        ? 'bg-primary-tint-08 text-primary-container ring-1 ring-primary-tint-30'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
    ].join(' ');
  }

  formatTurnoConsumo(value: number | null): string {
    return value === null ? '--' : this.formatNumber(value, 1);
  }

  private resolveSiteId(): string {
    let current: ActivatedRoute | null = this.route;
    while (current) {
      const siteId = current.snapshot.paramMap.get('siteId');
      if (siteId) return siteId;
      current = current.parent;
    }
    return '';
  }

  private mapHistoryRows(res: any): HistoricalRow[] {
    const rows = Array.isArray(res?.data?.rows) ? res.data.rows : [];
    return rows.map((row: HistoricalApiRow) => {
      const timestamp = this.parseDate(row.timestamp || row.fecha || '');
      return {
        timestampMs: timestamp?.getTime() ?? null,
        caudal: this.historicalNumber(row.caudal),
        nivel: this.historicalNumber(row.nivel),
        totalizador: this.historicalNumber(row.totalizador),
        nivelFreatico: this.historicalNumber(row.nivel_freatico),
      };
    });
  }

  private dashboardNumber(role: string): number | null {
    const value = this.dashboardData()?.resumen?.[role];
    if (!value || value.ok === false) return null;
    return this.toNumber(value.valor);
  }

  private latestHistoryNumber(
    field: keyof Pick<HistoricalRow, 'caudal' | 'nivel' | 'totalizador' | 'nivelFreatico'>,
  ): number | null {
    return this.historyRows().find((row) => row[field] !== null)?.[field] ?? null;
  }

  private historicalNumber(value: HistoricalValue | null | undefined): number | null {
    if (!value || value.ok === false) return null;
    return this.toNumber(value.valor);
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined) return null;

    let text = String(value).trim();
    if (!text) return null;

    if (text.includes(',') && text.includes('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else if (text.includes(',')) {
      text = text.replace(',', '.');
    }

    const parsed = Number(text.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private formatNumber(value: number | null, decimals: number): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '--';
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private formatChileDateTime(value: Date): string {
    return value.toLocaleString('es-CL', {
      timeZone: this.CHILE_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private formatChileTime(timestampMs: number | null): string {
    if (timestampMs === null) return '--';
    return new Date(timestampMs).toLocaleTimeString('es-CL', {
      timeZone: this.CHILE_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private formatChileChartDate(timestampMs: number): string {
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: this.CHILE_TIME_ZONE,
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(timestampMs));
    const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
    const month = part('month');
    const monthLabel = month ? `${month.charAt(0).toUpperCase()}${month.slice(1)}` : '';
    return `${Number(part('day'))} ${monthLabel} ${part('year')} ${part('hour')}:${part('minute')}`;
  }

  private chileDayKey(value: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.CHILE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private chileMinuteOfDay(timestampMs: number): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.CHILE_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(new Date(timestampMs));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value || 0);
    return part('hour') * 60 + part('minute');
  }

  private addDayKey(dayKey: string, days: number): string {
    const [year, month, day] = dayKey.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private parseTimeMinutes(value: string): number {
    const [hour = '0', minute = '0'] = value.split(':');
    return Number(hour) * 60 + Number(minute);
  }

  /**
   * Label del horario de un turno. Cuando el turno cruza la medianoche
   * calendario (ej. 23:00 → 06:59), agregamos sufijo "(día sig.)" para que el
   * operador entienda que la franja termina al día siguiente del seleccionado.
   */
  private formatTurnoHorario(start: string, end: string): string {
    const startMin = this.parseTimeMinutes(start);
    const endMin = this.parseTimeMinutes(end);
    return startMin <= endMin ? `${start} – ${end}` : `${start} – ${end} (día sig.)`;
  }

  /**
   * Label de la jornada completa (Total del Día). Si jornadaInicio == jornadaFin
   * se interpreta como cobertura 24h. Si difieren, mostramos el rango horario
   * tal como está configurado en el sitio.
   */
  private formatJornadaHorario(): string {
    const inicio = this.state.jornadaInicio() || '07:00';
    const fin = this.state.jornadaFin() || '07:00';
    return inicio === fin ? '24 horas' : `${inicio} – ${fin}`;
  }

  private rowsForDay(dayKey: string): HistoricalRow[] {
    return this.effectiveDayRows()
      .filter(
        (row) => row.timestampMs !== null && this.chileDayKey(new Date(row.timestampMs)) === dayKey,
      )
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  }

  private rowsForShift(dayKey: string, start: string, end: string): HistoricalRow[] {
    const startMin = this.parseTimeMinutes(start);
    const endMin = this.parseTimeMinutes(end);
    const nextDayKey = this.addDayKey(dayKey, 1);

    return this.effectiveDayRows()
      .filter((row) => {
        if (row.timestampMs === null) return false;
        const rowDayKey = this.chileDayKey(new Date(row.timestampMs));
        const minute = this.chileMinuteOfDay(row.timestampMs);

        if (startMin <= endMin) {
          return rowDayKey === dayKey && minute >= startMin && minute <= endMin;
        }

        return (
          (rowDayKey === dayKey && minute >= startMin) ||
          (rowDayKey === nextDayKey && minute <= endMin)
        );
      })
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  }

  private consumptionFromTotalizer(rows: HistoricalRow[]): number | null {
    const values = rows
      .filter((row) => row.totalizador !== null)
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0))
      .map((row) => row.totalizador as number);

    if (values.length < 2) return values.length === 1 ? 0 : null;
    return Math.max(0, values[values.length - 1] - values[0]);
  }
}
