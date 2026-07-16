import { A11yModule } from '@angular/cdk/a11y';
import { HttpClient } from '@angular/common/http';
import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DgaService } from '../../../../services/dga.service';

interface DgaReportRow {
  id: string;
  recordId: string;
  fecha: string;
  dateIso: string;
  timestampMs: number;
  nivelFreatico: number | null;
  caudal: number | null;
  totalizador: number | null;
  estado: string;
  enviadoDga: string;
  respuesta: string;
  comprobante: string;
}

@Component({
  selector: 'app-water-detail-dga-reporte',
  standalone: true,
  imports: [A11yModule],
  template: `
    <ng-container>
      <!-- Modal Reporte DGA -->
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]"
        (click)="closeDgaReportModal()"
      >
        <section
          class="w-full max-w-[480px] overflow-hidden rounded-2xl bg-white shadow-2xl"
          (click)="$event.stopPropagation()"
          role="dialog"
          cdkTrapFocus
          cdkTrapFocusAutoCapture
          aria-modal="true"
          aria-labelledby="dga-report-modal-title"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div class="flex items-center gap-3">
              <span
                class="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"
              >
                <span class="material-symbols-outlined text-[18px]">description</span>
              </span>
              <div>
                <h2 id="dga-report-modal-title" class="text-body font-semibold text-slate-800">
                  Reporte DGA
                </h2>
                <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                  Formato oficial · período a exportar
                </p>
              </div>
            </div>
            <button
              type="button"
              (click)="closeDgaReportModal()"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          <!-- Presets rápidos -->
          <div class="px-5 pt-4">
            <p
              class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            >
              Período rápido
            </p>
            <div class="grid grid-cols-3 gap-1.5">
              @for (preset of downloadPresets; track preset.id) {
                <button
                  type="button"
                  (click)="applyDgaReportPreset(preset.id)"
                  [class]="
                    dgaReportSelectedPreset() === preset.id
                      ? 'rounded-lg border border-accent/30 bg-accent/10 px-2 py-2 text-center text-caption-xs font-bold text-accent-deep transition-all'
                      : 'rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-caption-xs font-semibold text-slate-500 transition-all hover:border-slate-300 hover:bg-slate-50'
                  "
                >
                  {{ preset.label }}
                </button>
              }
            </div>
          </div>

          <!-- Meses -->
          <div class="px-5 pt-4">
            <p
              class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            >
              Meses {{ 'de ' + (dgaReportDateFrom() || '2026').slice(0, 4) }}
            </p>
            <div class="grid grid-cols-6 gap-1.5">
              @for (month of downloadMonthNames; track month; let i = $index) {
                <button
                  type="button"
                  (click)="applyDgaReportMonth(i)"
                  [class]="
                    !dgaMonthHasData(i)
                      ? 'rounded-lg py-1.5 text-caption-xs font-semibold bg-slate-50 text-slate-300 cursor-not-allowed'
                      : dgaReportSelectedMonths().includes(i)
                        ? 'rounded-lg py-1.5 text-caption-xs font-bold bg-accent-container text-white ring-2 ring-accent/30'
                        : 'rounded-lg py-1.5 text-caption-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors'
                  "
                >
                  {{ month.slice(0, 3) }}
                </button>
              }
            </div>
          </div>

          <!-- Rango manual -->
          <div class="grid grid-cols-2 gap-3 px-5 pt-4">
            <label class="grid gap-1.5 text-caption-xs font-bold text-slate-500">
              Desde
              <input
                type="date"
                min="2020-01-01"
                [value]="dgaReportDateFrom()"
                (input)="
                  dgaReportDateFrom.set($any($event.target).value);
                  dgaReportSelectedPreset.set('custom');
                  dgaReportSelectedMonths.set([])
                "
                class="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-700 outline-none transition-colors focus:border-accent/30 focus:ring-2 focus:ring-accent/10"
              />
            </label>
            <label class="grid gap-1.5 text-caption-xs font-bold text-slate-500">
              Hasta
              <input
                type="date"
                min="2020-01-01"
                [value]="dgaReportDateTo()"
                (input)="
                  dgaReportDateTo.set($any($event.target).value);
                  dgaReportSelectedPreset.set('custom');
                  dgaReportSelectedMonths.set([])
                "
                class="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-slate-700 outline-none transition-colors focus:border-accent/30 focus:ring-2 focus:ring-accent/10"
              />
            </label>
          </div>

          <!-- Granularidad del CSV -->
          <div class="mt-4 border-t border-slate-100 px-5 pt-4 pb-2">
            <label class="text-caption-xs uppercase tracking-wider font-semibold text-slate-500">
              Granularidad de los datos en el CSV
            </label>
            <div class="mt-2 grid grid-cols-5 gap-2">
              @for (opt of dgaReportBucketOptions; track opt.value) {
                <button
                  type="button"
                  (click)="dgaReportBucket.set(opt.value)"
                  [class]="
                    dgaReportBucket() === opt.value
                      ? 'rounded-lg border border-accent bg-accent/10 px-2 py-1.5 text-caption-xs font-semibold text-accent-container'
                      : 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-caption-xs font-semibold text-slate-600 hover:border-accent/20 hover:text-accent-container'
                  "
                >
                  {{ opt.label }}
                </button>
              }
            </div>
            <p class="mt-1 text-caption-xs text-slate-500">
              1 fila por bucket. La medición es la más reciente dentro del bucket.
            </p>
          </div>

          <!-- Orden de los datos -->
          <div class="px-5 pt-2 pb-2">
            <label class="text-caption-xs uppercase tracking-wider font-semibold text-slate-500">
              Orden de los datos
            </label>
            <div class="mt-2 grid grid-cols-2 gap-2">
              @for (opt of dgaReportOrdenOptions; track opt.value) {
                <button
                  type="button"
                  (click)="dgaReportOrden.set(opt.value)"
                  [class]="
                    dgaReportOrden() === opt.value
                      ? 'rounded-lg border border-accent bg-accent/10 px-2 py-1.5 text-caption-xs font-semibold text-accent-container'
                      : 'rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-caption-xs font-semibold text-slate-600 hover:border-accent/20 hover:text-accent-container'
                  "
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          </div>

          <!-- Errores generales del modal de reporte -->
          @if (dgaReportError()) {
            <div
              class="mx-5 mt-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-caption text-red-700"
            >
              <span class="material-symbols-outlined text-[16px]">error</span>
              <span>{{ dgaReportError() }}</span>
            </div>
          }
          <p class="px-5 py-2 text-caption-xs text-slate-500 italic">
            Para configurar informantes, transport y caudal máx del pozo, usá el botón
            <span class="font-semibold text-primary-container">Configurar reporte DGA</span> del
            panel de Settings del pozo.
          </p>

          <!-- Footer: rango + acción -->
          <div
            class="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-4"
          >
            <div>
              <p class="text-caption font-semibold text-slate-700">
                {{ dgaReportRangeLabel() }}
              </p>
              <p class="text-caption-xs font-semibold text-slate-500">
                {{ dgaReportDaysCount() > 0 ? dgaReportDaysCount() + ' días' : '—' }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <button
                type="button"
                (click)="closeDgaReportModal()"
                [disabled]="dgaReportDownloading()"
                class="rounded-lg px-3 py-2 text-body-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                (click)="generateDgaReport()"
                [disabled]="!dgaReportDateFrom() || !dgaReportDateTo() || dgaReportDownloading()"
                class="inline-flex items-center gap-1.5 rounded-lg bg-accent-container px-4 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-40"
              >
                @if (dgaReportDownloading()) {
                  <span class="material-symbols-outlined animate-spin text-[16px]">sync</span>
                  Descargando
                } @else {
                  <span class="material-symbols-outlined text-[16px]">download</span>
                  Descargar CSV DGA
                }
              </button>
            </div>
          </div>
        </section>
      </div>

      <!-- Modal Detalle Reporte DGA -->
      @if (selectedDgaReport(); as report) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-[2px]"
          (click)="closeDgaReportDetail()"
        >
          <section
            class="w-full max-w-[740px] overflow-hidden rounded-2xl bg-white shadow-2xl"
            (click)="$event.stopPropagation()"
            role="dialog"
            cdkTrapFocus
            cdkTrapFocusAutoCapture
            aria-modal="true"
            aria-labelledby="dga-report-detail-title"
          >
            <div class="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <h2
                id="dga-report-detail-title"
                class="text-h5 font-semibold uppercase tracking-wide text-slate-800"
              >
                Seguimiento de envío
              </h2>
              <button
                type="button"
                (click)="closeDgaReportDetail()"
                class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
                aria-label="Cerrar seguimiento"
              >
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="bg-slate-50 p-6">
              <div class="mx-auto max-w-[620px]">
                <div class="mb-5 flex items-center gap-3">
                  <span
                    class="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-tint-14 text-primary-container"
                  >
                    <span class="material-symbols-outlined text-[22px]">assignment</span>
                  </span>
                  <div>
                    <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                      Registro {{ report.recordId }}
                    </p>
                    <p class="text-h6 font-semibold text-slate-800">
                      {{ report.fecha }}
                    </p>
                  </div>
                </div>

                <div
                  class="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:grid-cols-3"
                >
                  <div class="px-5 py-5 text-center">
                    <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                      Nivel freatico
                    </p>
                    <p class="mt-2 text-h4 font-semibold text-slate-800">
                      {{ formatDgaNumber(report.nivelFreatico) }}
                    </p>
                    <p class="mt-1 text-caption font-bold text-slate-400">m</p>
                  </div>
                  <div
                    class="border-y border-slate-100 px-5 py-5 text-center sm:border-x sm:border-y-0"
                  >
                    <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                      Caudal
                    </p>
                    <p class="mt-2 text-h4 font-semibold text-slate-800">
                      {{ formatDgaNumber(report.caudal) }}
                    </p>
                    <p class="mt-1 text-caption font-bold text-slate-400">l/s</p>
                  </div>
                  <div class="px-5 py-5 text-center">
                    <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                      Totalizado
                    </p>
                    <p class="mt-2 text-h4 font-semibold text-slate-800">
                      {{ formatDgaInteger(report.totalizador) }}
                    </p>
                    <p class="mt-1 text-caption font-bold text-slate-400">m&sup3;</p>
                  </div>
                </div>

                <div class="mt-6 flex items-center justify-between gap-4">
                  <div class="flex items-center gap-3">
                    <span
                      class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"
                    >
                      <span class="material-symbols-outlined text-[22px]">send</span>
                    </span>
                    <div>
                      <p
                        class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400"
                      >
                        Envío a DGA
                      </p>
                      <p class="text-body-sm font-semibold text-slate-800">
                        {{ report.enviadoDga }}
                      </p>
                    </div>
                  </div>

                  <span
                    class="inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 text-caption font-semibold text-emerald-700"
                  >
                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                    Completado
                  </span>
                </div>

                <div class="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
                  <p class="text-caption-xs font-semibold uppercase tracking-wide text-slate-400">
                    Respuesta del software de DGA
                  </p>
                  <p class="mt-4 text-body-sm font-semibold text-slate-700">Respuesta</p>
                  <p class="mt-1 text-body-sm text-slate-600">
                    {{ report.respuesta }}
                  </p>
                  <p class="mt-4 text-body-sm font-semibold text-slate-700">N&deg; Comprobante</p>
                  @if (report.comprobante) {
                    @if (comprobanteUrl(report.comprobante); as url) {
                      <a
                        [href]="url"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="mt-1 inline-flex items-center gap-2 text-body-sm font-bold text-primary-container hover:text-primary-container hover:underline"
                        [title]="'Abrir en portal SNIA: ' + url"
                      >
                        <span class="font-mono">{{ report.comprobante }}</span>
                        <span class="material-symbols-outlined text-[16px]">open_in_new</span>
                      </a>
                    } @else {
                      <p
                        class="mt-1 inline-flex items-center gap-2 text-body-sm font-bold text-slate-600"
                        [title]="'Carga el número de obra del pozo para habilitar el link al portal SNIA'"
                      >
                        <span class="font-mono">{{ report.comprobante }}</span>
                      </p>
                    }
                  } @else {
                    <p class="mt-1 text-body-sm italic text-slate-500">sin comprobante</p>
                  }
                </div>
              </div>
            </div>
          </section>
        </div>
      }
    </ng-container>
  `,
})
export class WaterDetailDgaReporteComponent {
  private readonly dgaService = inject(DgaService);
  private readonly httpClient = inject(HttpClient);

