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
import { from as fromArray, of, catchError, map, mergeMap, toArray } from 'rxjs';
import { CompanyService, HistoryGranularity } from '../../../services/company.service';
import type { SiteRecord } from '@emeltec/shared';

Chart.register(...registerables);

/** Máx. de requests de historial en vuelo a la vez (protege el pool de la DB). */
const OVERVIEW_HISTORY_CONCURRENCY = 4;

type RangeKey = '24h' | '7d' | 'custom';

interface SiteSeries {
  id: string;
  nombre: string;
  color: string;
  nivel: { x: number; y: number }[];
  caudal: { x: number; y: number }[];
}

/** Resultado por pozo del fetch de historial (res puede ser null si falló). */
interface PozoHistResult {
  site: SiteRecord;
  res: unknown;
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

const RANGE_MS: Record<'24h' | '7d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
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

          <!-- Inputs de rango de fechas (solo modo "Rango") -->
          @if (range() === 'custom') {
            <div class="inline-flex items-center gap-1.5">
              <input
                type="date"
                [value]="customFrom()"
                [max]="customTo()"
                (change)="onCustomFrom($any($event.target).value)"
                aria-label="Fecha desde"
                class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-caption-xs text-slate-600 outline-none focus:border-primary-tint-35"
              />
              <span class="text-caption-xs text-slate-400">a</span>
              <input
                type="date"
                [value]="customTo()"
                [min]="customFrom()"
                (change)="onCustomTo($any($event.target).value)"
                aria-label="Fecha hasta"
                class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-caption-xs text-slate-600 outline-none focus:border-primary-tint-35"
              />
              <button
                type="button"
                (click)="applyCustomRange()"
                class="rounded-lg bg-primary px-2.5 py-1 text-caption-xs font-bold text-white transition-colors hover:bg-primary-container active:scale-95"
              >
                Aplicar
              </button>
            </div>
          }

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
              <span
                [class.text-slate-400]="hidden().has(s.id)"
                [class.line-through]="hidden().has(s.id)"
              >
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
    { key: 'custom', label: 'Rango' },
  ];

  readonly range = signal<RangeKey>('7d');
  // Fechas del modo "Rango" (YYYY-MM-DD). Default: últimos 7 días.
  readonly customFrom = signal<string>(this.isoDaysAgo(7));
  readonly customTo = signal<string>(this.isoDaysAgo(0));
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

  /** Aplica el rango de fechas custom (from ≤ to). Lo dispara el botón/inputs. */
  applyCustomRange(): void {
    if (this.customFrom() && this.customTo() && this.customFrom() > this.customTo()) return;
    this.loadSeries();
  }

  onCustomFrom(v: string): void {
    this.customFrom.set(v);
  }

  onCustomTo(v: string): void {
    this.customTo.set(v);
  }

  /** Fecha (hoy - n días) como YYYY-MM-DD. */
  private isoDaysAgo(n: number): string {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
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

  /**
   * limit + granularidad (cagg) según el rango. Para 'custom' se elige por el
   * span en días: corto → 1m, medio → 1h, largo → 1d. Cada uno mapea a su cagg
   * en el backend (equipo_1min / equipo_hourly / equipo_daily).
   */
  private rangeConfig(range: RangeKey, spanDays: number): RangeConfig {
    if (range === '24h') return { limit: 1500, granularity: '1m' };
    if (range === '7d') return { limit: 2000, granularity: '1h' };
    // custom: por span
    if (spanDays <= 2) return { limit: 3000, granularity: '1m' };
    if (spanDays <= 31) return { limit: 2000, granularity: '1h' };
    return { limit: 2000, granularity: '1d' };
  }

  /** Etiqueta del pozo: número de obra DGA si existe; si no, nombre; si no, id. */
  private siteLabel(site: SiteRecord): string {
    return site.pozo_config?.obra_dga?.trim() || site.descripcion || site.id;
  }

  private loadSeries(): void {
    const sites = this._sites;
    if (!sites.length) {
      this.series.set([]);
      this.renderChart();
      return;
    }

    let from: Date;
    let to: Date;
    if (this.range() === 'custom') {
      const f = this.customFrom();
      const t = this.customTo();
      if (!f || !t || f > t) {
        this.series.set([]);
        this.errorMsg.set('Rango de fechas inválido: "desde" no puede ser mayor que "hasta".');
        this.loading.set(false);
        this.renderChart();
        return;
      }
      from = new Date(`${f}T00:00:00`);
      to = new Date(`${t}T23:59:59`);
    } else {
      to = new Date();
      from = new Date(to.getTime() - RANGE_MS[this.range() as '24h' | '7d']);
    }

    const spanDays = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86400000));
    const cfg = this.rangeConfig(this.range(), spanDays);
    // El backend valida from/to con formato SOLO-fecha (YYYY-MM-DD). Con ISO los
    // descartaba y caía al path sin-rango (escaneo crudo de 48h, lento). En
    // fecha activa el path con rango, servido por el cagg de la granularidad.
    const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
    const opts = {
      from: dateOnly(from),
      to: dateOnly(to),
      ...(cfg.granularity ? { granularity: cfg.granularity } : {}),
    };

    this.loading.set(true);
    this.errorMsg.set('');

    // Concurrencia limitada: el overview pide historial de N pozos, cada uno con
    // varias queries pesadas. Dispararlas TODAS en paralelo (forkJoin) agota el
    // pool de conexiones de la DB con empresas de muchos pozos → 500. mergeMap
    // con tope las procesa en tandas. catchError por pozo: uno que falle se
    // saltea, no tumba el gráfico.
    fromArray(sites)
      .pipe(
        mergeMap(
          (site: SiteRecord) =>
            this.companyService.getSiteDashboardHistory(site.id, cfg.limit, opts).pipe(
              catchError(() => of(null)),
              map((res): PozoHistResult => ({ site, res })),
            ),
          OVERVIEW_HISTORY_CONCURRENCY,
        ),
        toArray(),
      )
      .subscribe({
        next: (results: PozoHistResult[]) => {
          const built: SiteSeries[] = [];
          // Orden estable por etiqueta para que el color de cada pozo no cambie
          // entre recargas (mergeMap devuelve en orden de finalización).
          results.sort((a, b) => this.siteLabel(a.site).localeCompare(this.siteLabel(b.site)));
          for (const { site, res } of results) {
            const ok = res && (res as { ok?: boolean }).ok;
            const { nivel, caudal } = this.extractSeries(ok ? res : null);
            if (nivel.length === 0 && caudal.length === 0) continue;
            built.push({
              id: site.id,
              nombre: this.siteLabel(site),
              color: PALETTE[built.length % PALETTE.length],
              nivel,
              caudal,
            });
          }
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

  /**
   * El endpoint dashboard-history devuelve { data: { rows: [...] } } donde cada
   * fila trae los roles ya clasificados como { ok, valor }: nivel_freatico,
   * nivel, caudal, totalizador. (Mismo shape que consume water-detail-operacion.)
   */
  private extractSeries(res: unknown): {
    nivel: { x: number; y: number }[];
    caudal: { x: number; y: number }[];
  } {
    const rows = (res as { data?: { rows?: unknown[] } } | null)?.data?.rows;
    const list = Array.isArray(rows) ? rows : [];
    const nivel: { x: number; y: number }[] = [];
    const caudal: { x: number; y: number }[] = [];
    for (const row of list as Array<Record<string, unknown>>) {
      const x = Date.parse(String(row['timestamp'] ?? row['fecha'] ?? ''));
      if (!Number.isFinite(x)) continue;
      const nv = this.roleNum(row['nivel_freatico'] ?? row['nivel']);
      const cv = this.roleNum(row['caudal']);
      if (nv !== null) nivel.push({ x, y: nv });
      if (cv !== null) caudal.push({ x, y: cv });
    }
    nivel.sort((a, b) => a.x - b.x);
    caudal.sort((a, b) => a.x - b.x);
    return { nivel, caudal };
  }

  /** Valor de un rol { ok, valor } → número (o null si no medido). */
  private roleNum(role: unknown): number | null {
    const r = role as { ok?: boolean; valor?: unknown } | null | undefined;
    if (!r || r.ok === false) return null;
    return this.toNum(r.valor);
  }

  /** Parseo tolerante a formato chileno ("530.806,375" → 530806.375). */
  private toNum(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    let text = String(raw).trim();
    if (!text) return null;
    if (text.includes(',') && text.includes('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else if (text.includes(',')) {
      text = text.replace(',', '.');
    }
    const n = Number(text.replace(/[^\d.-]/g, ''));
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
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
      return d.toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      });
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
