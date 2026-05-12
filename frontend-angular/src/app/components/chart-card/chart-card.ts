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
  @Input() data: Record<string, string | number | null | undefined>[] = [];
  @Input() dataKey = '';
  @Input() color = '#6366f1';

  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  ngAfterViewInit(): void {
    this.createChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if ((changes['data'] || changes['dataKey']) && this.chartCanvas) {
      this.createChart();
    }
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
        return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      } catch {
        return t == null ? '' : String(t);
      }
    });

    const values = this.data.map((d) => {
      const v = d[this.dataKey];
      return typeof v === 'number' ? v : v == null ? null : Number(v);
    });

    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, this.hexToRgba(this.color, 0.8));
    gradient.addColorStop(1, this.hexToRgba(this.color, 0.1));

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: this.color,
            backgroundColor: gradient,
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: this.color,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fff',
            titleColor: '#1e293b',
            bodyColor: this.color,
            borderColor: '#f1f5f9',
            borderWidth: 1,
            titleFont: { weight: 'bold', size: 13 },
            bodyFont: { weight: 'bold', size: 14 },
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 12 }, maxTicksLimit: 8 },
            border: { display: false },
          },
          y: {
            grid: { color: '#f1f5f9' },
            ticks: { color: '#94a3b8', font: { size: 12 } },
            border: { display: false },
          },
        },
      },
    });
  }

  private hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  get hasData(): boolean {
    return this.data && this.data.length > 0;
  }
}