  siteId = input.required<string>();
  siteName = input<string>('');
  monthlyFlowMonths = input<{ label: string; value: number }[]>([]);
  obraDga = input<string | null>(null);

  closed = output<void>();

  dgaReportSelectedPreset = signal<string | null>('last30');
  dgaReportSelectedMonths = signal<number[]>([]);
  dgaReportDateFrom = signal('');
  dgaReportDateTo = signal('');
  dgaReportBucket = signal<'minuto' | 'hora' | 'dia' | 'semana' | 'mes'>('hora');
  dgaReportOrden = signal<'asc' | 'desc'>('asc');
  dgaReportDownloading = signal<boolean>(false);
  dgaReportError = signal<string>('');
  selectedDgaReport = signal<DgaReportRow | null>(null);

  dgaReportDaysCount = computed(() => {
    const f = this.dgaReportDateFrom();
    const t = this.dgaReportDateTo();
    if (!f || !t) return 0;
    return Math.round((+new Date(t) - +new Date(f)) / 86400000) + 1;
  });
  dgaReportRangeLabel = computed(() => {
    const from = this.dgaReportDateFrom();
    const to = this.dgaReportDateTo();
    if (!from && !to) return 'Selecciona un período';
    const fmt = (s: string) => (s ? s.split('-').reverse().join('/') : '—');
    return `${fmt(from)} — ${fmt(to)}`;
  });

