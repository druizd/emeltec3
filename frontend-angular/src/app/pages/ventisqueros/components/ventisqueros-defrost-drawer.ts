import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ColdRoomDefrostService,
  type DefrostWindow,
} from '../../../services/cold-room-defrost.service';
import type { SalaAggregate } from '../ventisqueros';

@Component({
  selector: 'app-ventisqueros-defrost-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="vs-drawer-backdrop" (click)="open.set(false)" aria-hidden="true"></div>
      <aside
        class="vs-drawer vs-drawer--wide"
        role="dialog"
        aria-modal="true"
        aria-label="Ventanas defrost"
      >
        <header class="vs-drawer-head">
          <div class="min-w-0">
            <div class="vs-drawer-title">Ventanas defrost</div>
            <div class="vs-drawer-sub">
              Programá ciclos de descongelado por sala. Desviaciones dentro de la ventana se marcan
              como esperadas (no cuentan como crítico HACCP).
            </div>
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
        <div class="vs-drawer-body vs-defrost-body">
          <div class="vs-defrost-sidebar">
            @for (sa of defrostSchedules(); track sa.slug) {
              <button
                type="button"
                class="vs-defrost-sala-btn"
                [class.vs-defrost-sala-btn--active]="defrostSelectedSlug() === sa.slug"
                (click)="selectDefrostSala(sa.slug)"
              >
                <div class="vs-defrost-sala-name truncate">{{ sa.area }}</div>
                <div class="vs-defrost-sala-meta">{{ defrostSummary(sa.windows) }}</div>
              </button>
            }
          </div>

          <div class="vs-defrost-detail">
            @if (defrostSelected(); as ds) {
              <div class="vs-defrost-detail-head">
                <div class="vs-defrost-detail-name">{{ ds.area }}</div>
                <button
                  type="button"
                  class="vs-defrost-add-btn"
                  (click)="addDefrostWindow(ds.area)"
                >
                  <span class="material-symbols-outlined text-[14px]">add</span>
                  Agregar ventana
                </button>
              </div>

              @if (ds.windows.length === 0) {
                <div class="vs-defrost-empty">
                  Sin ventanas configuradas. Click "Agregar ventana" para empezar.
                </div>
              } @else {
                @for (w of ds.windows; track w.id) {
                  <article
                    class="vs-defrost-window"
                    [class.vs-defrost-window--disabled]="!w.enabled"
                  >
                    <header class="vs-defrost-window-head">
                      <label class="vs-defrost-toggle">
                        <input
                          type="checkbox"
                          [checked]="w.enabled"
                          (change)="updateDefrostWindowField(ds.area, w.id, 'enabled', $event)"
                        />
                        <span>{{ w.enabled ? 'Activa' : 'Pausada' }}</span>
                      </label>
                      <button
                        type="button"
                        class="vs-defrost-remove"
                        (click)="removeDefrostWindow(ds.area, w.id)"
                        aria-label="Quitar ventana"
                      >
                        <span class="material-symbols-outlined text-[14px]">delete</span>
                      </button>
                    </header>

                    <div class="vs-defrost-fields">
                      <div class="vs-defrost-field">
                        <span class="vs-defrost-field-lbl">Inicio</span>
                        <input
                          type="time"
                          class="vs-defrost-input"
                          [value]="w.startHHmm"
                          (change)="updateDefrostWindowField(ds.area, w.id, 'startHHmm', $event)"
                        />
                      </div>
                      <div class="vs-defrost-field">
                        <span class="vs-defrost-field-lbl">Duración (min)</span>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          class="vs-defrost-input vs-defrost-input--num"
                          [value]="w.durationMin"
                          (change)="updateDefrostWindowField(ds.area, w.id, 'durationMin', $event)"
                        />
                      </div>
                    </div>

                    <div class="vs-defrost-days">
                      <span class="vs-defrost-field-lbl">Días</span>
                      <div class="vs-defrost-days-row">
                        @for (d of daysOfWeekChoices; track d.n) {
                          <button
                            type="button"
                            class="vs-defrost-day"
                            [class.vs-defrost-day--active]="hasDefrostDay(ds.area, w.id, d.n)"
                            (click)="toggleDefrostDay(ds.area, w.id, d.n)"
                          >
                            {{ d.lbl }}
                          </button>
                        }
                      </div>
                    </div>
                  </article>
                }
              }
            } @else {
              <div class="vs-defrost-empty">
                Selecciona una sala a la izquierda para configurar sus ventanas defrost.
              </div>
            }
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

      /* Defrost drawer */
      .vs-drawer--wide {
        width: min(720px, 96vw);
      }
      .vs-defrost-body {
        display: grid;
        grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
        gap: 14px;
        padding: 14px;
      }
      .vs-defrost-sidebar {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 70vh;
        overflow-y: auto;
        padding-right: 4px;
      }
      .vs-defrost-sala-btn {
        text-align: left;
        padding: 8px 10px;
        border-radius: 9px;
        border: 1px solid transparent;
        background: transparent;
        font-family: var(--font-dm);
        transition:
          background 0.15s ease,
          border-color 0.15s ease;
      }
      .vs-defrost-sala-btn:hover {
        background: #f1f5f9;
      }
      .vs-defrost-sala-btn--active {
        background: var(--color-primary-tint-10);
        border-color: var(--color-primary-tint-30);
      }
      .vs-defrost-sala-name {
        font-size: 12.5px;
        font-weight: 600;
        color: #1e293b;
      }
      .vs-defrost-sala-meta {
        font-family: var(--font-mono);
        font-size: 10.5px;
        color: #94a3b8;
        margin-top: 2px;
      }
      .vs-defrost-detail {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .vs-defrost-detail-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 8px;
      }
      .vs-defrost-detail-name {
        font-family: var(--font-josefin);
        font-size: 14px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .vs-defrost-add-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 8px;
        background: var(--color-primary);
        color: #ffffff;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 600;
        border: 1px solid var(--color-primary);
      }
      .vs-defrost-add-btn:hover {
        background: #0a7d87;
        border-color: #0a7d87;
      }
      .vs-defrost-empty {
        padding: 28px 16px;
        text-align: center;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #94a3b8;
        background: #f8fafc;
        border: 1px dashed #e2e8f0;
        border-radius: 12px;
      }
      .vs-defrost-window {
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #ffffff;
      }
      .vs-defrost-window--disabled {
        opacity: 0.55;
        background: #f8fafc;
      }
      .vs-defrost-window-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .vs-defrost-toggle {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-dm);
        font-size: 11.5px;
        font-weight: 600;
        color: #475569;
        cursor: pointer;
      }
      .vs-defrost-toggle input {
        accent-color: var(--color-primary);
      }
      .vs-defrost-remove {
        width: 26px;
        height: 26px;
        border-radius: 6px;
        background: transparent;
        color: #94a3b8;
        border: 0;
      }
      .vs-defrost-remove:hover {
        color: var(--color-danger);
        background: rgba(239, 68, 68, 0.08);
      }
      .vs-defrost-fields {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .vs-defrost-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
      }
      .vs-defrost-field-lbl {
        font-family: var(--font-dm);
        font-size: 9.5px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #94a3b8;
      }
      .vs-defrost-input {
        font-family: var(--font-mono);
        font-size: 12.5px;
        padding: 6px 8px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        background: #ffffff;
        color: #1e293b;
      }
      .vs-defrost-input--num {
        width: 90px;
      }
      .vs-defrost-input:focus {
        outline: 2px solid var(--color-primary);
        outline-offset: 1px;
        border-color: var(--color-primary);
      }
      .vs-defrost-days {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .vs-defrost-days-row {
        display: flex;
        gap: 4px;
      }
      .vs-defrost-day {
        width: 30px;
        height: 30px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 7px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        font-family: var(--font-mono);
        font-size: 11px;
        font-weight: 600;
        color: #94a3b8;
        cursor: pointer;
      }
      .vs-defrost-day:hover {
        color: #475569;
      }
      .vs-defrost-day--active {
        background: var(--color-primary-tint-10);
        border-color: var(--color-primary-tint-40);
        color: var(--color-primary);
      }
    `,
  ],
})
export class VentisquerosDefrostDrawerComponent {
  readonly open = model<boolean>(false);
  readonly salaAggregates = input.required<SalaAggregate[]>();

  private readonly defrostSvc = inject(ColdRoomDefrostService);

  readonly defrostSelectedSlug = signal<string | null>(null);
  readonly daysOfWeekChoices: { n: number; lbl: string }[] = [
    { n: 1, lbl: 'L' },
    { n: 2, lbl: 'M' },
    { n: 3, lbl: 'X' },
    { n: 4, lbl: 'J' },
    { n: 5, lbl: 'V' },
    { n: 6, lbl: 'S' },
    { n: 7, lbl: 'D' },
  ];

  readonly defrostSchedules = computed(() => {
    this.defrostSvc.schedules();
    return this.salaAggregates().map((sa) => ({
      area: sa.area,
      slug: sa.slug,
      windows: this.defrostSvc.list(sa.area),
    }));
  });

  defrostSelected(): { area: string; slug: string; windows: DefrostWindow[] } | null {
    const slug = this.defrostSelectedSlug();
    if (!slug) return null;
    return this.defrostSchedules().find((d) => d.slug === slug) || null;
  }

  selectDefrostSala(slug: string): void {
    this.defrostSelectedSlug.set(slug);
  }

  addDefrostWindow(area: string): void {
    this.defrostSvc.addWindow(area, {
      startHHmm: '02:00',
      durationMin: 20,
      daysOfWeek: [1, 2, 3, 4, 5],
      enabled: true,
    });
  }

  removeDefrostWindow(area: string, id: string): void {
    this.defrostSvc.removeWindow(area, id);
  }

  updateDefrostWindowField(area: string, id: string, field: keyof DefrostWindow, ev: Event): void {
    const target = ev.target as HTMLInputElement | null;
    if (!target) return;
    let value: string | number | boolean = target.value;
    if (field === 'durationMin') value = Math.max(1, Number(target.value) || 0);
    if (field === 'enabled') value = target.checked;
    this.defrostSvc.updateWindow(area, id, { [field]: value } as Partial<DefrostWindow>);
  }

  toggleDefrostDay(area: string, id: string, day: number): void {
    const sched = this.defrostSvc.list(area);
    const w = sched.find((x) => x.id === id);
    if (!w) return;
    const set = new Set(w.daysOfWeek);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    this.defrostSvc.updateWindow(area, id, { daysOfWeek: [...set].sort((a, b) => a - b) });
  }

  hasDefrostDay(area: string, id: string, day: number): boolean {
    const w = this.defrostSvc.list(area).find((x) => x.id === id);
    return w ? w.daysOfWeek.includes(day) : false;
  }

  defrostSummary(windows: DefrostWindow[]): string {
    if (windows.length === 0) return 'Sin ventanas';
    const enabled = windows.filter((w) => w.enabled).length;
    return `${enabled} / ${windows.length} activa${windows.length === 1 ? '' : 's'}`;
  }
}
