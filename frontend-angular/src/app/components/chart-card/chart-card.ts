import {
  Component,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

@Component({
  selector: 'app-chart-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-card.html',
})
export class ChartCardComponent implements OnChanges, AfterViewInit {
  @Input() title = '';
  @Input() subtitle = '';
  @Input() data: Record<string, string | number | null | undefined>[] = [];
  @Input() dataKey = '';
  @Input() color = '#0dafbd';
  @Input() icon = 'show_chart';
  @Input() height = '320px';

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  ngAfterViewInit(): void {
    this.createChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['data'] || changes['dataKey'] || changes['color']) && this.chartCanvas) {
      this.createChart();
    }
  }

  get iconBgColor(): string {
    return this.hexToRgba(this.color, 0.08);
  }

  get iconBorderColor(): string {
    return this.hexToRgba(this.color, 0.2);
  }

  private createChart(): void {
    if (!this.chartCanvas?.nativeElement || !this.data?.length) return;

    if (this.chart) {
      this.chart.destroy();
    }

    const ctx = this.chartCanvas.nativeElement.getContext('2d');
    if (!ctx) return;

    const labels = this.data.map((d) => {
      const t = d['time'];
      try {
        const date = new Date(t as string | number);
        return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      } catch {
        return t == null ? '' : String(t);
      }
    });

    const values = this.data.map((d) => {
      const v = d[this.dataKey];
      return typeof v === 'number' ? v : v == null ? null : Number(v);
    });

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, this.hexToRgba(this.color, 0.35));
    gradient.addColorStop(1, this.hexToRgba(this.color, 0));

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: this.color,
            backgroundColor: gradient,
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: this.color,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Default de Chart.js son ~750ms de draw-in: demasiado para datos
        // funcionales que el usuario quiere leer. 300ms mantiene continuidad
        // sin estorbar; reduced-motion lo elimina.
        animation:
          typeof matchMedia !== 'undefined' &&
          matchMedia('(prefers-reduced-motion: reduce)').matches
            ? false
            : { duration: 300, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#ffffff',
            titleColor: '#1e293b',
            bodyColor: this.color,
            borderColor: '#e2e8f0',
            borderWidth: 1,
            titleFont: { family: 'DM Sans', weight: 600, size: 12 },
            bodyFont: { family: 'JetBrains Mono', weight: 600, size: 13 },
            padding: 10,
            cornerRadius: 6,
            displayColors: false,
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono', size: 11 },
              maxTicksLimit: 8,
            },
            border: { display: false },
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: {
              color: '#94a3b8',
              font: { family: 'JetBrains Mono', size: 11 },
            },
            border: { display: false },
          },
        },
      },
    });
  }

  private hexToRgba(hex: string, alpha: number): string {
    const cleaned = hex.replace('#', '');
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  get hasData(): boolean {
    return this.data && this.data.length > 0;
  }
}