  readonly dgaReportBucketOptions: {
    value: 'minuto' | 'hora' | 'dia' | 'semana' | 'mes';
    label: string;
  }[] = [
    { value: 'minuto', label: 'Cada minuto' },
    { value: 'hora', label: 'Cada hora' },
    { value: 'dia', label: 'Cada día' },
    { value: 'semana', label: 'Cada semana' },
    { value: 'mes', label: 'Cada mes' },
  ];
  readonly dgaReportOrdenOptions: { value: 'asc' | 'desc'; label: string }[] = [
    { value: 'asc', label: 'Ascendente (antiguo → reciente)' },
    { value: 'desc', label: 'Descendente (reciente → antiguo)' },
  ];
  readonly downloadPresets = [
    { id: 'last7', label: 'Últimos 7 días' },
    { id: 'last30', label: 'Últimos 30 días' },
    { id: 'last90', label: 'Últimos 90 días' },
    { id: 'thisYear', label: 'Este año' },
    { id: 'lastYear', label: 'Año pasado' },
  ];
  readonly downloadMonthNames = [
    'Enero',
    'Febrero',
    'Marzo',
    'Abril',
    'Mayo',
    'Junio',
    'Julio',
    'Agosto',
    'Septiembre',
    'Octubre',
    'Noviembre',
    'Diciembre',
  ];
  readonly downloadMonthShort = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];

  closeDgaReportModal(): void {
    this.closed.emit();
  }

  applyDgaReportPreset(presetId: string): void {
    this.dgaReportSelectedMonths.set([]);
    this.dgaReportSelectedPreset.set(presetId);
    const now = new Date();
    const y = now.getFullYear();
    let from = new Date(now),
      to = new Date(now);
    switch (presetId) {
      case 'last7':
        from = this.addDays(now, -6);
        break;
      case 'last30':
        from = this.addDays(now, -29);
        break;
      case 'last90':
        from = this.addDays(now, -89);
        break;
      case 'thisYear':
        from = new Date(y, 0, 1);
        break;
      case 'lastYear':
        from = new Date(y - 1, 0, 1);
        to = new Date(y - 1, 11, 31);
        break;
    }
    this.dgaReportDateFrom.set(this.toDateInputValue(from));
    this.dgaReportDateTo.set(this.toDateInputValue(to));
  }

  applyDgaReportMonth(monthIndex: number): void {
    if (!this.dgaMonthHasData(monthIndex)) return;
    const current = this.dgaReportSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter((m) => m !== monthIndex)
      : [...current, monthIndex].sort((a, b) => a - b);
    this.dgaReportSelectedMonths.set(next);
    this.dgaReportSelectedPreset.set(null);
    if (next.length === 0) return;
    const year = new Date().getFullYear();
    const from = new Date(year, Math.min(...next), 1);
    const to = new Date(year, Math.max(...next) + 1, 0);
    this.dgaReportDateFrom.set(this.toDateInputValue(from));
    this.dgaReportDateTo.set(this.toDateInputValue(to));
  }

  dgaMonthHasData(_monthIndex: number): boolean {
    // Todos los meses seleccionables. El rango lo valida el backend al
    // consultar `dato_dga`; si no hay data, el CSV queda con header solo.
    return true;
  }

  generateDgaReport(): void {
    const siteId = this.siteId();
    const from = this.dgaReportDateFrom();
    const to = this.dgaReportDateTo();
    if (!siteId) {
      this.dgaReportError.set('No se pudo determinar el sitio.');
      return;
    }
    if (!from || !to) {
      this.dgaReportError.set('Seleccioná un rango de fechas.');
      return;
    }

    // Rango interpretado en hora Chile UTC-4. `hasta` exclusivo: día siguiente 00:00.
    const desdeIso = `${from}T00:00:00-04:00`;
    const hastaDate = new Date(`${to}T00:00:00-04:00`);
    hastaDate.setUTCDate(hastaDate.getUTCDate() + 1);
    const hastaIso = hastaDate.toISOString();

    const url = this.dgaService.exportCsvUrlDirecto(
      siteId,
      desdeIso,
      hastaIso,
      this.dgaReportBucket(),
      this.dgaReportOrden(),
    );
    const filename = `reporte_dga_${siteId}_${this.dgaReportBucket()}_${from}_${to}.csv`;

    this.dgaReportDownloading.set(true);
    this.dgaReportError.set('');
    this.httpClient.get(url, { responseType: 'blob' }).subscribe({
      next: (blob: Blob) => {
        this.dgaReportDownloading.set(false);
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(objectUrl);
        this.closeDgaReportModal();
      },
      error: (err) => {
        this.dgaReportDownloading.set(false);
        this.dgaReportError.set(
          err?.error?.error?.message ?? err?.message ?? 'Error al descargar el reporte.',
        );
      },
    });
  }

  openDgaReportDetail(report: DgaReportRow): void {
    this.selectedDgaReport.set(report);
  }

  closeDgaReportDetail(): void {
    this.selectedDgaReport.set(null);
  }

  comprobanteUrl(comprobante: string | null | undefined): string | null {
    if (!comprobante) return null;
    const obra = this.obraDga();
    if (!obra) return null;
    return `https://apimee.mop.gob.cl/api/v1/mediciones/subterraneas?codigoObra=${encodeURIComponent(obra)}&numeroComprobante=${encodeURIComponent(comprobante)}`;
  }

  formatDgaNumber(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    // Formato DGA Res 2170 §4: punto decimal, sin separador miles.
    return value.toFixed(2);
  }

  formatDgaInteger(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(value)) return '—';
    // Formato DGA Res 2170 §4: entero sin decimales ni separador de miles.
    return Math.trunc(value).toString();
  }

  private toDateInputValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private addDays(value: Date, days: number): Date {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    return next;
  }
}
