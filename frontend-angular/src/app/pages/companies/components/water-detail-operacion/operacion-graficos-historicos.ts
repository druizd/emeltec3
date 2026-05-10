import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

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

@Component({
  selector: 'app-operacion-graficos-historicos',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-3">

      <!-- 24H: Nivel + Caudal -->
      <div class="grid gap-3 xl:grid-cols-2">

        <!-- Nivel Freático 24H -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 class="text-sm font-black text-slate-800">Nivel Freático</h3>
              <p class="mt-0.5 text-[11px] text-slate-400">Últimas 24 horas · m bajo superficie</p>
            </div>
            <button type="button" class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
              <span class="material-symbols-outlined text-[14px]">download</span>.CSV
            </button>
          </div>
          <div class="h-44 w-full">
            <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="nfGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#0DAFBD" stop-opacity="0.25"/>
                  <stop offset="100%" stop-color="#0DAFBD" stop-opacity="0.02"/>
                </linearGradient>
              </defs>
              @for (t of nivel24.yTicks; track t.y) {
                <line x1="55" [attr.y1]="t.y" x2="1090" [attr.y2]="t.y" stroke="#f1f5f9" stroke-width="1"/>
                <text x="50" [attr.y]="t.y + 4" font-size="11" fill="#94a3b8" text-anchor="end" font-family="monospace">{{ t.label }}</text>
              }
              @for (l of nivel24.xLabels; track l.x) {
                <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">{{ l.label }}</text>
              }
              <polygon [attr.points]="nivel24.fill" fill="url(#nfGrad)"/>
              <polyline [attr.points]="nivel24.polyline" fill="none" stroke="#0DAFBD" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </section>

        <!-- Caudal Instantáneo 24H -->
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 class="text-sm font-black text-slate-800">Caudal Instantáneo</h3>
              <p class="mt-0.5 text-[11px] text-slate-400">Últimas 24 horas · L/s</p>
            </div>
            <button type="button" class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
              <span class="material-symbols-outlined text-[14px]">download</span>.CSV
            </button>
          </div>
          <div class="h-44 w-full">
            <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="cqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="#4F46E5" stop-opacity="0.2"/>
                  <stop offset="100%" stop-color="#4F46E5" stop-opacity="0.02"/>
                </linearGradient>
              </defs>
              @for (t of caudal24.yTicks; track t.y) {
                <line x1="55" [attr.y1]="t.y" x2="1090" [attr.y2]="t.y" stroke="#f1f5f9" stroke-width="1"/>
                <text x="50" [attr.y]="t.y + 4" font-size="11" fill="#94a3b8" text-anchor="end" font-family="monospace">{{ t.label }}</text>
              }
              @for (l of caudal24.xLabels; track l.x) {
                <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">{{ l.label }}</text>
              }
              <polygon [attr.points]="caudal24.fill" fill="url(#cqGrad)"/>
              <polyline [attr.points]="caudal24.polyline" fill="none" stroke="#4F46E5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
        </section>

      </div>

      <!-- Flujo Mensual -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-black text-slate-800">Flujo Mensual</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">Últimos 12 meses · m³ totales por mes</p>
          </div>
          <button type="button" class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            <span class="material-symbols-outlined text-[14px]">download</span>.CSV
          </button>
        </div>
        <div class="h-44 w-full">
          <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
            @for (t of mensual.yTicks; track t.y) {
              <line x1="55" [attr.y1]="t.y" x2="1090" [attr.y2]="t.y" stroke="#f1f5f9" stroke-width="1"/>
              <text x="50" [attr.y]="t.y + 4" font-size="11" fill="#94a3b8" text-anchor="end" font-family="monospace">{{ t.label }}</text>
            }
            @for (l of mensual.xLabels; track l.x) {
              <text [attr.x]="l.x" y="212" font-size="11" fill="#64748b" text-anchor="middle" font-weight="600">{{ l.label }}</text>
            }
            @for (b of mensual.bars; track b.x) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="b.fill" rx="4" opacity="0.85"/>
            }
          </svg>
        </div>
      </section>

      <!-- Flujo Diario 30D -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-black text-slate-800">Flujo Diario</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">Últimos 30 días · m³/día · días sin operación en gris</p>
          </div>
          <button type="button" class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            <span class="material-symbols-outlined text-[14px]">download</span>.CSV
          </button>
        </div>
        <div class="h-44 w-full">
          <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
            @for (t of diario.yTicks; track t.y) {
              <line x1="55" [attr.y1]="t.y" x2="1090" [attr.y2]="t.y" stroke="#f1f5f9" stroke-width="1"/>
              <text x="50" [attr.y]="t.y + 4" font-size="11" fill="#94a3b8" text-anchor="end" font-family="monospace">{{ t.label }}</text>
            }
            @for (l of diario.xLabels; track l.x) {
              <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">{{ l.label }}</text>
            }
            @for (b of diario.bars; track b.x) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="b.fill" rx="2" opacity="0.85"/>
            }
          </svg>
        </div>
      </section>

      <!-- Resumen 7:00-7:00 -->
      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 class="text-sm font-black text-slate-800">Resumen Operacional 7:00–7:00</h3>
            <p class="mt-0.5 text-[11px] text-slate-400">Últimos 30 días · flujo acumulado por jornada (07:00 a 07:00 del día siguiente) · m³</p>
          </div>
          <button type="button" class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
            <span class="material-symbols-outlined text-[14px]">download</span>.CSV
          </button>
        </div>
        <div class="h-44 w-full">
          <svg viewBox="0 0 1100 220" class="h-full w-full" preserveAspectRatio="none">
            @for (t of turno7.yTicks; track t.y) {
              <line x1="55" [attr.y1]="t.y" x2="1090" [attr.y2]="t.y" stroke="#f1f5f9" stroke-width="1"/>
              <text x="50" [attr.y]="t.y + 4" font-size="11" fill="#94a3b8" text-anchor="end" font-family="monospace">{{ t.label }}</text>
            }
            @for (l of turno7.xLabels; track l.x) {
              <text [attr.x]="l.x" y="212" font-size="10" fill="#94a3b8" text-anchor="middle">{{ l.label }}</text>
            }
            @for (b of turno7.bars; track b.x) {
              <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="b.fill" rx="2" opacity="0.85"/>
            }
          </svg>
        </div>

        <!-- Leyenda -->
        <div class="mt-3 flex flex-wrap gap-4 text-[11px] text-slate-400">
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
  // SVG drawing area constants (viewBox: 0 0 1100 220)
  private readonly DX = 55;   // left padding (y-axis labels)
  private readonly DY = 15;   // top padding
  private readonly DW = 1035; // drawing width  (1100 - 55 - 10)
  private readonly DH = 170;  // drawing height (220 - 15 - 35)

  // ── Raw mock data ──────────────────────────────────────────

  private readonly nivelRaw = [
    32.4, 32.3, 32.2, 32.1, 32.0, 32.1, 32.3, 32.5,
    32.6, 32.7, 32.6, 32.5, 32.4, 32.3, 32.2, 32.1,
    32.0, 32.1, 32.2, 32.4, 32.5, 32.6, 32.5, 32.4,
  ];

  private readonly caudalRaw = [
    0, 0, 0, 0, 0, 0,
    3.1, 3.2, 3.0, 3.1, 3.2, 3.1,
    0, 0,
    3.0, 3.2, 3.1, 3.0, 3.2, 3.1,
    3.0, 0, 0, 0,
  ];

  private readonly mensualRaw  = [4821, 5102, 4953, 5231, 4987, 5340, 5108, 4876, 5012, 5230, 5089, 4920];
  private readonly mensualLabels = ['Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar', 'Abr', 'May'];

  private readonly diarioRaw = [
    172, 168, 175, 0, 163, 171, 174,
    169, 177, 165, 0, 178, 172, 166,
    175, 168, 0, 171, 174, 165,
    172, 169, 0, 179, 171, 168, 175,
    172, 0, 169,
  ];

  private readonly turno7Raw = [
    158, 162, 168, 0, 155, 165, 167,
    162, 171, 158, 0, 172, 165, 159,
    168, 161, 0, 164, 168, 158,
    165, 162, 0, 172, 164, 161, 168,
    165, 0, 162,
  ];

  // ── Precomputed charts ────────────────────────────────────

  readonly nivel24: LineChart;
  readonly caudal24: LineChart;
  readonly mensual: BarChart;
  readonly diario: BarChart;
  readonly turno7: BarChart;

  constructor() {
    const h24 = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

    const startDate = new Date(2026, 3, 11); // 11 Apr 2026
    const day30 = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      return `${d.getDate()}/${d.getMonth() + 1}`;
    });

    this.nivel24  = this.buildLine(this.nivelRaw, h24, 4);
    this.caudal24 = this.buildLine(this.caudalRaw, h24, 4);
    this.mensual  = this.buildBars(this.mensualRaw, this.mensualLabels, '#0DAFBD', 1);
    this.diario   = this.buildBars(this.diarioRaw, day30, '#0DAFBD', 5);
    this.turno7   = this.buildBars(this.turno7Raw, day30, '#7C3AED', 5);
  }

  private buildLine(pts: number[], labels: string[], xStep: number): LineChart {
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;
    const step = this.DW / (pts.length - 1);

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
}
