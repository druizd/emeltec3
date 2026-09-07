import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DgaService,
  type DgaBulkSlotActionResult,
  type DgaSlotsResumen,
} from '../../../../services/dga.service';

type BulkAction = 'recalcular' | 'dar_de_baja';

/** Estados que la acción en bloque puede tocar. Debe calzar con el backend. */
const TOCABLES = new Set(['pendiente', 'requires_review', 'fallido']);

const ETIQUETA_ESTADO: Record<string, string> = {
  vacio: 'Vacío',
  pendiente: 'Pendiente',
  requires_review: 'Requiere revisión',
  enviando: 'Enviando',
  enviado: 'Enviado',
  rechazado: 'Rechazado',
  fallido: 'Fallido',
};

/**
 * Mantenimiento de slots DGA de un pozo: recalcular o dar de baja un rango.
 *
 * Existe porque hasta ahora estas dos cosas solo se podían hacer entrando a la
 * base. La pantalla de Revisión DGA actúa de a un slot y solo sobre los que
 * están en `requires_review`, así que quedaban dos huecos:
 *
 *   - Corregiste un mapeo (una unidad, un factor, un cut-off) y los slots ya
 *     materializados siguen con el valor viejo. No se recalculan solos.
 *   - Un slot pasó la validación pero su dato NO es declarable, así que nunca
 *     entró a la cola de revisión y no había forma de cerrarlo.
 *
 * El flujo es de dos pasos a propósito: primero "Revisar", que solo lee y
 * muestra qué hay en el rango, y recién con eso a la vista se habilitan las
 * acciones. Una acción de rango aplicada a ciegas sobre declaraciones DGA es
 * exactamente lo que no queremos.
 */
