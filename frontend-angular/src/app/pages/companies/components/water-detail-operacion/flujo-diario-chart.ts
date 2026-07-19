import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  ViewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

Chart.register(...registerables);

export interface FlujoDiarioPoint {
  /** ISO YYYY-MM-DD. */
  dia: string;
  /** Flujo del día (delta totalizador) en m³. null / 0 = sin operación. */
  delta: number | null;
}

/**
 * Gráfico de barras del flujo diario del período (Chart.js). Reemplaza el SVG
 * hand-made del resumen-periodo; consistente con overview-nivel-caudal-chart.
 * Días sin operación (delta ≤ 0) se pintan en gris.
 */
@Component({
  selector: 'app-flujo-diario-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  styles: [':host { display: block; }'],
  template: `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="mb-4 flex items-center justify-between">
        <div>
          <h3 class="text-body-sm font-semibold text-slate-800">Flujo diario en el período</h3>
          <p class="mt-0.5 text-caption-xs text-slate-500">m³/día · días sin operación en gris</p>
        </div>
        @if (periodoLabel) {
          <span
            class="rounded-full bg-primary-tint-08 px-2.5 py-1 text-caption-xs font-bold text-primary-container"
            >{{ periodoLabel }}</span
          >
        }
      </div>
      <div class="relative h-44 w-full">
        @if (isEmpty) {
          <div class="absolute inset-0 flex items-center justify-center">
            <p class="text-caption text-slate-400">Sin datos de flujo en el período.</p>
          </div>
        }
        <canvas
          #canvas
          role="img"
          aria-label="Gráfico de barras del flujo diario del período (m³ por día)"
          [class.invisible]="isEmpty"
        ></canvas>
      </div>
    </section>
  `,
})
export class FlujoDiarioChartComponent implements AfterViewInit, OnDestroy {
  @Input() set points(value: FlujoDiarioPoint[]) {
    this._points = value || [];
    if (this.viewReady) this.render();
  }
  private _points: FlujoDiarioPoint[] = [];

  @Input() periodoLabel = '';

  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;
  private viewReady = false;

  get isEmpty(): boolean {
    return this._points.length === 0;
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.render();
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private render(): void {
    if (!this.viewReady || !this.canvas?.nativeElement) return;
    this.chart?.destroy();
    this.chart = null;

    const pts = [...this._points].sort((a, b) => a.dia.localeCompare(b.dia));
    if (pts.length === 0) return;

    const ctx = this.canvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const labels = pts.map((p) => this.fmtDia(p.dia));
    const values = pts.map((p) => p.delta ?? 0);
    const colors = values.map((v) => (v > 0 ? '#0dafbd' : '#cbd5e1'));
    const step = Math.max(1, Math.ceil(pts.length / 12));

    const reduceMotion =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderRadius: 2, maxBarThickness: 26 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 300, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#1e293b',
            bodyColor: '#0899a5',
            borderColor: '#e2e8f0',
            borderWidth: 1,
            titleFont: { family: 'DM Sans', weight: 600, size: 12 },
            bodyFont: { family: 'JetBrains Mono', weight: 600, size: 13 },
            padding: 10,
            cornerRadius: 6,
            displayColors: false,
            callbacks: {
              title: (items) => this.fmtDiaLargo(pts[items[0]?.dataIndex ?? 0]?.dia ?? ''),
              label: (item) => `${Number(item.parsed.y).toLocaleString('es-CL')} m³`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono', size: 10 },
              autoSkip: false,
              callback: (_value, index) => (index % step === 0 ? labels[index] : ''),
            },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f1f5f9' },
            ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 } },
            border: { display: false },
          },
        },
      },
    } as ChartConfiguration<'bar'>);
  }

  private fmtDia(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  private fmtDiaLargo(iso: string): string {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  }
}
