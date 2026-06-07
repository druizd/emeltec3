import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import type { PasteurQuickMetric } from './pasteurizador-dashboard.models';

@Component({
  selector: 'app-pasteurizador-status-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article class="status-card" [class.status-card--alarm]="alarm">
      <div class="status-head">
        <div>
          <p>{{ eyebrow }}</p>
          <h2>{{ title }}</h2>
        </div>
        <span class="status-icon">
          <span class="material-symbols-outlined text-[22px]">{{ icon }}</span>
        </span>
      </div>

      @if (alarm) {
        <div class="alarm-empty">
          <span class="material-symbols-outlined text-[28px]">check_circle</span>
          <strong>No hay alarmas activas</strong>
        </div>
      } @else {
        <div class="quick-list">
          @for (item of metrics; track item.label) {
            <div>
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          }
        </div>
      }
    </article>
  `,
  styles: [
    `
      .status-card {
        display: flex;
        height: 100%;
        flex-direction: column;
        border: 1px solid #e6ebf2;
        border-radius: 18px;
        background: #ffffff;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.055);
        overflow: hidden;
      }

      .status-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
        border-bottom: 1px solid #edf1f6;
        padding: 17px 18px;
      }

      p {
        color: #94a3b8;
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      h2 {
        margin-top: 4px;
        color: #0f172a;
        font-size: 17px;
        font-weight: 900;
      }

      .status-icon {
        display: grid;
        height: 40px;
        width: 40px;
        place-items: center;
        border-radius: 13px;
        background: #f0fdf4;
        color: #16a34a;
      }

      .quick-list {
        display: grid;
        flex: 1;
        align-content: center;
        padding: 8px 18px 16px;
      }

      .quick-list div {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        border-bottom: 1px solid #eef2f7;
        padding: 11px 0;
      }

      .quick-list div:last-child {
        border-bottom: 0;
      }

      .quick-list span {
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
      }

      .quick-list strong {
        color: #0f172a;
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 900;
      }

      .alarm-empty {
        display: grid;
        flex: 1;
        min-height: 0;
        place-items: center;
        padding: 24px;
        color: #16a34a;
        text-align: center;
      }

      .alarm-empty strong {
        display: block;
        max-width: 18ch;
        color: #16a34a;
        font-size: 14px;
        font-weight: 900;
        line-height: 1.4;
      }
    `,
  ],
})
export class PasteurizadorStatusCardComponent {
  @Input({ required: true }) eyebrow = '';
  @Input({ required: true }) title = '';
  @Input() icon = 'info';
  @Input() alarm = false;
  @Input() metrics: PasteurQuickMetric[] = [];
}