@Component({
  selector: 'app-dga-slots-mantenimiento',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section
      class="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
      aria-labelledby="mantenimiento-slots-titulo"
    >
      <div class="mb-3 flex items-start gap-3">
        <span
          class="material-symbols-outlined shrink-0 text-[20px] text-slate-400"
          aria-hidden="true"
          >build</span
        >
        <div class="min-w-0">
          <h3 id="mantenimiento-slots-titulo" class="text-body-sm font-semibold text-slate-900">
            Mantenimiento de slots
          </h3>
          <p class="text-caption text-slate-500">
            Recalcular vuelve a armar los slots con la configuración actual del mapeo — es lo que
            hay que hacer después de corregir una unidad o un factor. Dar de baja los cierra con una
            nota, para el dato que existe pero no es declarable.
            <strong>Nunca toca lo ya enviado a la DGA.</strong>
          </p>
        </div>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500" [attr.for]="'slots-desde'"
            >Desde (hora Chile, UTC−4)</label
          >
          <input
            id="slots-desde"
            type="datetime-local"
            [ngModel]="desde()"
            (ngModelChange)="onRangoChange('desde', $event)"
            name="slots-desde"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-body-sm text-slate-900 outline-none transition focus:border-primary focus:shadow-[0_0_0_3px_rgba(13,175,189,0.18)]"
          />
        </div>
        <div>
          <label class="mb-1 block text-caption font-bold text-slate-500" [attr.for]="'slots-hasta'"
            >Hasta (exclusivo)</label
          >
          <input
            id="slots-hasta"
            type="datetime-local"
            [ngModel]="hasta()"
            (ngModelChange)="onRangoChange('hasta', $event)"
            name="slots-hasta"
            class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-body-sm text-slate-900 outline-none transition focus:border-primary focus:shadow-[0_0_0_3px_rgba(13,175,189,0.18)]"
          />
        </div>
      </div>

      <div class="mt-3">
        <label class="mb-1 block text-caption font-bold text-slate-500" [attr.for]="'slots-nota'"
          >Motivo (queda en la auditoría)</label
        >
        <input
          id="slots-nota"
          [ngModel]="nota()"
          (ngModelChange)="nota.set($event)"
          name="slots-nota"
          maxlength="500"
          class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-body-sm text-slate-900 outline-none transition focus:border-primary focus:shadow-[0_0_0_3px_rgba(13,175,189,0.18)]"
          placeholder="Ej: corregida la unidad del caudal, m3/h declarado como L/s"
        />
        <p class="mt-1 text-caption-xs text-slate-500">
          Mínimo 5 caracteres. Es la única constancia de por qué este tramo se recalculó o no se
          declaró.
        </p>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          (click)="revisar()"
          [disabled]="!rangoValido() || busy() !== ''"
          [attr.aria-busy]="busy() === 'revisar'"
          class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-body-sm font-bold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
        >
          {{ busy() === 'revisar' ? 'Revisando…' : 'Revisar' }}
        </button>
      </div>

      @if (error()) {
        <p class="mt-3 text-caption font-semibold text-red-700" role="alert">{{ error() }}</p>
      }

      @if (resumen(); as r) {
        <div class="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p class="text-caption font-bold uppercase tracking-[0.1em] text-slate-500">
            En el rango: {{ r.total }} {{ r.total === 1 ? 'slot' : 'slots' }}
          </p>
          @if (r.total === 0) {
            <p class="mt-2 text-caption text-slate-600">
              No hay slots en ese rango. Revisá las fechas.
            </p>
          } @else {
            <ul class="mt-2 space-y-1">
              @for (e of r.estados; track e.estatus) {
                <li class="flex items-center justify-between gap-3 text-caption">
                  <span class="text-slate-700">
                    {{ etiquetaEstado(e.estatus) }}
                    @if (!esTocable(e.estatus)) {
                      <span class="font-semibold text-slate-500">— no se toca</span>
                    }
                  </span>
                  <span class="font-mono text-slate-900">{{ e.total }}</span>
                </li>
              }
            </ul>
            <p class="mt-2 text-caption font-semibold text-slate-700">
              Se van a afectar {{ tocables() }} {{ tocables() === 1 ? 'slot' : 'slots' }}.
            </p>
            @if (r.total > r.limite) {
              <p class="mt-1 text-caption text-amber-700">
                El rango supera el tope de {{ r.limite }} por operación: se procesan los más
                antiguos primero y hay que repetir.
              </p>
            }
          }
        </div>

        @if (tocables() > 0) {
          <div class="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              (click)="ejecutar('recalcular')"
              [disabled]="!puedeEjecutar()"
              [attr.aria-busy]="busy() === 'recalcular'"
              [attr.aria-label]="
                'Recalcular ' + tocables() + ' slots con la configuración actual del mapeo'
              "
              class="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-body-sm font-bold text-slate-600 transition hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55"
            >
              {{ busy() === 'recalcular' ? 'Recalculando…' : 'Recalcular' }}
            </button>
            <button
              type="button"
              (click)="ejecutar('dar_de_baja')"
              [disabled]="!puedeEjecutar()"
              [attr.aria-busy]="busy() === 'dar_de_baja'"
              [attr.aria-label]="
                'Dar de baja ' + tocables() + ' slots: quedan cerrados y no se declaran'
              "
              class="rounded-md bg-red-600 px-3 py-2 text-caption font-semibold text-white transition-colors hover:bg-red-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-55"
            >
              {{ busy() === 'dar_de_baja' ? 'Dando de baja…' : 'Dar de baja' }}
            </button>
          </div>
          @if (!notaValida()) {
            <p class="mt-2 text-caption text-slate-500">
              Escribí el motivo para habilitar las acciones.
            </p>
          }
        }
      }

      @if (resultado(); as res) {
        <div
          class="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3"
          role="alert"
          aria-labelledby="resultado-slots-titulo"
        >
          <p id="resultado-slots-titulo" class="text-caption font-bold text-emerald-800">
            {{ res.action === 'recalcular' ? 'Recalculados' : 'Dados de baja' }}:
            {{ res.afectados }} {{ res.afectados === 1 ? 'slot' : 'slots' }}
          </p>
          @if (res.action === 'recalcular') {
            <p class="mt-1 text-caption text-emerald-700">
              Quedaron en vacío. El worker los vuelve a llenar de a 24 por minuto, así que en unos
              minutos deberían estar todos con el valor nuevo.
            </p>
          }
          @if (noTocados(res) > 0) {
            <p class="mt-1 text-caption text-emerald-700">
              {{ noTocados(res) }} quedaron sin tocar por estar enviados o en envío.
            </p>
          }
        </div>
      }
    </section>
  `,
})
export class DgaSlotsMantenimientoComponent {
  siteId = input.required<string>();

  /** Avisa al padre para que refresque los KPI y la tabla del tab. */
  @Output() slotsChanged = new EventEmitter<void>();

  private dgaService = inject(DgaService);

  desde = signal('');
  hasta = signal('');
  nota = signal('');
  busy = signal('');
  error = signal('');
  resumen = signal<DgaSlotsResumen | null>(null);
  resultado = signal<DgaBulkSlotActionResult | null>(null);

  /** Slots del rango que la acción sí puede tocar. */
  tocables = computed(() =>
    (this.resumen()?.estados ?? [])
      .filter((e) => TOCABLES.has(e.estatus))
      .reduce((acc, e) => acc + e.total, 0),
  );

  notaValida = computed(() => this.nota().trim().length >= 5);
  rangoValido = computed(() => {
    const d = this.desde();
    const h = this.hasta();
    return Boolean(d && h && new Date(d) < new Date(h));
  });
  puedeEjecutar = computed(
    () => this.rangoValido() && this.notaValida() && this.busy() === '' && this.tocables() > 0,
  );

  etiquetaEstado(estatus: string): string {
    return ETIQUETA_ESTADO[estatus] ?? estatus;
  }

  esTocable(estatus: string): boolean {
    return TOCABLES.has(estatus);
  }

  /** Total del rango menos los efectivamente afectados. */
  noTocados(res: DgaBulkSlotActionResult): number {
    return res.antes.reduce((acc, e) => acc + e.total, 0) - res.afectados;
  }

  /**
   * Cambiar el rango invalida el resumen: dejarlo en pantalla habilitaría las
   * acciones con un conteo que ya no corresponde a las fechas de los inputs.
   */
  onRangoChange(campo: 'desde' | 'hasta', valor: string): void {
    if (campo === 'desde') this.desde.set(valor);
    else this.hasta.set(valor);
    this.resumen.set(null);
    this.resultado.set(null);
  }

  revisar(): void {
    if (!this.rangoValido()) return;
    this.busy.set('revisar');
    this.error.set('');
    this.resultado.set(null);
    this.dgaService.slotsResumen(this.siteId(), this.desdeIso(), this.hastaIso()).subscribe({
      next: (r) => {
        this.busy.set('');
        this.resumen.set(r);
      },
      error: (err: unknown) => {
        this.busy.set('');
        this.resumen.set(null);
        this.error.set(this.mensajeError(err, 'No fue posible leer el rango.'));
      },
    });
  }

  ejecutar(action: BulkAction): void {
    if (!this.puedeEjecutar()) return;
    this.busy.set(action);
    this.error.set('');
    this.dgaService
      .bulkSlotAction(this.siteId(), {
        action,
        desde: this.desdeIso(),
        hasta: this.hastaIso(),
        nota: this.nota().trim(),
      })
      .subscribe({
        next: (res) => {
          this.busy.set('');
          this.resultado.set(res);
          // El conteo anterior ya no vale: los slots cambiaron de estado.
          this.resumen.set(null);
          this.slotsChanged.emit();
        },
        error: (err: unknown) => {
          this.busy.set('');
          this.error.set(this.mensajeError(err, 'No fue posible aplicar la acción.'));
        },
      });
  }

  /**
   * `datetime-local` entrega hora de pared sin zona. La convención del proyecto
   * es UTC−4 fijo, así que se ancla explícitamente en vez de dejar que el
   * navegador use la zona del sistema — que en verano chileno es UTC−3 y
   * correría el rango una hora.
   */
  private desdeIso(): string {
    return `${this.desde()}:00-04:00`;
  }
  private hastaIso(): string {
    return `${this.hasta()}:00-04:00`;
  }

  private mensajeError(err: unknown, fallback: string): string {
    const e = err as { error?: { message?: string; error?: string }; message?: string };
    return e?.error?.message || e?.error?.error || e?.message || fallback;
  }
}
