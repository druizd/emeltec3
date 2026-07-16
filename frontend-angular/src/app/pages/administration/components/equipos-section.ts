import { ChangeDetectionStrategy, Component, input, output, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { DetectedDevice } from '../../../services/administration.service';
import { AdminSectionShellComponent } from './admin-section-shell';
import { AdminTableToolbarComponent } from './admin-table-toolbar';
import { AdminPaginationComponent } from './admin-pagination';

const PAGE_SIZE = 10;

/**
 * Sección "Equipos detectados" de /administration.
 * Muestra la tabla de dispositivos con su estado de clock-skew y sitio asignado.
 */
@Component({
  selector: 'app-equipos-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    AdminSectionShellComponent,
    AdminTableToolbarComponent,
    AdminPaginationComponent,
  ],
  template: `
    <app-admin-section-shell title="Equipos detectados">
      <div class="table-card">
        <app-admin-table-toolbar
          title="Equipos detectados"
          [countLabel]="filteredDevices().length + ' de ' + devices().length + ' visibles'"
          [searchValue]="search()"
          placeholder="Buscar serial, sitio o empresa"
          (searchChange)="onSearchChange($event)"
        >
          <button type="button" (click)="refresh.emit()" class="secondary-button">
            <span class="material-symbols-outlined text-[18px]">sync</span>
            Actualizar
          </button>
        </app-admin-table-toolbar>

        <div class="overflow-x-auto">
          <table class="responsive-table w-full text-left text-body-sm md:min-w-[1080px]">
            <thead class="table-head">
              <tr>
                <th class="px-4 py-3">Serial</th>
                <th class="px-4 py-3">Registro</th>
                <th class="px-4 py-3">Desfase</th>
                <th class="px-4 py-3 text-right">Cantidad de datos</th>
                <th class="px-4 py-3">Sitio</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (device of paginatedDevices(); track device.id_serial) {
                <tr class="bg-white transition-colors hover:bg-slate-50">
                  <td
                    class="px-4 py-3 font-mono text-caption font-bold text-slate-700"
                    data-label="Serial"
                  >
                    {{ device.id_serial }}
                  </td>
                  <td class="px-4 py-3" data-label="Registro">
                    <div class="device-time-stack">
                      <div class="device-time-row">
                        <span class="device-time-label">Medición</span>
                        <span class="device-time-value">{{ deviceMeasurementLabel(device) }}</span>
                      </div>
                      <div class="device-time-row">
                        <span class="device-time-label">Llegada BD</span>
                        <span class="device-time-value">{{ deviceArrivalLabel(device) }}</span>
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-3" data-label="Desfase">
                    <span
                      [class]="deviceClockSkewBadgeClass(device)"
                      [title]="deviceClockSkewTitle(device)"
                    >
                      <span class="material-symbols-outlined text-[15px]">{{
                        deviceClockSkewIcon(device)
                      }}</span>
                      {{ deviceClockSkewLabel(device) }}
                    </span>
                  </td>
                  <td
                    class="px-4 py-3 text-right font-bold text-slate-700"
                    data-label="Cantidad de datos"
                  >
                    {{ deviceDataCountLabel(device) }}
                  </td>
                  <td class="px-4 py-3" data-label="Sitio">
                    <span [class]="statusBadgeClass(device.sitio_id ? 'success' : 'warning')">
                      {{ device.sitio_descripcion || 'Sin asignar' }}
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-admin-pagination
          [total]="filteredDevices().length"
          [page]="page()"
          (pageChange)="onPageChange($event)"
        ></app-admin-pagination>
      </div>
    </app-admin-section-shell>
  `,
  styles: [
    `
      .secondary-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 36px;
        border-radius: 8px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
        padding: 8px 16px;
        font-family: var(--font-body);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-on-surface-variant);
        cursor: pointer;
        transition: all 160ms ease;
      }

      .secondary-button:hover {
        border-color: rgba(13, 175, 189, 0.3);
        background: rgba(13, 175, 189, 0.04);
        color: var(--color-primary-container);
      }

      .secondary-button:active {
        transform: scale(0.98);
      }

      .table-card {
        min-width: 0;
        overflow: hidden;
        border-radius: 10px;
        border: 1px solid var(--color-outline-variant);
        background: var(--color-surface);
      }

      .table-head {
        background: var(--color-surface-subtle);
        font-family: var(--font-josefin);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-on-surface-muted);
      }

      .device-time-stack {
        display: grid;
        gap: 4px;
        min-width: 220px;
      }

      .device-time-row {
        display: grid;
        grid-template-columns: 74px minmax(0, 1fr);
        align-items: baseline;
        gap: 10px;
      }

      .device-time-label {
        font-family: var(--font-josefin);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-on-surface-muted);
      }

      .device-time-value {
        font-family: var(--font-mono);
        font-size: 12px;
        font-weight: 600;
        color: var(--color-on-surface);
        white-space: nowrap;
      }

      .device-skew-badge {
        display: inline-flex;
        min-height: 28px;
        align-items: center;
        gap: 6px;
        border-radius: 9999px;
        border: 1px solid transparent;
        padding: 4px 9px;
        font-size: 11px;
        font-weight: 700;
        white-space: nowrap;
      }

      .device-skew-ok {
        border-color: rgba(34, 197, 94, 0.25);
        background: rgba(34, 197, 94, 0.1);
        color: #16a34a;
      }

      .device-skew-warning {
        border-color: rgba(251, 191, 36, 0.3);
        background: rgba(251, 191, 36, 0.12);
        color: #b45309;
      }

      .device-skew-danger {
        border-color: rgba(248, 113, 113, 0.3);
        background: rgba(248, 113, 113, 0.1);
        color: #dc2626;
      }

      .device-skew-neutral {
        border-color: var(--color-outline-variant);
        background: var(--color-surface-subtle);
        color: var(--color-on-surface-variant);
      }
    `,
  ],
})
export class EquiposSectionComponent {
  readonly devices = input.required<DetectedDevice[]>();
  readonly refresh = output<void>();

