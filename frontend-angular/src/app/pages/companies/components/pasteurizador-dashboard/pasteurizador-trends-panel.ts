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
  signal,
} from '@angular/core';
import {
  Chart,
  ChartConfiguration,
  ChartDataset,
  ChartOptions,
  TooltipItem,
  registerables,
} from 'chart.js';
import type {
  PasteurizadorBatchResponse,
  PasteurizadorDailyKpisResponse,
} from '../../../../services/company.service';
import { CHILE_TIME_ZONE } from '../../../../shared/timezone';

Chart.register(...registerables);

interface BatchRow {
  id: number;
  inicio: string;
  termino: string;
  duracion: string;
  temperatura: string;
  salida: string;
  cierres: number;
  errores: number;
}

interface TrendSummaryCard {
  label: string;
  value: string;
  icon: string;
  tone: 'green' | 'blue' | 'amber' | 'cyan' | 'red';
}

@Component({
  selector: 'app-pasteurizador-trends-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="trend-overview" aria-label="Resumen de tendencias">
      @for (card of summaryCards(); track card.label) {
        <article class="trend-mini-card" [ngClass]="'tone-' + card.tone">
          <span class="material-symbols-outlined">{{ card.icon }}</span>
          <div>
            <p>{{ card.label }}</p>
            <strong>{{ card.value }}</strong>
          </div>
        </article>
      }
    </section>

    <section class="trend-card">
      <header class="trend-card__hero">
        <div class="trend-title">
          <span class="material-symbols-outlined">monitoring</span>
          <div>
            <p>Salida producto a tina vs pasteurizacion</p>
            <strong>Analisis comparativo de tendencias</strong>
          </div>
        </div>

        <div class="trend-actions" aria-label="Rango rapido">
          <button
            type="button"
            [class.is-active]="selectedDurationMinutes() === 30"
            (click)="applyPreset(30)"
          >
            30m
          </button>
          <button
            type="button"
            [class.is-active]="selectedDurationMinutes() === 60"
            (click)="applyPreset(60)"
          >
            1h
          </button>
          <button
            type="button"
            [class.is-active]="selectedDurationMinutes() >= 115"
            (click)="applyPreset(120)"
          >
            2h
          </button>
        </div>
      </header>

      <div class="trend-body">
        <div class="chart-toolbar">
          <div class="legend" aria-label="Variables visibles">
            <span class="legend-item legend-item--purple">Pasteurizacion</span>
            <span class="legend-item legend-item--cyan">Temperatura entrada</span>
            <span class="legend-item legend-item--green">Salida a tina</span>
            <span class="legend-item legend-item--orange">Valvula</span>
          </div>

          <div class="window-label">
            <span>{{ windowLabel() }}</span>
            <strong>Max. 2 horas</strong>
          </div>
        </div>

        <div class="trend-chart">
          <canvas #canvas></canvas>
        </div>

        <div class="time-brush" aria-label="Selector de tiempo visible">
          <svg viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
            <path [attr.d]="previewPath()" />
          </svg>
          <span
            class="brush-selection"
            [style.left]="brushLeft()"
            [style.width]="brushWidth()"
          ></span>
          <div class="range-inputs">
            <input
              type="range"
              min="0"
              [max]="rangeMax()"
              [value]="rangeStart()"
              (input)="setRangeStart($event)"
              aria-label="Inicio del rango visible"
            />
            <input
              type="range"
              min="0"
              [max]="rangeMax()"
              [value]="rangeEnd()"
              (input)="setRangeEnd($event)"
              aria-label="Fin del rango visible"
            />
          </div>
        </div>
      </div>
    </section>

    <section class="batch-card">
      <header>
        <div>
          <span class="material-symbols-outlined">assignment</span>
          <h2>Registro de Batches</h2>
        </div>
        <button type="button">
          <span class="material-symbols-outlined">download</span>
          Exportar a Excel
        </button>
      </header>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>N° Batch</th>
              <th>Tiempo</th>
              <th>Temp Promedio</th>
              <th>Salida Producto a Tina</th>
              <th>N° Cierre Valvula</th>
              <th>N° Errores Criticos</th>
            </tr>
          </thead>
          <tbody>
            @for (batch of batches(); track batch.id) {
              <tr>
                <td class="batch-id">{{ batch.id }}</td>
                <td>
                  <div class="time-cell">
                    <span class="material-symbols-outlined">schedule</span>
                    <strong>{{ batch.duracion }}</strong>
                    <small>{{ batch.inicio }} ~ {{ batch.termino }}</small>
                  </div>
                </td>
                <td>
                  <span class="metric-chip metric-chip--blue">{{ batch.temperatura }}</span>
                </td>
                <td>{{ batch.salida }}</td>
                <td>
                  <span class="metric-chip metric-chip--amber">{{ batch.cierres }}</span>
                </td>
                <td>
                  <span
                    class="metric-chip"
                    [class.metric-chip--red]="batch.errores > 0"
                    [class.metric-chip--neutral]="batch.errores === 0"
                  >
                    {{ batch.errores }}
                  </span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td class="empty-batches" colspan="6">Sin batches completos hoy</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: grid;
        gap: 26px;
      }

      .trend-overview {
        display: grid;
        grid-template-columns: repeat(5, minmax(168px, 1fr));
        gap: 14px;
        align-items: stretch;
        padding-inline: 2px;
      }

      .trend-mini-card {
        display: flex;
        min-height: 66px;
        align-items: center;
        gap: 12px;
        overflow: hidden;
        border: 1px solid #dfe7f1;
        border-radius: 13px;
        background: #ffffff;
        padding: 12px 14px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.05);
      }

      .trend-mini-card > .material-symbols-outlined {
        display: grid;
        height: 38px;
        width: 38px;
        flex-shrink: 0;
        place-items: center;
        border-radius: 11px;
        font-size: 20px;
      }

      .trend-mini-card p {
        color: #64748b;
        font-family: var(--font-josefin);
        font-size: 9px;
        font-weight: 900;
        letter-spacing: 0.08em;
        line-height: 1.15;
        text-transform: uppercase;
      }

      .trend-mini-card strong {
        display: block;
        margin-top: 4px;
        color: #0f172a;
        font-family: var(--font-mono);
        font-size: 18px;
        font-weight: 900;
        line-height: 1;
      }

      .trend-mini-card.tone-green > .material-symbols-outlined {
        background: rgba(34, 197, 94, 0.11);
        color: #16a34a;
      }

      .trend-mini-card.tone-green strong {
        color: #16a34a;
      }

      .trend-mini-card.tone-blue > .material-symbols-outlined {
        background: rgba(37, 99, 235, 0.11);
        color: #2563eb;
      }

      .trend-mini-card.tone-blue strong {
        color: #2563eb;
      }

      .trend-mini-card.tone-amber > .material-symbols-outlined {
        background: rgba(245, 158, 11, 0.13);
        color: #d97706;
      }

      .trend-mini-card.tone-amber strong {
        color: #b45309;
      }

      .trend-mini-card.tone-cyan > .material-symbols-outlined {
        background: rgba(13, 175, 189, 0.11);
        color: #0899a5;
      }

      .trend-mini-card.tone-cyan strong {
        color: #0899a5;
      }

      .trend-mini-card.tone-red > .material-symbols-outlined {
        background: rgba(248, 113, 113, 0.13);
        color: #dc2626;
      }

      .trend-mini-card.tone-red strong {
        color: #dc2626;
      }

      .trend-card,
      .batch-card {
        overflow: hidden;
        border: 1px solid #dfe7f1;
        border-radius: 14px;
        background: #ffffff;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
      }

      .trend-card__hero {
        display: flex;
        min-height: 74px;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 54%, #9333ea 100%);
        padding: 16px 20px;
        color: #ffffff;
      }

      .trend-title {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 13px;
      }

      .trend-title > .material-symbols-outlined {
        display: grid;
        height: 36px;
        width: 36px;
        flex-shrink: 0;
        place-items: center;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.18);
        font-size: 21px;
      }

      .trend-title p {
        font-family: var(--font-josefin);
        font-size: 12px;
        font-weight: 900;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .trend-title strong {
        display: block;
        margin-top: 2px;
        color: rgba(255, 255, 255, 0.86);
        font-size: 13px;
        font-weight: 800;
      }

      .trend-actions {
        display: flex;
        gap: 8px;
      }

      .trend-actions button {
        min-width: 44px;
        border: 1px solid rgba(255, 255, 255, 0.26);
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.12);
        padding: 7px 10px;
        color: rgba(255, 255, 255, 0.86);
        font-size: 12px;
        font-weight: 900;
      }

      .trend-actions button.is-active {
        background: #ffffff;
        color: #7c3aed;
      }

      .trend-body {
        padding: 18px 20px 22px;
      }

      .chart-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        margin-bottom: 10px;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
      }

      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        color: #475569;
        font-size: 12px;
        font-weight: 800;
      }

      .legend-item::before {
        content: '';
        height: 9px;
        width: 9px;
        border-radius: 9999px;
      }

      .legend-item--purple::before {
        background: #8b5cf6;
      }

      .legend-item--cyan::before {
        background: #0dafbd;
      }

      .legend-item--green::before {
        background: #65b84f;
      }

      .legend-item--orange::before {
        background: #f59e0b;
      }

      .window-label {
        display: flex;
        flex-shrink: 0;
        align-items: center;
        gap: 8px;
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
      }

      .window-label strong {
        border: 1px solid rgba(139, 92, 246, 0.2);
        border-radius: 9999px;
        background: rgba(139, 92, 246, 0.08);
        padding: 5px 8px;
        color: #7c3aed;
        font-size: 11px;
      }

      .trend-chart {
        position: relative;
        height: 318px;
      }

      canvas {
        display: block;
        height: 100% !important;
        width: 100% !important;
      }

      .time-brush {
        position: relative;
        height: 42px;
        margin: 10px 24px 0 54px;
        border: 1px solid #c7d7f4;
        border-radius: 8px;
        background: #eff6ff;
      }

      .time-brush svg {
        position: absolute;
        inset: 6px 8px;
        height: calc(100% - 12px);
        width: calc(100% - 16px);
        fill: none;
      }

      .time-brush svg path {
        fill: rgba(96, 165, 250, 0.14);
        stroke: rgba(96, 165, 250, 0.38);
        stroke-width: 1.5;
      }

      .brush-selection {
        position: absolute;
        top: 5px;
        bottom: 5px;
        border: 1px solid rgba(139, 92, 246, 0.28);
        border-radius: 7px;
        background: rgba(139, 92, 246, 0.12);
        pointer-events: none;
      }

      .range-inputs,
      .range-inputs input {
        position: absolute;
        inset: 0;
      }

      .range-inputs input {
        width: 100%;
        appearance: none;
        background: transparent;
        pointer-events: none;
      }

      .range-inputs input::-webkit-slider-runnable-track {
        height: 42px;
        background: transparent;
      }

      .range-inputs input::-webkit-slider-thumb {
        height: 24px;
        width: 8px;
        margin-top: 9px;
        appearance: none;
        border: 1px solid #9bbcf3;
        border-radius: 5px;
        background: #ffffff;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.2);
        pointer-events: auto;
      }

      .range-inputs input::-moz-range-track {
        background: transparent;
      }

      .range-inputs input::-moz-range-thumb {
        height: 24px;
        width: 8px;
        border: 1px solid #9bbcf3;
        border-radius: 5px;
        background: #ffffff;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.2);
        pointer-events: auto;
      }

      .batch-card header {
        display: flex;
        min-height: 66px;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        border-bottom: 1px solid #dfe7f1;
        background: linear-gradient(180deg, #fbfaff 0%, #ffffff 100%);
        padding: 14px 18px;
      }

      .batch-card header > div {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .batch-card header .material-symbols-outlined {
        display: grid;
        height: 34px;
        width: 34px;
        place-items: center;
        border-radius: 10px;
        background: rgba(139, 92, 246, 0.12);
        color: #7c3aed;
        font-size: 20px;
      }

      .batch-card h2 {
        color: #0f172a;
        font-size: 16px;
        font-weight: 900;
      }

      .batch-card header button {
        display: inline-flex;
        min-height: 34px;
        align-items: center;
        gap: 8px;
        border-radius: 8px;
        background: #8b5cf6;
        padding: 0 13px;
        color: #ffffff;
        font-size: 12px;
        font-weight: 900;
        box-shadow: 0 8px 18px rgba(139, 92, 246, 0.18);
      }

      .batch-card header button .material-symbols-outlined {
        height: auto;
        width: auto;
        background: transparent;
        color: inherit;
        font-size: 17px;
      }

      .table-wrap {
        overflow-x: auto;
      }

      table {
        width: 100%;
        min-width: 940px;
        border-collapse: collapse;
      }

      th {
        padding: 16px 18px;
        color: #0f172a;
        font-size: 13px;
        font-weight: 900;
        text-align: left;
      }

      td {
        border-top: 1px solid #edf1f6;
        padding: 14px 18px;
        color: #0f172a;
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 800;
      }

      .batch-id {
        color: #7c3aed;
      }

      .empty-batches {
        padding: 28px 18px;
        color: #94a3b8;
        font-family: var(--font-body);
        font-weight: 900;
        text-align: center;
      }

      .time-cell {
        display: grid;
        grid-template-columns: 28px 1fr;
        align-items: center;
        gap: 4px 10px;
        font-family: var(--font-body);
      }

      .time-cell .material-symbols-outlined {
        grid-row: 1 / span 2;
        display: grid;
        height: 28px;
        width: 28px;
        place-items: center;
        border-radius: 9px;
        background: rgba(139, 92, 246, 0.11);
        color: #7c3aed;
        font-size: 17px;
      }

      .time-cell strong {
        color: #0f172a;
        font-size: 13px;
        font-weight: 900;
      }

      .time-cell small {
        color: #94a3b8;
        font-size: 12px;
        font-weight: 800;
      }

      .metric-chip {
        display: inline-grid;
        min-width: 32px;
        place-items: center;
        border-radius: 8px;
        padding: 6px 8px;
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 900;
      }

      .metric-chip--blue {
        background: #dbeafe;
        color: #2563eb;
      }

      .metric-chip--amber {
        background: #fef3c7;
        color: #d97706;
      }

      .metric-chip--red {
        background: #fee2e2;
        color: #dc2626;
      }

      .metric-chip--neutral {
        background: #f1f5f9;
        color: #64748b;
      }

      @media (max-width: 860px) {
        .trend-overview {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .trend-card__hero,
        .chart-toolbar,
        .batch-card header {
          align-items: flex-start;
          flex-direction: column;
        }

        .trend-chart {
          height: 280px;
        }

        .time-brush {
          margin-left: 0;
          margin-right: 0;
        }
      }

      @media (max-width: 560px) {
        .trend-overview {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class PasteurizadorTrendsPanelComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input({ required: true }) times: string[] = [];
  @Input({ required: true }) pasteurValues: number[] = [];
  @Input({ required: true }) entradaValues: number[] = [];
  @Input({ required: true }) productoValues: number[] = [];
  @Input() valveValues: number[] = [];
  @Input() dailyKpis: PasteurizadorDailyKpisResponse | null = null;

  @ViewChild('canvas') canvas?: ElementRef<HTMLCanvasElement>;

  readonly rangeStart = signal(0);
  readonly rangeEnd = signal(0);

  private chartInstance: Chart<'line'> | null = null;
  private initialized = false;
  private readonly minWindow = 15;
  private readonly maxWindow = 120;

  ngAfterViewInit(): void {
    this.initializeRange();
    this.renderChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['times']) {
      this.initialized = false;
      this.initializeRange();
    }

    if (this.canvas) {
      this.renderChart();
    }
  }

  ngOnDestroy(): void {
    this.destroyChart();
  }

  batches(): BatchRow[] {
    return (this.dailyKpis?.batches ?? []).map((batch) => this.mapBatchRow(batch));
  }

  summaryCards(): TrendSummaryCard[] {
    const kpis = this.dailyKpis?.kpis ?? null;

    return [
      {
        label: 'Produccion total (hoy)',
        value: kpis ? `${this.formatNumber(kpis.production_total_l, 0)} L` : '-- L',
        icon: 'database',
        tone: 'green',
      },
      {
        label: 'Temp. promedio (hoy)',
        value:
          kpis?.pasteurization_avg_c === null || kpis?.pasteurization_avg_c === undefined
            ? '-- \u00b0C'
            : `${this.formatNumber(kpis.pasteurization_avg_c, 1)} \u00b0C`,
        icon: 'device_thermostat',
        tone: 'blue',
      },
      {
        label: 'Tiempo operacion (hoy)',
        value: kpis ? this.formatDuration(kpis.operation_minutes) : '--',
        icon: 'schedule',
        tone: 'amber',
      },
      {
        label: 'N\u00b0 batches (hoy)',
        value: kpis ? this.formatNumber(kpis.valid_batches, 0) : '--',
        icon: 'inventory_2',
        tone: 'cyan',
      },
      {
        label: 'N\u00b0 alarmas (hoy)',
        value: kpis ? this.formatNumber(kpis.alarms_count, 0) : '--',
        icon: 'shield',
        tone: 'red',
      },
    ];
  }

  applyPreset(minutes: number): void {
    const end = this.rangeMax();
    const start = Math.max(0, end - Math.min(minutes, this.maxWindow));
    this.rangeStart.set(start);
    this.rangeEnd.set(end);
    this.renderChart();
  }

  setRangeStart(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const end = this.rangeEnd();
    const normalized = Math.max(0, Math.min(value, end - this.minWindow));
    const limited = Math.max(normalized, end - this.maxWindow);
    this.rangeStart.set(limited);
    this.renderChart();
  }

  setRangeEnd(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    const start = this.rangeStart();
    const normalized = Math.min(this.rangeMax(), Math.max(value, start + this.minWindow));
    const limited = Math.min(normalized, start + this.maxWindow);
    this.rangeEnd.set(limited);
    this.renderChart();
  }

  rangeMax(): number {
    return Math.max(this.times.length - 1, 0);
  }

  selectedDurationMinutes(): number {
    return Math.max(this.rangeEnd() - this.rangeStart(), 0);
  }

  windowLabel(): string {
    const start = this.times[this.rangeStart()] || '--:--';
    const end = this.times[this.rangeEnd()] || '--:--';
    return `${start} - ${end}`;
  }

  brushLeft(): string {
    const max = Math.max(this.rangeMax(), 1);
    return `${(this.rangeStart() / max) * 100}%`;
  }

  brushWidth(): string {
    const max = Math.max(this.rangeMax(), 1);
    return `${((this.rangeEnd() - this.rangeStart()) / max) * 100}%`;
  }

  previewPath(): string {
    const values = this.pasteurValues;
    if (!values.length) return '';

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 20 - ((value - min) / range) * 16;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    });

    return `${points.join(' ')} L 100 24 L 0 24 Z`;
  }

  private initializeRange(): void {
    if (this.initialized || !this.times.length) return;

    const end = this.rangeMax();
    const start = Math.max(0, end - this.maxWindow);
    this.rangeStart.set(start);
    this.rangeEnd.set(end);
    this.initialized = true;
  }

  private renderChart(): void {
    const canvas = this.canvas?.nativeElement;
    if (!canvas || !this.times.length) return;

    this.destroyChart();

    const context = canvas.getContext('2d');
    if (!context) return;

    this.chartInstance = new Chart(context, {
      type: 'line',
      data: {
        labels: this.visibleTimes(),
        datasets: this.datasets(),
      },
      options: this.chartOptions(),
    } satisfies ChartConfiguration<'line'>);
  }

  private datasets(): ChartDataset<'line', number[]>[] {
    const valveValues = this.valveValues.length
      ? this.visibleValues(this.valveValues)
      : this.visibleTimes().map(() => 0);

    return [
      {
        label: 'Pasteurizacion',
        data: this.visibleValues(this.pasteurValues),
        borderColor: '#8b5cf6',
        backgroundColor: 'rgba(139, 92, 246, 0.08)',
        borderWidth: 2.2,
        fill: true,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        yAxisID: 'yTemp',
      },
      {
        label: 'Temperatura entrada',
        data: this.visibleValues(this.entradaValues),
        borderColor: '#0dafbd',
        backgroundColor: '#0dafbd',
        borderWidth: 1.8,
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        yAxisID: 'yTemp',
      },
      {
        label: 'Salida a tina',
        data: this.visibleValues(this.productoValues),
        borderColor: '#65b84f',
        backgroundColor: '#65b84f',
        borderWidth: 2,
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        yAxisID: 'yLiters',
      },
      {
        label: 'Valvula',
        data: valveValues,
        borderColor: '#f59e0b',
        backgroundColor: '#f59e0b',
        borderWidth: 1.8,
        stepped: true,
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        yAxisID: 'yValve',
      },
      {
        label: 'Objetivo 72 °C',
        data: this.visibleTimes().map(() => 72),
        borderColor: '#ef4444',
        borderDash: [5, 5],
        borderWidth: 1,
        pointRadius: 0,
        pointHoverRadius: 0,
        pointHitRadius: 0,
        fill: false,
        yAxisID: 'yTemp',
      },
    ];
  }

  private chartOptions(): ChartOptions<'line'> {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      scales: {
        x: {
          grid: {
            color: '#e7ecf3',
            drawTicks: false,
          },
          ticks: {
            color: '#64748b',
            autoSkip: true,
            maxTicksLimit: 12,
            font: {
              family: 'JetBrains Mono',
              size: 11,
              weight: 700,
            },
          },
        },
        yTemp: {
          position: 'left',
          min: 0,
          max: 100,
          grid: {
            color: '#e7ecf3',
            drawTicks: false,
          },
          title: {
            display: true,
            text: '°C',
            color: '#64748b',
            font: {
              family: 'JetBrains Mono',
              size: 11,
              weight: 800,
            },
          },
          ticks: {
            color: '#64748b',
            stepSize: 20,
            font: {
              family: 'JetBrains Mono',
              size: 11,
              weight: 700,
            },
          },
        },
        yLiters: {
          position: 'right',
          min: 0,
          max: 10000,
          grid: {
            drawOnChartArea: false,
            drawTicks: false,
          },
          title: {
            display: true,
            text: 'LITROS',
            color: '#64748b',
            font: {
              family: 'JetBrains Mono',
              size: 11,
              weight: 800,
            },
          },
          ticks: {
            color: '#64748b',
            stepSize: 2500,
            font: {
              family: 'JetBrains Mono',
              size: 11,
              weight: 700,
            },
          },
        },
        yValve: {
          display: false,
          min: -0.1,
          max: 1.1,
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          filter: (item) => item.datasetIndex !== 4,
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
            title: (items) => `02 Junio 2026 ${items[0]?.label || ''}`,
            label: (item) => this.tooltipLabel(item),
          },
        },
      },
    };
  }

  private tooltipLabel(item: TooltipItem<'line'>): string {
    const value = typeof item.parsed.y === 'number' ? item.parsed.y : Number(item.raw || 0);
    const label = item.dataset.label || '';

    if (label === 'Salida a tina') {
      return `${label}: ${value.toLocaleString('es-CL', { maximumFractionDigits: 0 })} L`;
    }

    if (label === 'Valvula') {
      return `${label}: ${value >= 1 ? 'Abierta' : 'Cerrada'}`;
    }

    return `${label}: ${value.toLocaleString('es-CL', { maximumFractionDigits: 1 })} °C`;
  }

  private visibleTimes(): string[] {
    return this.times.slice(this.rangeStart(), this.rangeEnd() + 1);
  }

  private visibleValues(values: number[]): number[] {
    return values.slice(this.rangeStart(), this.rangeEnd() + 1);
  }

  private mapBatchRow(batch: PasteurizadorBatchResponse): BatchRow {
    return {
      id: batch.id,
      inicio: this.formatBatchTime(batch.start_at),
      termino: this.formatBatchTime(batch.end_at),
      duracion: this.formatDuration(batch.duration_min),
      temperatura:
        batch.temp_promedio_c === null ? '--°' : `${this.formatNumber(batch.temp_promedio_c, 0)}°`,
      salida: this.formatNumber(batch.volume_l, 0),
      cierres: batch.cierres_valvula,
      errores: batch.errores_criticos,
    };
  }

  private formatBatchTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--:--';

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: CHILE_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  }

  private formatNumber(value: number, maximumFractionDigits: number): string {
    return value.toLocaleString('es-CL', { maximumFractionDigits });
  }

  private formatDuration(minutes: number): string {
    const safeMinutes = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safeMinutes / 60);
    const remainingMinutes = safeMinutes % 60;

    if (!hours) return `${remainingMinutes} min`;
    if (!remainingMinutes) return `${hours} h`;
    return `${hours} h ${remainingMinutes} min`;
  }

  private destroyChart(): void {
    this.chartInstance?.destroy();
    this.chartInstance = null;
  }
}
