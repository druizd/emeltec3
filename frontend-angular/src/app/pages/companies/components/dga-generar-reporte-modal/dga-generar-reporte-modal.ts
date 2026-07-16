/**
 * Modal "Configurar reporte DGA" — modelo redesign 2026-05-17.
 *
 * Toda la config DGA del pozo en un solo modal:
 *   1. Sección Activación: los controles editan un BORRADOR local — nada se
 *      persiste hasta presionar "Guardar cambios" (valida antes de enviar y
 *      manda UN solo PATCH con los campos modificados). Pasar transport→'rest'
 *      o activar GCS exige 2FA: lo orquesta el interceptor global
 *      (twoFactorInterceptor) con el diálogo estándar.
 *   2. Sección Informante: dropdown del pool global (parte del borrador) +
 *      alta/rotación de credenciales (RUT + clave, botón propio). Rotación de
 *      clave exige 2FA — también vía interceptor.
 *   3. Sección Datos en vivo: GET live-preview cada N seg → muestra los
 *      valores formateados tal como se enviarían a SNIA con la última
 *      lectura del pozo.
 */
import { A11yModule } from '@angular/cdk/a11y';
import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  DgaInformantePublic,
  DgaLivePreview,
  DgaPeriodicidad,
  DgaService,
  DgaTransport,
  PatchPozoDgaConfigPayload,
  PozoDgaConfig,
} from '../../../../services/dga.service';
import { formatRutDgaInput } from '../../../../shared/rut';

const LIVE_REFRESH_MS = 10_000;

/** Mismo formato que exige el backend (Res 2170 §5.2, CODIGO_OBRA_REGEX). */
const CODIGO_OBRA_REGEX = /^O[BR]-\d{4}-\d+$/;

interface PeriodicidadOption {
  value: DgaPeriodicidad;
  label: string;
  cadencia: string;
}

/** Borrador editable de la config — se persiste solo al Guardar. */
interface ConfigDraft {
  dga_activo: boolean;
  dga_gcs_export: boolean;
  dga_transport: DgaTransport;
  obra_dga: string;
  dga_caudal_max_lps: string; // texto del input; se valida/convierte al guardar
  dga_periodicidad: DgaPeriodicidad | '';
  dga_fecha_inicio: string;
  dga_hora_inicio: string;
  dga_informante_rut: string;
}