  readonly search = signal('');
  readonly page = signal(1);

  readonly filteredDevices = computed<DetectedDevice[]>(() =>
    this.devices().filter((device) =>
      this.matchesSearch(this.search(), [
        device.id_serial,
        device.ultimo_registro,
        device.ultimo_registro_local || '',
        device.ultima_medicion || '',
        device.ultima_medicion_local || '',
        device.ultima_llegada || '',
        device.ultima_llegada_local || '',
        this.deviceClockSkewLabel(device),
        String(this.deviceDataCount(device)),
        String(device.total_registros),
        device.sitio_descripcion || '',
        device.empresa_nombre || '',
        device.sub_empresa_nombre || '',
      ]),
    ),
  );

  readonly paginatedDevices = computed<DetectedDevice[]>(() =>
    this.paginate(this.filteredDevices(), this.page()),
  );

  onSearchChange(value: string): void {
    this.search.set(value);
    this.page.set(1);
  }

  onPageChange(page: number): void {
    this.page.set(this.clampPage(page, this.filteredDevices().length));
  }

  // ── Display helpers ──────────────────────────────────────────────────────

  deviceDataCount(device: DetectedDevice): number {
    return Number(device.total_datos ?? 0);
  }

  deviceDataCountLabel(device: DetectedDevice): string {
    if (device.total_datos === undefined || device.total_datos === null) return 'No disponible';
    const count = this.deviceDataCount(device);
    return `${count} ${count === 1 ? 'dato' : 'datos'}`;
  }

  deviceMeasurementLabel(device: DetectedDevice): string {
    return (
      this.deviceDateLabel(device.ultima_medicion_local, device.ultima_medicion) ||
      this.deviceLastSeenLabel(device)
    );
  }

  deviceArrivalLabel(device: DetectedDevice): string {
    return (
      this.deviceDateLabel(device.ultima_llegada_local, device.ultima_llegada) ||
      this.deviceLastSeenLabel(device)
    );
  }

  deviceClockSkewLabel(device: DetectedDevice): string {
    const seconds = this.deviceClockSkewSeconds(device);
    if (seconds === null) return 'Sin llegada';
    if (seconds === 0) return 'Sin desfase';

    const absLabel = this.formatDurationLabel(Math.abs(seconds));
    if (seconds > 0) return `Adelantado ${absLabel}`;
    if (Math.abs(seconds) >= 86400) return 'Carga histórica';
    return `Llegada +${absLabel}`;
  }

  deviceClockSkewTitle(device: DetectedDevice): string {
    return [
      `Medición: ${this.deviceMeasurementLabel(device)}`,
      `Llegada BD: ${this.deviceArrivalLabel(device)}`,
      `Estado: ${this.deviceClockSkewLabel(device)}`,
    ].join(' | ');
  }

