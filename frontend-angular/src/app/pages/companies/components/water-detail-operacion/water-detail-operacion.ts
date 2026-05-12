import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { catchError, forkJoin, of, Subscription, switchMap, timer } from 'rxjs';
import { CompanyService } from '../../../../services/company.service';
import { OperacionGraficosHistoricosComponent } from './operacion-graficos-historicos';
import { OperacionResumenPeriodoComponent } from './operacion-resumen-periodo';
import { WaterOperacionStateService } from './water-operacion-state';

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

interface HistoricalRow {
  timestampMs: number | null;
  caudal: number | null;
  nivel: number | null;
  totalizador: number | null;
  nivelFreatico: number | null;
}

@Component({
  selector: 'app-water-detail-operacion',
  standalone: true,
  imports: [CommonModule, OperacionGraficosHistoricosComponent, OperacionResumenPeriodoComponent],
  providers: [WaterOperacionStateService],
  template: `
    <div class="space-y-3">
      <!-- Toggle de modo -->
      <nav
        class="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-2 shadow-sm"
        aria-label="Selector de modo de operación"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          (click)="modo.set('hoy')"
          [class]="modoClass('hoy')"
          [attr.aria-selected]="modo() === 'hoy'"
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
        >
          <span class="material-symbols-outlined text-[17px]" aria-hidden="true"
            >calendar_view_month</span
          >
          Resumen por Período
        </button>
        <p class="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-400">
          <span class="material-symbols-outlined text-[14px]">info</span>
          Puede presentar desfases momentáneos
        </p>
      </nav>

      <!-- Hoy en tiempo real (fusión realtime + turnos) -->
      @if (modo() === 'hoy') {
        <!-- Banner tiempo real -->
        <div
          class="rounded-2xl bg-gradient-to-br from-[#04606A] via-[#0899A5] to-[#0DAFBD] p-5 text-white shadow-sm"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="font-black text-sm">Datos en tiempo real</p>
              <p class="mt-0.5 text-[11px] text-cyan-100">actualización cada minuto</p>
            </div>
            <span class="flex items-center gap-2 text-[11px] font-bold text-cyan-50">
              <span class="h-2 w-2 animate-pulse rounded-full bg-emerald-300"></span>
              {{ latestTimestampLabel() }}
            </span>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            @for (m of metricas(); track m.label) {
              <div class="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
                <p class="text-[10px] font-bold uppercase tracking-widest text-cyan-100">
                  {{ m.label }}
                </p>
                <p class="mt-1 text-2xl font-black leading-none">
                  {{ m.valor
                  }}<span class="ml-1 text-sm font-bold text-white/70">{{ m.unidad }}</span>
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
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Acumulado por turno
                </p>
                <button
                  type="button"
                  (click)="turnosSettingsOpen.update((v) => !v)"
                  class="flex h-6 w-6 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                  [class]="
                    turnosSettingsOpen()
                      ? 'bg-cyan-100 text-cyan-700'
                      : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                  "
                  aria-label="Configurar horarios de turno"
                  [attr.aria-expanded]="turnosSettingsOpen()"
                >
                  <span class="material-symbols-outlined text-[15px]">settings</span>
                </button>
              </div>
              <!-- Navegación de fecha -->
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  (click)="diaOffset.update((v) => v - 1)"
                  class="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                  aria-label="Día anterior"
                >
                  <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                    >chevron_left</span
                  >
                </button>
                <span class="flex items-center gap-1.5 text-sm font-bold text-slate-700">
                  {{ fechaDiaReal() }}
                  @if (esHoy()) {
                    <span
                      class="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-black text-cyan-700"
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
                  class="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                >
                  <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                    >chevron_right</span
                  >
                </button>
                @if (!esHoy()) {
                  <button
                    type="button"
                    (click)="diaOffset.set(0)"
                    class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Hoy
                  </button>
                }
              </div>
            </div>

            <!-- Panel de configuración de turnos -->
            @if (turnosSettingsOpen()) {
              <div
                class="overflow-hidden rounded-xl border border-cyan-200 bg-cyan-50/60 p-4 shadow-sm"
              >
                <div class="mb-3 flex items-center justify-between">
                  <p class="text-[11px] font-black uppercase tracking-[0.12em] text-slate-600">
                    Configurar horarios
                  </p>
                  <div
                    class="flex items-center overflow-hidden rounded-lg border border-slate-200 bg-white text-[11px] font-bold"
                    role="group"
                    aria-label="Cantidad de turnos"
                  >
                    <button
                      type="button"
                      (click)="numTurnos.set(2)"
                      class="px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0DAFBD]"
                      [class]="
                        numTurnos() === 2
                          ? 'bg-cyan-600 text-white'
                          : 'text-slate-500 hover:bg-slate-50'
                      "
                      [attr.aria-pressed]="numTurnos() === 2"
                    >
                      2 turnos
                    </button>
                    <button
                      type="button"
                      (click)="numTurnos.set(3)"
                      class="px-3 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0DAFBD]"
                      [class]="
                        numTurnos() === 3
                          ? 'bg-cyan-600 text-white'
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
                  <span class="text-[10px] font-black uppercase tracking-widest text-slate-400"
                    >Nombre</span
                  >
                  <span
                    class="text-center text-[10px] font-black uppercase tracking-widest text-slate-400"
                    >Inicio</span
                  >
                  <span
                    class="text-center text-[10px] font-black uppercase tracking-widest text-slate-400"
                    >Fin</span
                  >
                  @for (t of turnosConfig().slice(0, numTurnos()); track t.nombre; let i = $index) {
                    <span class="h-2 w-2 rounded-full" [class]="turnoDot(i)"></span>
                    <input
                      type="text"
                      [value]="t.nombre"
                      (change)="updateTurnoConfig(i, 'nombre', $any($event.target).value)"
                      class="h-8 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                    />
                    <input
                      type="time"
                      [value]="t.inicio"
                      (change)="updateTurnoConfig(i, 'inicio', $any($event.target).value)"
                      class="h-8 rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-[11px] text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                    />
                    <input
                      type="time"
                      [value]="t.fin"
                      (change)="updateTurnoConfig(i, 'fin', $any($event.target).value)"
                      class="h-8 rounded-lg border border-slate-200 bg-white px-1 text-center font-mono text-[11px] text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                    />
                  }
                </div>
                <button
                  type="button"
                  (click)="turnosSettingsOpen.set(false)"
                  class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-cyan-700"
                >
                  <span class="material-symbols-outlined text-[14px]">check</span>
                  Listo
                </button>
              </div>
            }

            <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
              @for (turno of turnosReal(); track turno.nombre; let i = $index) {
                @if (turno.esTotal) {
                  <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {{ turno.nombre }}
                    </p>
                    <p class="mt-0.5 text-[10px] text-slate-400">{{ turno.horario }}</p>
                    <p class="mt-3 font-mono text-3xl font-black text-slate-800">
                      {{ formatTurnoConsumo(turno.consumo)
                      }}<span class="ml-1 text-sm font-bold text-slate-400">m³</span>
                    </p>
                    <div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        class="h-full w-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500"
                      ></div>
                    </div>
                  </div>
                } @else if (turno.activo) {
                  <div class="rounded-2xl p-4 shadow-sm" [class]="turnoGradiente(i)">
                    <div class="flex items-start justify-between gap-1">
                      <div>
                        <p class="text-[10px] font-black uppercase tracking-widest text-white/80">
                          {{ turno.nombre }}
                        </p>
                        <p class="mt-0.5 text-[10px] text-white/50">{{ turno.horario }}</p>
                      </div>
                      <button
                        type="button"
                        class="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 text-white/70 hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                        aria-label="Descargar datos del turno"
                      >
                        <span class="material-symbols-outlined text-[13px]" aria-hidden="true"
                          >download</span
                        >
                      </button>
                    </div>
                    <p class="mt-3 font-mono text-3xl font-black text-white">
                      {{ formatTurnoConsumo(turno.consumo)
                      }}<span class="ml-1 text-base font-bold text-white/60">m³</span>
                    </p>
                  </div>
                } @else {
                  <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 opacity-60">
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      {{ turno.nombre }}
                    </p>
                    <p class="mt-0.5 text-[10px] text-slate-400">{{ turno.horario }}</p>
                    <p class="mt-3 text-sm font-bold text-slate-400">No iniciado</p>
                  </div>
                }
              }
            </div>
          </div>

          <!-- Distribución lateral (solo xl) -->
          <section
            class="hidden xl:flex w-52 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <p class="mb-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
              Distribución
            </p>
            <div class="flex flex-1 flex-col justify-center gap-3">
              @for (d of distribucionReal(); track d.nombre) {
                <div>
                  <div class="mb-1 flex items-center justify-between gap-1">
                    <span class="text-[11px] font-semibold text-slate-600">{{ d.nombre }}</span>
                    <span class="font-mono text-[11px] text-slate-500">{{ d.pct }}%</span>
                  </div>
                  <div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      class="h-full rounded-full transition-all"
                      [class]="d.barClass"
                      [style.width]="d.pct + '%'"
                    ></div>
                  </div>
                  <p class="mt-0.5 text-right font-mono text-[10px] text-slate-400">
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
            <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Distribución de consumo por turno
            </h3>
            <span class="text-[11px] font-semibold text-slate-400">% del total diario</span>
          </div>
          <div class="space-y-3">
            @for (d of distribucionReal(); track d.nombre) {
              <div class="flex items-center gap-3">
                <span class="w-14 shrink-0 text-[12px] font-semibold text-slate-600">{{
                  d.nombre
                }}</span>
                <div class="flex-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    class="h-full rounded-full transition-all"
                    [class]="d.barClass"
                    [style.width]="d.pct + '%'"
                  ></div>
                </div>
                <span class="w-8 shrink-0 text-right font-mono text-[11px] text-slate-500"
                  >{{ d.pct }}%</span
                >
                <span class="w-16 shrink-0 text-right font-mono text-[11px] text-slate-500"
                  >{{ formatTurnoConsumo(d.consumo) }} m³</span
                >
              </div>
            }
          </div>
        </section>

        <!-- Sparkline caudal real-time -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-sm font-black text-slate-800">
              Caudal en <span class="text-cyan-600">Tiempo Real</span>
            </h3>
            <span class="text-[11px] font-semibold text-slate-400"
              >Últimos {{ realtimePoints().length }} registros</span
            >
          </div>
          <div class="h-20 w-full">
            <svg viewBox="0 0 1120 80" class="h-full w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="rtFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#0DAFBD" stop-opacity="0.22" />
                  <stop offset="100%" stop-color="#0DAFBD" stop-opacity="0.02" />
                </linearGradient>
              </defs>
              <polygon [attr.points]="chartFill(realtimePoints())" fill="url(#rtFill)" />
              <polyline
                [attr.points]="chartPolyline(realtimePoints())"
                fill="none"
                stroke="#0DAFBD"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div class="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
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
  private readonly CHILE_TIME_ZONE = 'America/Santiago';
  private readonly historyLimit = 2200;

  readonly modo = signal<OperacionModo>('hoy');
  readonly turnosSettingsOpen = signal(false);
  readonly dashboardData = signal<DashboardData | null>(null);
  readonly historyRows = signal<HistoricalRow[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal('');

  readonly diaOffset = this.state.diaOffset;
  readonly numTurnos = this.state.numTurnos;
  readonly turnosConfig = this.state.turnosConfig;

  readonly latestTelemetryDate = computed(() => {
    const latest = this.dashboardData()?.ultima_lectura;
    const raw = latest?.timestamp_completo || latest?.time || latest?.received_at || '';
    const parsed = this.parseDate(raw);
    if (parsed) return parsed;

    const row = this.historyRows().find((item) => item.timestampMs !== null);
    return row?.timestampMs ? new Date(row.timestampMs) : null;
  });

  readonly selectedOperationDate = computed(() => {
    const base = this.latestTelemetryDate() ?? new Date();
    const date = new Date(base);
    date.setDate(date.getDate() + this.diaOffset());
    return date;
  });

  readonly selectedDayKey = computed(() => this.chileDayKey(this.selectedOperationDate()));

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
      .slice(-20),
  );

  readonly realtimePoints = computed(() => {
    const points = this.realtimeChartRows().map((row) => row.caudal ?? 0);
    return points.length ? points : [0, 0];
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

  readonly totalDayConsumption = computed(() => {
    const rows = this.rowsForDay(this.selectedDayKey());
    return this.consumptionFromTotalizer(rows) ?? 0;
  });
  private readonly barClasses = ['bg-cyan-500', 'bg-emerald-500', 'bg-slate-400'];
  private readonly HOY = new Date();
  private readonly mockConsumo: (number | null)[] = [14.2, 10.6, null];
  private readonly mockPct = [57, 43, 0];

  readonly turnosReal = computed<TurnoCard[]>(() => {
    const cfg = this.turnosConfig().slice(0, this.numTurnos());
    const selectedDay = this.selectedDayKey();
    const cards: TurnoCard[] = cfg.map((c) => {
      const rows = this.rowsForShift(selectedDay, c.inicio, c.fin);
      const consumo = this.consumptionFromTotalizer(rows);
      return {
        nombre: c.nombre,
        horario: `${c.inicio} – ${c.fin}`,
        consumo,
        activo: rows.length > 0,
      };
    });

    cards.push({
      nombre: 'Total del Día',
      horario: '24 horas',
      consumo: this.totalDayConsumption(),
      activo: true,
      esTotal: true,
    });
    return cards;
  });

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

  readonly turnos = computed<TurnoCard[]>(() => {
    const cfg = this.turnosConfig().slice(0, this.numTurnos());
    const cards: TurnoCard[] = cfg.map((c, i) => ({
      nombre: c.nombre,
      horario: `${c.inicio} – ${c.fin}`,
      consumo: this.mockConsumo[i] ?? null,
      activo: this.mockConsumo[i] !== null,
    }));
    cards.push({
      nombre: 'Total del Día',
      horario: '24 horas',
      consumo: 24.8,
      activo: true,
      esTotal: true,
    });
    return cards;
  });

  readonly distribucion = computed<TurnoDistribucion[]>(() =>
    this.turnosConfig()
      .slice(0, this.numTurnos())
      .map((c, i) => ({
        nombre: c.nombre,
        consumo: this.mockConsumo[i] ?? 0,
        pct: this.mockPct[i] ?? 0,
        barClass: this.barClasses[i] ?? 'bg-slate-400',
      })),
  );

  readonly fechaDia = computed(() => {
    const d = new Date(this.HOY);
    d.setDate(d.getDate() + this.diaOffset());
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  });

  readonly esHoy = computed(() => this.diaOffset() === 0);

  ngOnInit(): void {
    const siteId = this.resolveSiteId();
    if (!siteId) {
      this.loadError.set('No se encontro el sitio actual.');
      return;
    }

    this.loading.set(true);
    this.pollingSub = timer(0, 60000)
      .pipe(
        switchMap(() =>
          forkJoin({
            dashboard: this.companyService.getSiteDashboardData(siteId),
            history: this.companyService.getSiteDashboardHistory(siteId, this.historyLimit),
          }).pipe(
            catchError((err) => {
              console.error('No fue posible cargar operacion del pozo', err);
              this.loadError.set('No fue posible cargar datos de operacion.');
              this.loading.set(false);
              return of(null);
            }),
          ),
        ),
      )
      .subscribe((res) => {
        if (!res) return;

        this.dashboardData.set(res.dashboard?.data || null);
        this.historyRows.set(this.mapHistoryRows(res.history));
        this.loadError.set('');
        this.loading.set(false);
      });
  }

  ngOnDestroy(): void {
    this.pollingSub?.unsubscribe();
  }

  updateTurnoConfig(index: number, field: 'nombre' | 'inicio' | 'fin', value: string): void {
    this.state.updateTurnoConfig(index, field, value);
  }

  chartPolyline(points: number[]): string {
    const W = 1120,
      H = 74;
    const safePoints = points.length > 1 ? points : [points[0] ?? 0, points[0] ?? 0];
    const min = Math.min(...safePoints),
      max = Math.max(...safePoints);
    const range = max - min || 1;
    const step = W / (safePoints.length - 1);
    return safePoints.map((v, i) => `${i * step},${H - ((v - min) / range) * (H - 10)}`).join(' ');
  }

  chartFill(points: number[]): string {
    const W = 1120,
      H = 74;
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

  turnoGradiente(index: number): string {
    if (index === 0) return 'bg-gradient-to-br from-[#04606A] to-[#0DAFBD]';
    if (index === 1) return 'bg-gradient-to-br from-[#065F46] to-[#22C55E]';
    return 'bg-slate-100';
  }

  turnoDot(index: number): string {
    return this.barClasses[index] ?? 'bg-slate-400';
  }

  modoClass(m: OperacionModo): string {
    const active = this.modo() === m;
    return [
      'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all',
      active
        ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
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

  private rowsForDay(dayKey: string): HistoricalRow[] {
    return this.historyRows()
      .filter(
        (row) => row.timestampMs !== null && this.chileDayKey(new Date(row.timestampMs)) === dayKey,
      )
      .sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  }

  private rowsForShift(dayKey: string, start: string, end: string): HistoricalRow[] {
    const startMin = this.parseTimeMinutes(start);
    const endMin = this.parseTimeMinutes(end);
    const nextDayKey = this.addDayKey(dayKey, 1);

    return this.historyRows()
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
