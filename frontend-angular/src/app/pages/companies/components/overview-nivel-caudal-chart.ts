import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { Chart, ChartConfiguration, Plugin, registerables } from 'chart.js';
import { forkJoin } from 'rxjs';
import { CompanyService, HistoryGranularity } from '../../../services/company.service';
import type { SiteDashboardHistoryEntry, SiteRecord } from '@emeltec/shared';

Chart.register(...registerables);

type RangeKey = '24h' | '7d' | '30d';

interface SiteSeries {
  id: string;
  nombre: string;
  color: string;
  nivel: { x: number; y: number }[];
  caudal: { x: number; y: number }[];
}

interface RangeConfig {
  limit: number;
  granularity?: HistoryGranularity;
}

const PALETTE = [
  '#0dafbd',
  '#f59e0b',
  '#6366f1',
  '#22c55e',
  '#ef4444',
  '#0ea5e9',
  '#a855f7',
  '#f97316',
  '#14b8a6',
  '#e11d48',
];

const RANGE_MS: Record<RangeKey, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** Rellena el fondo en blanco antes de dibujar → los PNG exportados no salen
 * con fondo transparente (que se ve negro en visores). */
const WHITE_BG: Plugin = {
  id: 'whiteBg',
  beforeDraw: (chart) => {
    const { ctx } = chart;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  },
};