  deviceClockSkewIcon(device: DetectedDevice): string {
    const tone = this.deviceClockSkewTone(device);
    if (tone === 'danger') return 'error';
    if (tone === 'warning') return 'schedule';
    if (tone === 'ok') return 'check_circle';
    return 'history';
  }

  deviceClockSkewBadgeClass(device: DetectedDevice): string {
    return `device-skew-badge device-skew-${this.deviceClockSkewTone(device)}`;
  }

  deviceLastSeenLabel(device: DetectedDevice): string {
    if (device.ultimo_registro_local)
      return this.readableDeviceDateTime(device.ultimo_registro_local);

    const date = new Date(device.ultimo_registro);
    if (Number.isNaN(date.getTime())) return device.ultimo_registro || 'Sin registro';

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'Etc/GMT+4',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(date)
      .replace(',', '');
  }

  statusBadgeClass(tone: 'success' | 'warning' | 'neutral'): string {
    const base = 'rounded-md px-2 py-1 text-caption font-bold';
    if (tone === 'success') return `${base} bg-emerald-50 text-emerald-700`;
    if (tone === 'warning') return `${base} bg-amber-50 text-amber-700`;
    return `${base} bg-slate-100 text-slate-500`;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private deviceClockSkewSeconds(device: DetectedDevice): number | null {
    if (device.desfase_segundos !== undefined && device.desfase_segundos !== null) {
      const direct = Number(device.desfase_segundos);
      if (Number.isFinite(direct)) return Math.round(direct);
    }

    const measuredMs = this.deviceTimestampMs(device.ultima_medicion);
    const receivedMs = this.deviceTimestampMs(device.ultima_llegada);
    if (measuredMs === null || receivedMs === null) return null;
    return Math.round((measuredMs - receivedMs) / 1000);
  }

  private deviceClockSkewTone(device: DetectedDevice): 'ok' | 'warning' | 'danger' | 'neutral' {
    const seconds = this.deviceClockSkewSeconds(device);
    if (seconds === null) return 'neutral';
    if (seconds < -86400) return 'neutral';
    if (seconds > 120) return 'danger';
    if (seconds > 30 || seconds < -600) return 'warning';
    return 'ok';
  }

  private deviceDateLabel(localValue?: string | null, utcValue?: string | null): string | null {
    if (localValue) return this.readableDeviceDateTime(localValue);

    const date = utcValue ? new Date(utcValue) : null;
    if (!date || Number.isNaN(date.getTime())) return null;

    return new Intl.DateTimeFormat('es-CL', {
      timeZone: 'Etc/GMT+4',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(date)
      .replace(',', '');
  }

  private deviceTimestampMs(value?: string | null): number | null {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  private formatDurationLabel(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const restSeconds = seconds % 60;
    if (minutes < 60) {
      return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 24) {
      return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
    }

    const days = Math.floor(hours / 24);
    const restHours = hours % 24;
    return restHours ? `${days}d ${restHours}h` : `${days}d`;
  }

  private readableDeviceDateTime(value: string): string {
    const cleaned = value.trim();
    const isoLike = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
    if (isoLike) return `${isoLike[3]}-${isoLike[2]}-${isoLike[1]} ${isoLike[4]}`;
    return cleaned.replace(',', '');
  }

  private paginate<T>(items: T[], page: number): T[] {
    const currentPage = this.clampPage(page, items.length);
    const start = (currentPage - 1) * PAGE_SIZE;
    return items.slice(start, start + PAGE_SIZE);
  }

  private clampPage(page: number, totalItems: number): number {
    const total = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    const normalized = Number.isFinite(page) ? Math.trunc(page) : 1;
    return Math.min(Math.max(normalized, 1), total);
  }

  private matchesSearch(
    query: string,
    values: (string | number | null | undefined)[],
  ): boolean {
    const normalizedQuery = this.normalizeSearchText(query);
    if (!normalizedQuery) return true;
    const haystack = this.normalizeSearchText(...values.map((v) => String(v ?? '')));
    return normalizedQuery
      .split(' ')
      .filter(Boolean)
      .every((part) => haystack.includes(part));
  }

  private normalizeSearchText(...values: (string | null | undefined)[]): string {
    return values
      .map((v) => String(v ?? '').trim())
      .join(' ')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}
