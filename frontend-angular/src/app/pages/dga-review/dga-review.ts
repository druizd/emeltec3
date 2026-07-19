/**
 * Admin DGA — cola de revisión manual de slots `requires_review`.
 *
 * Solo SuperAdmin/Admin acceden (gateado por route + backend authorizeRoles).
 * Acciones destructivas (aceptar/descartar slot) requieren 2FA email-OTP:
 * el twoFactorInterceptor global captura el 403 TWOFA_REQUIRED, abre el
 * diálogo estándar y reintenta con el header X-2FA-Code. Este componente no
 * orquesta nada del 2FA.
 */
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DgaReviewActionPayload, DgaReviewSlot, DgaService } from '../../services/dga.service';
import { TableSkeletonComponent } from '../../components/ui/table-skeleton';

interface RowEdit {
  caudal: string;
  totalizador: string;
  nivel: string;
  note: string;
}

/**
 * Etiquetas en español para los códigos de anomalía de validación.
 * El código crudo (sensor_frozen) es vocabulario de backend; el admin decide
 * más rápido leyendo la anomalía en su idioma. El detalle técnico completo
 * (reason) queda disponible como tooltip del badge.
 */
const WARNING_LABELS: Record<string, string> = {
  sensor_known_defective: 'Sensor marcado defectuoso',
  sensor_frozen: 'Totalizador congelado',
  totalizator_zero: 'Totalizador en cero',
  flow_negative: 'Caudal negativo',
  flow_exceeds_water_right: 'Caudal sobre el derecho',
  flow_absurd_no_water_right: 'Caudal fuera de rango',
  caudal_spike: 'Salto de caudal imposible',
  transform_failed_all_nulls: 'Telemetría sin valores',
  admin_override: 'Aceptado por admin',
  admin_discarded: 'Descartado por admin',
};

