import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ColdRoomService,
  type ColdRoomExportInterval,
  type ColdRoomExportPoint,
  type ColdRoomSensor,
} from '../../../services/cold-room.service';
import type { SalaAggregate } from '../ventisqueros';
import type { SiteRecord } from '@emeltec/shared';

@Component({
  selector: 'app-ventisqueros-history-export',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="vs-hx-backdrop" (click)="open.set(false)" aria-hidden="true"></div>
      <aside class="vs-hx-modal" role="dialog" aria-modal="true" aria-label="Descargar historial">
        <header class="vs-hx-head">
          <div class="vs-hx-title">Descargar historial</div>
          <button type="button" class="vs-hx-close" (click)="open.set(false)" aria-label="Cerrar">
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </header>

        <div class="vs-hx-body">
          <!-- Rango fechas -->
          <div class="vs-hx-section">
            <div class="vs-hx-section-title">1. Rango de fechas</div>
            <div class="vs-hx-range">
              <label class="vs-hx-field">
                <span>Desde</span>
                <input
                  type="datetime-local"
                  [value]="historyExportFrom()"
                  (input)="setHistoryExportFrom($event)"
                />
              </label>
              <label class="vs-hx-field">
                <span>Hasta</span>
                <input
                  type="datetime-local"
                  [value]="historyExportTo()"
                  (input)="setHistoryExportTo($event)"
                />
              </label>
            </div>
            <div class="vs-hx-hint">
              La resolución base se elige automático según rango: 1min (≤2d), 5min (≤7d), 1h (≤30d),
              1d (resto).
            </div>
          </div>

          <!-- Intervalo de agrupación (promedio / mín / máx) -->
          <div class="vs-hx-section">
            <div class="vs-hx-section-title">2. Intervalo de agrupación</div>
            <div class="flex flex-wrap gap-1.5">
              @for (opt of historyExportIntervalOptions; track opt.value) {
                <button
                  type="button"
                  class="vs-hx-btn"
                  [class.vs-hx-btn--primary]="historyExportInterval() === opt.value"
                  (click)="historyExportInterval.set(opt.value)"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
            <div class="vs-hx-hint">
              Cada fila trae promedio, mínimo y máximo por intervalo. "Auto" usa la resolución base.
              No puede ser más fino que la base disponible para el rango.
            </div>
          </div>

          <!-- Variables -->
          <div class="vs-hx-section">
            <div class="vs-hx-section-title">3. Variables</div>
            <div class="flex flex-wrap gap-1.5">
              @for (opt of historyExportVarsOptions; track opt.value) {
                <button
                  type="button"
                  class="vs-hx-btn"
                  [class.vs-hx-btn--primary]="historyExportVars() === opt.value"
                  (click)="historyExportVars.set(opt.value)"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          </div>

          <!-- Salas -->
          <div class="vs-hx-section">
            <div class="vs-hx-section-head">
              <div class="vs-hx-section-title">
                4. Salas
                <span class="vs-hx-count">
                  {{ historyExportSelectedSalas().size }} / {{ salaAggregates().length }}
                </span>
              </div>
              <button type="button" class="vs-hx-toggle-all" (click)="toggleExportSelectAllSalas()">
                {{
                  historyExportSelectedSalas().size === salaAggregates().length
                    ? 'Quitar todas'
                    : 'Seleccionar todas'
                }}
              </button>
            </div>
            <div class="vs-hx-grid">
              @for (sa of salaAggregates(); track sa.slug) {
                <label class="vs-hx-checkbox">
                  <input
                    type="checkbox"
                    [checked]="historyExportSelectedSalas().has(sa.slug)"
                    (change)="toggleExportSala(sa.slug)"
                  />
                  <span class="vs-hx-checkbox-lbl">
                    {{ sa.area }}
                    <span class="vs-hx-checkbox-meta">{{ sa.count }} sensores</span>
                  </span>
                </label>
              }
            </div>
          </div>

          <!-- Sensores -->
          <div class="vs-hx-section">
            <div class="vs-hx-section-head">
              <div class="vs-hx-section-title">
                5. Sensores
                <span class="vs-hx-count">
                  {{ historyExportSelectedSensors().size }} /
                  {{ exportAvailableSensors().length }}
                </span>
              </div>
              @if (exportAvailableSensors().length > 0) {
                <button
                  type="button"
                  class="vs-hx-toggle-all"
                  (click)="toggleExportSelectAllSensors()"
                >
                  {{
                    historyExportSelectedSensors().size === exportAvailableSensors().length
                      ? 'Quitar todos'
                      : 'Seleccionar todos'
                  }}
                </button>
              }
            </div>
            @if (exportAvailableSensors().length === 0) {
              <div class="vs-hx-empty">Selecciona al menos una sala primero.</div>
            } @else {
              <div class="vs-hx-grid">
                @for (s of exportAvailableSensors(); track s.id) {
                  <label class="vs-hx-checkbox">
                    <input
                      type="checkbox"
                      [checked]="historyExportSelectedSensors().has(s.id)"
                      (change)="toggleExportSensor(s.id)"
                    />
                    <span class="vs-hx-checkbox-lbl">
                      {{ s.id }}
                      <span class="vs-hx-checkbox-meta">{{ s.area }} · {{ s.tap }}</span>
                    </span>
                  </label>
                }
              </div>
            }
          </div>

          @if (historyExportError(); as err) {
            <div class="vs-hx-error">
              <span class="material-symbols-outlined text-[14px]">error</span>
              {{ err }}
            </div>
          }
        </div>

        <footer class="vs-hx-foot">
          <button type="button" class="vs-hx-btn" (click)="open.set(false)">Cancelar</button>
          <button
            type="button"
            class="vs-hx-btn vs-hx-btn--primary"
            [disabled]="historyExportLoading() || historyExportSelectedSensors().size === 0"
            (click)="confirmHistoryExport()"
          >
            @if (historyExportLoading()) {
              <span class="material-symbols-outlined text-[14px] animate-spin"
                >progress_activity</span
              >
              Generando…
            } @else {
              <span class="material-symbols-outlined text-[14px]">download</span>
              Descargar Excel
            }
          </button>
        </footer>
      </aside>
    }
  `,
  styles: [
    `
      .vs-hx-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(15, 23, 42, 0.5);
        z-index: 50;
        animation: hxFadeIn 0.15s ease-out;
      }
      @keyframes hxFadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .vs-hx-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: min(640px, 94vw);
        max-height: 88vh;
        background: #ffffff;
        border-radius: 14px;
        border: 1px solid #e2e8f0;
        box-shadow: 0 20px 60px rgba(15, 23, 42, 0.22);
        z-index: 51;
        display: flex;
        flex-direction: column;
        animation: hxScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      }
      @keyframes hxScaleIn {
        from {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.96);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }
      .vs-hx-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        border-bottom: 1px solid #e2e8f0;
      }
      .vs-hx-title {
        font-family: var(--font-josefin), sans-serif;
        font-size: 15px;
        font-weight: 600;
        color: #1e293b;
        letter-spacing: 0.02em;
      }
      .vs-hx-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 7px;
        background: transparent;
        color: #64748b;
        border: 1px solid transparent;
      }
      .vs-hx-close:hover {
        background: rgba(15, 23, 42, 0.06);
        color: #1e293b;
      }
      .vs-hx-body {
        padding: 16px 18px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .vs-hx-section {
        border-bottom: 1px solid #f1f5f9;
        padding-bottom: 12px;
      }
      .vs-hx-section:last-child {
        border-bottom: none;
        padding-bottom: 0;
      }
      .vs-hx-section-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .vs-hx-section-title {
        font-family: var(--font-dm);
        font-size: 12px;
        font-weight: 600;
        color: #1e293b;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 6px;
      }
      .vs-hx-count {
        font-family: var(--font-mono);
        font-size: 10.5px;
        font-weight: 500;
        color: #94a3b8;
        margin-left: 6px;
        text-transform: none;
        letter-spacing: 0;
      }
      .vs-hx-toggle-all {
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: var(--color-primary);
        background: transparent;
        border: none;
        font-weight: 500;
      }
      .vs-hx-toggle-all:hover {
        text-decoration: underline;
      }
      .vs-hx-range {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      .vs-hx-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: var(--font-dm);
        font-size: 11px;
        color: #64748b;
      }
      .vs-hx-field input {
        padding: 7px 9px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        font-family: var(--font-mono);
        font-size: 12px;
        color: #1e293b;
        outline: none;
      }
      .vs-hx-field input:focus {
        border-color: var(--color-primary);
      }
      .vs-hx-hint {
        margin-top: 6px;
        font-family: var(--font-dm);
        font-size: 10.5px;
        color: #94a3b8;
        font-style: italic;
      }
      .vs-hx-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 6px;
        max-height: 180px;
        overflow-y: auto;
        padding: 4px 2px;
      }
      .vs-hx-checkbox {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 9px;
        border: 1px solid #e2e8f0;
        border-radius: 7px;
        cursor: pointer;
        transition:
          border-color 0.15s,
          background 0.15s;
      }
      .vs-hx-checkbox:hover {
        border-color: var(--color-primary-tint-30);
        background: var(--color-primary-tint-04);
      }
      .vs-hx-checkbox input {
        margin-top: 2px;
        accent-color: var(--color-primary);
      }
      .vs-hx-checkbox-lbl {
        display: flex;
        flex-direction: column;
        font-family: var(--font-dm);
        font-size: 12px;
        color: #1e293b;
        line-height: 1.3;
      }
      .vs-hx-checkbox-meta {
        font-size: 10.5px;
        color: #94a3b8;
        font-weight: 400;
      }
      .vs-hx-empty {
        font-family: var(--font-dm);
        font-size: 11.5px;
        color: #94a3b8;
        font-style: italic;
        padding: 10px;
        text-align: center;
        background: #f8fafc;
        border-radius: 7px;
      }
      .vs-hx-error {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 8px 10px;
        background: rgba(239, 68, 68, 0.1);
        color: #b91c1c;
        border: 1px solid rgba(239, 68, 68, 0.25);
        border-radius: 7px;
        font-family: var(--font-dm);
        font-size: 11.5px;
      }
      .vs-hx-foot {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 18px;
        border-top: 1px solid #e2e8f0;
        background: #f8fafc;
        border-radius: 0 0 14px 14px;
      }
      .vs-hx-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 8px 14px;
        border-radius: 7px;
        border: 1px solid #e2e8f0;
        background: #ffffff;
        color: #475569;
        font-family: var(--font-dm);
        font-size: 12px;
        font-weight: 500;
      }
      .vs-hx-btn:hover:not(:disabled) {
        background: #f1f5f9;
      }
      .vs-hx-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .vs-hx-btn--primary {
        background: var(--color-primary);
        color: #ffffff;
        border-color: var(--color-primary);
      }
      .vs-hx-btn--primary:hover:not(:disabled) {
        background: #0c8b96;
      }
      .animate-spin {
        animation: hxSpin 0.9s linear infinite;
      }
      @keyframes hxSpin {
        to {
          transform: rotate(360deg);
        }
      }
    `,
  ],
})
export class VentisquerosHistoryExportComponent {
  readonly open = model<boolean>(false);
  readonly salaAggregates = input.required<SalaAggregate[]>();
  readonly coldRoomSensors = input.required<ColdRoomSensor[]>();
  readonly siteId = input.required<string>();
  readonly coldRoomSites = input.required<SiteRecord[]>();

  private readonly coldRoom = inject(ColdRoomService);

  // Reset state when modal opens.
  constructor() {
    effect(() => {
      if (this.open()) {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        this.historyExportFrom.set(this.toDatetimeLocal(startOfToday));
        this.historyExportTo.set(this.toDatetimeLocal(now));
        this.historyExportSelectedSalas.set(new Set());
        this.historyExportSelectedSensors.set(new Set());
        this.historyExportError.set(null);
      }
    });
  }

  readonly historyExportSelectedSalas = signal<Set<string>>(new Set<string>());
  readonly historyExportSelectedSensors = signal<Set<string>>(new Set<string>());
  readonly historyExportFrom = signal<string>('');
  readonly historyExportTo = signal<string>('');
  readonly historyExportLoading = signal<boolean>(false);
  readonly historyExportError = signal<string | null>(null);
  // Intervalo de agrupación (promedio/mín/máx por intervalo). 'auto' = resolución base.
  readonly historyExportInterval = signal<ColdRoomExportInterval>('auto');
  readonly historyExportIntervalOptions: { value: ColdRoomExportInterval; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: '1min', label: '1 min' },
    { value: '5min', label: '5 min' },
    { value: '15min', label: '15 min' },
    { value: '1h', label: '1 hora' },
    { value: '1d', label: '1 día' },
  ];
  // Variables a incluir en el Excel.
  readonly historyExportVars = signal<'both' | 'temp' | 'hum'>('both');
  readonly historyExportVarsOptions: { value: 'both' | 'temp' | 'hum'; label: string }[] = [
    { value: 'both', label: 'Ambas' },
    { value: 'temp', label: 'Temperatura' },
    { value: 'hum', label: 'Humedad' },
  ];

  private toDatetimeLocal(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  toggleExportSala(slug: string): void {
    const cur = new Set(this.historyExportSelectedSalas());
    if (cur.has(slug)) cur.delete(slug);
    else cur.add(slug);
    this.historyExportSelectedSalas.set(cur);
    // Limpia sensores cuyo área ya no está seleccionada.
    const validIds = new Set(this.exportAvailableSensors().map((s) => s.id));
    const cleanSensors = new Set(
      [...this.historyExportSelectedSensors()].filter((id) => validIds.has(id)),
    );
    this.historyExportSelectedSensors.set(cleanSensors);
  }

  toggleExportSensor(id: string): void {
    const cur = new Set(this.historyExportSelectedSensors());
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    this.historyExportSelectedSensors.set(cur);
  }

  toggleExportSelectAllSalas(): void {
    const all = this.salaAggregates().map((sa) => sa.slug);
    const cur = this.historyExportSelectedSalas();
    if (cur.size === all.length) this.historyExportSelectedSalas.set(new Set());
    else this.historyExportSelectedSalas.set(new Set(all));
    // Reset sensores.
    this.historyExportSelectedSensors.set(new Set());
  }

  toggleExportSelectAllSensors(): void {
    const available = this.exportAvailableSensors().map((s) => s.id);
    const cur = this.historyExportSelectedSensors();
    if (cur.size === available.length) this.historyExportSelectedSensors.set(new Set());
    else this.historyExportSelectedSensors.set(new Set(available));
  }

  readonly exportAvailableSensors = computed(() => {
    const salaSlugs = this.historyExportSelectedSalas();
    if (salaSlugs.size === 0) return [];
    return this.coldRoomSensors().filter((s) => salaSlugs.has(this.salaSlug(s.area)));
  });

  setHistoryExportFrom(ev: Event): void {
    this.historyExportFrom.set((ev.target as HTMLInputElement).value);
  }

  setHistoryExportTo(ev: Event): void {
    this.historyExportTo.set((ev.target as HTMLInputElement).value);
  }

  async confirmHistoryExport(): Promise<void> {
    this.historyExportError.set(null);
    const sensors = [...this.historyExportSelectedSensors()];
    if (sensors.length === 0) {
      this.historyExportError.set('Selecciona al menos un sensor.');
      return;
    }
    const fromStr = this.historyExportFrom();
    const toStr = this.historyExportTo();
    if (!fromStr || !toStr) {
      this.historyExportError.set('Rango de fechas inválido.');
      return;
    }
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (to <= from) {
      this.historyExportError.set('La fecha "Hasta" debe ser mayor que "Desde".');
      return;
    }

    const sid = this.siteId();
    const related = this.coldRoomSites().map((s) => s.id);
    const allIds = related.length > 0 ? [...new Set([sid, ...related])] : [sid];

    this.historyExportLoading.set(true);
    this.coldRoom
      .exportHistory(
        sid,
        from.toISOString(),
        to.toISOString(),
        allIds,
        sensors,
        this.historyExportInterval(),
      )
      .subscribe({
        next: async (res) => {
          this.historyExportLoading.set(false);
          if (!res.ok) {
            this.historyExportError.set(res.error || 'Error al obtener datos.');
            return;
          }
          if (res.data.points.length === 0) {
            this.historyExportError.set('Sin datos en el rango seleccionado.');
            return;
          }
          try {
            await this.downloadHistoryXlsx(
              res.data.points,
              from,
              to,
              res.meta.view,
              sensors,
              res.meta.interval,
            );
            this.open.set(false);
          } catch (err) {
            this.historyExportError.set(
              'Error al generar Excel: ' + (err instanceof Error ? err.message : String(err)),
            );
          }
        },
        error: (err) => {
          this.historyExportLoading.set(false);
          this.historyExportError.set(
            'Error HTTP: ' + (err?.error?.error || err?.message || 'desconocido'),
          );
        },
      });
  }

  // Lazy load xlsx — primer click paga la descarga (~150 kB), siguientes
  // clicks reusan el módulo en memoria.
  private xlsxLoader?: Promise<typeof import('xlsx')>;
  private async loadXlsx(): Promise<typeof import('xlsx')> {
    if (!this.xlsxLoader) this.xlsxLoader = import('xlsx');
    return this.xlsxLoader;
  }

  private salaSlug(area: string): string {
    return area
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private formatChileShort(ts: string): string {
    const { date, time } = this.formatChileParts(ts);
    return `${date} ${time}`;
  }

  private formatChileParts(ts: string): { date: string; time: string } {
    const d = new Date(ts);
    const parts = new Intl.DateTimeFormat('es-CL', {
      timeZone: 'America/Santiago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}:${get('minute')}`,
    };
  }

  private async downloadHistoryXlsx(
    points: ColdRoomExportPoint[],
    from: Date,
    to: Date,
    view: string,
    sensorIds: string[],
    intervalLabel?: string,
  ): Promise<void> {
    const XLSX = await this.loadXlsx();
    const wb = XLSX.utils.book_new();
    const r2 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 100) / 100);
    const vars = this.historyExportVars();
    const incT = vars !== 'hum';
    const incH = vars !== 'temp';

    // Hoja 1: Lecturas (promedio/mín/máx por intervalo). Columnas según variables.
    const rows = points.map((p) => {
      const dt = this.formatChileParts(p.ts);
      const row: Record<string, string | number | null> = {
        Fecha: dt.date,
        Hora: dt.time,
        Sensor: p.sensorId,
        Sala: (p.area || '').replace(/\s+/g, ' ').trim(),
        TAP: p.tap,
      };
      if (incT) {
        row['Temp prom (°C)'] = r2(p.t);
        row['Temp mín (°C)'] = r2(p.tMin);
        row['Temp máx (°C)'] = r2(p.tMax);
      }
      if (incH) {
        row['HR prom (%)'] = r2(p.h);
        row['HR mín (%)'] = r2(p.hMin);
        row['HR máx (%)'] = r2(p.hMax);
      }
      return row;
    });
    const sheet1 = XLSX.utils.json_to_sheet(rows);
    sheet1['!cols'] = [
      { wch: 12 }, // Fecha
      { wch: 8 }, // Hora
      { wch: 10 }, // Sensor
      { wch: 28 }, // Sala
      { wch: 8 }, // TAP
      ...(incT ? [{ wch: 14 }, { wch: 13 }, { wch: 13 }] : []),
      ...(incH ? [{ wch: 12 }, { wch: 11 }, { wch: 11 }] : []),
    ];
    // Freeze header row.
    sheet1['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, sheet1, 'Lecturas');

    // Hoja 2: Resumen.
    const fmtRange = (d: Date) => this.formatChileShort(d.toISOString());
    const cagg: Record<string, string> = {
      equipo_1min: '1 minuto',
      equipo_5min: '5 minutos',
      equipo_hourly: '1 hora',
      equipo_daily: '1 día',
    };
    const intervalNames: Record<string, string> = {
      '1min': '1 minuto',
      '5min': '5 minutos',
      '15min': '15 minutos',
      '1h': '1 hora',
      '1d': '1 día',
    };
    const summary = [
      { Campo: 'Sitio', Valor: 'Ventisqueros' },
      { Campo: 'Generado', Valor: this.formatChileShort(new Date().toISOString()) },
      { Campo: 'Rango desde', Valor: fmtRange(from) },
      { Campo: 'Rango hasta', Valor: fmtRange(to) },
      {
        Campo: 'Agrupación (promedio/mín/máx)',
        Valor: intervalLabel ? intervalNames[intervalLabel] || intervalLabel : cagg[view] || view,
      },
      { Campo: 'Resolución base', Valor: cagg[view] || view },
      {
        Campo: 'Variables',
        Valor:
          vars === 'both' ? 'Temperatura + Humedad' : vars === 'temp' ? 'Temperatura' : 'Humedad',
      },
      { Campo: 'Sensores', Valor: sensorIds.join(', ') },
      { Campo: 'Total filas', Valor: points.length },
    ];
    const sheet2 = XLSX.utils.json_to_sheet(summary);
    sheet2['!cols'] = [{ wch: 18 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, sheet2, 'Resumen');

    const fmt = (d: Date) =>
      `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const fileName = `ventisqueros-historial-${fmt(from)}-${fmt(to)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  }
}
