import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ColdRoomThresholdsService,
  type SalaThreshold,
  slugifyArea,
} from '../../../services/cold-room-thresholds.service';
import type { Sensor } from '../ventisqueros-data';

@Component({
  selector: 'app-ventisqueros-umbrales-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="vs-drawer-backdrop" (click)="open.set(false)" aria-hidden="true"></div>
      <aside class="vs-drawer" role="dialog" aria-modal="true" aria-label="Umbrales por sala">
        <header class="vs-drawer-head">
          <div class="min-w-0">
            <div class="vs-drawer-title">Umbrales por sala</div>
            <div class="vs-drawer-sub">Temperatura máxima permitida por área (°C). Editable.</div>
          </div>
          <button
            type="button"
            class="vs-drawer-close"
            (click)="open.set(false)"
            aria-label="Cerrar"
          >
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </header>
        <div class="vs-drawer-body">
          <div class="vs-thresholds-list">
            @for (t of thresholdsList(); track t.area) {
              <article
                class="vs-thresholds-card"
                [class.vs-thresholds-card--missing]="isNaN(t.tMax)"
              >
                <header class="vs-thresholds-card-head">
                  <span class="vs-thresholds-name truncate" [title]="t.area">{{ t.area }}</span>
                  <span class="vs-thresholds-card-meta">
                    @if (isNaN(t.tMax)) {
                      <span class="vs-thresholds-pending">sin config</span>
                    } @else if (t.updatedAt) {
                      Actualizado {{ relativeIso(t.updatedAt) }}
                      @if ($any(t).updatedBy) {
                        · {{ $any(t).updatedBy }}
                      }
                    }
                  </span>
                  <button
                    type="button"
                    class="vs-thresholds-remove"
                    (click)="removeThreshold(t.area)"
                    title="Quitar"
                    aria-label="Quitar umbral"
                    [disabled]="isNaN(t.tMax)"
                  >
                    <span class="material-symbols-outlined text-[14px]">delete</span>
                  </button>
                </header>

                <div class="vs-thresholds-fields">
                  <label class="vs-thresholds-field">
                    <span class="vs-thresholds-field-lbl">T máx (°C)</span>
                    <input
                      type="number"
                      step="0.5"
                      class="vs-thresholds-input"
                      [value]="isNaN(t.tMax) ? '' : t.tMax"
                      placeholder="—"
                      (change)="onThresholdMaxChange(t.area, $event)"
                    />
                  </label>
                  <label class="vs-thresholds-field">
                    <span class="vs-thresholds-field-lbl">T mín (°C)</span>
                    <input
                      type="number"
                      step="0.5"
                      class="vs-thresholds-input"
                      [value]="t.tMin ?? ''"
                      placeholder="—"
                      (change)="onThresholdMinChange(t.area, $event)"
                    />
                  </label>
                </div>

                <label class="vs-thresholds-field vs-thresholds-field--full">
                  <span class="vs-thresholds-field-lbl">Motivo</span>
                  <input
                    type="text"
                    class="vs-thresholds-input vs-thresholds-input--text"
                    [value]="$any(t).note ?? ''"
                    placeholder="Justificación HACCP…"
                    (change)="onThresholdNoteChange(t.area, $event)"
                  />
                </label>
              </article>
            }
          </div>

          <div class="vs-thresholds-footer">
            <button
              type="button"
              class="vs-thresholds-reset"
              (click)="resetThresholds()"
              title="Restaurar valores por defecto del cliente"
            >
              <span class="material-symbols-outlined text-[14px]">restart_alt</span>
              Restaurar defaults cliente
            </button>
            <span class="vs-thresholds-hint"> Cambios se guardan automáticamente (local). </span>
          </div>
        </div>
      </aside>
    }
  `,
  styles: [
    `
      /* Drawer shell */
      .vs-drawer-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.42);
        z-index: 40;
        animation: vsFadeIn 0.18s ease;
      }
      .vs-drawer {
        position: fixed;
        top: 0;
        right: 0;
        bottom: 0;
        width: min(540px, 96vw);
        background: #ffffff;
        border-left: 1px solid #e2e8f0;
        box-shadow: -10px 0 30px rgba(15, 23, 42, 0.1);
        z-index: 41;
        display: flex;
        flex-direction: column;
        animation: vsSlideIn 0.24s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes vsFadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      @keyframes vsSlideIn {
        from {
          transform: translateX(24px);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      .vs-drawer-head {
        padding: 14px 16px;
        border-bottom: 1px solid #e2e8f0;
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .vs-drawer-title {
        font-family: var(--font-josefin);
        font-size: 15px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .vs-drawer-sub {
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #64748b;
        margin-top: 2px;
      }
      .vs-drawer-close {
        margin-left: auto;
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        color: #64748b;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }
      .vs-drawer-close:hover {
        color: #1e293b;
        background: #f1f5f9;
      }
      .vs-drawer-body {
        padding: 16px;
        overflow-y: auto;
        flex: 1;
      }

      /* Thresholds content */
      .vs-thresholds-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .vs-thresholds-card {
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .vs-thresholds-card--missing {
        background: rgba(251, 191, 36, 0.04);
        border-color: rgba(251, 191, 36, 0.4);
      }
      .vs-thresholds-card-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .vs-thresholds-name {
        font-family: var(--font-josefin);
        font-size: 13.5px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
        flex: 1;
        min-width: 0;
      }
      .vs-thresholds-card-meta {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
      }
      .vs-thresholds-fields {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .vs-thresholds-field {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .vs-thresholds-field--full {
        grid-column: span 2;
      }
      .vs-thresholds-field-lbl {
        font-family: var(--font-dm);
        font-size: 9.5px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .vs-thresholds-input {
        font-family: var(--font-mono);
        font-size: 13px;
        font-weight: 600;
        text-align: right;
        padding: 6px 8px;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        background: #ffffff;
        color: #1e293b;
        width: 100%;
        font-variant-numeric: tabular-nums;
      }
      .vs-thresholds-input--text {
        font-family: var(--font-dm);
        font-weight: 400;
        text-align: left;
        font-size: 12px;
      }
      .vs-thresholds-input:focus {
        outline: 2px solid var(--color-primary);
        outline-offset: 1px;
        border-color: var(--color-primary);
      }
      .vs-thresholds-card--missing .vs-thresholds-input {
        border-color: rgba(251, 191, 36, 0.4);
      }
      .vs-thresholds-pending {
        font-family: var(--font-mono);
        font-size: 10px;
        color: #b45309;
        background: rgba(251, 191, 36, 0.12);
        border: 1px solid rgba(251, 191, 36, 0.3);
        border-radius: 4px;
        padding: 1px 5px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .vs-thresholds-remove {
        width: 28px;
        height: 28px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        color: #94a3b8;
        background: transparent;
      }
      .vs-thresholds-remove:hover {
        color: var(--color-danger);
        background: rgba(239, 68, 68, 0.08);
      }
      .vs-thresholds-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 14px;
        gap: 10px;
      }
      .vs-thresholds-reset {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 500;
      }
      .vs-thresholds-reset:hover {
        color: var(--color-primary);
        background: var(--color-primary-tint-06);
      }
      .vs-thresholds-hint {
        font-family: var(--font-dm);
        font-size: 11px;
        color: #94a3b8;
      }
    `,
  ],
})
export class VentisquerosUmbralesDrawerComponent {
  readonly open = model<boolean>(false);
  readonly sensors = input.required<Sensor[]>();

  private readonly thresholdsSvc = inject(ColdRoomThresholdsService);

  readonly thresholdsList = computed<SalaThreshold[]>(() => {
    this.thresholdsSvc.thresholds();
    const stored = this.thresholdsSvc.list();
    const storedSlugs = new Set(stored.map((t) => slugifyArea(t.area)));
    const liveAreas = Array.from(
      new Set(this.sensors().map((s) => (s.area || '').trim())),
    ).filter((a) => a && !storedSlugs.has(slugifyArea(a)));
    const extras: SalaThreshold[] = liveAreas.map((area) => ({
      area,
      tMax: NaN,
      updatedAt: '',
    }));
    return [...stored, ...extras].sort((a, b) => a.area.localeCompare(b.area));
  });

  onThresholdMaxChange(area: string, ev: Event): void {
    const input = ev.target as HTMLInputElement | null;
    if (!input) return;
    const v = Number(input.value);
    if (!Number.isFinite(v)) return;
    const cur = this.thresholdsSvc.get(area);
    this.thresholdsSvc.set(area, v, cur?.tMin, cur?.note);
  }

  onThresholdMinChange(area: string, ev: Event): void {
    const input = ev.target as HTMLInputElement | null;
    if (!input) return;
    const raw = input.value.trim();
    const v = raw === '' ? undefined : Number(raw);
    if (raw !== '' && !Number.isFinite(v as number)) return;
    const cur = this.thresholdsSvc.get(area);
    if (!cur) return;
    this.thresholdsSvc.set(area, cur.tMax, v as number | undefined, cur.note);
  }

  onThresholdNoteChange(area: string, ev: Event): void {
    const input = ev.target as HTMLInputElement | null;
    if (!input) return;
    const cur = this.thresholdsSvc.get(area);
    if (!cur) return;
    this.thresholdsSvc.set(area, cur.tMax, cur.tMin, input.value.trim());
  }

  removeThreshold(area: string): void {
    this.thresholdsSvc.remove(area);
  }

  resetThresholds(): void {
    this.thresholdsSvc.resetToDefaults();
  }

  readonly isNaN = Number.isNaN;

  relativeIso(iso: string): string {
    if (!iso) return '—';
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    if (diff < 60_000) return 'recién';
    if (diff < 3_600_000) return `hace ${Math.floor(diff / 60_000)}m`;
    if (diff < 86_400_000) return `hace ${Math.floor(diff / 3_600_000)}h`;
    return `hace ${Math.floor(diff / 86_400_000)}d`;
  }
}