@Component({
  selector: 'app-dga-review',
  standalone: true,
  imports: [CommonModule, FormsModule, TableSkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-6xl p-6 space-y-4">
      <header class="flex items-center justify-between">
        <div>
          <h1 class="text-h4 font-semibold text-slate-800">Cola de revisión DGA</h1>
          <p class="text-caption text-slate-500">
            Mediciones con anomalías detectadas en validación. Requieren decisión admin antes de
            enviar a SNIA.
          </p>
        </div>
        <button
          type="button"
          (click)="reload()"
          [disabled]="loading()"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-body-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-95 disabled:opacity-50"
        >
          Recargar
        </button>
      </header>

      <!-- Mensajes informativos (resultado de acciones) -->
      @if (codeMessage()) {
        <div
          class="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-body-sm text-emerald-800"
        >
          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">check_circle</span>
          <span>{{ codeMessage() }}</span>
        </div>
      }

      <!-- Ayuda -->
      <details class="rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-700">
        <summary
          class="flex cursor-pointer select-none items-center gap-2 text-body-sm font-semibold"
        >
          <span class="material-symbols-outlined text-[18px] text-primary" aria-hidden="true">help</span>
          ¿Cómo funciona esta cola?
        </summary>
        <div class="mt-3 space-y-2 text-caption text-slate-600">
          <p>
            Cada fila es una medición que la validación retuvo por una anomalía (columna
            <strong>Anomalías</strong>) antes de enviarla a la DGA. Nada se envía hasta que un admin
            decida.
          </p>
          <p>
            Los campos <strong>Caudal, Totalizador y Nivel</strong> son los valores que se
            declararán a la DGA si aceptas. Vienen pre-cargados con la medición del sensor (o con el
            valor sugerido por la validación). Puedes corregirlos solo si tienes fundamento, por
            ejemplo un totalizador congelado cuyo avance real conoces.
          </p>
          <ul class="list-disc space-y-1 pl-5">
            <li>
              <strong>Aceptar y enviar</strong>: la medición pasa a la cola de envío a SNIA con los
              valores de los campos.
            </li>
            <li>
              <strong>Descartar</strong>: la medición NO se envía y queda marcada como fallida.
            </li>
            <li>
              <strong>Reconocer sensor defectuoso</strong> (aparece en fallas de totalizador): marca
              el sensor como defectuoso para que las mediciones futuras NO vuelvan a caer aquí (se
              reportan con la incidencia registrada), abre una incidencia pendiente en la bitácora
              del sitio y acepta de una vez las mediciones retenidas por esa falla. Al reemplazar el
              equipo, quita la marca en la configuración del sensor.
            </li>
          </ul>
          <p>
            La <strong>nota admin</strong> es obligatoria y queda registrada de forma permanente en
            la medición junto con <strong>quién ejecutó la acción y cuándo</strong>: es el respaldo
            auditable de la decisión. Al confirmar cualquiera de las acciones se pedirá una
            verificación 2FA (código de 6 dígitos enviado a tu email, vence en 5 minutos).
          </p>
        </div>
      </details>

      <!-- Errores -->
      @if (error()) {
        <div
          class="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-body-sm text-red-800"
        >
          <span class="material-symbols-outlined text-[18px]" aria-hidden="true">error</span>
          <span>{{ error() }}</span>
        </div>
      }

      <!-- Tabla -->
      @if (loading()) {
        <app-table-skeleton [rows]="6" [columns]="6" />
      } @else if (slots().length === 0) {
        <div
          class="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-6 text-center text-emerald-800"
        >
          <span class="material-symbols-outlined text-[24px]" aria-hidden="true">check_circle</span>
          <p class="mt-1 text-body-sm font-semibold">Sin mediciones en revisión.</p>
          <p class="text-caption-xs text-emerald-700">
            Todas las mediciones pasaron validación y siguen su curso a SNIA.
          </p>
        </div>
      } @else {
        <div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table class="min-w-full text-caption">
            <thead class="bg-surface-subtle">
              <tr>
                <th class="dga-table-header">Obra</th>
                <th class="dga-table-header">Medición</th>
                <th class="dga-table-header">Anomalías</th>
                <th class="dga-table-header">Caudal (L/s)</th>
                <th class="dga-table-header">Totalizador (m³)</th>
                <th class="dga-table-header">Nivel (m)</th>
                <th class="dga-table-header">Nota admin</th>
                <th class="dga-table-header"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              @for (s of slots(); track slotKey(s)) {
                <tr class="hover:bg-slate-50">
                  <td class="px-3 py-2 align-top">
                    <div class="font-semibold text-slate-700">{{ s.codigo_obra || s.obra }}</div>
                    <div class="text-caption-xs text-slate-500">
                      {{ s.referencia_informante || s.site_id }}
                    </div>
                  </td>
                  <td class="px-3 py-2 align-top">
                    <div class="font-mono text-caption text-slate-800">{{ formatTs(s.ts) }}</div>
                    <div class="text-caption-xs text-slate-400">hora Chile</div>
                  </td>
                  <td class="px-3 py-2 align-top">
                    <ul class="space-y-1">
                      @for (w of s.validation_warnings; track w.code) {
                        <li>
                          <span
                            [title]="w.reason || ''"
                            class="inline-flex cursor-help items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-caption-xs font-semibold text-amber-700"
                          >
                            <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"></span>
                            {{ warningLabel(w.code) }}
                          </span>
                          @if (w.suggested !== null && w.suggested !== undefined) {
                            <span class="ml-1.5 font-mono text-caption-xs text-slate-500"
                              >sugerido: {{ w.suggested }}</span
                            >
                          }
                        </li>
                      }
                    </ul>
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="0.01"
                      [value]="edit(s).caudal"
                      (input)="setEdit(s, 'caudal', $any($event.target).value)"
                      [attr.aria-label]="'Caudal a declarar (L/s), medición ' + formatTs(s.ts)"
                      class="h-8 w-24 rounded-md border border-slate-200 bg-white px-2 font-mono text-caption-xs text-slate-800 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="1"
                      [value]="edit(s).totalizador"
                      (input)="setEdit(s, 'totalizador', $any($event.target).value)"
                      [attr.aria-label]="'Totalizador a declarar (m³), medición ' + formatTs(s.ts)"
                      class="h-8 w-32 rounded-md border border-slate-200 bg-white px-2 font-mono text-caption-xs text-slate-800 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input
                      type="number"
                      step="0.01"
                      [value]="edit(s).nivel"
                      (input)="setEdit(s, 'nivel', $any($event.target).value)"
                      [attr.aria-label]="
                        'Nivel freático a declarar (m), medición ' + formatTs(s.ts)
                      "
                      class="h-8 w-24 rounded-md border border-slate-200 bg-white px-2 font-mono text-caption-xs text-slate-800 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </td>
                  <td class="px-3 py-2 align-top">
                    <input
                      type="text"
                      [value]="edit(s).note"
                      (input)="setEdit(s, 'note', $any($event.target).value)"
                      maxlength="500"
                      placeholder="Motivo de la decisión (queda registrado)"
                      [attr.aria-label]="'Nota admin, medición ' + formatTs(s.ts)"
                      class="h-8 w-48 rounded-md border border-slate-200 bg-white px-2 text-caption-xs text-slate-800 outline-none placeholder:text-slate-500 focus:border-accent focus:ring-2 focus:ring-accent/20"
                    />
                  </td>
                  <td class="px-3 py-2 align-top space-y-1">
                    <button
                      type="button"
                      (click)="accept(s)"
                      [disabled]="acting() === slotKey(s)"
                      class="block w-full rounded-md bg-primary px-2 py-1 text-caption-xs font-bold text-white transition-colors hover:bg-primary-container focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-tint-40 active:scale-[0.98] disabled:opacity-50"
                    >
                      {{ acting() === slotKey(s) ? 'Enviando…' : 'Aceptar y enviar' }}
                    </button>
                    <button
                      type="button"
                      (click)="discard(s)"
                      [disabled]="acting() === slotKey(s)"
                      class="block w-full rounded-md border border-red-200 bg-white px-2 py-1 text-caption-xs font-bold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 active:scale-[0.98] disabled:opacity-50"
                    >
                      Descartar
                    </button>
                    @if (esFallaTotalizador(s)) {
                      <button
                        type="button"
                        (click)="reconocerSensor(s)"
                        [disabled]="acting() === slotKey(s)"
                        title="Marca el sensor como defectuoso (las mediciones futuras dejan de caer aquí y quedan con incidencia registrada), crea una incidencia pendiente en la bitácora del sitio y acepta las mediciones retenidas por esta falla."
                        class="block w-full rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-caption-xs font-bold text-amber-700 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200 active:scale-[0.98] disabled:opacity-50"
                      >
                        Reconocer sensor defectuoso
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
})
export class DgaReviewComponent {
  private readonly dga = inject(DgaService);

  slots = signal<DgaReviewSlot[]>([]);
  loading = signal<boolean>(false);
  error = signal<string>('');
  /** Mensaje informativo post-acción (ej. resultado de reconocer sensor). */
  codeMessage = signal<string>('');
  /** key del slot cuya acción está en vuelo (deshabilita botones). */
  acting = signal<string>('');

  /** Edits por slot (caudal/totalizador/nivel/nota). Map serializable. */
  private edits = signal<Record<string, RowEdit>>({});

  constructor() {
    this.reload();
  }

  slotKey(s: DgaReviewSlot): string {
    return `${s.site_id}::${s.ts}`;
  }

  warningLabel(code: string): string {
    return WARNING_LABELS[code] ?? code;
  }

  /** Formatea el ts UTC del slot como DD/MM/YYYY HH:MM hora de Chile. */
  private static readonly TS_FORMAT = new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  formatTs(ts: string): string {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const p = Object.fromEntries(
      DgaReviewComponent.TS_FORMAT.formatToParts(d).map((x) => [x.type, x.value]),
    );
    return `${p['day']}/${p['month']}/${p['year']} ${p['hour']}:${p['minute']}`;
  }

  /**
   * Lectura PURA del edit de un slot (sin efectos). Escribir un signal desde
   * un binding de template dispara change detection a mitad de render y
   * produce filas fantasma — la inicialización ocurre en initEdits() al
   * cargar la lista, nunca aquí.
   */
  edit(s: DgaReviewSlot): RowEdit {
    return this.edits()[this.slotKey(s)] ?? DgaReviewComponent.initialEdit(s);
  }

  /**
   * Normaliza al formato que EXIGE el envío a SNIA (Manual Técnico DGA,
   * mismo contrato que snia-client.ts): caudal y nivel con 2 decimales,
   * totalizador entero sin decimales. La DB entrega numerics con 3
   * decimales ("1775.000") — mostrar eso induce a declarar mal.
   */
  private static fmtDecimal2(v: string | null | undefined): string {
    if (v == null || v === '') return '';
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : '';
  }

  private static fmtEntero(v: string | number | null | undefined): string {
    if (v == null || v === '') return '';
    const n = Number(v);
    return Number.isFinite(n) ? String(Math.trunc(n)) : '';
  }

  private static initialEdit(s: DgaReviewSlot): RowEdit {
    // Valores actuales del slot o sugeridos por la validación, ya en el
    // formato exacto que se declarará a la DGA.
    const suggestedTot = s.validation_warnings.find(
      (w) => w.code === 'totalizator_zero',
    )?.suggested;
    return {
      caudal: DgaReviewComponent.fmtDecimal2(s.caudal_instantaneo),
      totalizador:
        s.flujo_acumulado != null && s.flujo_acumulado !== ''
          ? DgaReviewComponent.fmtEntero(s.flujo_acumulado)
          : DgaReviewComponent.fmtEntero(suggestedTot),
      nivel: DgaReviewComponent.fmtDecimal2(s.nivel_freatico),
      note: '',
    };
  }

  private initEdits(list: DgaReviewSlot[]): void {
    const map: Record<string, RowEdit> = {};
    for (const s of list) {
      map[this.slotKey(s)] = DgaReviewComponent.initialEdit(s);
    }
    this.edits.set(map);
  }

  setEdit(s: DgaReviewSlot, field: keyof RowEdit, value: string): void {
    const key = this.slotKey(s);
    this.edits.update((m) => ({
      ...m,
      [key]: { ...this.edit(s), [field]: value },
    }));
  }

  reload(): void {
    this.loading.set(true);
    this.error.set('');
    this.dga.listReviewQueue().subscribe({
      next: (list) => {
        this.slots.set(list);
        this.initEdits(list);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(this.friendlyError(err, 'No se pudo cargar la cola de revisión.'));
        this.loading.set(false);
      },
    });
  }

  /**
   * Maps backend errors to Spanish copy. Recognises common HTTP statuses;
   * falls back to the API-provided message only when it is a complete sentence
   * (starts uppercase, ends with punctuation), otherwise uses the generic
   * fallback so the user never sees something like "ECONNREFUSED 127.0.0.1".
   */
  private friendlyError(err: unknown, fallback: string): string {
    const e = err as {
      status?: number;
      error?: { error?: { message?: string; code?: string } };
      message?: string;
    };
    const apiMessage = e?.error?.error?.message;
    const status = e?.status;
    const errCode = (e as { error?: { code?: string } })?.error?.code;
    if (status === 0) return 'Sin conexión con el servidor. Revisa tu red y vuelve a intentar.';
    if (status === 401) return 'Sesión expirada. Inicia sesión nuevamente.';
    // 403 TWOFA_*: el interceptor ya orquestó el diálogo; llegar aquí = canceló.
    if (status === 403 && (errCode === 'TWOFA_REQUIRED' || errCode === 'TWOFA_INVALID')) {
      return 'Verificación 2FA cancelada. La acción no se aplicó.';
    }
    if (status === 403) return 'No tienes permisos para esta acción.';
    if (status === 404) return 'El recurso solicitado no existe.';
    if (status === 429) return 'Demasiados intentos. Espera unos segundos y vuelve a intentar.';
    if (status && status >= 500) return 'Error del servidor. Intenta nuevamente en unos minutos.';
    if (apiMessage && /^[A-ZÁÉÍÓÚÑ].*[.!?]$/.test(apiMessage)) return apiMessage;
    return fallback;
  }

  private numOrNull(s: string): number | null {
    const t = (s ?? '').trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  accept(s: DgaReviewSlot): void {
    const e = this.edit(s);
    if (!e.note.trim()) {
      this.error.set('Nota admin requerida para aceptar.');
      return;
    }
    const payload: DgaReviewActionPayload = {
      site_id: s.site_id,
      ts: s.ts,
      action: 'accept',
      values: {
        caudal_instantaneo: this.numOrNull(e.caudal),
        flujo_acumulado: this.numOrNull(e.totalizador),
        nivel_freatico: this.numOrNull(e.nivel),
      },
      admin_note: e.note.trim(),
    };
    this.executeAction(s, payload);
  }

  /** Códigos de anomalía atribuibles al totalizador (mismos que el backend). */
  private static readonly TOTALIZADOR_CODES = new Set([
    'sensor_frozen',
    'sensor_known_defective',
    'totalizator_zero',
  ]);

  esFallaTotalizador(s: DgaReviewSlot): boolean {
    return s.validation_warnings.some((w) =>
      DgaReviewComponent.TOTALIZADOR_CODES.has(w.code as string),
    );
  }

  /**
   * Reconoce el sensor totalizador del sitio como defectuoso. Usa la nota
   * admin de la fila como descripción (obligatoria: queda en la marca del
   * sensor, en la incidencia de bitácora y en los slots aceptados).
   */
  reconocerSensor(s: DgaReviewSlot): void {
    const nota = this.edit(s).note.trim();
    if (nota.length < 5) {
      this.error.set(
        'Escribe la nota admin (mín. 5 caracteres) — describe la falla o el recambio programado.',
      );
      return;
    }
    const key = this.slotKey(s);
    this.acting.set(key);
    this.error.set('');
    this.dga.reconocerSensorDefectuoso(s.site_id, nota).subscribe({
      next: (r) => {
        this.acting.set('');
        this.codeMessage.set(
          `Sensor reconocido: ${r.slots_aceptados} medición(es) aceptada(s) y enviándose; ` +
            `incidencia INC-${String(r.incidencia_id).padStart(4, '0')} abierta en la bitácora del sitio. ` +
            `Al reemplazar el equipo, quita la marca en la configuración del sensor.`,
        );
        this.reload();
      },
      error: (err) => {
        this.acting.set('');
        this.error.set(this.friendlyError(err, 'No se pudo reconocer el sensor.'));
      },
    });
  }

  discard(s: DgaReviewSlot): void {
    const e = this.edit(s);
    if (!e.note.trim()) {
      this.error.set('Nota admin requerida para descartar.');
      return;
    }
    const payload: DgaReviewActionPayload = {
      site_id: s.site_id,
      ts: s.ts,
      action: 'discard',
      admin_note: e.note.trim(),
    };
    this.executeAction(s, payload);
  }

  private executeAction(s: DgaReviewSlot, payload: DgaReviewActionPayload): void {
    const key = this.slotKey(s);
    this.acting.set(key);
    this.error.set('');
    this.dga.applyReviewDecision(payload).subscribe({
      next: () => {
        // Quita el slot de la lista localmente y limpia su edit.
        this.slots.update((list) => list.filter((x) => this.slotKey(x) !== key));
        this.edits.update((m) => {
          const copy = { ...m };
          delete copy[key];
          return copy;
        });
        this.acting.set('');
      },
      error: (err) => {
        this.acting.set('');
        this.error.set(this.friendlyError(err, 'No se pudo aplicar la acción.'));
      },
    });
  }
}
