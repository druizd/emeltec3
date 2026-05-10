import { CommonModule } from '@angular/common';
import { Component, computed, signal } from '@angular/core';
import { OperacionGraficosHistoricosComponent } from './operacion-graficos-historicos';

type OperacionModo = 'realtime' | 'turnos' | 'historico';

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

@Component({
  selector: 'app-water-detail-operacion',
  standalone: true,
  imports: [CommonModule, OperacionGraficosHistoricosComponent],
  template: `
    <div class="space-y-3">

      <!-- Toggle de modo -->
      <nav class="flex flex-wrap items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-2 shadow-sm">
        <button type="button" (click)="modo.set('realtime')" [class]="modoClass('realtime')">
          <span class="material-symbols-outlined text-[17px]">sync</span>
          Tiempo Real
        </button>
        <button type="button" (click)="modo.set('turnos')" [class]="modoClass('turnos')">
          <span class="material-symbols-outlined text-[17px]">schedule</span>
          Operación por Turnos
        </button>
        <button type="button" (click)="modo.set('historico')" [class]="modoClass('historico')">
          <span class="material-symbols-outlined text-[17px]">query_stats</span>
          Gráficos Históricos
        </button>
        <p class="ml-auto flex items-center gap-1 text-[11px] font-semibold text-slate-400">
          <span class="material-symbols-outlined text-[14px]">info</span>
          Puede presentar desfases momentáneos
        </p>
      </nav>

      <!-- Tiempo Real -->
      @if (modo() === 'realtime') {

        <!-- Banner tiempo real -->
        <div class="rounded-2xl bg-gradient-to-br from-[#04606A] via-[#0D8A96] to-[#0DAFBD] p-5 text-white shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="font-black text-sm">Datos en tiempo real</p>
              <p class="mt-0.5 text-[11px] text-cyan-100">actualización cada minuto</p>
            </div>
            <span class="flex items-center gap-2 text-[11px] font-bold text-cyan-50">
              <span class="h-2 w-2 animate-pulse rounded-full bg-emerald-300"></span>
              06/05/2026 12:35
            </span>
          </div>
          <div class="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            @for (m of metricas; track m.label) {
              <div class="rounded-xl bg-white/10 px-4 py-3 ring-1 ring-white/10">
                <p class="text-[10px] font-bold uppercase tracking-widest text-cyan-100">{{ m.label }}</p>
                <p class="mt-1 text-2xl font-black leading-none">
                  {{ m.valor }}<span class="ml-1 text-sm font-bold text-white/70">{{ m.unidad }}</span>
                </p>
              </div>
            }
          </div>
        </div>

        <!-- Mini chart caudal -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-sm font-black text-slate-800">
              Caudal en <span class="text-cyan-600">Tiempo Real</span>
            </h3>
            <span class="text-[11px] font-semibold text-slate-400">Últimos {{ realtimePoints.length }} registros</span>
          </div>
          <div class="h-20 w-full">
            <svg viewBox="0 0 1120 80" class="h-full w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="rtFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#0DAFBD" stop-opacity="0.22"/>
                  <stop offset="100%" stop-color="#0DAFBD" stop-opacity="0.02"/>
                </linearGradient>
              </defs>
              <polygon [attr.points]="chartFill(realtimePoints)" fill="url(#rtFill)"/>
              <polyline
                [attr.points]="chartPolyline(realtimePoints)"
                fill="none"
                stroke="#0DAFBD"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </div>
          <div class="mt-1 flex justify-between font-mono text-[10px] text-slate-400">
            <span>12:15</span><span>12:20</span><span>12:25</span><span>12:30</span><span>12:35</span>
          </div>
        </section>

      }

      <!-- Turnos -->
      @if (modo() === 'turnos') {

        <!-- Navegación de fecha -->
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <button type="button" (click)="diaOffset.update(v => v - 1)" class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
              <span class="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <span class="flex items-center gap-2 text-sm font-black text-slate-800">
              <span class="material-symbols-outlined text-[15px] text-slate-400">calendar_today</span>
              {{ fechaDia() }}
              @if (esHoy()) {
                <span class="rounded-full bg-cyan-100 px-2 py-0.5 text-[10px] font-black text-cyan-700">Hoy</span>
              }
            </span>
            <button
              type="button"
              (click)="diaOffset.update(v => v + 1)"
              [disabled]="esHoy()"
              class="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span class="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
          <button type="button" (click)="diaOffset.set(0)" class="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50">Hoy</button>
        </div>

        <!-- Tarjetas de turno -->
        <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
          @for (turno of turnos; track turno.nombre) {
            @if (turno.esTotal) {
              <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div class="flex items-start justify-between gap-1">
                  <div>
                    <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ turno.nombre }}</p>
                    <p class="mt-0.5 text-[10px] text-slate-400">{{ turno.horario }}</p>
                  </div>
                </div>
                <p class="mt-3 font-mono text-3xl font-black text-slate-800">
                  {{ turno.consumo }}<span class="ml-1 text-sm font-bold text-slate-400">m³</span>
                </p>
                <div class="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div class="h-full w-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500"></div>
                </div>
              </div>
            } @else if (turno.activo) {
              <div class="rounded-2xl p-4 shadow-sm" [class]="turnoGradiente(turno.nombre)">
                <div class="flex items-start justify-between gap-1">
                  <div>
                    <p class="text-[10px] font-black uppercase tracking-widest text-white/80">{{ turno.nombre }}</p>
                    <p class="mt-0.5 text-[10px] text-white/50">{{ turno.horario }}</p>
                  </div>
                  <button type="button" class="flex h-6 w-6 items-center justify-center rounded-lg bg-white/15 text-white/70 hover:bg-white/25">
                    <span class="material-symbols-outlined text-[13px]">download</span>
                  </button>
                </div>
                <p class="mt-3 font-mono text-3xl font-black text-white">
                  {{ turno.consumo }}<span class="ml-1 text-base font-bold text-white/60">m³</span>
                </p>
              </div>
            } @else {
              <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 opacity-60">
                <p class="text-[10px] font-black uppercase tracking-widest text-slate-400">{{ turno.nombre }}</p>
                <p class="mt-0.5 text-[10px] text-slate-400">{{ turno.horario }}</p>
                <p class="mt-3 text-sm font-bold text-slate-400">No iniciado</p>
              </div>
            }
          }
        </div>

        <!-- Distribución de consumo -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">Distribución de consumo por turno</h3>
            <span class="text-[11px] font-semibold text-slate-400">% del total diario</span>
          </div>
          <div class="space-y-3">
            @for (d of distribucion; track d.nombre) {
              <div class="flex items-center gap-3">
                <span class="w-14 shrink-0 text-[12px] font-semibold text-slate-600">{{ d.nombre }}</span>
                <div class="flex-1 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div class="h-full rounded-full transition-all" [class]="d.barClass" [style.width]="d.pct + '%'"></div>
                </div>
                <span class="w-8 shrink-0 text-right font-mono text-[11px] text-slate-500">{{ d.pct }}%</span>
                <span class="w-16 shrink-0 text-right font-mono text-[11px] text-slate-500">{{ d.consumo }} m³</span>
              </div>
            }
          </div>
        </section>

      }

      <!-- Histórico -->
      @if (modo() === 'historico') {
        <app-operacion-graficos-historicos />
      }

    </div>
  `,
})
export class WaterDetailOperacionComponent {
  readonly modo = signal<OperacionModo>('realtime');
  readonly diaOffset = signal(0);

