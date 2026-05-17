/**
 * Modal "Configurar reporte DGA" — modelo redesign 2026-05-17.
 *
 * Toda la config DGA del pozo en un solo modal:
 *   1. Sección Activación (siempre visible): toggle activo, transport
 *      (off/shadow/rest), código de obra, caudal_max_lps, periodicidad,
 *      fecha+hora inicio. Cada control se persiste inmediato al cambiar.
 *      Pasar transport→'rest' dispara 2FA inline (input código + confirm).
 *   2. Sección Informante: dropdown del pool global + alta/rotación de
 *      credenciales (RUT + clave). Rotación de clave exige 2FA.
 *   3. Sección Datos en vivo: GET live-preview cada N seg → muestra los
 *      valores formateados tal como se enviarían a SNIA con la última
 *      lectura del pozo.
 */
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

const LIVE_REFRESH_MS = 10_000;

interface PeriodicidadOption {
  value: DgaPeriodicidad;
  label: string;
  cadencia: string;
}

@Component({
  selector: 'app-dga-generar-reporte-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open) {
      <div
        class="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
        (click)="onBackdrop($event)"
      >
        <div
          class="relative mx-4 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <div class="flex items-center gap-3">
              <span class="material-symbols-outlined text-[24px] text-cyan-600">description</span>
              <div>
                <h2 class="text-base font-semibold text-slate-800">Configurar reporte DGA</h2>
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
            <!-- ====== Activación DGA (siempre visible) ====== -->
            <section
              class="space-y-3 rounded-lg border border-cyan-200 bg-cyan-50/40 px-4 py-3"
            >
              <div
                class="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-cyan-700"
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
                    [checked]="pozo()?.dga_activo ?? false"
                    [disabled]="pozoSaving() !== ''"
                    (change)="changeField('dga_activo', $any($event.target).checked)"
                    class="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-300"
                  />
                  <span class="text-[12px] font-semibold text-slate-700">DGA activo</span>
                  @if (pozoSaving() === 'dga_activo') {
                    <span class="text-[10px] italic text-cyan-600">Guardando…</span>
                  }
                </label>

                <!-- Modo envío -->
                <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  Modo envío
                  <select
                    [value]="pozo()?.dga_transport ?? 'off'"
                    [disabled]="pozoSaving() !== ''"
                    (change)="changeTransport($any($event.target).value)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-700 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100"
                  >
                    <option value="off">Off (no envía)</option>
                    <option value="shadow">Shadow (rellena sin enviar)</option>
                    <option value="rest">REST (envía a SNIA)</option>
                  </select>
                </label>

                <!-- Código de obra -->
                <div class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  Código de obra
                  <div class="flex gap-2">
                    <input
                      type="text"
                      [ngModel]="obraDga()"
                      (ngModelChange)="obraDga.set($event)"
                      placeholder="OB-XXXX-XXX"
                      [disabled]="obraDgaSaving()"
                      class="flex-1 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono uppercase tracking-wider text-slate-700 outline-none focus:border-cyan-300"
                    />
                    <button
                      type="button"
                      (click)="saveObraDga()"
                      [disabled]="obraDgaSaving() || obraDga().trim() === obraDgaInitial()"
                      class="rounded bg-cyan-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-cyan-700 disabled:opacity-40"
                    >
                      OK
                    </button>
                  </div>
                </div>

                <!-- Caudal max -->
                <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  Caudal máx [L/s]
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    [value]="pozo()?.dga_caudal_max_lps ?? ''"
                    [disabled]="pozoSaving() !== ''"
                    (change)="changeCaudalMax($any($event.target).value)"
                    placeholder="sin cargar (fallback 1000)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono outline-none focus:border-cyan-300"
                  />
                </label>

                <!-- Periodicidad -->
                <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  Periodicidad
                  <select
                    [value]="pozo()?.dga_periodicidad ?? ''"
                    [disabled]="pozoSaving() !== ''"
                    (change)="changeField('dga_periodicidad', $any($event.target).value || null)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-cyan-300"
                  >
                    <option value="">— elegir —</option>
                    @for (p of periodicidades; track p.value) {
                      <option [value]="p.value">{{ p.label }} ({{ p.cadencia }})</option>
                    }
                  </select>
                </label>

                <!-- Fecha inicio -->
                <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  Fecha inicio
                  <input
                    type="date"
                    min="2020-01-01"
                    [value]="pozo()?.dga_fecha_inicio ?? ''"
                    [disabled]="pozoSaving() !== ''"
                    (change)="changeField('dga_fecha_inicio', $any($event.target).value || null)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono outline-none focus:border-cyan-300"
                  />
                </label>

                <!-- Hora inicio -->
                <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  Hora inicio (UTC-4)
                  <input
                    type="time"
                    step="60"
                    [value]="horaInicioForInput()"
                    [disabled]="pozoSaving() !== ''"
                    (change)="changeField('dga_hora_inicio', $any($event.target).value || null)"
                    class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono outline-none focus:border-cyan-300"
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
                Pasar a <strong>REST</strong> envía a SNIA en producción. Verifica que el
                sistema legacy esté apagado para esta obra antes (Res 2170 §6.3).
                Requiere código 2FA.
              </p>
            </section>

            <!-- ====== Informante (pool global) ====== -->
            <section
              class="space-y-3 rounded-lg border border-violet-200 bg-violet-50/40 px-4 py-3"
            >
              <div
                class="flex items-center justify-between text-[10px] uppercase tracking-wider font-semibold text-violet-700"
              >
                <span class="flex items-center gap-2">
                  <span class="material-symbols-outlined text-[14px]">badge</span>
                  Informante
                </span>
                <button
                  type="button"
                  (click)="reloadInformantes()"
                  [disabled]="informantesLoading()"
                  class="text-[10px] font-bold text-violet-700 hover:underline disabled:opacity-50"
                >
                  Recargar
                </button>
              </div>

              <!-- Selector pool -->
              <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                Asociar informante (RUT)
                <select
                  [value]="pozo()?.dga_informante_rut ?? ''"
                  [disabled]="pozoSaving() !== '' || informantesLoading()"
                  (change)="changeField('dga_informante_rut', $any($event.target).value || null)"
                  class="h-8 rounded border border-slate-200 bg-white px-2 text-[12px] font-mono outline-none focus:border-violet-300"
                >
                  <option value="">— ninguno —</option>
                  @for (inf of informantes(); track inf.rut) {
                    <option [value]="inf.rut">{{ inf.rut }}{{ inf.referencia ? ' · ' + inf.referencia : '' }}</option>
                  }
                </select>
                <span class="text-[10px] text-slate-500">
                  Un mismo RUT puede asociarse a varios pozos.
                </span>
              </label>

              <!-- Alta/rotación rápida -->
              <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  [ngModel]="newInfRut()"
                  (ngModelChange)="newInfRut.set($event)"
                  placeholder="RUT nuevo o existente"
                  class="rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-mono outline-none focus:border-violet-300"
                />
                <input
                  type="password"
                  [ngModel]="newInfClave()"
                  (ngModelChange)="newInfClave.set($event)"
                  placeholder="clave SNIA (rotar)"
                  autocomplete="new-password"
                  class="rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] font-mono outline-none focus:border-violet-300"
                />
                <input
                  type="text"
                  [ngModel]="newInfReferencia()"
                  (ngModelChange)="newInfReferencia.set($event)"
                  placeholder="referencia interna (opcional)"
                  class="rounded border border-slate-200 bg-white px-2 py-1.5 text-[12px] outline-none focus:border-violet-300"
                />
              </div>
              <button
                type="button"
                (click)="guardarInformante()"
                [disabled]="!newInfRut().trim() || informanteSaving()"
                class="rounded bg-violet-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-violet-700 disabled:opacity-40"
              >
                @if (informanteSaving()) { Guardando… } @else { Guardar informante }
              </button>
              @if (informanteError()) {
                <div
                  class="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700"
                >
                  {{ informanteError() }}
                </div>
              }
              <p class="text-[10px] text-slate-500">
                Solo RUT es obligatorio. La clave solo se exige al crear nuevo o rotar
                (requiere 2FA). Referencia es etiqueta libre interna.
              </p>
            </section>

            <!-- ====== Datos en vivo ====== -->
            <section
              class="space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-3"
            >
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
                      <div class="font-mono text-[14px] font-bold text-cyan-700">
                        {{ p.caudal ?? '—' }}
                      </div>
                    </div>
                    <div class="rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div class="text-[10px] uppercase tracking-wider text-slate-400">
                        Totalizador [m³]
                      </div>
                      <div class="font-mono text-[14px] font-bold text-cyan-700">
                        {{ p.totalizador ?? '—' }}
                      </div>
                    </div>
                    <div class="rounded border border-slate-200 bg-white px-2 py-1.5">
                      <div class="text-[10px] uppercase tracking-wider text-slate-400">
                        Nivel Freático [m]
                      </div>
                      <div class="font-mono text-[14px] font-bold text-cyan-700">
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
            class="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-6 py-4"
          >
            <button
              type="button"
              (click)="cerrar()"
              class="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-700 hover:bg-slate-100"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>

      <!-- ====== Modal 2FA inline ====== -->
      @if (twoFactorPrompt()) {
        <div
          class="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-[2px]"
        >
          <section class="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div class="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-3">
              <span class="material-symbols-outlined text-[20px] text-amber-700">verified_user</span>
              <h3 class="text-sm font-black uppercase tracking-wide text-amber-900">
                Verificación 2FA
              </h3>
            </div>
            <div class="space-y-3 px-5 py-4 text-[13px] text-slate-700">
              <p>{{ twoFactorPrompt() }}</p>
              <p
                class="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-800"
              >
                Verifica que el sistema legacy esté apagado para esta obra antes de
                activar REST (Res 2170 §6.3).
              </p>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  (click)="requestTwoFactorCode()"
                  [disabled]="twoFactorRequesting()"
                  class="rounded-lg bg-amber-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {{ twoFactorRequesting() ? 'Enviando…' : 'Solicitar código' }}
                </button>
                <span class="text-[11px] text-amber-700">Se envía al email admin.</span>
              </div>
              <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                Código (6 dígitos)
                <input
                  type="text"
                  inputmode="numeric"
                  maxlength="6"
                  [value]="twoFactorCode()"
                  (input)="twoFactorCode.set($any($event.target).value.replace(/\\D/g, ''))"
                  placeholder="000000"
                  class="h-9 w-32 rounded-lg border border-amber-300 bg-white px-2 text-center font-mono text-[14px] font-bold tracking-widest text-slate-800 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                />
              </label>
              @if (twoFactorError()) {
                <div class="text-[11px] text-red-700">{{ twoFactorError() }}</div>
              }
            </div>
            <div class="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                type="button"
                (click)="cancelTwoFactor()"
                class="rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                (click)="confirmTwoFactor()"
                [disabled]="twoFactorCode().length !== 6 || twoFactorBusy()"
                class="rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {{ twoFactorBusy() ? 'Confirmando…' : 'Confirmar' }}
              </button>
            </div>
          </section>
        </div>
      }
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

  // Pozo DGA config
  readonly pozo = signal<PozoDgaConfig | null>(null);
  /** Campo cuyo PATCH está en vuelo. '' cuando idle. */
  readonly pozoSaving = signal<string>('');
  readonly pozoError = signal<string>('');

  // Obra DGA (input separado con botón porque es texto libre)
  readonly obraDga = signal<string>('');
  readonly obraDgaInitial = signal<string>('');
  readonly obraDgaSaving = signal<boolean>(false);

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

  // 2FA
  /** Mensaje a mostrar en el modal de 2FA. '' cuando cerrado. */
  readonly twoFactorPrompt = signal<string>('');
  readonly twoFactorCode = signal<string>('');
  readonly twoFactorRequesting = signal<boolean>(false);
  readonly twoFactorBusy = signal<boolean>(false);
  readonly twoFactorError = signal<string>('');
  /**
   * Acción pendiente a ejecutar con el código 2FA. Se resuelve cuando el
   * usuario confirma.
   */
  private twoFactorPendingAction: ((code: string) => Promise<void>) | null = null;

  readonly horaInicioForInput = computed<string>(() => {
    const v = this.pozo()?.dga_hora_inicio;
    if (!v) return '';
    return v.length >= 5 ? v.slice(0, 5) : v;
  });

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
        this.obraDga.set(cfg?.obra_dga ?? '');
        this.obraDgaInitial.set(cfg?.obra_dga ?? '');
      },
      error: (err: HttpErrorResponse) => {
        this.pozoError.set('No se pudo cargar config DGA: ' + (err.error?.error?.message ?? err.message));
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

  // ============ Patch pozo config ============

  /**
   * Aplica un PATCH parcial al pozo_config. Si la respuesta exige 2FA,
   * lanza el modal de 2FA y reintenta con el código.
   */
  private patchPozo(
    fieldLabel: string,
    payload: PatchPozoDgaConfigPayload,
    twoFactorCode?: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.pozoSaving.set(fieldLabel);
      this.pozoError.set('');
      this.dgaService.patchPozoDgaConfig(this.siteId, payload, twoFactorCode).subscribe({
        next: (updated) => {
          this.pozo.set(updated);
          this.obraDga.set(updated.obra_dga ?? '');
          this.obraDgaInitial.set(updated.obra_dga ?? '');
          this.pozoSaving.set('');
          this.configChanged.emit();
          resolve(true);
        },
        error: (err: HttpErrorResponse) => {
          this.pozoSaving.set('');
          const code = err.error?.error?.code;
          if (code === 'DGA_2FA_REQUIRED' || code === 'DGA_2FA_INVALID') {
            // Activar prompt de 2FA y reintento.
            this.promptTwoFactor(
              'Cambiar a REST exige verificación 2FA.',
              async (twoCode) => {
                const ok = await this.patchPozo(fieldLabel, payload, twoCode);
                if (!ok) throw new Error('reintento falló');
              },
            );
            resolve(false);
          } else {
            this.pozoError.set(err.error?.error?.message ?? err.message ?? 'Error desconocido');
            resolve(false);
          }
        },
      });
    });
  }

  /** Wrapper genérico para cambios atómicos (un solo campo). */
  changeField<K extends keyof PatchPozoDgaConfigPayload>(
    field: K,
    value: PatchPozoDgaConfigPayload[K],
  ): void {
    const payload = { [field]: value } as PatchPozoDgaConfigPayload;
    void this.patchPozo(String(field), payload);
  }

  changeTransport(value: DgaTransport): void {
    // Backend exige 2FA si pasa a 'rest'. El patchPozo detecta el error
    // DGA_2FA_REQUIRED y abre el prompt automáticamente.
    this.changeField('dga_transport', value);
  }

  changeCaudalMax(raw: string): void {
    const trimmed = (raw ?? '').trim();
    let value: number | null;
    if (trimmed === '') {
      value = null;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        this.pozoError.set('Caudal máx inválido (número ≥ 0).');
        return;
      }
      value = n;
    }
    this.changeField('dga_caudal_max_lps', value);
  }

  saveObraDga(): void {
    const value = this.obraDga().trim();
    if (value === this.obraDgaInitial()) return;
    this.obraDgaSaving.set(true);
    this.http
      .patch<{ ok: boolean }>(`/api/companies/sites/${encodeURIComponent(this.siteId)}`, {
        pozo_config: { obra_dga: value || null },
      })
      .subscribe({
        next: () => {
          this.obraDgaSaving.set(false);
          this.obraDgaInitial.set(value);
          // Refresca pozo_config para que obra_dga refleje el cambio.
          this.loadPozo();
          this.configChanged.emit();
        },
        error: (err: HttpErrorResponse) => {
          this.obraDgaSaving.set(false);
          this.pozoError.set(
            err.error?.error?.message ?? err.message ?? 'Error al guardar código de obra',
          );
        },
      });
  }

  // ============ Informante ============

  guardarInformante(): void {
    const rut = this.newInfRut().trim();
    if (!rut) return;
    const clave = this.newInfClave();
    const referencia = this.newInfReferencia().trim() || null;

    // Backend exige clave si el RUT es nuevo. Pre-validamos contra el pool
    // local para dar feedback inmediato sin esperar el 409.
    const rutExisteEnPool = this.informantes().some((i) => i.rut === rut);
    if (!rutExisteEnPool && !clave) {
      this.informanteError.set(
        `RUT ${rut} no está en el pool. Ingresá la clave SNIA para crearlo.`,
      );
      return;
    }

    // Si pasa clave → 2FA. Si solo referencia (RUT ya existe) → directo.
    if (clave) {
      this.promptTwoFactor(
        `Rotar/establecer clave SNIA para ${rut} exige verificación 2FA.`,
        async (code) => {
          await this.doSaveInformante({ rut, clave_informante: clave, referencia }, code);
        },
      );
      return;
    }
    void this.doSaveInformante({ rut, referencia }, undefined);
  }

  private async doSaveInformante(
    payload: { rut: string; clave_informante?: string; referencia?: string | null },
    twoFactorCode: string | undefined,
  ): Promise<void> {
    this.informanteSaving.set(true);
    this.informanteError.set('');
    return new Promise<void>((resolve) => {
      this.dgaService.upsertInformante(payload, twoFactorCode).subscribe({
        next: () => {
          this.informanteSaving.set(false);
          this.newInfClave.set('');
          this.loadInformantes();
          resolve();
        },
        error: (err: HttpErrorResponse) => {
          this.informanteSaving.set(false);
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
          resolve();
        },
      });
    });
  }

  // ============ 2FA flow ============

  private promptTwoFactor(message: string, action: (code: string) => Promise<void>): void {
    this.twoFactorPrompt.set(message);
    this.twoFactorCode.set('');
    this.twoFactorError.set('');
    this.twoFactorPendingAction = action;
  }

  requestTwoFactorCode(): void {
    this.twoFactorRequesting.set(true);
    this.twoFactorError.set('');
    this.dgaService.request2faCode().subscribe({
      next: () => {
        this.twoFactorRequesting.set(false);
        this.twoFactorError.set('Código enviado al email admin. Vence en 5 min.');
      },
      error: (err: HttpErrorResponse) => {
        this.twoFactorRequesting.set(false);
        this.twoFactorError.set(
          'No se pudo enviar código: ' + (err.error?.error?.message ?? err.message),
        );
      },
    });
  }

  cancelTwoFactor(): void {
    this.twoFactorPendingAction = null;
    this.twoFactorPrompt.set('');
    this.twoFactorCode.set('');
    this.twoFactorError.set('');
  }

  async confirmTwoFactor(): Promise<void> {
    const code = this.twoFactorCode();
    const action = this.twoFactorPendingAction;
    if (code.length !== 6 || !action) return;
    this.twoFactorBusy.set(true);
    this.twoFactorError.set('');
    try {
      await action(code);
      this.cancelTwoFactor();
    } catch (err) {
      const e = err as HttpErrorResponse;
      this.twoFactorError.set(
        'Acción falló: ' + (e.error?.error?.message ?? e.message ?? 'error desconocido'),
      );
    } finally {
      this.twoFactorBusy.set(false);
    }
  }

  formatAge(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
    return `${Math.round(seconds / 86400)}d`;
  }
}
