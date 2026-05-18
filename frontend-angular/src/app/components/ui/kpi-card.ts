import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type KpiTone = 'primary' | 'success' | 'danger' | 'warning' | 'neutral';

@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [CommonModule],
  host: { class: 'block' },
  template: `
    <article
      class="flex min-h-[104px] items-center justify-between gap-3 rounded-xl border bg-white p-4"
      [class]="cardToneClass()"
    >
      <div class="min-w-0 flex-1">
        <p
          class="truncate text-caption-xs font-semibold uppercase tracking-[0.12em] text-on-surface-muted"
          style="font-family: var(--font-josefin);"
        >
          {{ label }}
        </p>
        <p
          class="mt-2 truncate text-h4 font-semibold leading-none text-on-surface"
          style="font-family: var(--font-mono); letter-spacing: -0.02em;"
        >
          {{ displayValue }}
        </p>
        @if (unit || helper) {
          <p class="mt-1.5 truncate text-caption-xs font-medium text-on-surface-variant">
            {{ helper || unit }}
          </p>
        }
      </div>

      @if (icon || hasContent) {
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors"
          [class]="iconToneClass()"
        >
          @if (icon) {
            <span class="material-symbols-outlined text-[20px]">{{ icon }}</span>
          }
          <ng-content></ng-content>
        </span>
      }
    </article>
  `,
})
export class KpiCardComponent {
  @Input() label = '';
  @Input() value: string | number | null | undefined = undefined;
  @Input() unit = '';
  @Input() helper = '';
  @Input() icon = '';
  @Input() tone: KpiTone = 'primary';
  hasContent = false;

  get displayValue(): string {
    return this.value !== undefined && this.value !== null && this.value !== ''
      ? String(this.value)
      : 'Sin datos';
  }

  cardToneClass(): string {
    switch (this.tone) {
      case 'primary':
        return 'border-[rgba(13,175,189,0.25)] shadow-[0_1px_4px_rgba(13,175,189,0.08)] hover:shadow-[0_4px_16px_rgba(13,175,189,0.15)]';
      case 'success':
        return 'border-[rgba(34,197,94,0.20)] shadow-[0_1px_4px_rgba(15,23,42,0.05)] hover:shadow-[0_4px_16px_rgba(34,197,94,0.12)]';
      case 'danger':
        return 'border-[rgba(248,113,113,0.25)] shadow-[0_1px_4px_rgba(15,23,42,0.05)] hover:shadow-[0_4px_16px_rgba(248,113,113,0.12)]';
      case 'warning':
        return 'border-[rgba(251,191,36,0.25)] shadow-[0_1px_4px_rgba(15,23,42,0.05)] hover:shadow-[0_4px_16px_rgba(251,191,36,0.12)]';
      default:
        return 'border-[#e2e8f0] shadow-[0_1px_4px_rgba(15,23,42,0.05)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.08)]';
    }
  }

  iconToneClass(): string {
    switch (this.tone) {
      case 'primary':
        return 'border-[rgba(13,175,189,0.20)] bg-[rgba(13,175,189,0.08)] text-primary-container';
      case 'success':
        return 'border-[rgba(34,197,94,0.20)] bg-[rgba(34,197,94,0.08)] text-[#16a34a]';
      case 'danger':
        return 'border-[rgba(248,113,113,0.25)] bg-[rgba(248,113,113,0.08)] text-[#dc2626]';
      case 'warning':
        return 'border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.10)] text-[#d97706]';
      default:
        return 'border-[#e2e8f0] bg-[#f8fafc] text-on-surface-variant';
    }
  }
}
