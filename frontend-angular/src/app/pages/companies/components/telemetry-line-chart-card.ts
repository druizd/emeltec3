import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import {
  Chart,
  ChartConfiguration,
  ChartDataset,
  ChartOptions,
  Plugin,
  TooltipItem,
  registerables,
} from 'chart.js';

Chart.register(...registerables);

type TimePoint = { x: number; y: number };
type ChartPointValue = TimePoint | null;
type ReferenceTone = 'min' | 'target' | 'max' | 'neutral';

export interface TelemetryReferenceLine {
  label: string;
  value: number;
  tone: ReferenceTone;
}

export interface TelemetryChartSeries {
  label: string;
  color: string;
  values: (number | null)[];
  unit?: string;
  precision?: number;
  fill?: boolean;
}

export interface TelemetryLineChart {
  title: string;
  subtitle?: string;
  tone?: 'orange' | 'cyan' | 'green' | 'purple' | 'blue';
  timestamps: number[];
  series: TelemetryChartSeries[];
  referenceLines?: TelemetryReferenceLine[];
  min?: number;
  max?: number;
  emptyText?: string;
  note?: string;
  showLatestBadge?: boolean;
}

@Component({
  selector: 'app-telemetry-line-chart-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="chart-card" [ngClass]="'tone-' + (chart.tone || 'blue')">
      <div class="chart-head">
        <div class="min-w-0">
          <p>{{ chart.subtitle || 'Historico' }}</p>
          <h2>{{ chart.title }}</h2>
        </div>
        <div class="range-tags">
          @if (chart.note) {
            <span class="range-tag--neutral">{{ chart.note }}</span>
          }
          @for (line of chart.referenceLines || []; track line.label) {
            <span [ngClass]="'range-tag--' + line.tone">{{ line.label }}</span>
          }
        </div>
      </div>

      <div class="chart-box">
        <canvas #canvas [class.is-hidden]="!hasRenderableData()"></canvas>
        @if (!hasRenderableData()) {
          <div class="empty-state">
            <span class="material-symbols-outlined">show_chart</span>
            <strong>Sin datos suficientes</strong>
            <span>{{ chart.emptyText || 'Faltan mediciones para construir el grafico.' }}</span>
          </div>
        }
      </div>
    </article>
  `,
  styles: [
    `
      .chart-card {
        position: relative;
        display: flex;
        min-height: 340px;
        height: 100%;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        background: #ffffff;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
      }

      .chart-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 20px 22px 8px;
      }

      p {
        color: #94a3b8;
        font-family: var(--font-josefin);
        font-size: 9px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      h2 {
        margin-top: 3px;
        color: #334155;
        font-size: 15px;
        font-weight: 900;
      }

      .range-tags {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
      }

      .range-tags span {
        border: 1px solid #e6ebf2;
        border-radius: 9999px;
        background: #f8fafc;
        padding: 5px 8px;
        font-size: 10px;
        font-weight: 900;
        white-space: nowrap;
      }

      .range-tag--min {
        border-color: rgba(37, 99, 235, 0.25) !important;
        background: rgba(37, 99, 235, 0.08) !important;
        color: #2563eb;
      }

      .range-tag--target {
        border-color: rgba(34, 197, 94, 0.28) !important;
        background: rgba(34, 197, 94, 0.09) !important;
        color: #16a34a;
      }

      .range-tag--max {
        border-color: rgba(239, 68, 68, 0.25) !important;
        background: rgba(239, 68, 68, 0.08) !important;
        color: #dc2626;
      }

      .range-tag--neutral {
        color: #64748b;
      }

      .chart-box {
        position: relative;
        flex: 1;
        min-height: 260px;
        padding: 4px 22px 16px;
      }

      canvas {
        display: block;
        height: 100% !important;
        width: 100% !important;
      }

      canvas.is-hidden {
        opacity: 0;
      }

      .empty-state {
        display: grid;
        height: 100%;
        min-height: 250px;
        place-items: center;
        align-content: center;
        gap: 6px;
        border-radius: 12px;
        color: #94a3b8;
        text-align: center;
      }

      .empty-state .material-symbols-outlined {
        font-size: 30px;
        color: #cbd5e1;
      }

      .empty-state strong {
        color: #475569;
        font-size: 14px;
      }

      .empty-state span:last-child {
        max-width: 280px;
        font-size: 12px;
        font-weight: 700;
      }

      @media (max-width: 760px) {
        .chart-head {
          flex-direction: column;
        }

        .range-tags {
          justify-content: flex-start;
        }
      }
    `,
  ],
})
export class TelemetryLineChartCardComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) chart!: TelemetryLineChart;
  @ViewChild('canvas') canvas?: ElementRef<HTMLCanvasElement>;

  private chartInstance: Chart<'line'> | null = null;

  ngAfterViewInit(): void {
    this.renderChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['chart'] && this.canvas) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.destroyChart();
  }

  hasRenderableData(): boolean {
    return this.chart.series.some((series) => this.finiteValues(series.values).length >= 2);
  }

  private renderChart(): void {
    const canvas = this.canvas?.nativeElement;
    if (!canvas || !this.chart) return;

    this.destroyChart();
    if (!this.hasRenderableData()) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const config: ChartConfiguration<'line', ChartPointValue[], number> = {
      type: 'line',
      data: {
        datasets: [...this.seriesDatasets(ctx, canvas), ...this.referenceDatasets()],
      },
      options: this.chartOptions(),
      plugins: [this.hoverGuidePlugin(), this.valueBadgePlugin()],
    };

    this.chartInstance = new Chart(ctx, config);
  }

  private seriesDatasets(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
  ): ChartDataset<'line', ChartPointValue[]>[] {
    return this.chart.series.map((series, index) => {
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 360);
      gradient.addColorStop(0, this.withAlpha(series.color, series.fill ? 0.13 : 0));
      gradient.addColorStop(0.58, this.withAlpha(series.color, series.fill ? 0.055 : 0));
      gradient.addColorStop(1, this.withAlpha(series.color, 0));

      return {
        label: series.label,
        data: this.seriesData(series.values),
        borderColor: series.color,
        backgroundColor: gradient,
        borderWidth: index === 0 ? 2.4 : 2,
        fill: Boolean(series.fill),
        tension: 0.16,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 14,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: series.color,
        pointBorderWidth: 2,
        pointStyle: 'circle',
        spanGaps: true,
        order: 1,
      };
    });
  }

  private seriesData(values: (number | null)[]): ChartPointValue[] {
    return values.map((value, index) => {
      const timestamp = this.chart.timestamps[index];
      if (!Number.isFinite(value) || !Number.isFinite(timestamp)) return null;
      return { x: Number(timestamp), y: Number(value) };
    });
  }

  private referenceDatasets(): ChartDataset<'line', ChartPointValue[]>[] {
    return (this.chart.referenceLines || []).map((line) => ({
      label: line.label,
      data: this.referenceDatasetData(line.value),
      borderColor: this.referenceColor(line.tone),
      backgroundColor: this.referenceColor(line.tone),
      borderDash: line.tone === 'target' ? [8, 6] : [6, 7],
      borderWidth: line.tone === 'target' ? 1.8 : 1.6,
      pointRadius: 0,
      pointHoverRadius: 0,
      pointHitRadius: 0,
      fill: false,
      tension: 0,
      order: 0,
    }));
  }

  private referenceDatasetData(value: number): ChartPointValue[] {
    const { min, max } = this.xBounds();
    return [
      { x: min, y: value },
      { x: max, y: value },
    ];
  }

  private chartOptions(): ChartOptions<'line'> {
    const yBounds = this.visibleYBounds();
    const xBounds = this.xBounds();

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      animation: {
        duration: 300,
      },
      scales: {
        x: {
          type: 'linear',
          min: xBounds.min,
          max: xBounds.max,
          grid: {
            color: '#e7ecf3',
            drawTicks: false,
          },
          border: {
            color: '#dbe3ee',
          },
          ticks: {
            color: '#94a3b8',
            autoSkip: true,
            maxTicksLimit: 9,
            maxRotation: 0,
            minRotation: 0,
            font: {
              family: 'JetBrains Mono',
              size: 11,
              weight: 800,
            },
            padding: 12,
            callback: (value) => this.formatTickTimestamp(Number(value)),
          },
        },
        y: {
          min: yBounds.min,
          max: yBounds.max,
          grid: {
            color: '#e7ecf3',
            drawTicks: false,
          },
          border: {
            color: '#dbe3ee',
          },
          ticks: {
            color: '#94a3b8',
            stepSize: this.yStep(yBounds),
            font: {
              family: 'JetBrains Mono',
              size: 11,
              weight: 800,
            },
            padding: 12,
            callback: (value) => this.formatAxisValue(Number(value)),
          },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            boxHeight: 8,
            boxWidth: 18,
            color: '#64748b',
            font: {
              family: 'DM Sans',
              size: 12,
              weight: 700,
            },
            filter: (item) => (item.datasetIndex ?? 0) < this.chart.series.length,
            usePointStyle: true,
          },
        },
        tooltip: {
          enabled: true,
          filter: (item) => item.datasetIndex < this.chart.series.length,
          backgroundColor: '#ffffff',
          borderColor: '#dbe3ee',
          borderWidth: 1,
          bodyColor: '#334155',
          titleColor: '#0f172a',
          titleFont: {
            family: 'DM Sans',
            size: 13,
            weight: 900,
          },
          bodyFont: {
            family: 'DM Sans',
            size: 12,
            weight: 700,
          },
          cornerRadius: 10,
          displayColors: true,
          padding: 12,
          caretPadding: 8,
          boxPadding: 4,
          callbacks: {
            title: (items) => this.formatTooltipTimestamp(Number(items[0]?.parsed?.x)),
            label: (item) => this.tooltipLabel(item),
          },
        },
      },
    };
  }

  private hoverGuidePlugin(): Plugin<'line'> {
    return {
      id: 'telemetry-hover-guide',
      afterDraw: (chart) => {
        const active = chart.tooltip?.getActiveElements?.() || [];
        const first = active[0];
        if (!first) return;
        const point = chart.getDatasetMeta(first.datasetIndex).data[first.index];
        if (!point) return;

        const { ctx, chartArea } = chart;
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(point.x, chartArea.top);
        ctx.lineTo(point.x, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
      },
    };
  }

  private valueBadgePlugin(): Plugin<'line'> {
    return {
      id: 'telemetry-value-badge',
      afterDatasetsDraw: (chart) => {
        if (!this.chart.showLatestBadge) return;
        const dataset = chart.data.datasets[0];
        const meta = chart.getDatasetMeta(0);
        const lastIndex = this.lastFiniteDataIndex(dataset.data as ChartPointValue[]);
        const point = meta.data[lastIndex];
        const value = this.pointY(dataset.data[lastIndex] as ChartPointValue);
        const series = this.chart.series[0];
        if (!point || typeof value !== 'number' || !series) return;

        const ctx = chart.ctx;
        const text = `${this.formatValue(value, series)}${series.unit ? ` ${series.unit}` : ''}`;
        ctx.save();
        ctx.font = '900 11px JetBrains Mono';
        const metrics = ctx.measureText(text);
        const width = metrics.width + 18;
        const height = 26;
        const x = Math.min(chart.chartArea.right - width - 2, point.x + 12);
        const y = Math.max(chart.chartArea.top + 6, point.y - height / 2);

        ctx.fillStyle = series.color;
        this.roundRect(ctx, x, y, width, height, 10);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, x + 9, y + 17);
        ctx.restore();
      },
    };
  }

  private tooltipLabel(item: TooltipItem<'line'>): string {
    const series = this.chart.series[item.datasetIndex];
    const value = typeof item.parsed.y === 'number' ? item.parsed.y : Number(item.raw || 0);
    const suffix = series?.unit ? ` ${series.unit}` : '';
    return `${series?.label || item.dataset.label}: ${this.formatValue(value, series)}${suffix}`;
  }

  private xBounds(): { min: number; max: number } {
    const timestamps = this.chart.timestamps.filter(Number.isFinite);
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const now = Date.now();
      return { min: now - 60 * 60 * 1000, max: now };
    }
    if (min === max) return { min: min - 30 * 60 * 1000, max: max + 30 * 60 * 1000 };
    return { min, max };
  }

  private visibleYBounds(): { min: number; max: number } {
    const values = [
      ...this.chart.series.flatMap((series) => this.finiteValues(series.values)),
      ...(this.chart.referenceLines || []).map((line) => line.value),
    ].filter(Number.isFinite);

    if (!values.length) return { min: this.chart.min ?? 0, max: this.chart.max ?? 1 };

    const rawMin = this.chart.min ?? Math.min(...values);
    const rawMax = this.chart.max ?? Math.max(...values);
    if (rawMin === rawMax) return { min: rawMin - 1, max: rawMax + 1 };

    const span = rawMax - rawMin;
    const padding = span * 0.14;
    const min = this.chart.min ?? rawMin - padding;
    const max = this.chart.max ?? rawMax + padding;
    const roundTo = this.roundUnit(max - min);

    return {
      min: Math.floor(min / roundTo) * roundTo,
      max: Math.ceil(max / roundTo) * roundTo,
    };
  }

  private yStep(bounds: { min: number; max: number }): number {
    const range = bounds.max - bounds.min;
    if (range <= 1) return 0.2;
    if (range <= 5) return 1;
    if (range <= 15) return 2;
    if (range <= 40) return 5;
    if (range <= 120) return 20;
    if (range <= 1000) return 100;
    return Math.ceil(range / 5 / 100) * 100;
  }

  private roundUnit(range: number): number {
    if (range <= 2) return 0.1;
    if (range <= 20) return 1;
    if (range <= 200) return 5;
    if (range <= 1000) return 25;
    return 100;
  }

  private finiteValues(values: (number | null)[]): number[] {
    return values.filter((value): value is number => Number.isFinite(value));
  }

  private lastFiniteDataIndex(data: ChartPointValue[]): number {
    for (let index = data.length - 1; index >= 0; index -= 1) {
      if (typeof this.pointY(data[index]) === 'number') return index;
    }
    return -1;
  }

  private pointY(value: ChartPointValue): number | null {
    if (value && typeof value.y === 'number' && Number.isFinite(value.y)) return value.y;
    return null;
  }

  private formatTickTimestamp(timestampMs: number): string {
    if (!Number.isFinite(timestampMs)) return '';
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(new Date(timestampMs));
    const day = parts.find((part) => part.type === 'day')?.value || '';
    const hour = parts.find((part) => part.type === 'hour')?.value || '';
    const minute = parts.find((part) => part.type === 'minute')?.value || '';
    return hour === '00' && minute === '00' ? String(Number(day)) : `${hour}:${minute}`;
  }

  private formatTooltipTimestamp(timestampMs: number): string {
    if (!Number.isFinite(timestampMs)) return '';
    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    })
      .format(new Date(timestampMs))
      .replace(/\./g, '');
  }

  private formatValue(value: number, series?: TelemetryChartSeries): string {
    return value.toLocaleString('es-CL', {
      minimumFractionDigits: series?.precision,
      maximumFractionDigits: series?.precision ?? 2,
    });
  }

  private formatAxisValue(value: number): string {
    if (!Number.isFinite(value)) return '';
    const abs = Math.abs(value);
    const maximumFractionDigits = abs < 2 ? 2 : abs < 20 ? 1 : 0;
    return value.toLocaleString('es-CL', { maximumFractionDigits });
  }

  private referenceColor(tone: ReferenceTone): string {
    if (tone === 'max') return '#ef4444';
    if (tone === 'target') return '#22c55e';
    if (tone === 'min') return '#2563eb';
    return '#94a3b8';
  }

  private withAlpha(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ): void {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  private destroyChart(): void {
    this.chartInstance?.destroy();
    this.chartInstance = null;
  }
}