  private readonly HOY = new Date(2026, 4, 6);

  readonly metricas: MetricaTiempoReal[] = [
    { label: 'Caudal Actual', valor: '3.1', unidad: 'L/s' },
    { label: 'Totalizador', valor: '541,551', unidad: 'm³' },
    { label: 'Nivel de Agua', valor: '32.4', unidad: 'm' },
    { label: 'Consumo Hoy', valor: '24.8', unidad: 'm³' },
  ];

  readonly realtimePoints = [2.8, 3.1, 3.0, 2.9, 3.2, 3.1, 2.8, 3.0, 3.3, 3.1, 2.9, 3.0, 3.2, 3.1, 2.8, 3.0, 3.1, 2.9, 3.2, 3.1];

  readonly turnos: TurnoCard[] = [
    { nombre: 'Turno 1', horario: '07:00 – 14:59', consumo: 14.2, activo: true },
    { nombre: 'Turno 2', horario: '15:00 – 22:59', consumo: 10.6, activo: true },
    { nombre: 'Turno 3', horario: '23:00 – 06:59', consumo: null, activo: false },
    { nombre: 'Total del Día', horario: '24 horas', consumo: 24.8, activo: true, esTotal: true },
  ];

  readonly distribucion: TurnoDistribucion[] = [
    { nombre: 'Turno 1', consumo: 14.2, pct: 57, barClass: 'bg-cyan-500' },
    { nombre: 'Turno 2', consumo: 10.6, pct: 43, barClass: 'bg-emerald-500' },
    { nombre: 'Turno 3', consumo: 0, pct: 0, barClass: 'bg-slate-400' },
  ];

  readonly fechaDia = computed(() => {
    const d = new Date(this.HOY);
    d.setDate(d.getDate() + this.diaOffset());
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  });

  readonly esHoy = computed(() => this.diaOffset() === 0);

  chartPolyline(points: number[]): string {
    const W = 1120, H = 74;
    const min = Math.min(...points), max = Math.max(...points);
    const range = max - min || 1;
    const step = W / (points.length - 1);
    return points.map((v, i) => `${i * step},${H - ((v - min) / range) * (H - 10)}`).join(' ');
  }

  chartFill(points: number[]): string {
    const W = 1120, H = 74;
    const min = Math.min(...points), max = Math.max(...points);
    const range = max - min || 1;
    const step = W / (points.length - 1);
    const coords = points.map((v, i) => `${i * step},${H - ((v - min) / range) * (H - 10)}`).join(' ');
    return `0,${H} ${coords} ${(points.length - 1) * step},${H}`;
  }

  turnoGradiente(nombre: string): string {
    if (nombre === 'Turno 1') return 'bg-gradient-to-br from-[#04606A] to-[#0DAFBD]';
    if (nombre === 'Turno 2') return 'bg-gradient-to-br from-[#065F46] to-[#22C55E]';
    return 'bg-slate-100';
  }

  modoClass(m: OperacionModo): string {
    const active = this.modo() === m;
    return [
      'inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-all',
      active ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700',
    ].join(' ');
  }
}
