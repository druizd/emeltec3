import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import type { PasteurKpi } from './pasteurizador-dashboard.models';

@Component({
  selector: 'app-pasteurizador-kpi-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="kpi-card" [ngClass]="'tone-' + kpi.tone">
      <div class="kpi-head">
        <div>
          <p>{{ kpi.label }}</p>
          <strong>
            {{ kpi.value }}
            @if (kpi.unit) {
              <span>{{ kpi.unit }}</span>
            }
          </strong>
        </div>
        <span class="kpi-icon">
          <span class="material-symbols-outlined text-[23px]">{{ kpi.icon }}</span>
        </span>
      </div>

      <div class="kpi-foot">
        <span>{{ kpi.helper }}</span>
        <svg viewBox="0 0 132 34" preserveAspectRatio="none" aria-hidden="true">
          <path [attr.d]="miniPath(kpi.trend)" fill="none" stroke="currentColor" stroke-width="2" />
        </svg>
      </div>
    </article>
  `,
  styles: [
    `
      .kpi-card {
        position: relative;
        display: flex;
        height: 100%;
        min-height: 132px;
        flex-direction: column;
        justify-content: space-between;
        overflow: hidden;
        border: 1px solid #e6ebf2;
        border-radius: 16px;
        background: #ffffff;
        padding: 16px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.055);
      }

      .kpi-head {
        position: relative;
        z-index: 1;
        display: flex;
        min-height: 74px;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }

      p {
        color: #64748b;
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      strong {
        display: block;
        margin-top: 10px;
        color: #0f172a;
        font-family: var(--font-mono);
        font-size: 28px;
        font-weight: 900;
        letter-spacing: 0;
        line-height: 1;
      }

      strong span {
        color: #64748b;
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: 900;
      }

      .kpi-icon {
        display: grid;
        height: 42px;
        width: 42px;
        flex-shrink: 0;
        place-items: center;
        border-radius: 13px;
        background: #f8fafc;
      }

      .kpi-foot {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: minmax(0, 1fr) 120px;
        gap: 12px;
        align-items: end;
        margin-top: 16px;
      }

      .kpi-foot span {
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.35;
      }

      svg {
        height: 34px;
        width: 100%;
      }

      .tone-purple {
        border-color: rgba(124, 58, 237, 0.45);
        background:
          radial-gradient(circle at 96% 2%, rgba(255, 255, 255, 0.2), transparent 5.5rem),
          radial-gradient(circle at 18% 115%, rgba(255, 255, 255, 0.16), transparent 6rem),
          linear-gradient(135deg, #a855f7 0%, #8b5cf6 42%, #6d28d9 100%);
        color: #ffffff;
        box-shadow:
          0 0 0 1px rgba(124, 58, 237, 0.14),
          0 14px 30px rgba(109, 40, 217, 0.22);
      }

      .tone-purple::before,
      .tone-purple::after {
        content: '';
        position: absolute;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.1);
        pointer-events: none;
      }

      .tone-purple::before {
        right: -26px;
        top: -34px;
        height: 106px;
        width: 106px;
      }

      .tone-purple::after {
        bottom: -48px;
        left: -34px;
        height: 118px;
        width: 118px;
      }

      .tone-cyan {
        border-color: #e6ebf2;
        background: #ffffff;
        color: #0dafbd;
      }

      .tone-green,
      .tone-success {
        border-color: #e6ebf2;
        background: #ffffff;
        color: #22c55e;
      }

      .tone-orange {
        border-color: #e6ebf2;
        background: #ffffff;
        color: #f97316;
      }

      .tone-purple .kpi-icon {
        background: rgba(255, 255, 255, 0.14);
        color: #ffffff;
      }

      .tone-purple strong {
        color: #ffffff;
      }

      .tone-purple p,
      .tone-purple .kpi-foot span,
      .tone-purple strong span {
        color: rgba(255, 255, 255, 0.82);
      }

      .tone-cyan strong,
      .tone-green strong,
      .tone-success strong,
      .tone-orange strong {
        color: #111827;
      }

      .tone-cyan .kpi-icon {
        background: rgba(13, 175, 189, 0.1);
      }

      .tone-green .kpi-icon,
      .tone-success .kpi-icon {
        background: rgba(34, 197, 94, 0.1);
      }

      .tone-orange .kpi-icon {
        background: rgba(249, 115, 22, 0.1);
      }

      @media (max-width: 680px) {
        .kpi-foot {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class PasteurizadorKpiCardComponent {
  @Input({ required: true }) kpi!: PasteurKpi;

  miniPath(values: number[]): string {
    return this.buildPath(values, 4, 128, 4, 30);
  }

  private buildPath(
    values: number[],
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
  ): string {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const width = xMax - xMin;
    const height = yMax - yMin;

    return values
      .map((value, index) => {
        const x = xMin + (width / Math.max(values.length - 1, 1)) * index;
        const y = yMax - ((value - min) / range) * height;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }
}
