import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CompanyService, type HistoryGranularity } from '../../../../services/company.service';

@Component({
  selector: 'app-water-detail-descarga',
  standalone: true,
  imports: [CommonModule, A11yModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-[2px]"
      (click)="closed.emit()"
    >
      <section
        class="w-full max-w-[820px] overflow-hidden rounded-2xl bg-white shadow-2xl"
        (click)="$event.stopPropagation()"
        role="dialog"
        cdkTrapFocus
        cdkTrapFocusAutoCapture
        aria-modal="true"
        aria-labelledby="download-modal-title"
      >
        <!-- Modal header -->
        <div class="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div class="flex items-center gap-3">
            <span
              class="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"
            >
              <span class="material-symbols-outlined text-[20px]" aria-hidden="true">download</span>
            </span>
            <div>
              <h2 id="download-modal-title" class="text-h6 font-semibold text-slate-800">
                Exportar Datos
              </h2>
              @if (siteName()) {
                <p class="text-caption font-semibold text-slate-500">
                  {{ siteName() }}
                </p>
              }
            </div>
          </div>
          <button
            type="button"
            (click)="closed.emit()"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700 active:scale-95"
            aria-label="Cerrar"
          >
            <span class="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
          </button>
        </div>

        <div class="grid gap-0 md:grid-cols-[220px_minmax(0,1fr)]">
          <!-- Left panel: presets + month selector -->
          <div class="border-b border-slate-100 px-5 py-5 md:border-b-0 md:border-r">
            <p
              class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            >
              Períodos rápidos
            </p>
            <div class="grid gap-0.5">
              @for (preset of downloadPresets; track preset.id) {
                <button
                  type="button"
                  (click)="applyDownloadPreset(preset.id)"
                  [attr.aria-pressed]="downloadSelectedPreset() === preset.id"
                  [class]="
                    downloadSelectedPreset() === preset.id
                      ? 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm font-bold bg-primary-tint-08 text-primary-container border border-primary-tint-25 transition-colors active:scale-95'
                      : 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-body-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors active:scale-95'
                  "
                >
                  @if (downloadSelectedPreset() === preset.id) {
                    <span
                      class="h-1.5 w-1.5 rounded-full bg-primary/10 flex-shrink-0"
                      aria-hidden="true"
                    ></span>
                  }
                  {{ preset.label }}
                </button>
              }
            </div>

            <p
              class="mb-2 mt-5 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            >
              Meses {{ 'de ' + (downloadDateFrom() || '2026').slice(0, 4) }}
            </p>
            <div class="grid grid-cols-3 gap-1.5">
              @for (month of downloadMonthNames; track month; let i = $index) {
                <button
                  type="button"
                  (click)="applyDownloadMonth(i)"
                  [attr.aria-pressed]="downloadSelectedMonths().includes(i)"
                  [class]="
                    !downloadMonthHasData(i)
                      ? 'rounded-lg py-1.5 text-caption-xs font-semibold bg-slate-50 text-slate-300 cursor-not-allowed select-none'
                      : downloadSelectedMonths().includes(i)
                        ? 'rounded-lg py-1.5 text-caption-xs font-bold bg-primary text-white ring-2 ring-[rgba(13,175,189,0.45)] active:scale-95'
                        : 'rounded-lg py-1.5 text-caption-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors active:scale-95'
                  "
                >
                  {{ month.slice(0, 3) }}
                </button>
              }
            </div>
            <p class="mt-2 text-caption-xs font-semibold text-slate-300">
              Verde = datos disponibles
            </p>
          </div>

          <!-- Right panel: date range + data types + format -->
          <div class="px-6 py-5">
            <!-- Selected range pill -->
            <div
              class="mb-5 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3"
            >
              <div>
                <p class="text-caption-xs font-bold uppercase tracking-wide text-slate-400">
                  Rango seleccionado
                </p>
                <p class="mt-0.5 text-body-sm font-semibold text-slate-700">
                  {{ downloadRangeLabel() }}
                </p>
              </div>
              <span
                class="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-caption-xs font-bold text-slate-500"
              >
                {{ downloadDaysCount() > 0 ? downloadDaysCount() + ' días' : '—' }}
              </span>
            </div>

            <!-- Custom date range -->
            <div class="mb-5 grid gap-3 sm:grid-cols-2">
              <label class="grid gap-1.5 text-caption font-bold text-slate-600">
                Desde
                <input
                  type="date"
                  min="2020-01-01"
                  [value]="downloadDateFrom()"
                  (input)="
                    downloadDateFrom.set($any($event.target).value);
                    downloadSelectedPreset.set('custom');
                    downloadSelectedMonths.set([])
                  "
                  class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                />
              </label>
              <label class="grid gap-1.5 text-caption font-bold text-slate-600">
                Hasta
                <input
                  type="date"
                  min="2020-01-01"
                  [value]="downloadDateTo()"
                  (input)="
                    downloadDateTo.set($any($event.target).value);
                    downloadSelectedPreset.set('custom');
                    downloadSelectedMonths.set([])
                  "
                  class="h-10 rounded-xl border border-slate-200 bg-white px-3 text-slate-700 outline-none transition-colors focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                />
              </label>
            </div>

            <!-- Data types -->
            <p
              class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            >
              Datos a incluir
            </p>
            <div class="mb-5 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              @for (dtype of downloadDataTypeOptions; track dtype.id) {
                <button
                  type="button"
                  (click)="toggleDownloadDataType(dtype.id)"
                  [attr.aria-pressed]="isDownloadTypeSelected(dtype.id)"
                  [class]="
                    isDownloadTypeSelected(dtype.id)
                      ? 'rounded-lg border border-primary-tint-55 bg-primary-tint-08 px-3 py-2.5 text-center text-body-sm font-bold text-primary-container transition-colors active:scale-95'
                      : 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-center text-body-sm font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-95'
                  "
                >
                  {{ dtype.label }}
                </button>
              }
            </div>

            <!-- Granularity -->
            <p
              class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            >
              Granularidad
            </p>
            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              @for (gran of downloadGranularityOptions; track gran.id) {
                <button
                  type="button"
                  (click)="downloadGranularity.set(gran.id)"
                  [title]="gran.hint"
                  [attr.aria-pressed]="downloadGranularity() === gran.id"
                  [class]="
                    downloadGranularity() === gran.id
                      ? 'rounded-lg border border-primary-tint-55 bg-primary-tint-08 px-2 py-2 text-center text-caption font-bold text-primary-container transition-colors active:scale-95'
                      : 'rounded-lg border border-slate-200 bg-white px-2 py-2 text-center text-caption font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 active:scale-95'
                  "
                >
                  {{ gran.label }}
                </button>
              }
            </div>
            <div
              class="mb-5 mt-3 flex items-start gap-2 rounded-xl border border-primary-tint-25 bg-primary-tint-08 px-3 py-2.5 text-caption font-semibold text-primary-container"
            >
              <span class="material-symbols-outlined mt-0.5 text-[16px]" aria-hidden="true"
                >schedule</span
              >
              <span>{{ downloadWorkloadLabel() }}</span>
            </div>

            <!-- Format -->
            <p
              class="mb-2 text-caption-xs font-semibold uppercase tracking-[0.14em] text-slate-400"
            >
              Formato de archivo
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                (click)="downloadFormat.set('csv')"
                [attr.aria-pressed]="downloadFormat() === 'csv'"
                [class]="
                  downloadFormat() === 'csv'
                    ? 'flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-body-sm font-bold text-emerald-700 transition-colors active:scale-95'
                    : 'flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-body-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors active:scale-95'
                "
              >
                <span class="material-symbols-outlined text-[16px]" aria-hidden="true">csv</span>
                CSV
              </button>
            </div>
          </div>
        </div>

        <!-- Modal footer -->
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4"
        >
          @if (downloadError()) {
            <p class="basis-full text-caption font-semibold text-rose-500">
              {{ downloadError() }}
            </p>
          }
          <p
            class="text-caption font-semibold"
            [class]="downloadError() ? 'text-rose-500' : 'text-slate-500'"
          >
            {{
              downloadSelectedTypes().length === 0
                ? 'Selecciona al menos un dato'
                : downloadSelectedTypes().length +
                  ' variable' +
                  (downloadSelectedTypes().length > 1 ? 's' : '') +
                  ' · ' +
                  downloadFormat().toUpperCase()
            }}
          </p>
          <div class="flex items-center gap-3">
            <button
              type="button"
              (click)="closed.emit()"
              class="rounded-lg px-4 py-2 text-body-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-800 active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="button"
              (click)="executeDownload()"
              [disabled]="
                downloadBusy() ||
                downloadSelectedTypes().length === 0 ||
                !downloadDateFrom() ||
                !downloadDateTo()
              "
              class="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-body-sm font-semibold text-white transition-colors hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span class="material-symbols-outlined text-[17px]" aria-hidden="true">download</span>
              {{ downloadBusy() ? 'Generando...' : 'Descargar' }}
            </button>
          </div>
        </div>
      </section>
    </div>
  `,
})
export class WaterDetailDescargaComponent {
  private readonly companyService = inject(CompanyService);

  readonly siteId = input.required<string>();
  readonly siteName = input<string>('');
  readonly monthlyFlowMonths = input<
    { label: string; value: number; proyeccion?: number | null }[]
  >([]);

  readonly closed = output<void>();

  downloadSelectedPreset = signal<string | null>('last30');
  downloadSelectedMonths = signal<number[]>([]);
  downloadDateFrom = signal('');
  downloadDateTo = signal('');
  downloadFormat = signal<'xlsx' | 'csv'>('csv');
  downloadSelectedTypes = signal<string[]>(['caudal', 'nivel', 'totalizador', 'nivel_freatico']);
  downloadGranularity = signal<HistoryGranularity>('1m');
  downloadBusy = signal(false);
  downloadError = signal('');

  downloadRangeLabel = computed(() => {
    const from = this.downloadDateFrom();
    const to = this.downloadDateTo();
    if (!from && !to) return 'Sin rango seleccionado';
    const fmt = (s: string) => (s ? s.split('-').reverse().join('/') : '—');
    return `${fmt(from)} — ${fmt(to)}`;
  });
  downloadDaysCount = computed(() => {
    const f = this.downloadDateFrom();
    const t = this.downloadDateTo();
    if (!f || !t) return 0;
    return Math.round((+new Date(t) - +new Date(f)) / 86400000) + 1;
  });
  downloadWorkloadLabel = computed(() => {
    if (this.downloadBusy()) {
      return 'Generando archivo. Si el rango es largo, puede tardar unos minutos.';
    }
    if (this.downloadGranularity() !== '1m' || this.downloadDaysCount() < 30) {
      return 'Exportación directa desde datos procesados.';
    }
    return 'Rangos largos minuto a minuto pueden tardar unos minutos. Mantén esta pestaña abierta.';
  });

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

  readonly downloadDataTypeOptions = [
    { id: 'caudal', label: 'Caudal', unit: 'L/s' },
    { id: 'nivel', label: 'Nivel', unit: 'm' },
    { id: 'totalizador', label: 'Totalizador', unit: 'm³' },
    { id: 'nivel_freatico', label: 'Nivel Freático', unit: 'm' },
  ];

  readonly downloadGranularityOptions: {
    id: HistoryGranularity;
    label: string;
    hint: string;
  }[] = [
    { id: '1m', label: '1 minuto', hint: 'Detalle máximo' },
    { id: '1h', label: '1 hora', hint: 'Resumen por hora' },
    { id: '1d', label: '1 día', hint: 'Resumen diario' },
  ];

  constructor() {
    this.applyDownloadPreset('last30');
  }

  applyDownloadPreset(presetId: string): void {
    this.downloadSelectedMonths.set([]);
    const now = new Date();
    const y = now.getFullYear();
    let from: Date, to: Date;
    switch (presetId) {
      case 'last7':
        from = new Date(now);
        from.setDate(from.getDate() - 6);
        to = now;
        break;
      case 'last30':
        from = new Date(now);
        from.setDate(from.getDate() - 29);
        to = now;
        break;
      case 'last90':
        from = new Date(now);
        from.setDate(from.getDate() - 89);
        to = now;
        break;
      case 'thisYear':
        from = new Date(y, 0, 1);
        to = now;
        break;
      case 'lastYear':
        from = new Date(y - 1, 0, 1);
        to = new Date(y - 1, 11, 31);
        break;
      default:
        return;
    }
    this.downloadDateFrom.set(this.toDateInputValue(from));
    this.downloadDateTo.set(this.toDateInputValue(to));
    this.downloadSelectedPreset.set(presetId);
  }

  applyDownloadMonth(monthIndex: number): void {
    if (!this.downloadMonthHasData(monthIndex)) return;
    const current = this.downloadSelectedMonths();
    const next = current.includes(monthIndex)
      ? current.filter((m) => m !== monthIndex)
      : [...current, monthIndex].sort((a, b) => a - b);
    this.downloadSelectedMonths.set(next);
    this.downloadSelectedPreset.set(null);
    if (next.length === 0) return;
    const year = new Date().getFullYear();
    const from = new Date(year, Math.min(...next), 1);
    const to = new Date(year, Math.max(...next) + 1, 0);
    this.downloadDateFrom.set(this.toDateInputValue(from));
    this.downloadDateTo.set(this.toDateInputValue(to));
  }

  downloadMonthHasData(monthIndex: number): boolean {
    const year = new Date().getFullYear();
    const shortMonth = this.downloadMonthShort[monthIndex];
    const shortYear = String(year).slice(2);
    const match = this.monthlyFlowMonths().find((m) =>
      m.label.startsWith(`${shortMonth} '${shortYear}`),
    );
    return match ? match.value > 0 : false;
  }

  toggleDownloadDataType(typeId: string): void {
    const current = this.downloadSelectedTypes();
    if (current.includes(typeId)) {
      this.downloadSelectedTypes.set(current.filter((t) => t !== typeId));
    } else {
      this.downloadSelectedTypes.set([...current, typeId]);
    }
  }

  isDownloadTypeSelected(typeId: string): boolean {
    return this.downloadSelectedTypes().includes(typeId);
  }

  executeDownload(): void {
    const siteId = this.siteId();
    const from = this.downloadDateFrom();
    const to = this.downloadDateTo();
    const fields = this.downloadSelectedTypes();

    if (!siteId) {
      this.downloadError.set('No se encontró el sitio actual.');
      return;
    }

    if (!from || !to || fields.length === 0) {
      this.downloadError.set('Selecciona rango y datos para exportar.');
      return;
    }

    this.downloadBusy.set(true);
    this.downloadError.set('');

    this.companyService
      .downloadSiteDashboardHistory(siteId, {
        from,
        to,
        fields,
        format: 'csv',
        granularity: this.downloadGranularity(),
      })
      .subscribe({
        next: (response) => {
          const blob = response.body;
          if (!blob) {
            this.downloadBusy.set(false);
            this.downloadError.set('No se recibio el archivo.');
            return;
          }

          const filename =
            this.filenameFromContentDisposition(response.headers.get('content-disposition')) ||
            `historico_${siteId}_${from}_${to}.csv`;
          this.saveBlob(blob, filename);
          this.downloadBusy.set(false);
          this.closed.emit();
        },
        error: (err: unknown) => {
          this.downloadBusy.set(false);
          this.downloadError.set(
            this.errorMessage(err, 'No fue posible descargar los datos historicos.'),
          );
        },
      });
  }

  private filenameFromContentDisposition(value: string | null): string | null {
    if (!value) return null;
    const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(value);
    return match?.[1] ? decodeURIComponent(match[1].replace(/"/g, '')) : null;
  }

  private saveBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private toDateInputValue(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private errorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      const payload = err.error as { message?: string; error?: string } | string | undefined;
      if (typeof payload === 'string') return payload;
      return payload?.message || payload?.error || fallback;
    }

    return fallback;
  }
}
