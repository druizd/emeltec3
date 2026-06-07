import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Sensor, fmtTemp, humColor, tempColor } from './ventisqueros-data';

@Component({
  selector: 'app-ventisqueros-focus-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block shrink-0' },
  template: `
    @if (focus(); as f) {
      <div class="vs-focus-card">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="vs-id-chip">{{ f.id }}</span>
              <span class="vs-tap-chip">{{ f.tap }}</span>
              @if (f.alerted) {
                <span class="vs-alert-mini-chip">EN ALERTA</span>
              }
            </div>
            <div class="vs-focus-area">{{ f.area }}</div>
          </div>
          <button class="vs-focus-open-btn flex">
            <span class="material-symbols-outlined text-[13px]">open_in_new</span>
          </button>
        </div>

        <div class="mt-3 grid grid-cols-2 gap-2.5">
          <div class="vs-stat-card">
            <div class="vs-stat-label">Temperatura</div>
            <div class="mt-1 flex items-baseline gap-0.75">
              <span class="vs-stat-value" [style.color]="f.alerted ? '#B91C1C' : '#1E293B'">{{
                f.t.toFixed(1)
              }}</span>
              <span class="vs-stat-unit">°C</span>
            </div>
            <div class="mt-1.5">
              <svg [attr.width]="120" [attr.height]="28" class="vs-spark-svg">
                <defs>
                  <linearGradient [attr.id]="'sparkFill-' + f.id" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" [attr.stop-color]="sparkColor(f)" stop-opacity="0.28" />
                    <stop offset="100%" [attr.stop-color]="sparkColor(f)" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <path
                  [attr.d]="sparkFill(f, 120, 28)"
                  [attr.fill]="'url(#sparkFill-' + f.id + ')'"
                />
                <path
                  [attr.d]="sparkPath(f, 120, 28)"
                  fill="none"
                  [attr.stroke]="sparkColor(f)"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <circle
                  [attr.cx]="sparkLast(f, 120, 28).x"
                  [attr.cy]="sparkLast(f, 120, 28).y"
                  r="2.2"
                  fill="#fff"
                  [attr.stroke]="sparkColor(f)"
                  stroke-width="1.2"
                />
              </svg>
            </div>
          </div>
          <div class="vs-stat-card">
            <div class="vs-stat-label">Humedad</div>
            <div class="mt-1 flex items-baseline gap-0.75">
              <span class="vs-stat-value text-[#1E293B]">{{ fmtHumValue(f.h) }}</span>
              <span class="vs-stat-unit">%</span>
            </div>
            <div class="vs-h-bar-track">
              <div
                class="vs-h-bar-fill"
                [style.width]="f.h + '%'"
                [style.background]="humBarGradient(f.h)"
              ></div>
            </div>
            <div class="vs-h-bar-scale mt-1 flex justify-between">
              <span>40%</span><span>100%</span>
            </div>
          </div>
        </div>

        <div class="vs-focus-footer mt-2.5 flex items-center justify-between pt-2.5">
          <span class="flex items-center gap-1">
            <span class="material-symbols-outlined text-[11px]">schedule</span>
            hace 32 s
          </span>
          <span class="vs-focus-base">HR {{ fmtHumValue(f.h) }}%</span>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .vs-focus-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px 14px 12px;
        box-shadow: 0 2px 10px rgba(15, 23, 42, 0.05);
      }
      .vs-id-chip {
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 600;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 1px 5px;
        color: #475569;
      }
      .vs-tap-chip {
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 600;
        color: var(--color-primary-container);
        background: rgba(13, 175, 189, 0.1);
        border-radius: 4px;
        padding: 2px 6px;
        letter-spacing: 0.06em;
        border: 1px solid rgba(13, 175, 189, 0.25);
      }
      .vs-alert-mini-chip {
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 600;
        color: #b91c1c;
        background: rgba(239, 68, 68, 0.1);
        border-radius: 4px;
        padding: 2px 6px;
        border: 1px solid rgba(239, 68, 68, 0.25);
        letter-spacing: 0.06em;
      }
      .vs-focus-area {
        font-family: var(--font-josefin);
        font-size: 17px;
        font-weight: 600;
        color: #1e293b;
        margin-top: 6px;
        letter-spacing: 0.02em;
      }
      .vs-focus-open-btn {
        background: none;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 4px;
        cursor: pointer;
        color: #64748b;
        transition: background 0.12s ease;
      }
      .vs-focus-open-btn:hover {
        background: #f8fafc;
      }
      .vs-stat-card {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 10px;
      }
      .vs-stat-label {
        font-family: var(--font-body);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .vs-stat-value {
        font-family: var(--font-mono);
        font-size: 22px;
        font-weight: 600;
        line-height: 1;
      }
      .vs-stat-unit {
        font-family: var(--font-mono);
        font-size: 12px;
        color: #64748b;
      }
      .vs-spark-svg {
        display: block;
        overflow: visible;
      }
      .vs-h-bar-track {
        margin-top: 8px;
        height: 6px;
        background: #e2e8f0;
        border-radius: 999px;
        overflow: hidden;
      }
      .vs-h-bar-fill {
        height: 100%;
        border-radius: 999px;
      }
      .vs-h-bar-scale {
        font-size: 9px;
        color: #94a3b8;
        font-family: var(--font-mono);
      }
      .vs-focus-footer {
        border-top: 1px dashed #e2e8f0;
        font-size: 11px;
        color: #64748b;
      }
      .vs-focus-base {
        font-family: var(--font-mono);
        font-size: 11px;
      }
    `,
  ],
})
export class VentisquerosFocusCardComponent {
  readonly focus = input.required<Sensor | undefined>();

  readonly fmtTemp = fmtTemp;

  fmtHumValue(h: number): number {
    return Number(h.toFixed(2));
  }

  sparkColor(s: Sensor): string {
    return s.alerted ? '#EF4444' : tempColor(s.t);
  }

  humBarGradient(h: number): string {
    return `linear-gradient(90deg, ${humColor(40)}, ${humColor(h)})`;
  }

  private sparkCoords(s: Sensor, width: number, height: number): [number, number][] {
    const points = s.hist;
    if (!points || points.length === 0) return [];
    const min = Math.min(...points);
    const max = Math.max(...points);
    const range = max - min || 1;
    const step = width / (points.length - 1);
    return points.map((v, i) => [i * step, height - ((v - min) / range) * (height - 4) - 2]);
  }

  sparkPath(s: Sensor, width: number, height: number): string {
    const coords = this.sparkCoords(s, width, height);
    if (!coords.length) return '';
    return 'M ' + coords.map(([x, y]) => `${x},${y}`).join(' L ');
  }

  sparkFill(s: Sensor, width: number, height: number): string {
    const coords = this.sparkCoords(s, width, height);
    if (!coords.length) return '';
    return `M 0,${height} L ${coords.map(([x, y]) => `${x},${y}`).join(' L ')} L ${width},${height} Z`;
  }

  sparkLast(s: Sensor, width: number, height: number): { x: number; y: number } {
    const coords = this.sparkCoords(s, width, height);
    if (!coords.length) return { x: 0, y: 0 };
    const [x, y] = coords[coords.length - 1];
    return { x, y };
  }
}
