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
import type { PasteurChart, PasteurReferenceLine } from './pasteurizador-dashboard.models';

Chart.register(...registerables);

@Component({
  selector: 'app-pasteurizador-chart-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article
      class="chart-card"
      [class.chart-card--featured]="featured"
      [ngClass]="'tone-' + chart.tone"
    >
      <div class="chart-head">
        <div>
          <p>{{ chart.subtitle || 'Tiempo real' }}</p>
          <h2>{{ chart.title }}</h2>
        </div>
        <div class="range-tags">
          @for (line of chart.referenceLines || []; track line.label) {
            <span [ngClass]="'range-tag--' + line.tone">{{ line.label }}</span>
          }
        </div>
      </div>

      <div class="chart-box">
        <canvas #canvas></canvas>
      </div>
    </article>
  `,
  styles: [
    `
      .chart-card {
        position: relative;
        display: flex;
        height: 100%;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #e6ebf2;
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.06);
      }

      .chart-card--featured {
        min-height: 330px;
      }

      .chart-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        border-bottom: 1px solid #edf1f6;
        padding: 13px 16px 11px;
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
        color: #0f172a;
        font-size: 16px;
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

      .chart-box {
        position: relative;
        flex: 1;
        height: 300px;
        padding: 10px 16px 16px;
      }

      .chart-card--featured .chart-box {
        height: 240px;
      }

      canvas {
        display: block;
        height: 100% !important;
        width: 100% !important;
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
export class PasteurizadorChartCardComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) chart!: PasteurChart;
  @Input() featured = false;
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

  private renderChart(): void {
    const canvas = this.canvas?.nativeElement;
    if (!canvas || !this.chart) return;

    this.destroyChart();

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const color = this.seriesColor();
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 360);
    gradient.addColorStop(0, this.withAlpha(color, 0.13));
    gradient.addColorStop(0.58, this.withAlpha(color, 0.055));
    gradient.addColorStop(1, this.withAlpha(color, 0.01));

    const config: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: this.chart.times,
        datasets: [
          {
            label: this.chart.title,
            data: this.chart.values,
            borderColor: color,
            backgroundColor: gradient,
            borderWidth: this.featured ? 3.4 : 3,
            fill: true,
            tension: 0,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHitRadius: 14,
            pointBackgroundColor: color,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            order: 1,
          },
          ...this.referenceDatasets(),
        ],
      },
      options: this.chartOptions(),
      plugins: [this.valueBadgePlugin()],
    };

    this.chartInstance = new Chart(ctx, config);
  }

  private referenceDatasets(): ChartDataset<'line', number[]>[] {
    return (this.chart.referenceLines || []).map((line) => ({
      label: line.label,
      data: this.chart.values.map(() => line.value),
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

  private chartOptions(): ChartOptions<'line'> {
    const yBounds = this.visibleYBounds();

    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      animation: {
        duration: 350,
      },
      scales: {
        x: {
          grid: {
            color: (context) =>
              this.xTickLabel(context.index || 0) ? '#e7ecf3' : 'rgba(231, 236, 243, 0)',
            drawTicks: false,
          },
          border: {
            color: '#dbe3ee',
          },
          ticks: {
            color: '#94a3b8',
            autoSkip: false,
            font: {
              family: 'JetBrains Mono',
              size: 11,
              weight: 800,
            },
            padding: 12,
            callback: (_value, index) => this.xTickLabel(index),
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
            callback: (value) => `${value}`,
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
              weight: 800,
            },
            filter: (item) => item.datasetIndex !== undefined,
            usePointStyle: true,
          },
        },
        tooltip: {
          enabled: true,
          filter: (item) => item.datasetIndex === 0,
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
            weight: 800,
          },
          cornerRadius: 10,
          displayColors: true,
          padding: 12,
          callbacks: {
            title: (items) => this.tooltipTitle(items),
            label: (item) => this.tooltipLabel(item),
          },
        },
      },
    };
  }

  private valueBadgePlugin(): Plugin<'line'> {
    return {
      id: 'pasteur-value-badge',
      afterDatasetsDraw: (chart) => {
        const dataset = chart.data.datasets[0];
        const meta = chart.getDatasetMeta(0);
        const point = meta.data[meta.data.length - 1];
        const value = dataset.data[dataset.data.length - 1];
        if (!point || typeof value !== 'number') return;

        const ctx = chart.ctx;
        const text = `${value.toFixed(this.chart.unit === 'L' ? 0 : 1)} ${this.chart.unit}`;
        ctx.save();
        ctx.font = '900 11px JetBrains Mono';
        const metrics = ctx.measureText(text);
        const width = metrics.width + 18;
        const height = 26;
        const x = Math.min(chart.chartArea.right - width - 2, point.x + 12);
        const y = Math.max(chart.chartArea.top + 6, point.y - height / 2);

        ctx.fillStyle = this.seriesColor();
        this.roundRect(ctx, x, y, width, height, 10);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.fillText(text, x + 9, y + 17);
        ctx.restore();
      },
    };
  }

  private tooltipTitle(items: TooltipItem<'line'>[]): string {
    const label = String(items[0]?.label || '');
    return `${this.chart.tooltipDateLabel || '02 Junio 2026'} ${label}`;
  }

  private tooltipLabel(item: TooltipItem<'line'>): string {
    const value = typeof item.parsed.y === 'number' ? item.parsed.y : Number(item.raw || 0);
    const suffix = this.chart.unit ? ` ${this.chart.unit}` : '';
    return `${this.chart.tooltipMetricLabel || item.dataset.label}: ${value.toLocaleString(
      'es-CL',
      {
        maximumFractionDigits: this.chart.unit === 'L' ? 0 : 1,
      },
    )}${suffix}`;
  }

  private visibleYBounds(): { min: number; max: number } {
    const referenceValues = (this.chart.referenceLines || []).map((line) => line.value);
    const values = [...this.chart.values, ...referenceValues].filter(Number.isFinite);
    if (!values.length) return { min: this.chart.min, max: this.chart.max };

    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const minSpan = this.chart.unit === '°C' ? (this.featured ? 16 : 10) : 500;
    const span = Math.max(rawMax - rawMin, minSpan);
    const center = (rawMin + rawMax) / 2;
    const paddedSpan = span * 1.22;
    const roundTo = this.chart.unit === '°C' ? 1 : 100;
    const lowerLimit = this.chart.unit === 'L' ? 0 : Number.NEGATIVE_INFINITY;

    const min = Math.max(lowerLimit, center - paddedSpan / 2);
    const max = center + paddedSpan / 2;

    return {
      min: Math.floor(min / roundTo) * roundTo,
      max: Math.ceil(max / roundTo) * roundTo,
    };
  }

  private yStep(bounds: { min: number; max: number }): number {
    const range = bounds.max - bounds.min;
    if (range <= 12) return 2;
    if (range <= 25) return 5;
    if (range <= 100) return 10;
    if (range <= 1000) return 250;
    return Math.ceil(range / 4 / 100) * 100;
  }

  private xTickLabel(index: number): string {
    const label = this.chart.times[index] || '';
    if (!label) return '';

    const minute = Number(label.slice(-2));
    const isEdge = index === 0 || index === this.chart.times.length - 1;
    return isEdge || minute % 10 === 0 ? label : '';
  }

  private seriesColor(): string {
    switch (this.chart.tone) {
      case 'cyan':
        return '#0dafbd';
      case 'green':
      case 'success':
        return '#22c55e';
      case 'orange':
        return '#f97316';
      default:
        return '#8b5cf6';
    }
  }

  private referenceColor(tone: PasteurReferenceLine['tone']): string {
    if (tone === 'max') return '#ef4444';
    if (tone === 'target') return '#22c55e';
    return '#2563eb';
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
