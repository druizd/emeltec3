import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Sensor, TapKey, fmtTemp } from './ventisqueros-data';

@Component({
  selector: 'app-ventisqueros-visibility-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="vs-visibility">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="vs-visibility-title">Visibilidad en plano</div>
          <div class="vs-visibility-sub">
            Oculta sensores individuales o grupos completos (TAP) sin perder su lectura
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="vs-visibility-count">
            {{ visibleCount() }}/{{ sensors().length }} visibles
          </span>
          <button
            (click)="showAll()"
            [disabled]="hidden().size === 0"
            class="vs-visibility-btn flex items-center gap-1 active:scale-95"
            [style.opacity]="hidden().size === 0 ? 0.5 : 1"
          >
            <span class="material-symbols-outlined text-[12px]" aria-hidden="true">visibility</span>
            Mostrar todos
          </button>
          <button
            (click)="hideAll()"
            [disabled]="hidden().size === sensors().length"
            class="vs-visibility-btn flex items-center gap-1 active:scale-95"
            [style.opacity]="hidden().size === sensors().length ? 0.5 : 1"
          >
            <span class="material-symbols-outlined text-[12px]" aria-hidden="true">visibility_off</span>
            Ocultar todos
          </button>
        </div>
      </div>

      <div class="vs-tap-card-grid grid gap-2.5">
        @for (tap of taps(); track tap) {
          @if ((grouped()[tap] || []).length > 0) {
            <div class="vs-tap-card-wrap">
              <button
                (click)="toggleTap(tap)"
                [attr.aria-pressed]="!isTapHidden(tap)"
                class="vs-tap-card-head flex w-full items-center justify-between gap-2 active:scale-[0.98]"
              >
                <div class="flex items-center gap-2">
                  <span
                    class="vs-tap-color-dot"
                    [style.background]="tapColors()[tap]"
                    [style.box-shadow]="'0 0 0 3px ' + tapColors()[tap] + '22'"
                  ></span>
                  <span class="vs-tap-card-title">{{ tap }}</span>
                  <span class="vs-tap-card-meta">
                    {{ (grouped()[tap] || []).length }} sensores
                  </span>
                </div>
                <span class="vs-tap-card-toggle flex items-center gap-1">
                  <span
                    class="material-symbols-outlined text-[16px]"
                    aria-hidden="true"
                    [style.color]="
                      isTapHidden(tap)
                        ? '#94A3B8'
                        : isTapPartiallyHidden(tap)
                          ? '#F59E0B'
                          : '#0DAFBD'
                    "
                  >
                    {{ isTapHidden(tap) ? 'visibility_off' : 'visibility' }}
                  </span>
                </span>
              </button>
              <div class="vs-tap-card-body flex flex-col">
                @for (s of grouped()[tap] || []; track s.id) {
                  <label
                    class="vs-row flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors"
                    [style.opacity]="isHidden(s.id) ? 0.55 : 1"
                  >
                    <input
                      type="checkbox"
                      class="vs-check"
                      [checked]="!isHidden(s.id)"
                      (change)="toggleSensor(s.id)"
                    />
                    <span class="vs-id-chip">{{ s.id }}</span>
                    <span class="vs-check-area flex-1 truncate">{{ s.area }}</span>
                    @if (s.alerted) {
                      <span class="vs-check-alert-dot"></span>
                    }
                    <span class="vs-check-temp">{{ fmtTemp(s.t) }}</span>
                  </label>
                }
              </div>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .vs-visibility {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 14px;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.04);
      }
      .vs-visibility-title {
        font-family: var(--font-josefin);
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .vs-visibility-sub {
        font-size: 11px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .vs-visibility-count {
        font-size: 11px;
        color: #64748b;
        font-family: var(--font-mono);
      }
      .vs-visibility-btn {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        padding: 5px 10px;
        font-size: 11px;
        color: #475569;
        font-family: var(--font-body);
        cursor: pointer;
        transition: background 0.12s ease;
      }
      .vs-visibility-btn:hover:not(:disabled) {
        background: #f8fafc;
      }
      .vs-tap-card-grid {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }
      .vs-tap-card-wrap {
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        overflow: hidden;
        background: #ffffff;
      }
      .vs-tap-card-head {
        padding: 10px 12px;
        background: #f8fafc;
        border: none;
        border-bottom: 1px solid #e2e8f0;
        cursor: pointer;
        font-family: var(--font-body);
      }
      .vs-tap-color-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }
      .vs-tap-card-title {
        font-family: var(--font-josefin);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.04em;
        color: #1e293b;
      }
      .vs-tap-card-meta {
        font-family: var(--font-mono);
        font-size: 10px;
        color: #94a3b8;
      }
      .vs-tap-card-toggle {
        font-size: 11px;
        color: #475569;
      }
      .vs-tap-card-body {
        padding: 6px;
      }
      .vs-check {
        width: 14px;
        height: 14px;
        accent-color: var(--color-primary);
        cursor: pointer;
      }
      .vs-check-area {
        font-family: var(--font-body);
        font-size: 12px;
        color: #1e293b;
      }
      .vs-check-alert-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #ef4444;
        box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25);
      }
      .vs-check-temp {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: #64748b;
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
      .vs-row:hover {
        background: #f8fafc;
      }
    `,
  ],
})
export class VentisquerosVisibilityPanelComponent {
  readonly sensors = input.required<Sensor[]>();
  readonly hidden = input.required<Set<string>>();
  readonly taps = input.required<TapKey[]>();
  readonly tapColors = input.required<Record<TapKey, string>>();

  readonly hiddenChange = output<Set<string>>();

  readonly fmtTemp = fmtTemp;

  readonly grouped = computed<Record<string, Sensor[]>>(() => {
    const out: Record<string, Sensor[]> = {};
    for (const s of this.sensors()) {
      (out[s.tap] = out[s.tap] || []).push(s);
    }
    return out;
  });

  readonly visibleCount = computed(() => this.sensors().length - this.hidden().size);

  isHidden(id: string): boolean {
    return this.hidden().has(id);
  }

  isTapHidden(tap: TapKey): boolean {
    const group = this.sensors().filter((s) => s.tap === tap);
    return group.length > 0 && group.every((s) => this.hidden().has(s.id));
  }

  isTapPartiallyHidden(tap: TapKey): boolean {
    const group = this.sensors().filter((s) => s.tap === tap);
    const hidden = group.filter((s) => this.hidden().has(s.id)).length;
    return hidden > 0 && hidden < group.length;
  }

  toggleSensor(id: string): void {
    const next = new Set(this.hidden());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.hiddenChange.emit(next);
  }

  toggleTap(tap: TapKey): void {
    const group = this.sensors().filter((s) => s.tap === tap);
    const next = new Set(this.hidden());
    if (this.isTapHidden(tap)) {
      group.forEach((s) => next.delete(s.id));
    } else {
      group.forEach((s) => next.add(s.id));
    }
    this.hiddenChange.emit(next);
  }

  showAll(): void {
    this.hiddenChange.emit(new Set());
  }

  hideAll(): void {
    this.hiddenChange.emit(new Set(this.sensors().map((s) => s.id)));
  }
}
