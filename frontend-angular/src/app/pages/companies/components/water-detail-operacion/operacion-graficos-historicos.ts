import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { catchError, of, Subscription, switchMap, timer } from 'rxjs';
import * as XLSX from 'xlsx';
import { CompanyService, type ContadorMensualPoint } from '../../../../services/company.service';
import { WaterOperacionStateService } from './water-operacion-state';

interface LineChart {
  polyline: string;
  fill: string;
  yTicks: { y: number; label: string }[];
  xLabels: { x: number; label: string }[];
}

interface BarChart {
  bars: { x: number; y: number; w: number; h: number; fill: string }[];
  yTicks: { y: number; label: string }[];
  xLabels: { x: number; label: string }[];
}

type ChartPreset = '6h' | '12h' | '24h' | '48h' | '7d' | 'custom';

@Component({
  selector: 'app-operacion-graficos-historicos',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">
      <!-- Gráficos de tendencia: Nivel Freático + Caudal (rango compartido) -->
      <div class="overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm">
        <!-- Header con selector de rango -->
        <div class="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 class="text-sm font-black text-slate-800">Gráficos de Tendencia</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">{{ chartSubtitle() }}</p>
          </div>

          <!-- Dropdown button -->
          <div class="relative">
            <button
              type="button"
              (click)="chartRangeOpen.update((v) => !v)"
              class="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[12px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
              [class]="
                chartRangeOpen()
                  ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-700'
              "
              aria-label="Selector de rango de tiempo"
              [attr.aria-expanded]="chartRangeOpen()"
            >
              <span class="material-symbols-outlined text-[15px]">calendar_month</span>
              {{ chartPreset() === 'custom' ? chartRangeLabel() : presetBadge() }}
              <span
                class="material-symbols-outlined text-[14px] transition-transform duration-200"
                [class.rotate-180]="chartRangeOpen()"
                >expand_more</span
              >
            </button>

            @if (chartRangeOpen()) {
              <!-- Backdrop -->
              <div class="fixed inset-0 z-10" (click)="chartRangeOpen.set(false)"></div>

              <!-- Panel flotante -->
              <div
                class="absolute right-0 top-full z-20 mt-1.5 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
              >
                <!-- Presets -->
                <div class="p-3">
                  <p class="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                    Rango de tiempo
                  </p>
                  <div class="flex flex-wrap gap-1.5" role="group" aria-label="Presets de rango">
                    @for (p of PRESETS; track p.key) {
                      <button
                        type="button"
                        (click)="setPreset(p.key)"
                        class="rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                        [class]="
                          chartPreset() === p.key
                            ? 'bg-cyan-600 text-white'
                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                        "
                        [attr.aria-pressed]="chartPreset() === p.key"
                      >
                        {{ p.label }}
                      </button>
                    }
                  </div>
                </div>

                <!-- Custom dates -->
                <div class="border-t border-slate-100 px-3 pb-3 pt-2.5 space-y-2">
                  <p class="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">
                    Personalizado
                  </p>
                  <div class="space-y-1.5">
                    <label class="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                      <span class="w-9 shrink-0">Desde</span>
                      <input
                        type="datetime-local"
                        [value]="editStart()"
                        (change)="onEditStart($any($event.target).value)"
                        class="h-8 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 font-mono text-[11px] text-slate-700 outline-none focus:border-cyan-400 focus:bg-white focus:ring-1 focus:ring-cyan-100"
                      />
                    </label>
                    <label class="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                      <span class="w-9 shrink-0">Hasta</span>
                      <input
                        type="datetime-local"
                        [value]="editEnd()"
                        (change)="onEditEnd($any($event.target).value)"
                        class="h-8 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 font-mono text-[11px] text-slate-700 outline-none focus:border-cyan-400 focus:bg-white focus:ring-1 focus:ring-cyan-100"
                      />
                    </label>
                  </div>
                  @if (chartPreset() === 'custom') {
                    <button
                      type="button"
                      (click)="applyCustomRange()"
                      class="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg bg-cyan-600 py-2 text-[12px] font-bold text-white transition-colors hover:bg-cyan-700"
                    >
                      <span class="material-symbols-outlined text-[14px]">check</span>
                      Aplicar rango
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Charts grid -->
        <div class="grid gap-0 xl:grid-cols-2">
          <!-- Nivel Freático -->
          <div class="p-5 xl:border-r xl:border-slate-100">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-black text-slate-700">Nivel Freático</p>
                <p class="text-[11px] text-slate-400">m bajo superficie</p>
              </div>
              <button
                type="button"
                aria-label="Descargar Nivel Freático en CSV"
                class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
              >
                <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                  >download</span
                >.CSV
              </button>
            </div>
            <div class="h-44 w-full">
              <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="nfGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#0DAFBD" stop-opacity="0.25" />
                    <stop offset="100%" stop-color="#0DAFBD" stop-opacity="0.02" />
                  </linearGradient>
                </defs>
                @for (t of nivel24().yTicks; track t.y) {
                  <line
                    x1="55"
                    [attr.y1]="t.y"
                    x2="1090"
                    [attr.y2]="t.y"
                    stroke="#f1f5f9"
                    stroke-width="1"
                  />
                  <text
                    x="50"
                    [attr.y]="t.y + 4"
                    font-size="11"
                    fill="#94a3b8"
                    text-anchor="end"
                    font-family="monospace"
                  >
                    {{ t.label }}
                  </text>
                }
                @for (l of nivel24().xLabels; track l.x) {
                  <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">
                    {{ l.label }}
                  </text>
                }
                <polygon [attr.points]="nivel24().fill" fill="url(#nfGrad)" />
                <polyline
                  [attr.points]="nivel24().polyline"
                  fill="none"
                  stroke="#0DAFBD"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          </div>

          <!-- Caudal Instantáneo -->
          <div class="p-5">
            <div class="mb-3 flex items-center justify-between gap-3">
              <div>
                <p class="text-xs font-black text-slate-700">Caudal Instantáneo</p>
                <p class="text-[11px] text-slate-400">L/s</p>
              </div>
              <button
                type="button"
                aria-label="Descargar Caudal Instantáneo en CSV"
                class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
              >
                <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                  >download</span
                >.CSV
              </button>
            </div>
            <div class="h-44 w-full">
              <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="cqGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#4F46E5" stop-opacity="0.2" />
                    <stop offset="100%" stop-color="#4F46E5" stop-opacity="0.02" />
                  </linearGradient>
                </defs>
                @for (t of caudal24().yTicks; track t.y) {
                  <line
                    x1="55"
                    [attr.y1]="t.y"
                    x2="1090"
                    [attr.y2]="t.y"
                    stroke="#f1f5f9"
                    stroke-width="1"
                  />
                  <text
                    x="50"
                    [attr.y]="t.y + 4"
                    font-size="11"
                    fill="#94a3b8"
                    text-anchor="end"
                    font-family="monospace"
                  >
                    {{ t.label }}
                  </text>
                }
                @for (l of caudal24().xLabels; track l.x) {
                  <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">
                    {{ l.label }}
                  </text>
                }
                <polygon [attr.points]="caudal24().fill" fill="url(#cqGrad)" />
                <polyline
                  [attr.points]="caudal24().polyline"
                  fill="none"
                  stroke="#4F46E5"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <!-- Flujo Mensual -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-black text-slate-800">Flujo Mensual</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Últimos 12 meses · {{ mensualUnit() }} totales por mes
            </p>
          </div>
          <button
            type="button"
            (click)="downloadMensualXlsx()"
            [disabled]="mensualLoading() || mensualEmpty()"
            aria-label="Descargar Flujo Mensual en Excel"
            class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
          >
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">download</span
            >.XLSX
          </button>
        </div>
        <div class="h-44 w-full">
          @if (mensualLoading()) {
            <div class="flex h-full items-center justify-center text-[11px] text-slate-400">
              <span class="material-symbols-outlined mr-1.5 animate-spin text-[16px]"
                >progress_activity</span
              >
              Cargando flujo mensual...
            </div>
          } @else if (mensualEmpty()) {
            <div class="flex h-full items-center justify-center text-[11px] text-slate-400">
              Sin datos de totalizador para este sitio en los últimos 12 meses.
            </div>
          } @else {
            <div class="relative h-full w-full">
              <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
                @for (t of mensual().yTicks; track t.y) {
                  <line
                    x1="55"
                    [attr.y1]="t.y"
                    x2="1090"
                    [attr.y2]="t.y"
                    stroke="#f1f5f9"
                    stroke-width="1"
                  />
                  <text
                    x="50"
                    [attr.y]="t.y + 4"
                    font-size="11"
                    fill="#94a3b8"
                    text-anchor="end"
                    font-family="monospace"
                  >
                    {{ t.label }}
                  </text>
                }
                @for (l of mensual().xLabels; track l.x) {
                  <text
                    [attr.x]="l.x"
                    y="212"
                    font-size="11"
                    fill="#64748b"
                    text-anchor="middle"
                    font-weight="600"
                  >
                    {{ l.label }}
                  </text>
                }
                @for (b of mensual().bars; track b.x; let i = $index) {
                  <rect
                    [attr.x]="b.x"
                    [attr.y]="b.y"
                    [attr.width]="b.w"
                    [attr.height]="b.h"
                    [attr.fill]="b.fill"
                    rx="4"
                    [attr.opacity]="mensualHoverIndex() === i ? 1 : 0.85"
                    (mouseenter)="mensualHoverIndex.set(i)"
                    (mouseleave)="mensualHoverIndex.set(null)"
                    class="cursor-pointer transition-opacity"
                  />
                }
              </svg>
              @if (mensualTooltip(); as tip) {
                <div
                  class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg"
                  [style.left.%]="tip.leftPct"
                  [style.top.%]="tip.topPct"
                >
                  <div class="font-bold">{{ tip.label }}</div>
                  <div class="font-mono">{{ tip.value }} {{ tip.unit }}</div>
                </div>
              }
            </div>
          }
        </div>
      </section>

      <!-- Flujo Diario 30D -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-black text-slate-800">Flujo Diario</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Últimos 30 días · m³/día · días sin operación en gris
            </p>
          </div>
          <button
            type="button"
            aria-label="Descargar Flujo Diario en CSV"
            class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
          >
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">download</span
            >.CSV
          </button>
        </div>
        <div class="h-44 w-full">
          <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
            @for (t of diario.yTicks; track t.y) {
              <line
                x1="55"
                [attr.y1]="t.y"
                x2="1090"
                [attr.y2]="t.y"
                stroke="#f1f5f9"
                stroke-width="1"
              />
              <text
                x="50"
                [attr.y]="t.y + 4"
                font-size="11"
                fill="#94a3b8"
                text-anchor="end"
                font-family="monospace"
              >
                {{ t.label }}
              </text>
            }
            @for (l of diario.xLabels; track l.x) {
              <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">
                {{ l.label }}
              </text>
            }
            @for (b of diario.bars; track b.x) {
              <rect
                [attr.x]="b.x"
                [attr.y]="b.y"
                [attr.width]="b.w"
                [attr.height]="b.h"
                [attr.fill]="b.fill"
                rx="2"
                opacity="0.85"
              />
            }
          </svg>
        </div>
      </section>

      <!-- Resumen jornada configurable -->
      <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="flex items-start justify-between gap-3 p-5 pb-0">
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-sm font-black text-slate-800">
                Resumen Operacional {{ jornadaInicio() }}–{{ jornadaFin() }}
              </h3>
              <button
                type="button"
                (click)="jornadaSettingsOpen.update((v) => !v)"
                class="flex h-6 w-6 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
                [class]="
                  jornadaSettingsOpen()
                    ? 'bg-cyan-100 text-cyan-700'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                "
                aria-label="Configurar período de jornada"
                [attr.aria-expanded]="jornadaSettingsOpen()"
              >
                <span class="material-symbols-outlined text-[15px]">settings</span>
              </button>
            </div>
            <p class="mt-0.5 text-[11px] text-slate-400">
              Últimos 30 días · flujo acumulado por jornada ({{ jornadaInicio() }} a
              {{ jornadaFin() }} del día siguiente) · m³
            </p>
          </div>
          <button
            type="button"
            aria-label="Descargar Resumen Jornada en CSV"
            class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
          >
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">download</span
            >.CSV
          </button>
        </div>

        @if (jornadaSettingsOpen()) {
          <div
            class="mx-5 mt-3 overflow-hidden rounded-xl border border-cyan-200 bg-cyan-50/60 p-4"
          >
            <p class="mb-2.5 text-[11px] font-black uppercase tracking-[0.12em] text-slate-600">
              Período de jornada
            </p>
            <div class="flex flex-wrap items-center gap-3 text-[12px] font-semibold text-slate-600">
              <label class="flex items-center gap-2">
                <span class="text-slate-400">Inicio</span>
                <input
                  type="time"
                  [value]="jornadaInicio()"
                  (change)="jornadaInicio.set($any($event.target).value)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-center font-mono text-[12px] text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                />
              </label>
              <span class="text-slate-300">–</span>
              <label class="flex items-center gap-2">
                <span class="text-slate-400">Fin</span>
                <input
                  type="time"
                  [value]="jornadaFin()"
                  (change)="jornadaFin.set($any($event.target).value)"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-center font-mono text-[12px] text-slate-700 outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100"
                />
              </label>
              <span class="text-[11px] text-slate-400"
                >(del día siguiente si cruza medianoche)</span
              >
            </div>
            <button
              type="button"
              (click)="jornadaSettingsOpen.set(false)"
              class="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-cyan-700"
            >
              <span class="material-symbols-outlined text-[14px]">check</span>
              Listo
            </button>
          </div>
        }

        <div class="h-44 w-full px-5 pt-4">
          <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
            @for (t of turno7.yTicks; track t.y) {
              <line
                x1="55"
                [attr.y1]="t.y"
                x2="1090"
                [attr.y2]="t.y"
                stroke="#f1f5f9"
                stroke-width="1"
              />
              <text
                x="50"
                [attr.y]="t.y + 4"
                font-size="11"
                fill="#94a3b8"
                text-anchor="end"
                font-family="monospace"
              >
                {{ t.label }}
              </text>
            }
            @for (l of turno7.xLabels; track l.x) {
              <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">
                {{ l.label }}
              </text>
            }
            @for (b of turno7.bars; track b.x) {
              <rect
                [attr.x]="b.x"
                [attr.y]="b.y"
                [attr.width]="b.w"
                [attr.height]="b.h"
                [attr.fill]="b.fill"
                rx="2"
                opacity="0.85"
              />
            }
          </svg>
        </div>

        <!-- Leyenda -->
        <div class="flex flex-wrap gap-4 px-5 pb-5 pt-3 text-[11px] text-slate-400">
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-3 w-3 rounded-sm bg-violet-500 opacity-85"></span>
            Jornada con operación
          </span>
          <span class="flex items-center gap-1.5">
            <span class="inline-block h-3 w-3 rounded-sm bg-slate-200"></span>
            Sin operación registrada
          </span>
        </div>
      </section>
    </div>
  `,
})
export class OperacionGraficosHistoricosComponent implements OnInit, OnDestroy {
  private readonly state = inject(WaterOperacionStateService);
  private readonly route = inject(ActivatedRoute);
  private readonly companyService = inject(CompanyService);
  private monthlyCountersSub: Subscription | null = null;

  readonly jornadaInicio = this.state.jornadaInicio;
  readonly jornadaFin = this.state.jornadaFin;
  readonly jornadaSettingsOpen = signal(false);

  readonly monthlyCountersData = signal<ContadorMensualPoint[]>([]);
  readonly monthlyCountersLoading = signal(false);
  readonly monthShortNames = [
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

  // ── Date range ────────────────────────────────────────────

  private readonly NOW = new Date(2026, 4, 12, 12, 35);

  readonly PRESETS: { key: ChartPreset; label: string }[] = [
    { key: '6h', label: 'Últimas 6h' },
    { key: '12h', label: 'Últimas 12h' },
    { key: '24h', label: 'Últimas 24h' },
    { key: '48h', label: 'Últimas 48h' },
    { key: '7d', label: 'Últimos 7 días' },
  ];

  readonly chartPreset = signal<ChartPreset>('24h');
  readonly chartRangeOpen = signal(false);
  readonly chartStart = signal<Date>(new Date(this.NOW.getTime() - 24 * 3_600_000));
  readonly chartEnd = signal<Date>(new Date(this.NOW));
  readonly editStart = signal(this.toDatetimeLocal(new Date(this.NOW.getTime() - 24 * 3_600_000)));
  readonly editEnd = signal(this.toDatetimeLocal(this.NOW));

  readonly chartRangeLabel = computed(
    () => `${this.fmtDate(this.chartStart())} – ${this.fmtDate(this.chartEnd())}`,
  );

  readonly presetBadge = computed(() => {
    const map: Partial<Record<ChartPreset, string>> = {
      '6h': 'Últimas 6H',
      '12h': 'Últimas 12H',
      '24h': 'Últimas 24H',
      '48h': 'Últimas 48H',
      '7d': 'Últimos 7 días',
    };
    return map[this.chartPreset()] ?? '';
  });

  readonly chartSubtitle = computed(() => {
    const map: Partial<Record<ChartPreset, string>> = {
      '6h': 'Últimas 6 horas',
      '12h': 'Últimas 12 horas',
      '24h': 'Últimas 24 horas',
      '48h': 'Últimas 48 horas',
      '7d': 'Últimos 7 días',
    };
    return map[this.chartPreset()] ?? this.chartRangeLabel();
  });

  // ── SVG drawing area (viewBox: 0 0 1100 220) ─────────────

  private readonly DX = 55;
  private readonly DY = 15;
  private readonly DW = 1035;
  private readonly DH = 170;

  // ── Raw mock data (24 hourly points, cycled for longer ranges) ────────────

  private readonly nivelRaw = [
    32.4, 32.3, 32.2, 32.1, 32.0, 32.1, 32.3, 32.5, 32.6, 32.7, 32.6, 32.5, 32.4, 32.3, 32.2, 32.1,
    32.0, 32.1, 32.2, 32.4, 32.5, 32.6, 32.5, 32.4,
  ];

  private readonly caudalRaw = [
    0, 0, 0, 0, 0, 0, 3.1, 3.2, 3.0, 3.1, 3.2, 3.1, 0, 0, 3.0, 3.2, 3.1, 3.0, 3.2, 3.1, 3.0, 0, 0,
    0,
  ];

  private readonly diarioRaw = [
    172, 168, 175, 0, 163, 171, 174, 169, 177, 165, 0, 178, 172, 166, 175, 168, 0, 171, 174, 165,
    172, 169, 0, 179, 171, 168, 175, 172, 0, 169,
  ];

  private readonly turno7Raw = [
    158, 162, 168, 0, 155, 165, 167, 162, 171, 158, 0, 172, 165, 159, 168, 161, 0, 164, 168, 158,
    165, 162, 0, 172, 164, 161, 168, 165, 0, 162,
  ];

  // ── Reactive line charts ──────────────────────────────────

  readonly nivel24 = computed(() =>
    this.buildLineForRange(this.nivelRaw, this.chartStart(), this.chartEnd()),
  );
  readonly caudal24 = computed(() =>
    this.buildLineForRange(this.caudalRaw, this.chartStart(), this.chartEnd()),
  );

  // ── Bar charts ────────────────────────────────────────────

  readonly mensual = computed<BarChart>(() => {
    const points = this.monthlyCountersData();
    if (points.length === 0) return { bars: [], yTicks: [], xLabels: [] };
    const vals = points.map((p) => p.delta ?? 0);
    const labels = points.map((p) => {
      const date = new Date(`${p.mes}T00:00:00-04:00`);
      return this.monthShortNames[date.getUTCMonth()] ?? '';
    });
    return this.buildBars(vals, labels, '#0DAFBD', 1);
  });
  readonly mensualUnit = computed(() => this.monthlyCountersData()[0]?.unidad ?? 'm³');
  readonly mensualLoading = computed(
    () => this.monthlyCountersLoading() && this.monthlyCountersData().length === 0,
  );
  readonly mensualEmpty = computed(
    () =>
      !this.monthlyCountersLoading() &&
      this.monthlyCountersData().every((p) => (p.delta ?? 0) === 0),
  );

  readonly mensualHoverIndex = signal<number | null>(null);

  readonly mensualTooltip = computed(() => {
    const idx = this.mensualHoverIndex();
    if (idx === null) return null;
    const point = this.monthlyCountersData()[idx];
    const bar = this.mensual().bars[idx];
    if (!point || !bar) return null;
    const date = new Date(`${point.mes}T00:00:00-04:00`);
    const monthName = this.monthShortNames[date.getUTCMonth()] ?? '';
    const yr = date.getUTCFullYear();
    const value = point.delta != null ? this.formatVolume(point.delta) : '—';
    const leftPct = ((bar.x + bar.w / 2) / 1100) * 100;
    const topPct = (bar.y / 220) * 100;
    return {
      label: `${monthName} ${yr}`,
      value,
      unit: this.mensualUnit(),
      leftPct,
      topPct,
    };
  });

  private formatVolume(value: number): string {
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value);
  }

  readonly diario: BarChart;
  readonly turno7: BarChart;

  constructor() {
    const startDate = new Date(2026, 3, 11);
    const day30 = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    });
    this.diario = this.buildBars(this.diarioRaw, day30, '#0DAFBD', 5);
    this.turno7 = this.buildBars(this.turno7Raw, day30, '#7C3AED', 5);
  }

  ngOnInit(): void {
    const siteId = this.resolveSiteId();
    if (!siteId) return;
    this.startMonthlyCountersPolling(siteId);
  }

  ngOnDestroy(): void {
    this.monthlyCountersSub?.unsubscribe();
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

  downloadMensualXlsx(): void {
    const points = this.monthlyCountersData();
    if (points.length === 0) return;
    const unit = this.mensualUnit();
    const rows = points.map((p) => ({
      Mes: this.formatMesIsoToYm(p.mes),
      [`Volumen (${unit})`]: p.delta != null ? Number(p.delta.toFixed(3)) : null,
      'Cantidad de registros': p.muestras,
      'Última lectura': this.formatTimestampShort(p.ultimo_dato),
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    // Anchos de columna razonables.
    sheet['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 22 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Flujo Mensual');
    const siteId = this.resolveSiteId();
    const fileName = `flujo-mensual-${siteId || 'sitio'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  private formatMesIsoToYm(mes: string): string {
    return mes ? mes.slice(0, 7) : '';
  }

  private formatTimestampShort(ts: string | null): string {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  }

  private startMonthlyCountersPolling(siteId: string): void {
    this.monthlyCountersLoading.set(true);
    this.monthlyCountersSub?.unsubscribe();
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

  // ── Date range actions ────────────────────────────────────

  setPreset(key: ChartPreset): void {
    const hoursMap: Partial<Record<ChartPreset, number>> = {
      '6h': 6,
      '12h': 12,
      '24h': 24,
      '48h': 48,
      '7d': 168,
    };
    const hours = hoursMap[key];
    if (!hours) return;

    const end = new Date(this.NOW);
    const start = new Date(end.getTime() - hours * 3_600_000);
    this.chartPreset.set(key);
    this.chartStart.set(start);
    this.chartEnd.set(end);
    this.editStart.set(this.toDatetimeLocal(start));
    this.editEnd.set(this.toDatetimeLocal(end));
    this.chartRangeOpen.set(false);
  }

  onEditStart(value: string): void {
    this.editStart.set(value);
    this.chartPreset.set('custom');
  }

  onEditEnd(value: string): void {
    this.editEnd.set(value);
    this.chartPreset.set('custom');
  }

  applyCustomRange(): void {
    const start = new Date(this.editStart());
    const end = new Date(this.editEnd());
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) return;
    this.chartStart.set(start);
    this.chartEnd.set(end);
    this.chartRangeOpen.set(false);
  }

  // ── Chart builders ────────────────────────────────────────

  private buildLineForRange(rawData: number[], start: Date, end: Date): LineChart {
    const hours = Math.max(2, Math.round((end.getTime() - start.getTime()) / 3_600_000));
    const pts = Array.from({ length: hours }, (_, i) => rawData[i % rawData.length]);

    const showDate = hours > 48;
    const xStep = Math.max(1, Math.round(hours / 6));

    const labels = pts.map((_, i) => {
      const d = new Date(start.getTime() + i * 3_600_000);
      return showDate
        ? `${d.getDate()}/${d.getMonth() + 1}`
        : `${String(d.getHours()).padStart(2, '0')}:00`;
    });

    return this.buildLine(pts, labels, xStep);
  }

  private buildLine(pts: number[], labels: string[], xStep: number): LineChart {
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const step = this.DW / Math.max(pts.length - 1, 1);

    const coords = pts.map((v, i) => {
      const x = this.DX + i * step;
      const y = this.DY + this.DH - ((v - min) / range) * this.DH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const polyline = coords.join(' ');
    const fill = `${this.DX},${this.DY + this.DH} ${polyline} ${this.DX + this.DW},${this.DY + this.DH}`;

    const nTicks = 5;
    const yTicks = Array.from({ length: nTicks }, (_, i) => ({
      y: Math.round(this.DY + this.DH - (i / (nTicks - 1)) * this.DH),
      label: (min + (range * i) / (nTicks - 1)).toFixed(1),
    }));

    const xLabels: { x: number; label: string }[] = [];
    for (let i = 0; i < pts.length; i += xStep) {
      xLabels.push({ x: Math.round(this.DX + i * step), label: labels[i] ?? '' });
    }

    return { polyline, fill, yTicks, xLabels };
  }

  private buildBars(vals: number[], labels: string[], color: string, xStep: number): BarChart {
    const maxVal = Math.max(...vals) || 1;
    const slotW = this.DW / vals.length;
    const barW = Math.max(slotW * 0.72, 4);
    const gapW = (slotW - barW) / 2;

    const bars = vals.map((v, i) => {
      const h = Math.round((v / maxVal) * this.DH);
      return {
        x: Math.round(this.DX + i * slotW + gapW),
        y: Math.round(this.DY + this.DH - h),
        w: Math.round(barW),
        h: Math.max(h, v > 0 ? 2 : 0),
        fill: v === 0 ? '#e2e8f0' : color,
      };
    });

    const nTicks = 4;
    const yTicks = Array.from({ length: nTicks }, (_, i) => ({
      y: Math.round(this.DY + this.DH - (i / (nTicks - 1)) * this.DH),
      label: i === 0 ? '0' : Math.round((maxVal * i) / (nTicks - 1)).toLocaleString('es-CL'),
    }));

    const xLabels: { x: number; label: string }[] = [];
    for (let i = 0; i < vals.length; i += xStep) {
      xLabels.push({ x: Math.round(this.DX + i * slotW + slotW / 2), label: labels[i] ?? '' });
    }

    return { bars, yTicks, xLabels };
  }

  // ── Formatting helpers ────────────────────────────────────

  private fmtDate(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  private toDatetimeLocal(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}