@Component({
  selector: 'app-dga-generar-reporte-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div
        class="anim-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
        animate.leave="anim-overlay-out"
        role="dialog"
        cdkTrapFocus
        cdkTrapFocusAutoCapture
        aria-modal="true"
        aria-labelledby="dga-generar-reporte-title"
        (click)="onBackdrop($event)"
      >
        <div
          class="anim-panel relative mx-4 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-[24px] text-primary-container"
                >description</span
              >
              <div>
                <h2 id="dga-generar-reporte-title" class="text-body font-semibold text-slate-800">
                  Configurar reporte DGA
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
          <div class="space-y-5 px-6 py-5">
            <!-- ====== Activación DGA (borrador; se aplica al Guardar) ====== -->
            <section
              class="space-y-3 rounded-lg border border-primary-tint-25 bg-primary-tint-08/40 px-4 py-3"
            >
              <div
                class="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-primary-container"
              >
                <span class="material-symbols-outlined text-[14px]">tune</span>
                Activación
              </div>

              <!-- Grid de controles -->
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <!-- Toggle Activo -->
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    [checked]="draft().dga_activo"
                    [disabled]="saving()"
                    (change)="setDraft('dga_activo', $any($event.target).checked)"
                    class="h-4 w-4 rounded border-slate-300 text-primary-container focus:ring-[rgba(13,175,189,0.45)]"
                  />
                  <span class="text-[12px] font-semibold text-slate-700">DGA activo</span>
                </label>

                <!-- Toggle Export GCS (desarrollo a medida CCU_Central; activar exige 2FA) -->
                <label class="flex items-center gap-2">
                  <input
                    type="checkbox"
                    [checked]="draft().dga_gcs_export"
                    [disabled]="saving()"
                    (change)="setDraft('dga_gcs_export', $any($event.target).checked)"
                    class="h-4 w-4 rounded border-slate-300 text-primary-container focus:ring-[rgba(13,175,189,0.45)]"
                  />
                  <span class="text-[12px] font-semibold text-slate-700">Copia a GCS</span>
                  <span
                    class="material-symbols-outlined cursor-help text-[12px] leading-none text-slate-400 hover:text-primary-container"
                    title="Copia cada envío DGA con respuesta de SNIA (enviado o rechazado) a Google Cloud Storage en formato Parquet. Desarrollo a medida solicitado por CCU_Central — usar SOLO en instalaciones de CCU. Activarlo exige verificación 2FA al guardar."
                    aria-label="Ayuda: Copia a GCS"
                    >help</span
                  >
                </label>

                <!-- Modo envío -->
                <label
                  class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Modo envío
                  <select
                    [value]="draft().dga_transport"
                    [disabled]="saving()"
                    (change)="setDraft('dga_transport', $any($event.target).value)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none focus:border-primary-tint-35 focus:ring-2 focus:ring-primary-tint-20"
                  >
                    <option value="off">Off (no envía)</option>
                    <option value="shadow">Shadow (rellena sin enviar)</option>
                    <option value="rest">REST (envía a SNIA)</option>
                  </select>
                </label>

                <!-- Código de obra -->
                <label
                  class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Código de obra
                  <input
                    type="text"
                    [ngModel]="draft().obra_dga"
                    (ngModelChange)="setDraft('obra_dga', $event)"
                    placeholder="OB-XXXX-XXX"
                    [disabled]="saving()"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono uppercase tracking-wider text-slate-700 outline-none focus:border-primary-tint-35"
                  />
                </label>

                <!-- Caudal max -->
                <label
                  class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Caudal máx [L/s]
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    [ngModel]="draft().dga_caudal_max_lps"
                    (ngModelChange)="setDraft('dga_caudal_max_lps', $event)"
                    [disabled]="saving()"
                    placeholder="sin cargar (fallback 1000)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono outline-none focus:border-primary-tint-35"
                  />
                </label>

                <!-- Periodicidad -->
                <label
                  class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Periodicidad
                  <select
                    [value]="draft().dga_periodicidad"
                    [disabled]="saving()"
                    (change)="setDraft('dga_periodicidad', $any($event.target).value)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-primary-tint-35"
                  >
                    <option value="">— elegir —</option>
                    @for (p of periodicidades; track p.value) {
                      <option [value]="p.value">{{ p.label }} ({{ p.cadencia }})</option>
                    }
                  </select>
                </label>

                <!-- Fecha inicio -->
                <label
                  class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Fecha inicio
                  <input
                    type="date"
                    min="2020-01-01"
                    [value]="draft().dga_fecha_inicio"
                    [disabled]="saving()"
                    (change)="setDraft('dga_fecha_inicio', $any($event.target).value)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono outline-none focus:border-primary-tint-35"
                  />
                </label>

                <!-- Hora inicio -->
                <label
                  class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500"
                >
                  Hora inicio (UTC-4)
                  <input
                    type="time"
                    step="60"
                    [value]="draft().dga_hora_inicio"
                    [disabled]="saving()"
                    (change)="setDraft('dga_hora_inicio', $any($event.target).value)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono outline-none focus:border-primary-tint-35"
                  />
                </label>
              </div>

              @if (pozoError()) {
                <div
                  class="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800"
                >
                  <span class="material-symbols-outlined text-[14px]">warning</span>
                  <span>{{ pozoError() }}</span>
                </div>
              }

              <p class="text-[10px] text-slate-500">
                Los cambios se aplican al presionar <strong>Guardar cambios</strong>. Pasar a
                <strong>REST</strong> envía a SNIA en producción — verifica que el sistema legacy
                esté apagado para esta obra antes (Res 2170 §6.3). Activar REST o GCS pide
                verificación 2FA al guardar.
              </p>
            </section>

            <!-- ====== Informante (pool global) ====== -->
            <section class="space-y-3 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3">
              <div
                class="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-accent-container"
              >
                <span class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-[14px]">badge</span>
                  Informante
                </span>
                <button
                  type="button"
                  (click)="reloadInformantes()"
                  [disabled]="informantesLoading()"
                  class="text-[10px] font-bold text-accent-container hover:underline disabled:opacity-50"
                >
                  Recargar
                </button>
              </div>

              <!-- Selector pool (parte del borrador de config) -->
              <label
                class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500"
              >
                Asociar informante (RUT)
                <select
                  [value]="draft().dga_informante_rut"
                  [disabled]="saving() || informantesLoading()"
                  (change)="setDraft('dga_informante_rut', $any($event.target).value)"
                  class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono outline-none focus:border-accent/30"
                >
                  <option value="">— ninguno —</option>
                  @for (inf of informantes(); track inf.rut) {
                    <option [value]="inf.rut">
                      {{ inf.rut }}{{ inf.referencia ? ' · ' + inf.referencia : '' }}
                    </option>
                  }
                </select>
                <span class="text-[10px] text-slate-500">
                  Un mismo RUT puede asociarse a varios pozos. Se aplica al Guardar.
                </span>
              </label>

              <!-- Alta/rotación rápida -->
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  [ngModel]="newInfRut()"
                  (ngModelChange)="updateNewInfRut($event)"
                  inputmode="text"
                  maxlength="12"
                  placeholder="RUT nuevo o existente"
                  class="rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-mono outline-none focus:border-accent/30"
                />
                <input
                  type="password"
                  [ngModel]="newInfClave()"
                  (ngModelChange)="newInfClave.set($event)"
                  placeholder="clave SNIA (rotar)"
                  autocomplete="new-password"
                  class="rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-mono outline-none focus:border-accent/30"
                />
                <input
                  type="text"
                  [ngModel]="newInfReferencia()"
                  (ngModelChange)="newInfReferencia.set($event)"
                  placeholder="referencia interna (opcional)"
                  class="rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-accent/30"
                />
              </div>
              <button
                type="button"
                (click)="guardarInformante()"
                [disabled]="!newInfRut().trim() || informanteSaving()"
                class="rounded bg-accent-container px-3 py-1.5 text-[12px] font-bold text-white hover:bg-accent-deep disabled:opacity-40"
              >
                @if (informanteSaving()) {
                  Guardando…
                } @else {
                  Guardar informante
                }
              </button>
              @if (informanteError()) {
                <div
                  class="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700"
                >
                  {{ informanteError() }}
                </div>
              }
              <p class="text-[10px] text-slate-500">
                Solo RUT es obligatorio. La clave solo se exige al crear nuevo o rotar (pide 2FA).
                Referencia es etiqueta libre interna.
              </p>
            </section>

            <!-- ====== Datos en vivo ====== -->
            <section class="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3">
              <div
                class="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-slate-500"
              >
                <span class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-[14px]">sensors</span>
                  Datos en vivo (lo que se reportaría ahora)
                </span>
                @if (preview(); as p) {
                  @if (p.age_seconds !== null) {
                    <span class="text-[10px] text-slate-500">
                      última lectura: hace {{ formatAge(p.age_seconds) }}
                    </span>
                  }
                }
              </div>

              @if (preview(); as p) {
                @if (p.ts) {
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div class="rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div class="text-[10px] uppercase tracking-wider text-slate-400">
                        Caudal [L/s]
                      </div>
                      <div class="font-mono text-[14px] font-bold text-primary-container">
                        {{ p.caudal ?? '—' }}
                      </div>
                    </div>
                    <div class="rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div class="text-[10px] uppercase tracking-wider text-slate-400">
                        Totalizador [m³]
                      </div>
                      <div class="font-mono text-[14px] font-bold text-primary-container">
                        {{ p.totalizador ?? '—' }}
                      </div>
                    </div>
                    <div class="rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div class="text-[10px] uppercase tracking-wider text-slate-400">
                        Nivel Freático [m]
                      </div>
                      <div class="font-mono text-[14px] font-bold text-primary-container">
                        {{ p.nivelFreaticoDelPozo || '(vacío)' }}
                      </div>
                    </div>
                  </div>
                  <div
                    class="rounded border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-mono text-slate-600"
                  >
                    fechaMedicion: {{ p.fechaMedicion }} · horaMedicion: {{ p.horaMedicion }}
                  </div>
                } @else {
                  <div class="text-[11px] italic text-slate-500">
                    Sin telemetría reciente del pozo.
                  </div>
                }
              }
            </section>
          </div>

          <!-- Footer -->
          <div
            class="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/60 px-6 py-4"
          >
            <span class="text-[11px] text-slate-500">
              @if (isDirty()) {
                <span class="flex items-center gap-1 font-semibold text-amber-700">
                  <span class="material-symbols-outlined text-[14px]">edit</span>
                  Cambios sin guardar
                </span>
              }
            </span>
            <div class="flex items-center gap-2">
              <button
                type="button"
                (click)="cerrar()"
                class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100"
              >
                Cerrar
              </button>
              <button
                type="button"
                (click)="guardarConfig()"
                [disabled]="!isDirty() || saving()"
                class="rounded-lg bg-primary px-4 py-2 text-[13px] font-bold text-white hover:bg-primary-container disabled:opacity-40"
              >
                {{ saving() ? 'Guardando…' : 'Guardar cambios' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class DgaGenerarReporteModalComponent implements OnChanges, OnDestroy {
  private readonly dgaService = inject(DgaService);
  private readonly http = inject(HttpClient);

  @Input() open = false;
  @Input() siteId = '';
  @Input() siteName = '';
  @Output() closed = new EventEmitter<void>();
  /** Emitido tras cualquier cambio que afecte la config DGA del pozo. */
  @Output() configChanged = new EventEmitter<void>();

  readonly periodicidades: PeriodicidadOption[] = [
    { value: 'hora', label: 'Hora', cadencia: 'cada 60 min' },
    { value: 'dia', label: 'Día', cadencia: 'cada 24 h' },
    { value: 'semana', label: 'Semana', cadencia: 'cada 7 días' },
    { value: 'mes', label: 'Mes', cadencia: 'cada 30 días' },
  ];

  // Pozo DGA config (baseline del servidor) + borrador local
  readonly pozo = signal<PozoDgaConfig | null>(null);
  readonly draft = signal<ConfigDraft>(DgaGenerarReporteModalComponent.emptyDraft());
  readonly saving = signal<boolean>(false);
  readonly pozoError = signal<string>('');

  // Informantes
  readonly informantes = signal<DgaInformantePublic[]>([]);
  readonly informantesLoading = signal<boolean>(false);
  readonly newInfRut = signal<string>('');
  readonly newInfClave = signal<string>('');
  readonly newInfReferencia = signal<string>('');
  readonly informanteSaving = signal<boolean>(false);
  readonly informanteError = signal<string>('');

  // Live preview
  readonly preview = signal<DgaLivePreview | null>(null);
  private livePollHandle: ReturnType<typeof setInterval> | null = null;

  /** true cuando el borrador difiere de lo guardado en el servidor. */
  readonly isDirty = computed<boolean>(() => {
    const base = DgaGenerarReporteModalComponent.draftFrom(this.pozo());
    const d = this.draft();
    return (Object.keys(d) as (keyof ConfigDraft)[]).some((k) => d[k] !== base[k]);
  });

  private static emptyDraft(): ConfigDraft {
    return {
      dga_activo: false,
      dga_gcs_export: false,
      dga_transport: 'off',
      obra_dga: '',
      dga_caudal_max_lps: '',
      dga_periodicidad: '',
      dga_fecha_inicio: '',
      dga_hora_inicio: '',
      dga_informante_rut: '',
    };
  }

  /** Proyecta la config del servidor al shape del borrador (strings de input). */
  private static draftFrom(cfg: PozoDgaConfig | null): ConfigDraft {
    if (!cfg) return DgaGenerarReporteModalComponent.emptyDraft();
    const hora = cfg.dga_hora_inicio ?? '';
    return {
      dga_activo: cfg.dga_activo,
      dga_gcs_export: cfg.dga_gcs_export,
      dga_transport: cfg.dga_transport,
      obra_dga: cfg.obra_dga ?? '',
      dga_caudal_max_lps: cfg.dga_caudal_max_lps != null ? String(cfg.dga_caudal_max_lps) : '',
      dga_periodicidad: cfg.dga_periodicidad ?? '',
      dga_fecha_inicio: cfg.dga_fecha_inicio ?? '',
      dga_hora_inicio: hora.length >= 5 ? hora.slice(0, 5) : hora,
      dga_informante_rut: cfg.dga_informante_rut ?? '',
    };
  }

  // ============ Lifecycle ============

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['open'] && this.open) {
      this.loadAll();
      this.startLivePoll();
    } else if (changes['open'] && !this.open) {
      this.stopLivePoll();
    }
  }

  ngOnDestroy(): void {
    this.stopLivePoll();
  }

  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cerrar();
  }

  cerrar(): void {
    if (this.isDirty() && !confirm('Hay cambios sin guardar. ¿Cerrar y descartarlos?')) {
      return;
    }
    this.closed.emit();
  }

  // ============ Carga inicial ============

  private loadAll(): void {
    this.pozoError.set('');
    this.informanteError.set('');
    this.loadPozo();
    this.loadInformantes();
    this.loadPreview();
  }

  private loadPozo(): void {
    if (!this.siteId) return;
    this.dgaService.getPozoDgaConfig(this.siteId).subscribe({
      next: (cfg) => {
        this.pozo.set(cfg);
        this.draft.set(DgaGenerarReporteModalComponent.draftFrom(cfg));
      },
      error: (err: HttpErrorResponse) => {
        this.pozoError.set(
          'No se pudo cargar config DGA: ' + (err.error?.error?.message ?? err.message),
        );
      },
    });
  }

  reloadInformantes(): void {
    this.loadInformantes();
  }

  private loadInformantes(): void {
    this.informantesLoading.set(true);
    this.dgaService.listInformantes().subscribe({
      next: (list) => {
        this.informantes.set(list);
        this.informantesLoading.set(false);
      },
      error: () => {
        this.informantes.set([]);
        this.informantesLoading.set(false);
      },
    });
  }

  private loadPreview(): void {
    if (!this.siteId) return;
    this.dgaService.getLivePreview(this.siteId).subscribe({
      next: (p) => this.preview.set(p),
      error: () => this.preview.set(null),
    });
  }

  private startLivePoll(): void {
    this.stopLivePoll();
    this.livePollHandle = setInterval(() => this.loadPreview(), LIVE_REFRESH_MS);
  }

  private stopLivePoll(): void {
    if (this.livePollHandle) {
      clearInterval(this.livePollHandle);
      this.livePollHandle = null;
    }
  }

  // ============ Borrador + Guardar ============

  setDraft<K extends keyof ConfigDraft>(field: K, value: ConfigDraft[K]): void {
    this.draft.update((d) => ({ ...d, [field]: value }));
  }

  /**
   * Valida el borrador completo. Devuelve el mensaje del primer problema o
   * null si todo OK. La validación corre ANTES de tocar el backend — ese es
   * el punto del botón Guardar.
   */
  private validateDraft(d: ConfigDraft): string | null {
    const obra = d.obra_dga.trim().toUpperCase();
    if (obra && !CODIGO_OBRA_REGEX.test(obra)) {
      return 'Código de obra inválido. Formato: OB-NNNN-N u OR-NNNN-N (ej. OB-0602-7).';
    }
    if (d.dga_caudal_max_lps.trim() !== '') {
      const n = Number(d.dga_caudal_max_lps);
      if (!Number.isFinite(n) || n < 0) return 'Caudal máx inválido (número ≥ 0).';
    }
    if (d.dga_activo) {
      if (!d.dga_periodicidad) return 'Para activar DGA elige una periodicidad.';
      if (!d.dga_fecha_inicio || !d.dga_hora_inicio) {
        return 'Para activar DGA completa fecha y hora de inicio.';
      }
    }
    if (d.dga_transport === 'rest') {
      if (!obra) return 'Para modo REST el código de obra es obligatorio.';
      if (!d.dga_informante_rut) return 'Para modo REST asocia un informante.';
    }
    return null;
  }

  /**
   * Aplica el borrador: valida, arma UN PATCH con solo los campos que
   * cambiaron y lo envía. obra_dga viaja por su endpoint propio
   * (companies/sites). Si el cambio exige 2FA (REST/GCS), el interceptor
   * global abre el diálogo y reintenta solo.
   */
  guardarConfig(): void {
    const d = this.draft();
    const base = DgaGenerarReporteModalComponent.draftFrom(this.pozo());

    const validationError = this.validateDraft(d);
    if (validationError) {
      this.pozoError.set(validationError);
      return;
    }

    const payload: PatchPozoDgaConfigPayload = {};
    if (d.dga_activo !== base.dga_activo) payload.dga_activo = d.dga_activo;
    if (d.dga_gcs_export !== base.dga_gcs_export) payload.dga_gcs_export = d.dga_gcs_export;
    if (d.dga_transport !== base.dga_transport) payload.dga_transport = d.dga_transport;
    if (d.dga_caudal_max_lps !== base.dga_caudal_max_lps) {
      payload.dga_caudal_max_lps =
        d.dga_caudal_max_lps.trim() === '' ? null : Number(d.dga_caudal_max_lps);
    }
    if (d.dga_periodicidad !== base.dga_periodicidad) {
      payload.dga_periodicidad = d.dga_periodicidad === '' ? null : d.dga_periodicidad;
    }
    if (d.dga_fecha_inicio !== base.dga_fecha_inicio) {
      payload.dga_fecha_inicio = d.dga_fecha_inicio || null;
    }
    if (d.dga_hora_inicio !== base.dga_hora_inicio) {
      payload.dga_hora_inicio = d.dga_hora_inicio || null;
    }
    if (d.dga_informante_rut !== base.dga_informante_rut) {
      payload.dga_informante_rut = d.dga_informante_rut || null;
    }
    const obraChanged = d.obra_dga.trim().toUpperCase() !== base.obra_dga;

    this.saving.set(true);
    this.pozoError.set('');

    const patchConfig = () => {
      if (Object.keys(payload).length === 0) {
        this.saving.set(false);
        this.loadPozo();
        this.configChanged.emit();
        return;
      }
      this.dgaService.patchPozoDgaConfig(this.siteId, payload).subscribe({
        next: (updated) => {
          this.pozo.set(updated);
          this.draft.set(DgaGenerarReporteModalComponent.draftFrom(updated));
          this.saving.set(false);
          this.configChanged.emit();
        },
        error: (err: HttpErrorResponse) => {
          this.saving.set(false);
          this.pozoError.set(this.friendlySaveError(err));
        },
      });
    };

    if (obraChanged) {
      const obra = d.obra_dga.trim().toUpperCase();
      this.http
        .patch<{ ok: boolean }>(`/api/companies/sites/${encodeURIComponent(this.siteId)}`, {
          pozo_config: { obra_dga: obra || null },
        })
        .subscribe({
          next: () => patchConfig(),
          error: (err: HttpErrorResponse) => {
            this.saving.set(false);
            this.pozoError.set(
              err.error?.error?.message ?? err.message ?? 'Error al guardar código de obra',
            );
          },
        });
    } else {
      patchConfig();
    }
  }

  private friendlySaveError(err: HttpErrorResponse): string {
    const code = err.error?.code ?? err.error?.error?.code;
    if (err.status === 403 && (code === 'TWOFA_REQUIRED' || code === 'TWOFA_INVALID')) {
      return 'Verificación 2FA cancelada. Los cambios no se guardaron.';
    }
    return err.error?.error?.message ?? err.message ?? 'Error desconocido';
  }

  // ============ Informante ============

  updateNewInfRut(value: string): void {
    this.newInfRut.set(formatRutDgaInput(value));
  }

  guardarInformante(): void {
    const rut = formatRutDgaInput(this.newInfRut());
    if (!rut) return;
    const clave = this.newInfClave();
    const referencia = this.newInfReferencia().trim() || null;

    // Backend exige clave si el RUT es nuevo. Pre-validamos contra el pool
    // local para dar feedback inmediato sin esperar el 409.
    const rutExisteEnPool = this.informantes().some((i) => formatRutDgaInput(i.rut) === rut);
    if (!rutExisteEnPool && !clave) {
      this.informanteError.set(
        `RUT ${rut} no está en el pool. Ingresá la clave SNIA para crearlo.`,
      );
      return;
    }

    // Con clave el backend exige 2FA — el interceptor global abre el diálogo.
    const payload = clave ? { rut, clave_informante: clave, referencia } : { rut, referencia };
    this.informanteSaving.set(true);
    this.informanteError.set('');
    this.dgaService.upsertInformante(payload).subscribe({
      next: () => {
        this.informanteSaving.set(false);
        this.newInfClave.set('');
        this.loadInformantes();
      },
      error: (err: HttpErrorResponse) => {
        this.informanteSaving.set(false);
        const code = err.error?.code ?? err.error?.error?.code;
        if (err.status === 403 && (code === 'TWOFA_REQUIRED' || code === 'TWOFA_INVALID')) {
          this.informanteError.set('Verificación 2FA cancelada. El informante no se guardó.');
          return;
        }
        // Extrae el message del envelope tipo {ok:false, error:{code,message}}
        // o fallback al string genérico de Angular.
        const apiMsg =
          err.error?.error?.message ??
          err.error?.message ??
          (typeof err.error === 'string' ? err.error : null) ??
          err.message ??
          'Error desconocido';
        const apiCode = err.error?.error?.code;
        const detalle = apiCode ? ` [${apiCode}]` : '';
        this.informanteError.set(`No se pudo guardar${detalle}: ${apiMsg}`);
      },
    });
  }

  formatAge(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }
}
