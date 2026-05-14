import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DgaPeriodicidad, DgaService, DgaUserPublic } from '../../../../services/dga.service';
import { CHILE_TIME_ZONE } from '../../../../shared/timezone';

interface PeriodicidadOption {
  value: DgaPeriodicidad;
  label: string;
  cadencia: string;
}

interface DatoReportableInfo {
  nombre: string;
  unidad: string;
  descripcion: string;
}

@Component({
  selector: 'app-dga-generar-reporte-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (open) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dga-modal-title"
        (click)="onBackdrop($event)"
      >
        <div
          class="relative w-full max-w-2xl mx-4 bg-white rounded-xl shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-cyan-600 text-[24px]">description</span>
              <div>
                <h2 id="dga-modal-title" class="text-base font-semibold text-slate-800">
                  Generar Reporte DGA
                </h2>
                <p class="text-[12px] text-slate-500">
                  Obra: <span class="font-mono">{{ siteName || siteId }}</span>
                </p>
              </div>
            </div>
            <button
              type="button"
              (click)="cerrar()"
              class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>

          <!-- Body -->
          <div class="px-6 py-5 space-y-5">
            <!-- Bloque informativo: datos que se reportarán (no editable) -->
            <div class="rounded-lg border border-cyan-200 bg-cyan-50/60 px-4 py-3">
              <div
                class="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-cyan-700"
              >
                <span class="material-symbols-outlined text-[14px]">info</span>
                Datos que se reportarán automáticamente
              </div>
              <ul class="mt-2 grid grid-cols-1 gap-1 text-[12px] sm:grid-cols-3">
                @for (d of datosReportables; track d.nombre) {
                  <li class="flex flex-col rounded bg-white/70 border border-cyan-100 px-2 py-1.5">
                    <span class="font-semibold text-slate-800">{{ d.nombre }}</span>
                    <span class="font-mono text-[11px] text-cyan-700">{{ d.unidad }}</span>
                  </li>
                }
              </ul>
              <p class="mt-2 text-[11px] text-slate-500">
                La obra (<span class="font-mono">{{ siteName || siteId }}</span
                >) y la zona horaria <span class="font-mono">UTC-4</span> se asignan
                automáticamente.
              </p>
            </div>

            <!-- Formulario informante -->
            <div class="grid grid-cols-2 gap-4">
              <!-- Nombre -->
              <div class="col-span-2">
                <label
                  for="dga-nombre"
                  class="text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Nombre del informante
                </label>
                <input
                  id="dga-nombre"
                  type="text"
                  autocomplete="name"
                  placeholder="Juan Pérez"
                  [ngModel]="nombre()"
                  (ngModelChange)="nombre.set($event)"
                  class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                />
              </div>

              <!-- RUT informante -->
              <div>
                <label
                  for="dga-rut"
                  class="text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  RUT del informante
                </label>
                <input
                  id="dga-rut"
                  type="text"
                  inputmode="text"
                  autocomplete="off"
                  placeholder="12.345.678-9"
                  [ngModel]="rut()"
                  (ngModelChange)="rut.set($event)"
                  class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-mono focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                />
              </div>

              <!-- Clave -->
              <div>
                <label
                  for="dga-clave"
                  class="text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Clave DGA
                </label>
                <input
                  id="dga-clave"
                  type="password"
                  autocomplete="new-password"
                  placeholder="••••••••"
                  [ngModel]="clave()"
                  (ngModelChange)="clave.set($event)"
                  class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-mono focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                />
                <p class="mt-1 text-[10px] text-slate-400">Se almacena cifrada (AES-256-GCM).</p>
              </div>

              <!-- Periodicidad -->
              <div class="col-span-2">
                <label class="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  Periodicidad del envío automático
                </label>
                <div class="mt-2 grid grid-cols-4 gap-2">
                  @for (opt of periodicidades; track opt.value) {
                    <button
                      type="button"
                      (click)="periodicidad.set(opt.value)"
                      [class]="periodicidadBtnClass(opt.value)"
                    >
                      <span class="block font-semibold">{{ opt.label }}</span>
                      <span class="block text-[10px] font-normal opacity-75">{{
                        opt.cadencia
                      }}</span>
                    </button>
                  }
                </div>
              </div>

              <!-- Día de inicio del evento -->
              <div>
                <label
                  for="dga-fecha-inicio"
                  class="text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Día de inicio del reporte
                </label>
                <input
                  id="dga-fecha-inicio"
                  type="date"
                  [ngModel]="fechaInicio()"
                  (ngModelChange)="fechaInicio.set($event)"
                  class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-mono focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                />
              </div>

              <!-- Hora de inicio -->
              <div>
                <label
                  for="dga-hora-inicio"
                  class="text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Hora de inicio (UTC-4)
                </label>
                <input
                  id="dga-hora-inicio"
                  type="time"
                  step="60"
                  [ngModel]="horaInicio()"
                  (ngModelChange)="horaInicio.set($event)"
                  class="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[14px] font-mono focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                />
              </div>
            </div>

            <!-- Resumen lo que se va a programar -->
            <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px]">
              <div class="font-semibold text-slate-700 mb-1">Resumen del reporte</div>
              <div class="grid grid-cols-2 gap-x-4 gap-y-0.5 text-slate-600">
                <div>
                  <span class="text-slate-400">Cadencia:</span>
                  <span class="ml-1 font-mono text-slate-800">{{ periodicidadLabel() }}</span>
                </div>
                <div>
                  <span class="text-slate-400">Inicio:</span>
                  <span class="ml-1 font-mono text-slate-800">{{ inicioPreview() }}</span>
                </div>
              </div>
            </div>

            @if (errorMsg()) {
              <div
                class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
              >
                <span class="material-symbols-outlined text-[18px]">error</span>
                <span>{{ errorMsg() }}</span>
              </div>
            }

            @if (successMsg()) {
              <div
                class="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-700"
              >
                <span class="material-symbols-outlined text-[18px]">check_circle</span>
                <span>{{ successMsg() }}</span>
              </div>
            }
          </div>

          <!-- Footer -->
          <div
            class="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50/60"
          >
            <button
              type="button"
              (click)="cerrar()"
              [disabled]="enviando()"
              class="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-[13px] font-medium hover:bg-slate-100 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              (click)="enviar()"
              [disabled]="!formValido() || enviando()"
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 text-white text-[13px] font-semibold hover:bg-cyan-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              @if (enviando()) {
                <span class="material-symbols-outlined animate-spin text-[16px]">sync</span>
              } @else {
                <span class="material-symbols-outlined text-[16px]">save</span>
              }
              {{ enviando() ? 'Programando' : 'Programar reporte' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class DgaGenerarReporteModalComponent {
  private readonly dgaService = inject(DgaService);

  @Input() open = false;
  @Input() siteId = '';
  @Input() siteName = '';
  @Output() closed = new EventEmitter<void>();
  @Output() created = new EventEmitter<DgaUserPublic>();

  readonly datosReportables: DatoReportableInfo[] = [
    { nombre: 'Caudal Instantáneo', unidad: 'L/s', descripcion: 'Caudal medido al instante' },
    { nombre: 'Flujo Acumulado', unidad: 'm³', descripcion: 'Totalizador del flujo' },
    { nombre: 'Nivel Freático', unidad: 'm', descripcion: 'Nivel calculado del agua' },
  ];

  readonly periodicidades: PeriodicidadOption[] = [
    { value: 'hora', label: 'Hora', cadencia: 'cada 60 min' },
    { value: 'dia', label: 'Día', cadencia: 'cada 24 h' },
    { value: 'semana', label: 'Semana', cadencia: 'cada 7 días' },
    { value: 'mes', label: 'Mes', cadencia: 'cada 30 días' },
  ];

  readonly periodicidad = signal<DgaPeriodicidad>('dia');
  readonly nombre = signal<string>('');
  readonly rut = signal<string>('');
  readonly clave = signal<string>('');
  readonly fechaInicio = signal<string>(this.todayLocalIso());
  readonly horaInicio = signal<string>('08:00');
  readonly enviando = signal<boolean>(false);
  readonly errorMsg = signal<string>('');
  readonly successMsg = signal<string>('');

  readonly periodicidadLabel = computed(
    () => this.periodicidades.find((p) => p.value === this.periodicidad())?.label ?? '',
  );

  readonly inicioPreview = computed(() => {
    const f = this.fechaInicio();
    const h = this.horaInicio();
    if (!f || !h) return '—';
    const [y, m, d] = f.split('-');
    return `${d}/${m}/${y} ${h}`;
  });

  readonly formValido = computed(() => {
    return (
      this.nombre().trim().length >= 2 &&
      this.rut().trim().length >= 7 &&
      this.clave().trim().length >= 4 &&
      !!this.fechaInicio() &&
      !!this.horaInicio() &&
      !!this.siteId
    );
  });

  periodicidadBtnClass(value: DgaPeriodicidad): string {
    const base =
      'px-3 py-2 rounded-lg text-[12px] font-semibold border transition-colors text-left';
    return this.periodicidad() === value
      ? `${base} border-cyan-500 bg-cyan-50 text-cyan-700`
      : `${base} border-slate-200 bg-white text-slate-600 hover:border-cyan-200 hover:text-cyan-700`;
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cerrar();
  }

  cerrar(): void {
    if (this.enviando()) return;
    this.closed.emit();
  }

  enviar(): void {
    if (!this.formValido() || this.enviando()) return;
    this.errorMsg.set('');
    this.successMsg.set('');
    this.enviando.set(true);

    this.dgaService
      .crearInformante({
        site_id: this.siteId,
        nombre_informante: this.nombre().trim(),
        rut_informante: this.rut().trim(),
        clave_informante: this.clave(),
        periodicidad: this.periodicidad(),
        fecha_inicio: this.fechaInicio(),
        hora_inicio: this.horaInicio(),
      })
      .subscribe({
        next: (created) => {
          this.enviando.set(false);
          this.successMsg.set(
            'Informante registrado. El reporte automático comenzará en la fecha y hora indicadas.',
          );
          this.created.emit(created);
          this.resetForm();
        },
        error: (err: HttpErrorResponse) => {
          this.enviando.set(false);
          const apiMsg =
            err.error?.error?.message ??
            err.error?.message ??
            err.message ??
            'Error al guardar informante';
          this.errorMsg.set(apiMsg);
        },
      });
  }

  private resetForm(): void {
    this.nombre.set('');
    this.rut.set('');
    this.clave.set('');
  }

  private todayLocalIso(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: CHILE_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  }
}
