import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type WellStatTone = 'primary' | 'neutral' | 'orange' | 'blue';

/**
 * Compact stat card used in the well diagram sidebar.
 * Replaces inline-styled cards with token-driven variants.
 *
 * Use <ng-content> for optional footer (e.g. progress bar).
 */
@Component({
  selector: 'app-well-stat-card',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  template: `
    <div [class]="cardClass()">
      <p [class]="labelClass()" style="font-family: var(--font-josefin);">
        {{ label }}
      </p>
      <p [class]="valueClass()" style="font-family: var(--font-mono); line-height: 1;">
        {{ value
        }}<span class="ml-0.5 text-[11px] font-semibold text-slate-500">{{ unit }}</span>
      </p>
      @if (helper) {
        <p class="mt-0.5 text-[9px] font-medium text-slate-400">{{ helper }}</p>
      }
      <ng-content></ng-content>
    </div>
  `,
})
export class WellStatCardComponent {
  @Input() label = '';
  @Input() value: string | number = '';
  @Input() unit = '';
  @Input() helper = '';
  @Input() tone: WellStatTone = 'neutral';
  @Input() size: 'sm' | 'md' | 'lg' = 'lg';

  cardClass(): string {
    const base = 'rounded-lg border px-2.5 py-2';
    switch (this.tone) {
      case 'primary':
        return `${base} border-primary-tint-20 bg-primary-tint-06`;
      case 'orange':
        return `${base} border-orange-200 bg-orange-50`;
      case 'blue':
        return `${base} border-sky-200 bg-sky-50`;
      default:
        return `${base} border-slate-200 bg-slate-50`;
    }
  }

  labelClass(): string {
    const base = 'mb-0.5 text-[9px] font-bold uppercase tracking-[0.1em]';
    switch (this.tone) {
      case 'orange':
        return `${base} text-orange-500`;
      case 'blue':
        return `${base} text-sky-700`;
      default:
        return `${base} text-slate-400`;
    }
  }

  valueClass(): string {
    const sizeClass =
      this.size === 'sm' ? 'text-[16px]' : this.size === 'md' ? 'text-[18px]' : 'text-[20px]';
    const weight = this.size === 'lg' ? 'font-bold' : 'font-semibold';
    let color: string;
    switch (this.tone) {
      case 'primary':
        color = 'text-primary-container';
        break;
      case 'orange':
        color = 'text-slate-600';
        break;
      case 'blue':
        color = 'text-sky-600';
        break;
      default:
        color = this.size === 'lg' ? 'text-slate-800' : 'text-slate-600';
    }
    return `${sizeClass} ${weight} ${color}`;
  }
}
