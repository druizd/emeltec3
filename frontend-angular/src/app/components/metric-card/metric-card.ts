import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-metric-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './metric-card.html',
})
export class MetricCardComponent {
  @Input() title: string = '';
  @Input() value: any;
  @Input() unit: string = '';
  @Input() time: string = '';

  get formattedTime(): string {
    if (!this.time) return 'Sin datos';
    try {
      return new Date(this.time).toLocaleString('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Sin datos';
    }
  }

  get displayValue(): string {
    return this.value !== undefined && this.value !== null ? String(this.value) : '--';
  }
}
