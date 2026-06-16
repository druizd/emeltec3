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
type SeriesAggregation = 'avg' | 'last' | 'min' | 'max';
type MissingValueMode = 'gap' | 'zero' | 'carry';

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
  aggregation?: SeriesAggregation;
  missingValue?: MissingValueMode;
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
  compact?: boolean;
  maxVisiblePoints?: number;
  bucketMinutes?: number;
  extendToNow?: boolean;
  xMin?: number;
  xMax?: number;
}

@Component({
  selector: 'app-telemetry-line-chart-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article
      class="chart-card"
      [class.chart-card--compact]="chart.compact"
      [ngClass]="'tone-' + (chart.tone || 'blue')"
    >
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
        min-height: 0;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid #dce5ef;
        border-radius: 12px;
        background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
        box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
      }

      .chart-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        padding: 20px 22px 6px;
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
        flex: none;
        height: 242px;
        min-height: 0;
        padding: 6px 22px 18px;
      }

      .chart-card--compact .chart-box {
        height: 202px;
      }

      canvas {
        display: block;
        height: 100% !important;
        max-height: 100%;
        width: 100% !important;
      }

      canvas.is-hidden {
        opacity: 0;
      }

      .empty-state {
        display: grid;
        height: 100%;
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
    if (this.canRenderFilledTimeline()) return true;
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
      const style = this.seriesStyle(series.label, index);
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 360);
      gradient.addColorStop(0, this.withAlpha(series.color, series.fill ? 0.13 : 0));
      gradient.addColorStop(0.58, this.withAlpha(series.color, series.fill ? 0.055 : 0));
      gradient.addColorStop(1, this.withAlpha(series.color, 0));

      return {
        label: series.label,
        data: this.seriesData(series),
        borderColor: series.color,
        backgroundColor: gradient,
        borderWidth: style.borderWidth,
        borderDash: style.borderDash,
        borderCapStyle: 'round',
        borderJoinStyle: 'round',
        fill: Boolean(series.fill),
        tension: style.tension,
        cubicInterpolationMode: 'monotone',
        normalized: true,
        pointRadius: 0,
        pointHoverRadius: style.pointHoverRadius,
        pointHitRadius: 14,
        pointBackgroundColor: '#ffffff',
        pointBorderColor: series.color,
        pointBorderWidth: style.pointBorderWidth,
        pointStyle: style.pointStyle,
        spanGaps: true,
        order: style.order,
      };
    });
  }

  private seriesData(series: TelemetryChartSeries): ChartPointValue[] {
    const values = series.values;
    if (this.chart.bucketMinutes) return this.bucketedSeriesData(series);

    const points = this.displayIndexes().map((index) => {
      const value = values[index];
      const timestamp = this.chart.timestamps[index];
      if (!Number.isFinite(value) || !Number.isFinite(timestamp)) return null;
      return { x: Number(timestamp), y: Number(value) };
    });

    return this.extendPointsToNow(points);
  }

  private bucketedSeriesData(series: TelemetryChartSeries): ChartPointValue[] {
    const values = series.values;
    let lastValue: number | null = null;
    return this.bucketTimeline().map((bucket) => {
      const aggregate = bucket.extension
        ? null
        : this.aggregateBucketValues(values, bucket.indexes, series.aggregation ?? 'avg');
      let value = aggregate;

      if (typeof aggregate === 'number') {
        lastValue = aggregate;
      } else if (series.missingValue === 'zero') {
        value = 0;
      } else if (series.missingValue === 'carry') {
        value = lastValue;
      } else if (bucket.extension) {
        value = lastValue;
      }

      if (typeof value === 'number') lastValue = value;
      return typeof value === 'number' ? { x: bucket.x, y: value } : null;
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
          afterBuildTicks: (scale) => {
            scale.ticks = this.xTicks(xBounds).map((value) => ({ value }));
          },
          grid: {
            color: '#dfe7f0',
            drawTicks: false,
          },
          border: {
            color: '#d3dde9',
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
            color: '#dfe7f0',
            drawTicks: false,
          },
          border: {
            color: '#d3dde9',
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
            padding: 18,
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
          itemSort: (a, b) =>
            this.tooltipOrder(a.dataset.label) - this.tooltipOrder(b.dataset.label),
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
    if (Number.isFinite(this.chart.xMin) && Number.isFinite(this.chart.xMax)) {
      const min = Number(this.chart.xMin);
      const max = Number(this.chart.xMax);
      if (max > min) return { min, max };
    }

    const timestamps = this.plotTimestamps();
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const now = Date.now();
      return { min: now - 60 * 60 * 1000, max: now };
    }
    if (min === max) return { min: min - 30 * 60 * 1000, max: max + 30 * 60 * 1000 };
    return { min, max };
  }

  private plotTimestamps(): number[] {
    if (this.chart.bucketMinutes) return this.bucketTimeline().map((bucket) => bucket.x);
    const timestamps = this.displayIndexes()
      .map((index) => this.chart.timestamps[index])
      .filter(Number.isFinite);
    const now = Date.now();
    const latest = this.latestRawTimestamp();
    if (latest !== null && this.shouldExtendToNow(latest, now)) timestamps.push(now);
    return timestamps;
  }

  private bucketTimeline(): { x: number; indexes: number[]; extension?: boolean }[] {
    const bucketMs = Math.max(1, this.chart.bucketMinutes ?? 60) * 60_000;
    const buckets = new Map<number, number[]>();
    const xMin = Number(this.chart.xMin);
    const xMax = Number(this.chart.xMax);
    const shouldFillMissingTimeline =
      this.chart.series.some(
        (series) => series.missingValue === 'zero' || series.missingValue === 'carry',
      ) &&
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      xMax > xMin;

    for (let index = 0; index < this.chart.timestamps.length; index += 1) {
      const timestamp = this.chart.timestamps[index];
      if (!Number.isFinite(timestamp)) continue;
      const bucket = Math.floor(Number(timestamp) / bucketMs) * bucketMs;
      const indexes = buckets.get(bucket) || [];
      indexes.push(index);
      buckets.set(bucket, indexes);
    }

    if (shouldFillMissingTimeline) {
      const start = Math.floor(xMin / bucketMs) * bucketMs;
      const end = Math.ceil(xMax / bucketMs) * bucketMs;
      for (let bucket = start; bucket <= end; bucket += bucketMs) {
        if (!buckets.has(bucket)) buckets.set(bucket, []);
      }
    }

    let timeline: { x: number; indexes: number[]; extension?: boolean }[] = Array.from(
      buckets.entries(),
    )
      .sort(([a], [b]) => a - b)
      .map(([x, indexes]) => ({ x, indexes }));

    const latest = this.latestRawTimestamp();
    const now = Date.now();
    if (!shouldFillMissingTimeline && latest !== null && this.shouldExtendToNow(latest, now)) {
      const last = timeline[timeline.length - 1];
      if (!last || now - last.x > 60_000) timeline.push({ x: now, indexes: [], extension: true });
    }

    const maxPoints = this.chart.maxVisiblePoints ?? (this.chart.compact ? 180 : 280);
    if (timeline.length <= maxPoints) return timeline;

    const selected = new Set<number>();
    const last = timeline.length - 1;
    for (let index = 0; index < maxPoints; index += 1) {
      selected.add(Math.round((index * last) / (maxPoints - 1)));
    }
    if (timeline.length) selected.add(timeline.length - 1);
    timeline = Array.from(selected)
      .sort((a, b) => a - b)
      .map((index) => timeline[index]!);

    return timeline;
  }

  private aggregateBucketValues(
    values: (number | null)[],
    indexes: number[],
    aggregation: SeriesAggregation,
  ): number | null {
    const finite = indexes
      .map((index) => values[index])
      .filter((value): value is number => Number.isFinite(value));
    if (!finite.length) return null;
    if (aggregation === 'last') return finite[finite.length - 1]!;
    if (aggregation === 'min') return Math.min(...finite);
    if (aggregation === 'max') return Math.max(...finite);
    return finite.reduce((sum, value) => sum + value, 0) / finite.length;
  }

  private extendPointsToNow(points: ChartPointValue[]): ChartPointValue[] {
    const latest = this.latestRawTimestamp();
    const now = Date.now();
    if (latest === null || !this.shouldExtendToNow(latest, now)) return points;
    const last = [...points]
      .reverse()
      .find((point): point is TimePoint => this.pointY(point) !== null);
    if (!last || now - last.x <= 60_000) return points;
    return [...points, { x: now, y: last.y }];
  }

  private latestRawTimestamp(): number | null {
    const timestamps = this.chart.timestamps.filter(Number.isFinite);
    if (!timestamps.length) return null;
    return Math.max(...timestamps);
  }

  private shouldExtendToNow(latestTimestamp: number, now: number): boolean {
    if (!this.chart.extendToNow || now <= latestTimestamp) return false;
    const bucketMs = Math.max(30 * 60_000, (this.chart.bucketMinutes ?? 60) * 60_000 * 1.5);
    return (
      now - latestTimestamp <= bucketMs &&
      this.localDateKey(latestTimestamp) === this.localDateKey(now)
    );
  }

  private xTicks(bounds: { min: number; max: number }): number[] {
    const hour = 60 * 60 * 1000;
    const twelveHours = 12 * hour;
    const span = bounds.max - bounds.min;
    const ticks: number[] = [];

    if (span <= 3 * hour + 60_000) {
      const halfHour = 30 * 60 * 1000;
      const firstTick = Math.ceil(bounds.min / halfHour) * halfHour;
      ticks.push(bounds.min);
      for (let value = firstTick; value < bounds.max; value += halfHour) {
        if (value > bounds.min) ticks.push(value);
      }
      ticks.push(bounds.max);
      return Array.from(new Set(ticks)).sort((a, b) => a - b);
    }

    const firstHour = Math.floor(bounds.min / hour) * hour;

    for (let value = firstHour; value <= bounds.max; value += hour) {
      const time = this.localTimeParts(value);
      if (time.minute === '00' && (time.hour === '00' || time.hour === '12')) ticks.push(value);
    }

    if (!ticks.length) ticks.push(bounds.min);
    if (ticks[0]! - bounds.min > twelveHours * 0.6) ticks.unshift(bounds.min);
    if (Math.abs(ticks[ticks.length - 1]! - bounds.max) > hour) {
      ticks.push(bounds.max);
    }
    return Array.from(new Set(ticks)).sort((a, b) => a - b);
  }

  private displayIndexes(): number[] {
    const timestamps = this.chart.timestamps;
    const maxPoints = this.chart.maxVisiblePoints ?? (this.chart.compact ? 180 : 280);
    const validIndexes = timestamps
      .map((timestamp, index) => (Number.isFinite(timestamp) ? index : -1))
      .filter((index) => index >= 0);

    if (validIndexes.length <= maxPoints) return validIndexes;

    const selected = new Set<number>();
    const last = validIndexes.length - 1;
    for (let index = 0; index < maxPoints; index += 1) {
      selected.add(validIndexes[Math.round((index * last) / (maxPoints - 1))]!);
    }
    return Array.from(selected).sort((a, b) => a - b);
  }

  private seriesStyle(
    label: string,
    index: number,
  ): {
    borderWidth: number;
    borderDash: number[];
    pointHoverRadius: number;
    pointBorderWidth: number;
    pointStyle: 'circle' | 'triangle' | 'rectRot' | 'rectRounded';
    tension: number;
    order: number;
  } {
    const normalized = label.toLocaleLowerCase('es-CL');
    const isTotal = normalized.includes('total') || normalized.includes('principal');
    const pointStyles = ['circle', 'triangle', 'rectRot', 'rectRounded'] as const;

    return {
      borderWidth: isTotal ? 2.6 : index === 0 ? 2.25 : 2.05,
      borderDash: [],
      pointHoverRadius: isTotal ? 5.2 : 4.8,
      pointBorderWidth: isTotal ? 2.4 : 2.1,
      pointStyle: pointStyles[index % pointStyles.length],
      tension: 0.18,
      order: isTotal ? 3 : 2,
    };
  }

  private tooltipOrder(label?: string): number {
    const normalized = (label || '').toLocaleLowerCase('es-CL');
    if (normalized.includes('total')) return -1;
    if (normalized.includes('principal')) return -1;
    return 0;
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

  private canRenderFilledTimeline(): boolean {
    const xMin = Number(this.chart.xMin);
    const xMax = Number(this.chart.xMax);
    const hasZeroFill = this.chart.series.some((series) => series.missingValue === 'zero');
    const hasCarrySeed = this.chart.series.some(
      (series) => series.missingValue === 'carry' && this.finiteValues(series.values).length >= 1,
    );
    return (
      Boolean(this.chart.bucketMinutes) &&
      (hasZeroFill || hasCarrySeed) &&
      Number.isFinite(xMin) &&
      Number.isFinite(xMax) &&
      xMax > xMin
    );
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
    if (hour === '00' && minute === '00' && day) return `${Number(day)} 00:00`;
    return `${hour}:${minute}`;
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

  private localDateKey(timestampMs: number): string {
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestampMs));
    const year = parts.find((part) => part.type === 'year')?.value || '';
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const day = parts.find((part) => part.type === 'day')?.value || '';
    return `${year}-${month}-${day}`;
  }

  private localTimeParts(timestampMs: number): { hour: string; minute: string } {
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      hour12: false,
    }).formatToParts(new Date(timestampMs));
    return {
      hour: parts.find((part) => part.type === 'hour')?.value || '',
      minute: parts.find((part) => part.type === 'minute')?.value || '',
    };
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
