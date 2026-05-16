import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import * as XLSX from 'xlsx';
import { type HistoricalRow, WaterOperacionStateService } from './water-operacion-state';

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
                (click)="downloadNivelXlsx()"
                [disabled]="nivelEmpty()"
                aria-label="Descargar Nivel Freático en Excel"
                class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
              >
                <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                  >download</span
                >.XLSX
              </button>
            </div>
            <div class="relative h-44 w-full">
              @if (nivelEmpty()) {
                <div
                  class="flex h-full items-center justify-center text-[11px] text-slate-400"
                >
                  Sin datos de nivel freático en el rango seleccionado.
                </div>
              } @else {
              <svg
                viewBox="0 0 1100 220"
                class="h-full w-full cursor-crosshair"
                preserveAspectRatio="none"
                #nivelSvg
                (mousemove)="onLineHover('nivel', $event, nivelSvg)"
                (mouseleave)="clearLineHover('nivel')"
              >
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
                @if (nivelHover(); as h) {
                  <line
                    [attr.x1]="h.x"
                    [attr.x2]="h.x"
                    [attr.y1]="DY"
                    [attr.y2]="DY + DH"
                    stroke="#CBD5E1"
                    stroke-width="1"
                    stroke-dasharray="4 4"
                  />
                  <circle
                    [attr.cx]="h.x"
                    [attr.cy]="h.y"
                    r="4.5"
                    fill="#ffffff"
                    stroke="#0DAFBD"
                    stroke-width="2.5"
                  />
                }
              </svg>
              @if (nivelHover(); as h) {
                <div
                  class="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg"
                  [style.left.%]="h.leftPct"
                  [style.top]="'4px'"
                >
                  <div class="font-bold">{{ h.label }}</div>
                  <div class="font-mono">{{ h.value }} {{ h.unit }}</div>
                </div>
              }
              }
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
                (click)="downloadCaudalXlsx()"
                [disabled]="caudalEmpty()"
                aria-label="Descargar Caudal Instantáneo en Excel"
                class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
              >
                <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                  >download</span
                >.XLSX
              </button>
            </div>
            <div class="relative h-44 w-full">
              @if (caudalEmpty()) {
                <div
                  class="flex h-full items-center justify-center text-[11px] text-slate-400"
                >
                  Sin datos de caudal en el rango seleccionado.
                </div>
              } @else {
              <svg
                viewBox="0 0 1100 220"
                class="h-full w-full cursor-crosshair"
                preserveAspectRatio="none"
                #caudalSvg
                (mousemove)="onLineHover('caudal', $event, caudalSvg)"
                (mouseleave)="clearLineHover('caudal')"
              >
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
                @if (caudalHover(); as h) {
                  <line
                    [attr.x1]="h.x"
                    [attr.x2]="h.x"
                    [attr.y1]="DY"
                    [attr.y2]="DY + DH"
                    stroke="#CBD5E1"
                    stroke-width="1"
                    stroke-dasharray="4 4"
                  />
                  <circle
                    [attr.cx]="h.x"
                    [attr.cy]="h.y"
                    r="4.5"
                    fill="#ffffff"
                    stroke="#4F46E5"
                    stroke-width="2.5"
                  />
                }
              </svg>
              @if (caudalHover(); as h) {
                <div
                  class="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg"
                  [style.left.%]="h.leftPct"
                  [style.top]="'4px'"
                >
                  <div class="font-bold">{{ h.label }}</div>
                  <div class="font-mono">{{ h.value }} {{ h.unit }}</div>
                </div>
              }
              }
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
              Últimos 30 días · {{ diarioUnit() }}/día · días sin operación en gris
            </p>
          </div>
          <button
            type="button"
            (click)="downloadDiarioXlsx()"
            [disabled]="diarioLoading() || diarioEmpty()"
            aria-label="Descargar Flujo Diario en Excel"
            class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
          >
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">download</span
            >.XLSX
          </button>
        </div>
        <div class="h-44 w-full">
          @if (diarioLoading()) {
            <div class="flex h-full items-center justify-center text-[11px] text-slate-400">
              <span class="material-symbols-outlined mr-1.5 animate-spin text-[16px]"
                >progress_activity</span
              >
              Cargando flujo diario...
            </div>
          } @else if (diarioEmpty()) {
            <div class="flex h-full items-center justify-center text-[11px] text-slate-400">
              Sin datos de totalizador para este sitio en los últimos 30 días.
            </div>
          } @else {
            <div class="relative h-full w-full">
              <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
                @for (t of diario().yTicks; track t.y) {
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
                @for (l of diario().xLabels; track l.x) {
                  <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">
                    {{ l.label }}
                  </text>
                }
                @for (b of diario().bars; track b.x; let i = $index) {
                  <rect
                    [attr.x]="b.x"
                    [attr.y]="b.y"
                    [attr.width]="b.w"
                    [attr.height]="b.h"
                    [attr.fill]="b.fill"
                    rx="2"
                    [attr.opacity]="diarioHoverIndex() === i ? 1 : 0.85"
                    (mouseenter)="diarioHoverIndex.set(i)"
                    (mouseleave)="diarioHoverIndex.set(null)"
                    class="cursor-pointer transition-opacity"
                  />
                }
              </svg>
              @if (diarioTooltip(); as tip) {
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
            (click)="downloadJornadaXlsx()"
            [disabled]="turno7Loading() || turno7Empty()"
            aria-label="Descargar Resumen Jornada en Excel"
            class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0DAFBD]"
          >
            <span class="material-symbols-outlined text-[14px]" aria-hidden="true">download</span
            >.XLSX
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
          @if (turno7Loading()) {
            <div class="flex h-full items-center justify-center text-[11px] text-slate-400">
              <span class="material-symbols-outlined mr-1.5 animate-spin text-[16px]"
                >progress_activity</span
              >
              Cargando resumen jornada...
            </div>
          } @else if (turno7Empty()) {
            <div class="flex h-full items-center justify-center text-[11px] text-slate-400">
              Sin datos de jornada para este sitio en los últimos 30 días.
            </div>
          } @else {
            <div class="relative h-full w-full">
              <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
                @for (t of turno7().yTicks; track t.y) {
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
                @for (l of turno7().xLabels; track l.x) {
                  <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">
                    {{ l.label }}
                  </text>
                }
                @for (b of turno7().bars; track b.x; let i = $index) {
                  <rect
                    [attr.x]="b.x"
                    [attr.y]="b.y"
                    [attr.width]="b.w"
                    [attr.height]="b.h"
                    [attr.fill]="b.fill"
                    rx="2"
                    [attr.opacity]="turno7HoverIndex() === i ? 1 : 0.85"
                    (mouseenter)="turno7HoverIndex.set(i)"
                    (mouseleave)="turno7HoverIndex.set(null)"
                    class="cursor-pointer transition-opacity"
                  />
                }
              </svg>
              @if (turno7Tooltip(); as tip) {
                <div
                  class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg"
                  [style.left.%]="tip.leftPct"
                  [style.top.%]="tip.topPct"
                >
                  <div class="font-bold">{{ tip.label }}</div>
                  <div class="text-slate-300">{{ tip.sublabel }}</div>
                  <div class="font-mono">{{ tip.value }} {{ tip.unit }}</div>
                </div>
              }
            </div>
          }
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
export class OperacionGraficosHistoricosComponent {
  private readonly state = inject(WaterOperacionStateService);
  private readonly route = inject(ActivatedRoute);

  readonly jornadaInicio = this.state.jornadaInicio;
  readonly jornadaFin = this.state.jornadaFin;
  readonly jornadaSettingsOpen = signal(false);

  // Estos signals viven en el state (los pollea el parent), asi que al cambiar
  // de pestaña no se re-fetchea.
  readonly monthlyCountersData = this.state.monthlyCountersData;
  readonly monthlyCountersLoading = this.state.monthlyCountersLoading;
  readonly dailyCountersData = this.state.dailyCountersData;
  readonly dailyCountersLoading = this.state.dailyCountersLoading;
  readonly jornadaCountersData = this.state.jornadaCountersData;
  readonly jornadaCountersLoading = this.state.jornadaCountersLoading;
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

  private readonly NOW = new Date();

  readonly PRESETS: { key: ChartPreset; label: string }[] = [
    { key: '6h', label: 'Últimas 6h' },
    { key: '12h', label: 'Últimas 12h' },
    { key: '24h', label: 'Últimas 24h' },
    { key: '48h', label: 'Últimas 48h' },
    { key: '7d', label: 'Últimos 7 días' },
  ];

  readonly chartPreset = signal<ChartPreset>('6h');
  readonly chartRangeOpen = signal(false);
  readonly chartStart = signal<Date>(new Date(this.NOW.getTime() - 6 * 3_600_000));
  readonly chartEnd = signal<Date>(new Date(this.NOW));
  readonly editStart = signal(this.toDatetimeLocal(new Date(this.NOW.getTime() - 6 * 3_600_000)));
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

  readonly DX = 55;
  readonly DY = 15;
  readonly DW = 1035;
  readonly DH = 170;

  // ── Reactive line charts (real data via state) ────────────

  private readonly historyRows = this.state.historyRows;

  private rowsInRange(field: 'caudal' | 'nivelFreatico'): { t: number; v: number }[] {
    const start = this.chartStart().getTime();
    const end = this.chartEnd().getTime();
    return this.historyRows()
      .filter(
        (r): r is HistoricalRow & { timestampMs: number } =>
          r.timestampMs !== null &&
          r.timestampMs >= start &&
          r.timestampMs <= end &&
          r[field] !== null,
      )
      .map((r) => ({ t: r.timestampMs, v: r[field] as number }))
      .sort((a, b) => a.t - b.t);
  }

  readonly nivel24 = computed(() => this.buildLineByTime(this.rowsInRange('nivelFreatico'), 'm'));
  readonly caudal24 = computed(() => this.buildLineByTime(this.rowsInRange('caudal'), 'L/s'));

  readonly nivelEmpty = computed(() => this.rowsInRange('nivelFreatico').length === 0);
  readonly caudalEmpty = computed(() => this.rowsInRange('caudal').length === 0);

  // ── Hover state para tooltips de linea ────────────────────

  readonly nivelHoverIdx = signal<number | null>(null);
  readonly caudalHoverIdx = signal<number | null>(null);

  readonly nivelHover = computed(() =>
    this.computeLineHover(this.rowsInRange('nivelFreatico'), this.nivelHoverIdx(), 'm', 2),
  );
  readonly caudalHover = computed(() =>
    this.computeLineHover(this.rowsInRange('caudal'), this.caudalHoverIdx(), 'L/s', 2),
  );

  onLineHover(chart: 'nivel' | 'caudal', event: MouseEvent, svg: Element): void {
    const pts =
      chart === 'nivel' ? this.rowsInRange('nivelFreatico') : this.rowsInRange('caudal');
    if (pts.length === 0) {
      this.clearLineHover(chart);
      return;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const vbX = ((event.clientX - rect.left) / rect.width) * 1100;
    const start = this.chartStart().getTime();
    const span = Math.max(1, this.chartEnd().getTime() - start);
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const x = this.DX + ((pts[i].t - start) / span) * this.DW;
      const d = Math.abs(x - vbX);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }
    if (chart === 'nivel') this.nivelHoverIdx.set(nearest);
    else this.caudalHoverIdx.set(nearest);
  }

  clearLineHover(chart: 'nivel' | 'caudal'): void {
    if (chart === 'nivel') this.nivelHoverIdx.set(null);
    else this.caudalHoverIdx.set(null);
  }

  private computeLineHover(
    pts: { t: number; v: number }[],
    idx: number | null,
    unit: string,
    decimals: number,
  ) {
    if (idx === null) return null;
    const p = pts[idx];
    if (!p) return null;
    const start = this.chartStart().getTime();
    const span = Math.max(1, this.chartEnd().getTime() - start);
    const values = pts.map((q) => q.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const x = this.DX + ((p.t - start) / span) * this.DW;
    const y = this.DY + this.DH - ((p.v - min) / range) * this.DH;
    return {
      x,
      y,
      leftPct: (x / 1100) * 100,
      topPct: (y / 220) * 100,
      label: this.formatChileShort(p.t),
      value: new Intl.NumberFormat('es-CL', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(p.v),
      unit,
    };
  }

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

  // Slice ultimos 30 dias para el chart (el state guarda 90 para cubrir el
  // preset 90d del Resumen por Periodo).
  private readonly diarioPoints = computed(() => this.dailyCountersData().slice(-30));

  readonly diario = computed<BarChart>(() => {
    const points = this.diarioPoints();
    if (points.length === 0) return { bars: [], yTicks: [], xLabels: [] };
    const vals = points.map((p) => p.delta ?? 0);
    const labels = points.map((p) => {
      const [, m, d] = p.dia.split('-');
      return `${Number(d)}/${Number(m)}`;
    });
    return this.buildBars(vals, labels, '#0DAFBD', 5);
  });
  readonly diarioUnit = computed(() => this.diarioPoints()[0]?.unidad ?? 'm³');
  readonly diarioLoading = computed(
    () => this.dailyCountersLoading() && this.diarioPoints().length === 0,
  );
  readonly diarioEmpty = computed(
    () =>
      !this.dailyCountersLoading() &&
      this.diarioPoints().every((p) => (p.delta ?? 0) === 0),
  );

  readonly diarioHoverIndex = signal<number | null>(null);

  readonly diarioTooltip = computed(() => {
    const idx = this.diarioHoverIndex();
    if (idx === null) return null;
    const point = this.diarioPoints()[idx];
    const bar = this.diario().bars[idx];
    if (!point || !bar) return null;
    const value = point.delta != null ? this.formatVolume(point.delta) : '—';
    const leftPct = ((bar.x + bar.w / 2) / 1100) * 100;
    const topPct = (bar.y / 220) * 100;
    return {
      label: this.formatDiaLargo(point.dia),
      value,
      unit: this.diarioUnit(),
      leftPct,
      topPct,
    };
  });

  private formatDiaLargo(dia: string): string {
    if (!dia) return '';
    const [y, m, d] = dia.split('-').map(Number);
    if (!y || !m || !d) return dia;
    const date = new Date(`${dia}T00:00:00-04:00`);
    const monthName = this.monthShortNames[date.getUTCMonth()] ?? '';
    return `${d} ${monthName} '${String(y).slice(2)}`;
  }

  readonly turno7 = computed<BarChart>(() => {
    const points = this.jornadaCountersData();
    if (points.length === 0) return { bars: [], yTicks: [], xLabels: [] };
    const vals = points.map((p) => p.delta ?? 0);
    const labels = points.map((p) => {
      const [, m, d] = p.dia.split('-');
      return `${Number(d)}/${Number(m)}`;
    });
    return this.buildBars(vals, labels, '#7C3AED', 5);
  });
  readonly turno7Unit = computed(() => this.jornadaCountersData()[0]?.unidad ?? 'm³');
  readonly turno7Loading = computed(
    () => this.jornadaCountersLoading() && this.jornadaCountersData().length === 0,
  );
  readonly turno7Empty = computed(
    () =>
      !this.jornadaCountersLoading() &&
      this.jornadaCountersData().every((p) => (p.delta ?? 0) === 0),
  );
  readonly turno7HoverIndex = signal<number | null>(null);
  readonly turno7Tooltip = computed(() => {
    const idx = this.turno7HoverIndex();
    if (idx === null) return null;
    const point = this.jornadaCountersData()[idx];
    const bar = this.turno7().bars[idx];
    if (!point || !bar) return null;
    const value = point.delta != null ? this.formatVolume(point.delta) : '—';
    const leftPct = ((bar.x + bar.w / 2) / 1100) * 100;
    const topPct = (bar.y / 220) * 100;
    return {
      label: this.formatDiaLargo(point.dia),
      sublabel: `${point.inicio} → ${point.fin}`,
      value,
      unit: this.turno7Unit(),
      leftPct,
      topPct,
    };
  });

  private resolveSiteId(): string {
    let current: ActivatedRoute | null = this.route;
    while (current) {
      const siteId = current.snapshot.paramMap.get('siteId');
      if (siteId) return siteId;
      current = current.parent;
    }
    return '';
  }

  downloadNivelXlsx(): void {
    this.downloadTimeseriesXlsx({
      pts: this.rowsInRange('nivelFreatico'),
      sheetName: 'Nivel Freatico',
      valueHeader: 'Nivel (m)',
      decimals: 2,
      filePrefix: 'nivel-freatico',
    });
  }

  downloadCaudalXlsx(): void {
    this.downloadTimeseriesXlsx({
      pts: this.rowsInRange('caudal'),
      sheetName: 'Caudal',
      valueHeader: 'Caudal (L/s)',
      decimals: 2,
      filePrefix: 'caudal',
    });
  }

  private downloadTimeseriesXlsx(opts: {
    pts: { t: number; v: number }[];
    sheetName: string;
    valueHeader: string;
    decimals: number;
    filePrefix: string;
  }): void {
    const { pts, sheetName, valueHeader, decimals, filePrefix } = opts;
    if (pts.length === 0) return;
    const factor = 10 ** decimals;
    const rows = pts.map((p) => ({
      'Fecha y hora': this.formatChileShort(p.t),
      [valueHeader]: Math.round(p.v * factor) / factor,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [{ wch: 18 }, { wch: 16 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, sheetName);
    const siteId = this.resolveSiteId();
    const fileName = `${filePrefix}-${siteId || 'sitio'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  private formatChileShort(timestampMs: number): string {
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(timestampMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  }

  downloadJornadaXlsx(): void {
    const points = this.jornadaCountersData();
    if (points.length === 0) return;
    const unit = this.turno7Unit();
    const rows = points.map((p) => ({
      Día: this.formatDiaLargo(p.dia),
      Jornada: `${p.inicio} → ${p.fin}`,
      [`Volumen (${unit})`]: p.delta != null ? Number(p.delta.toFixed(3)) : null,
      'Cantidad de registros': p.muestras,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Resumen Jornada');
    const siteId = this.resolveSiteId();
    const fileName = `resumen-jornada-${siteId || 'sitio'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  downloadDiarioXlsx(): void {
    const points = this.diarioPoints();
    if (points.length === 0) return;
    const unit = this.diarioUnit();
    const rows = points.map((p) => ({
      Día: this.formatDiaLargo(p.dia),
      [`Volumen (${unit})`]: p.delta != null ? Number(p.delta.toFixed(3)) : null,
      'Cantidad de registros': p.muestras,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Flujo Diario');
    const siteId = this.resolveSiteId();
    const fileName = `flujo-diario-${siteId || 'sitio'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  downloadMensualXlsx(): void {
    const points = this.monthlyCountersData();
    if (points.length === 0) return;
    const unit = this.mensualUnit();
    const rows = points.map((p) => ({
      Mes: this.formatMesLargo(p.mes),
      [`Volumen (${unit})`]: p.delta != null ? Number(p.delta.toFixed(3)) : null,
      'Cantidad de registros': p.muestras,
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    // Anchos de columna razonables.
    sheet['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 22 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Flujo Mensual');
    const siteId = this.resolveSiteId();
    const fileName = `flujo-mensual-${siteId || 'sitio'}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }

  private readonly monthLongNames = [
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

  private formatMesLargo(mes: string): string {
    if (!mes) return '';
    const date = new Date(`${mes}T00:00:00-04:00`);
    if (isNaN(date.getTime())) return mes;
    const name = this.monthLongNames[date.getUTCMonth()] ?? '';
    const yr = String(date.getUTCFullYear()).slice(2);
    return `${name} '${yr}`;
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

  /**
   * Construye LineChart desde tuplas (timestamp, valor) reales. X se mapea
   * proporcional al timestamp dentro de [chartStart, chartEnd], no por indice,
   * para que series con sampling irregular o gaps se vean correctamente.
   */
  private buildLineByTime(pts: { t: number; v: number }[], _unit: string): LineChart {
    if (pts.length === 0) {
      return { polyline: '', fill: '', yTicks: [], xLabels: [] };
    }

    const start = this.chartStart().getTime();
    const end = this.chartEnd().getTime();
    const tSpan = Math.max(1, end - start);

    const values = pts.map((p) => p.v);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    const coords = pts.map((p) => {
      const x = this.DX + ((p.t - start) / tSpan) * this.DW;
      const y = this.DY + this.DH - ((p.v - min) / range) * this.DH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const polyline = coords.join(' ');
    const firstX = this.DX + ((pts[0].t - start) / tSpan) * this.DW;
    const lastX = this.DX + ((pts[pts.length - 1].t - start) / tSpan) * this.DW;
    const fill = `${firstX.toFixed(1)},${this.DY + this.DH} ${polyline} ${lastX.toFixed(1)},${this.DY + this.DH}`;

    const nTicks = 5;
    const yTicks = Array.from({ length: nTicks }, (_, i) => ({
      y: Math.round(this.DY + this.DH - (i / (nTicks - 1)) * this.DH),
      label: (min + (range * i) / (nTicks - 1)).toFixed(1),
    }));

    // X labels: 6 marcas equidistantes en tiempo, formato segun span.
    const showDate = tSpan > 48 * 3_600_000;
    const xLabels: { x: number; label: string }[] = [];
    const N = 6;
    for (let i = 0; i <= N; i++) {
      const t = start + (i / N) * tSpan;
      const x = this.DX + (i / N) * this.DW;
      const d = new Date(t);
      const label = showDate
        ? `${d.getDate()}/${d.getMonth() + 1}`
        : `${String(d.getHours()).padStart(2, '0')}:00`;
      xLabels.push({ x: Math.round(x), label });
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