@Component({
  selector: 'app-overview-nivel-caudal-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  styles: [':host { display: block; }'],
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <!-- Header -->
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-body-sm font-semibold text-slate-800">Nivel freático vs caudal</h3>
          <p class="mt-0.5 text-caption-xs text-slate-400">
            Evolución de nivel freático (m) y caudal instantáneo (l/s) por pozo
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <!-- Selector de rango -->
          <div class="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            @for (r of ranges; track r.key) {
              <button
                type="button"
                (click)="setRange(r.key)"
                [attr.aria-pressed]="range() === r.key"
                [class]="
                  range() === r.key
                    ? 'bg-white text-primary-container shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                "
                class="rounded-md px-2.5 py-1 text-caption-xs font-bold transition-colors active:scale-95"
              >
                {{ r.label }}
              </button>
            }
          </div>

          <!-- Exportar -->
          <button
            type="button"
            (click)="exportarPngPorPozo()"
            [disabled]="loading() || series().length === 0 || exporting()"
            class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-caption-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            title="Descarga un PNG individual por cada pozo"
          >
            <span
              class="material-symbols-outlined text-[15px]"
              [class.animate-spin]="exporting()"
              aria-hidden="true"
              >{{ exporting() ? 'progress_activity' : 'download' }}</span
            >
            {{ exporting() ? 'Exportando…' : 'Exportar PNG por pozo' }}
          </button>
        </div>
      </div>

      <!-- Leyenda: toggles por sitio + nota de estilo de línea -->
      @if (series().length > 0) {
        <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          @for (s of series(); track s.id) {
            <button
              type="button"
              (click)="toggle(s.id)"
              [attr.aria-pressed]="!hidden().has(s.id)"
              class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-2.5 py-1 text-caption-xs font-semibold text-slate-600 transition hover:border-slate-300 active:scale-95"
            >
              <span
                class="h-2.5 w-2.5 rounded-full"
                [style.background]="hidden().has(s.id) ? 'transparent' : s.color"
                [style.boxShadow]="'inset 0 0 0 2px ' + s.color"
              ></span>
              <span [class.text-slate-400]="hidden().has(s.id)" [class.line-through]="hidden().has(s.id)">
                {{ s.nombre }}
              </span>
            </button>
          }
          <span class="ml-1 inline-flex items-center gap-3 text-caption-xs text-slate-400">
            <span class="inline-flex items-center gap-1">
              <span class="inline-block h-0.5 w-5 rounded bg-slate-400"></span> Caudal
            </span>
            <span class="inline-flex items-center gap-1">
              <span class="inline-block h-0 w-5 border-t-2 border-dashed border-slate-400"></span>
              Nivel
            </span>
          </span>
        </div>
      }

      <!-- Chart / estados -->
      <div class="relative" style="height: 340px">
        @if (loading()) {
          <div class="absolute inset-0 flex items-center justify-center">
            <span
              class="material-symbols-outlined animate-spin text-3xl text-slate-300"
              aria-hidden="true"
              >progress_activity</span
            >
          </div>
        }
        @if (errorMsg()) {
          <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span class="material-symbols-outlined mb-1 text-3xl text-slate-300" aria-hidden="true"
              >error</span
            >
            <p class="text-caption text-slate-500">{{ errorMsg() }}</p>
            <button
              type="button"
              (click)="reintentar()"
              class="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-caption-xs font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-800 active:scale-95"
            >
              <span class="material-symbols-outlined text-[14px]" aria-hidden="true">refresh</span>
              Reintentar
            </button>
          </div>
        }
        @if (!loading() && !errorMsg() && series().length === 0) {
          <div class="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span class="material-symbols-outlined mb-1 text-3xl text-slate-300" aria-hidden="true"
              >water_drop</span
            >
            <p class="text-caption text-slate-500">Sin datos de pozos para el período.</p>
          </div>
        }
        <canvas #chartCanvas [class.invisible]="loading() || series().length === 0"></canvas>
      </div>
    </section>
  `,
})
export class OverviewNivelCaudalChartComponent implements AfterViewInit, OnDestroy {
  private readonly companyService = inject(CompanyService);

  @Input() set sites(value: SiteRecord[]) {
    this._sites = (value || []).filter((s) => !!s?.id);
    if (this.viewReady) this.loadSeries();
  }
  private _sites: SiteRecord[] = [];

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;
  private viewReady = false;

  readonly ranges: { key: RangeKey; label: string }[] = [
    { key: '24h', label: '24h' },
    { key: '7d', label: '7d' },
    { key: '30d', label: '30d' },
  ];

  readonly range = signal<RangeKey>('7d');
  readonly hidden = signal<Set<string>>(new Set());
  readonly series = signal<SiteSeries[]>([]);
  readonly loading = signal(false);
  readonly exporting = signal(false);
  readonly errorMsg = signal('');

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.loadSeries();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  setRange(range: RangeKey): void {
    if (this.range() === range) return;
    this.range.set(range);
    this.loadSeries();
  }

  reintentar(): void {
    this.loadSeries();
  }

  toggle(siteId: string): void {
    this.hidden.update((prev) => {
      const next = new Set(prev);
      if (next.has(siteId)) next.delete(siteId);
      else next.add(siteId);
      return next;
    });
    this.renderChart();
  }

  private rangeConfig(range: RangeKey): RangeConfig {
    switch (range) {
      case '24h':
        return { limit: 500 };
      case '7d':
        return { limit: 2000, granularity: '1h' };
      case '30d':
        return { limit: 2000, granularity: '1d' };
    }
  }

  private loadSeries(): void {
    const sites = this._sites;
    if (!sites.length) {
      this.series.set([]);
      this.renderChart();
      return;
    }

    const to = new Date();
    const from = new Date(to.getTime() - RANGE_MS[this.range()]);
    const cfg = this.rangeConfig(this.range());
    const opts = {
      from: from.toISOString(),
      to: to.toISOString(),
      ...(cfg.granularity ? { granularity: cfg.granularity } : {}),
    };

    this.loading.set(true);
    this.errorMsg.set('');

    forkJoin(
      sites.map((s) => this.companyService.getSiteDashboardHistory(s.id, cfg.limit, opts)),
    ).subscribe({
      next: (results) => {
        const built: SiteSeries[] = [];
        sites.forEach((site, i) => {
          const res = results[i];
          const entries = res?.ok ? (res.data ?? []) : [];
          const { nivel, caudal } = this.extractSeries(entries);
          if (nivel.length === 0 && caudal.length === 0) return;
          built.push({
            id: site.id,
            nombre: site.descripcion || site.id,
            color: PALETTE[built.length % PALETTE.length],
            nivel,
            caudal,
          });
        });
        this.series.set(built);
        this.loading.set(false);
        this.renderChart();
      },
      error: () => {
        this.series.set([]);
        this.loading.set(false);
        this.errorMsg.set('No se pudo cargar el historial de los pozos.');
        this.renderChart();
      },
    });
  }

  private extractSeries(entries: SiteDashboardHistoryEntry[]): {
    nivel: { x: number; y: number }[];
    caudal: { x: number; y: number }[];
  } {
    const nivel: { x: number; y: number }[] = [];
    const caudal: { x: number; y: number }[] = [];
    for (const entry of entries) {
      const x = Date.parse(entry.timestamp);
      if (!Number.isFinite(x)) continue;
      const nv = this.toNum(entry.variables['nivel_freatico'] ?? entry.variables['nivel']);
      const cv = this.toNum(entry.variables['caudal']);
      if (nv !== null) nivel.push({ x, y: nv });
      if (cv !== null) caudal.push({ x, y: cv });
    }
    nivel.sort((a, b) => a.x - b.x);
    caudal.sort((a, b) => a.x - b.x);
    return { nivel, caudal };
  }

  private toNum(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  private renderChart(): void {
    if (!this.viewReady || !this.chartCanvas?.nativeElement) return;
    this.chart?.destroy();
    this.chart = null;

    const visible = this.series().filter((s) => !this.hidden().has(s.id));
    if (visible.length === 0) return;

    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chart = new Chart(ctx, this.buildConfig(visible, false));
  }

  /** Config de Chart.js compartida entre el gráfico combinado y los PNG por pozo. */
  private buildConfig(sites: SiteSeries[], forExport: boolean): ChartConfiguration<'line'> {
    const datasets = sites.flatMap((s) => [
      {
        label: `${s.nombre} · Caudal`,
        data: s.caudal,
        yAxisID: 'yCaudal',
        borderColor: s.color,
        backgroundColor: s.color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        spanGaps: true,
      },
      {
        label: `${s.nombre} · Nivel`,
        data: s.nivel,
        yAxisID: 'yNivel',
        borderColor: s.color,
        backgroundColor: s.color,
        borderDash: [5, 4],
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.3,
        spanGaps: true,
      },
    ]);

    const reduceMotion =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    return {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: forExport || reduceMotion ? false : { duration: 300, easing: 'easeOutQuart' },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        plugins: {
          legend: {
            display: forExport,
            labels: { font: { family: 'DM Sans', size: 11 }, boxWidth: 18, usePointStyle: false },
          },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#1e293b',
            bodyColor: '#334155',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            titleFont: { family: 'DM Sans', weight: 600, size: 12 },
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            padding: 10,
            cornerRadius: 6,
            callbacks: {
              title: (items) => this.fmtFull(Number(items[0]?.parsed?.x)),
              label: (item) => {
                const unit = item.dataset.yAxisID === 'yNivel' ? 'm' : 'l/s';
                const raw = item.parsed.y;
                const y = raw == null ? '—' : Math.round(raw * 100) / 100;
                return `${item.dataset.label}: ${y} ${unit}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            grid: { display: false },
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono', size: 10 },
              maxTicksLimit: 8,
              callback: (value) => this.fmtTick(Number(value)),
            },
            border: { display: false },
          },
          yNivel: {
            type: 'linear',
            position: 'left',
            title: {
              display: true,
              text: 'Nivel freático (m)',
              color: '#64748b',
              font: { family: 'DM Sans', size: 11, weight: 600 },
            },
            grid: { color: '#f1f5f9' },
            ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } },
            border: { display: false },
          },
          yCaudal: {
            type: 'linear',
            position: 'right',
            title: {
              display: true,
              text: 'Caudal (l/s)',
              color: '#64748b',
              font: { family: 'DM Sans', size: 11, weight: 600 },
            },
            grid: { drawOnChartArea: false },
            ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } },
            border: { display: false },
          },
        },
      },
      plugins: [WHITE_BG],
    } as ChartConfiguration<'line'>;
  }

  /**
   * Exporta un PNG individual por cada pozo (todos, no solo los visibles).
   * Renderiza cada gráfico en un canvas fuera de pantalla con leyenda visible,
   * lo convierte a PNG y dispara la descarga.
   */
  async exportarPngPorPozo(): Promise<void> {
    const sites = this.series();
    if (sites.length === 0 || this.exporting()) return;
    this.exporting.set(true);
    try {
      for (const site of sites) {
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 600;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        const chart = new Chart(ctx, this.buildConfig([site], true));
        const url = chart.toBase64Image('image/png', 1);
        chart.destroy();
        this.downloadDataUrl(url, `${this.slug(site.nombre)}-nivel-caudal-${this.range()}.png`);
      }
    } finally {
      this.exporting.set(false);
    }
  }

  private downloadDataUrl(dataUrl: string, filename: string): void {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  private slug(value: string): string {
    return (
      value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'pozo'
    );
  }

  private fmtTick(ms: number): string {
    const d = new Date(ms);
    if (this.range() === '24h') {
      return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    }
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
  }

  private fmtFull(ms: number): string {
    if (!Number.isFinite(ms)) return '';
    return new Date(ms).toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
}
