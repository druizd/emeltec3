import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { AuthService } from '../../../../services/auth.service';
import { FormsModule } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import {
  AlertaCondicion,
  AlertaDia,
  AlertaRow,
  AlertaService,
  AlertaSeveridad,
  CONDICION_LABELS,
  CreateAlertaPayload,
  DIAS_ORDEN,
  DIAS_SHORT,
  SEVERIDAD_LABELS,
  UpdateAlertaPayload,
} from '../../../../services/alerta.service';
import { AdministrationService } from '../../../../services/administration.service';
import {
  CompanyService,
  CONTADOR_ROLES,
  type ContadorDiarioPoint,
  type ContadorRol,
  type TelemetryHistoryRow,
} from '../../../../services/company.service';
import type { VariableMapping } from '@emeltec/shared';
import { InlineErrorComponent } from '../../../../components/ui/inline-error';
import { TableSkeletonComponent } from '../../../../components/ui/table-skeleton';

interface SimulationResultRow {
  timestamp: string;
  value: number | null;
  raw: unknown;
  matched: boolean;
}

interface SimulationSummary {
  total: number;
  matched: number;
  rows: SimulationResultRow[];
  withValueCount: number;
}

/**
 * Los inputs de umbral son `type="number"`, así que el value accessor de
 * Angular escribe `number` cuando hay valor y `null` cuando el campo queda
 * vacío — nunca `''`. El draft acepta los tres para no mentir sobre lo que
 * realmente llega desde el template.
 */
type UmbralValue = string | number | null;

function umbralVacio(v: UmbralValue): boolean {
  return v === '' || v === null || v === undefined;
}

interface DraftAlerta {
  nombre: string;
  descripcion: string;
  variable_key: string;
  condicion: AlertaCondicion;
  umbral_bajo: UmbralValue;
  umbral_alto: UmbralValue;
  severidad: AlertaSeveridad;
  cooldown_minutos: number;
  dias_activos: AlertaDia[];
  visible_to_all: boolean;
}

const CONDICIONES_DISPONIBLES: AlertaCondicion[] = [
  'mayor_que',
  'menor_que',
  'igual_a',
  'fuera_rango',
  'consumo_diario',
  'sin_datos',
  'dga_atrasado',
];

/**
 * Condiciones cuyo umbral se compara contra un valor YA transformado por el
 * reg_map (unidades de ingeniería), en vez del valor crudo del payload.
 */
const CONDICIONES_EN_UNIDAD_REAL: AlertaCondicion[] = ['consumo_diario'];

const SEVERIDADES_DISPONIBLES: AlertaSeveridad[] = ['baja', 'media', 'alta', 'critica'];

function emptyDraft(): DraftAlerta {
  return {
    nombre: '',
    descripcion: '',
    variable_key: '',
    condicion: 'mayor_que',
    umbral_bajo: '',
    umbral_alto: '',
    severidad: 'media',
    cooldown_minutos: 5,
    dias_activos: [...DIAS_ORDEN],
    visible_to_all: true,
  };
}

function rowToDraft(r: AlertaRow): DraftAlerta {
  return {
    nombre: r.nombre,
    descripcion: r.descripcion ?? '',
    variable_key: r.variable_key,
    condicion: r.condicion,
    umbral_bajo: r.umbral_bajo === null ? '' : String(r.umbral_bajo),
    umbral_alto: r.umbral_alto === null ? '' : String(r.umbral_alto),
    severidad: r.severidad,
    cooldown_minutos: r.cooldown_minutos,
    dias_activos: [...r.dias_activos],
    visible_to_all: r.visible_to_all !== false,
  };
}

@Component({
  selector: 'app-alertas-configuracion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, A11yModule, InlineErrorComponent, TableSkeletonComponent],
  template: `
    <div class="space-y-3">
      <!-- Header -->
      <div class="flex items-center justify-between gap-3">
        <p class="text-caption-xs font-semibold text-slate-500">
          {{ reglas().length }}
          {{ reglas().length === 1 ? 'regla configurada' : 'reglas configuradas' }}
        </p>
        @if (canEdit()) {
          <button
            type="button"
            (click)="toggleNuevo()"
            class="inline-flex items-center gap-1.5 rounded-xl border border-primary-tint-25 bg-primary-tint-08 px-3 py-2 text-caption font-bold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-[0.98]"
          >
            <span class="material-symbols-outlined text-[16px]" aria-hidden="true">{{
              mostrandoNuevo() ? 'close' : 'add'
            }}</span>
            {{ mostrandoNuevo() ? 'Cancelar' : 'Nueva regla' }}
          </button>
        }
      </div>

      <!-- Loading / error -->
      @if (loading()) {
        <app-table-skeleton [rows]="4" [columns]="4" [showHeader]="false" />
      }
      @if (errorMsg()) {
        <app-inline-error [message]="errorMsg()" />
      }

      <!-- Modal nueva regla -->
      @if (mostrandoNuevo()) {
        <div
          class="anim-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
          animate.leave="anim-overlay-out"
          role="dialog"
          cdkTrapFocus
          cdkTrapFocusAutoCapture
          aria-modal="true"
          aria-labelledby="nueva-alerta-title"
          (click)="onBackdrop($event)"
          (keydown.escape)="toggleNuevo()"
        >
          <div
            class="anim-panel relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            (click)="$event.stopPropagation()"
          >
            <!-- Header -->
            <div
              class="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4"
            >
              <div class="flex items-center gap-3">
                <span
                  class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-tint-08 text-primary-container"
                >
                  <span class="material-symbols-outlined text-[20px]">add_alert</span>
                </span>
                <h2 id="nueva-alerta-title" class="text-h6 font-semibold text-slate-800">
                  Nueva regla de alerta
                </h2>
              </div>
              <button
                type="button"
                (click)="toggleNuevo()"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-95"
                aria-label="Cerrar"
              >
                <span class="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
              </button>
            </div>

            <!-- Body -->
            <div class="flex-1 overflow-y-auto px-5 py-5">
              <ng-container
                *ngTemplateOutlet="reglaForm; context: { $implicit: nuevaRegla, isNew: true }"
              ></ng-container>
            </div>

            <!-- Footer -->
            <div
              class="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-4"
            >
              <button
                type="button"
                (click)="toggleNuevo()"
                class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-[0.98]"
              >
                Cancelar
              </button>
              <button
                type="button"
                [disabled]="saving() || !puedeGuardar(nuevaRegla)"
                (click)="guardarNueva()"
                class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span class="material-symbols-outlined text-[16px]" aria-hidden="true">check</span>
                Crear regla
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Lista de reglas existentes -->
      @for (regla of reglas(); track regla.id) {
        <article
          class="overflow-hidden rounded-2xl border shadow-sm transition duration-200"
          [class]="
            regla.activa
              ? 'border-slate-200 bg-white hover:shadow-md'
              : 'border-slate-200/70 bg-slate-50'
          "
        >
          <div class="flex items-stretch">
            <!-- Rail de severidad: prioridad legible a un vistazo, sin leer texto -->
            <span
              aria-hidden="true"
              class="w-1 shrink-0"
              [class]="regla.activa ? severidadRailClass(regla.severidad) : 'bg-slate-300'"
            ></span>

            <div class="min-w-0 flex-1">
              <div class="flex items-start justify-between gap-3 px-4 py-3.5">
                <div class="flex min-w-0 items-start gap-3">
                  @if (canEdit()) {
                    <!-- Switch 44x24 con knob de 20px y 2px de aire a cada
                         lado: translate-x-5 (20px) lo deja simétrico en ambos
                         extremos. Antes el knob no declaraba left, así que
                         caía en su posición estática y se montaba sobre el
                         borde derecho. -->
                    <button
                      type="button"
                      (click)="toggleActiva(regla)"
                      [class]="regla.activa ? 'bg-primary' : 'bg-slate-300 hover:bg-slate-400'"
                      class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-tint-55 focus-visible:ring-offset-2 active:scale-95"
                      [attr.aria-label]="
                        regla.activa ? 'Desactivar regla' : 'Activar regla'
                      "
                      [attr.aria-pressed]="regla.activa"
                    >
                      <span
                        [class]="regla.activa ? 'translate-x-5' : 'translate-x-0'"
                        class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200"
                      ></span>
                    </button>
                  }
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <p
                        class="truncate font-semibold"
                        [class]="regla.activa ? 'text-slate-800' : 'text-slate-500'"
                      >
                        {{ regla.nombre }}
                      </p>
                      <span
                        class="inline-block rounded-full px-2 py-0.5 text-caption-xs font-bold"
                        [class]="severidadBadgeClass(regla.severidad)"
                      >
                        {{ severidadLabel(regla.severidad) }}
                      </span>
                      @if (!regla.activa) {
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-caption-xs font-bold text-slate-600"
                        >
                          <span class="material-symbols-outlined text-[12px]" aria-hidden="true"
                            >pause</span
                          >
                          Pausada
                        </span>
                      }
                    </div>

                    <!-- Variable (alias del reg_map) + condición -->
                    <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      @if (regla.condicion !== 'dga_atrasado') {
                        <span
                          class="text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                          [title]="regla.variable_key"
                        >
                          {{ aliasVariable(regla.variable_key) }}
                        </span>
                      }
                      <span
                        class="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-caption-xs font-bold text-slate-700"
                      >
                        {{ condicionResumen(regla) }}
                      </span>
                      <!-- Con el reg_map visible abajo ("… · m3"), un umbral
                           sin unidad se lee como si fuera esa unidad. Cuando
                           la variable tiene transformación, el worker compara
                           el valor crudo: hay que decirlo. -->
                      @if (requiereValorCrudo(regla.variable_key, regla.condicion)) {
                        <span
                          class="rounded-md bg-amber-50 px-1.5 py-0.5 text-caption-xs font-semibold text-amber-700"
                          title="El umbral se compara contra el valor crudo del payload, no contra la unidad del reg_map"
                        >
                          valor crudo
                        </span>
                      }
                    </div>

                    @if (regla.descripcion) {
                      <p class="mt-1 truncate text-caption-xs text-slate-500">
                        {{ regla.descripcion }}
                      </p>
                    }
                  </div>
                </div>
                @if (canEdit()) {
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      (click)="expandirRegla(regla.id)"
                      class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-95"
                      [attr.aria-label]="reglaExpandida() === regla.id ? 'Colapsar' : 'Editar'"
                      [attr.aria-pressed]="reglaExpandida() === regla.id"
                    >
                      <span class="material-symbols-outlined text-[18px]" aria-hidden="true">{{
                        reglaExpandida() === regla.id ? 'expand_less' : 'edit'
                      }}</span>
                    </button>
                    <button
                      type="button"
                      (click)="eliminar(regla)"
                      class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-95"
                      aria-label="Eliminar regla"
                    >
                      <span class="material-symbols-outlined text-[18px]" aria-hidden="true"
                        >delete</span
                      >
                    </button>
                  </div>
                }
              </div>

              @if (reglaExpandida() !== regla.id) {
                <div
                  class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-4 py-2.5"
                >
                  <span class="flex items-center gap-1 text-caption-xs text-slate-500">
                    <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                      >calendar_today</span
                    >
                    {{ diasResumen(regla.dias_activos) }}
                  </span>
                  <span class="flex items-center gap-1 text-caption-xs text-slate-500">
                    <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                      >schedule</span
                    >
                    cooldown {{ regla.cooldown_minutos }} min
                  </span>
                  @if (regla.variable_key && regla.condicion !== 'dga_atrasado') {
                    <!-- La clave cruda sigue visible: es la que compara el worker.
                         Si no está en el reg_map del sitio, se avisa. -->
                    @if (isVariableRegistrada(regla.variable_key)) {
                      <span
                        class="flex items-center gap-1 text-caption-xs text-slate-500"
                        [title]="
                          'Variable del reg_map · rol ' + (rolVariable(regla.variable_key) || '—')
                        "
                      >
                        <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                          >data_object</span
                        >
                        <span class="font-semibold">{{ aliasVariable(regla.variable_key) }}</span>
                        <span class="font-mono text-slate-400">{{ regla.variable_key }}</span>
                        @if (unidadRegMap(regla.variable_key); as u) {
                          <span class="font-mono text-slate-400">· {{ u }}</span>
                        }
                      </span>
                    } @else {
                      <span
                        class="flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-mono text-caption-xs text-amber-700"
                        title="La variable no está registrada en el reg_map del sitio"
                      >
                        <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                          >warning</span
                        >
                        {{ regla.variable_key }} · sin mapeo
                      </span>
                    }
                  }
                  @if (!regla.visible_to_all) {
                    <span
                      class="flex items-center gap-1 text-caption-xs text-slate-500"
                      title="Solo visible para usuarios designados"
                    >
                      <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                        >visibility_off</span
                      >
                      Restringida
                    </span>
                  }
                </div>
              }

          @if (reglaExpandida() === regla.id && drafts()[regla.id]) {
            <div class="space-y-4 border-t border-slate-100 px-5 py-4">
              <ng-container
                *ngTemplateOutlet="
                  reglaForm;
                  context: { $implicit: drafts()[regla.id]!, isNew: false }
                "
              ></ng-container>
              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  (click)="cancelarEdicion(regla)"
                  class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-[0.98]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  [disabled]="saving() || !puedeGuardar(drafts()[regla.id]!)"
                  (click)="guardarEdicion(regla)"
                  class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span class="material-symbols-outlined text-[16px]" aria-hidden="true"
                    >check</span
                  >
                  Guardar
                </button>
              </div>
            </div>
          }
            </div>
          </div>
        </article>
      } @empty {
        @if (!loading()) {
          <p class="rounded-xl bg-slate-50 px-4 py-6 text-center text-caption text-slate-500">
            No hay reglas configuradas para este sitio. Crea una con el botón "Nueva regla".
          </p>
        }
      }
    </div>

    <!-- Template del formulario reusable -->
    <ng-template #reglaForm let-draft let-isNew="isNew">
      <div class="space-y-5">
        <!-- ── Identificación ── -->
        <section class="space-y-3">
          <p class="flex items-center gap-2 text-body-sm font-semibold text-slate-700">
            <span
              class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary-tint-08 text-primary-container"
            >
              <span class="material-symbols-outlined text-[15px]">badge</span>
            </span>
            Identificación
          </p>
          <!-- Nombre -->
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Nombre</label
            >
            <input
              type="text"
              [(ngModel)]="draft.nombre"
              placeholder="Ej: Nivel freático crítico"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
            />
          </div>

          <!-- Descripción -->
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Descripción (opcional)</label
            >
            <input
              type="text"
              [(ngModel)]="draft.descripcion"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
            />
          </div>
        </section>

        <!-- ── Condición de disparo ── -->
        <section class="space-y-3 border-t border-slate-100 pt-5">
          <p class="flex items-center gap-2 text-body-sm font-semibold text-slate-700">
            <span
              class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary-tint-08 text-primary-container"
            >
              <span class="material-symbols-outlined text-[15px]">rule</span>
            </span>
            Condición de disparo
          </p>
          <!-- Condición -->
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Condición</label
            >
            <select
              [(ngModel)]="draft.condicion"
              (ngModelChange)="resetSimulacion()"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm font-bold text-slate-700 focus:border-primary-tint-55 focus:outline-none"
            >
              @for (c of condicionesDisponibles; track c) {
                <option [value]="c">{{ condicionLabel(c) }}</option>
              }
            </select>
          </div>

          <!-- Variable (ocultar para dga_atrasado) -->
          @if (draft.condicion !== 'dga_atrasado') {
            <div>
              <label
                class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Variable</label
              >
              @if (variablesParaCondicion(draft.condicion).length > 0) {
                <select
                  [(ngModel)]="draft.variable_key"
                  (ngModelChange)="resetSimulacion()"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                >
                  <option value="" disabled>Selecciona una variable…</option>
                  @for (v of variablesParaCondicion(draft.condicion); track v.id) {
                    <option [value]="v.d1">
                      {{ v.alias }} ({{ v.d1 }}){{ v.unidad ? ' · ' + v.unidad : '' }}
                    </option>
                  }
                </select>
                @if (draft.condicion === 'consumo_diario') {
                  <p class="mt-1 text-caption-xs text-slate-500">
                    Solo se listan contadores acumulables (totalizador, energía, volumen).
                  </p>
                }
                @if (draft.variable_key && !isVariableRegistrada(draft.variable_key)) {
                  <p class="mt-1 flex items-center gap-1 text-caption-xs text-amber-600">
                    <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                      >warning</span
                    >
                    "{{ draft.variable_key }}" no está en las variables registradas del sitio.
                  </p>
                }
                @if (requiereValorCrudo(draft.variable_key, draft.condicion)) {
                  <p
                    class="mt-1.5 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-caption-xs text-amber-800"
                  >
                    <span class="material-symbols-outlined mt-px text-[14px]" aria-hidden="true"
                      >info</span
                    >
                    <span>
                      Esta variable tiene transformación
                      <span class="font-mono">{{ transformacionVariable(draft.variable_key) }}</span
                      >. La alerta compara el <strong>valor crudo del payload</strong>, no el valor
                      convertido que muestra el dashboard. Usa "Probar regla" para ver el rango real
                      antes de fijar el umbral.
                    </span>
                  </p>
                }
              } @else if (draft.condicion === 'consumo_diario') {
                <p
                  class="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-caption-xs text-amber-800"
                >
                  <span class="material-symbols-outlined mt-px text-[14px]" aria-hidden="true"
                    >warning</span
                  >
                  <span>
                    Este sitio no tiene ninguna variable con rol de contador acumulable
                    (totalizador, energía o volumen) en su reg_map. Sin eso no hay consumo diario
                    que medir — asigna el rol en la configuración de variables del sitio.
                  </span>
                </p>
              } @else {
                <input
                  type="text"
                  [(ngModel)]="draft.variable_key"
                  (ngModelChange)="resetSimulacion()"
                  placeholder="Ej: caudal, nivel_freatico"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                />
                <p class="mt-1 text-caption-xs text-slate-500">
                  Sin variables registradas en el sitio; ingresa la clave manualmente.
                </p>
              }
            </div>
          }

          <!-- Umbrales (según condición) -->
          @if (
            draft.condicion === 'mayor_que' ||
            draft.condicion === 'menor_que' ||
            draft.condicion === 'igual_a' ||
            draft.condicion === 'consumo_diario'
          ) {
            <div>
              <label
                class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >
                {{ draft.condicion === 'consumo_diario' ? 'Consumo máximo del día' : 'Umbral' }}
              </label>
              <div class="relative">
                <input
                  type="number"
                  step="any"
                  [(ngModel)]="draft.umbral_bajo"
                  (ngModelChange)="resetSimulacion()"
                  (wheel)="onWheelNumber($event)"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                  [class.pr-12]="unidadVariable(draft.variable_key, draft.condicion)"
                />
                @if (unidadVariable(draft.variable_key, draft.condicion); as u) {
                  <span
                    class="pointer-events-none absolute inset-y-0 right-3 flex items-center font-mono text-caption-xs text-slate-400"
                    >{{ u }}</span
                  >
                }
              </div>
              @if (draft.condicion === 'consumo_diario') {
                <p class="mt-1 text-caption-xs text-slate-500">
                  Diferencia acumulada del totalizador dentro del día (00:00–23:59, hora de Chile).
                  Se evalúa durante el día, no al cierre.
                </p>
              }
            </div>
          }
          @if (draft.condicion === 'fuera_rango') {
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label
                  class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >Mínimo</label
                >
                <input
                  type="number"
                  step="any"
                  [(ngModel)]="draft.umbral_bajo"
                  (ngModelChange)="resetSimulacion()"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                />
              </div>
              <div>
                <label
                  class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >Máximo</label
                >
                <input
                  type="number"
                  step="any"
                  [(ngModel)]="draft.umbral_alto"
                  (ngModelChange)="resetSimulacion()"
                  (wheel)="onWheelNumber($event)"
                  class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
                />
              </div>
            </div>
          }

          <!-- Nota especial dga_atrasado -->
          @if (draft.condicion === 'dga_atrasado') {
            <div
              class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-caption text-amber-800"
            >
              <p class="mb-1 font-bold">Escalación automática</p>
              <p>
                El sistema notifica al cruzar 24h, 48h y 72h sin reporte DGA (severidades media →
                alta → crítica). No requiere umbral ni variable. Aplica al informante DGA del sitio.
              </p>
            </div>
          }

          <!-- Severidad (solo si no es dga_atrasado — DGA computa por tier) -->
          @if (draft.condicion !== 'dga_atrasado') {
            <div>
              <label
                class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                >Severidad</label
              >
              <div class="flex flex-wrap gap-1.5">
                @for (s of severidadesDisponibles; track s) {
                  <button
                    type="button"
                    (click)="draft.severidad = s"
                    [attr.aria-pressed]="draft.severidad === s"
                    [class]="
                      draft.severidad === s
                        ? severidadButtonActive(s)
                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    "
                    class="rounded-full px-3 py-1 text-caption-xs font-bold transition-colors active:scale-95"
                  >
                    {{ severidadLabel(s) }}
                  </button>
                }
              </div>
            </div>
          }
        </section>

        <!-- ── Programación ── -->
        <section class="space-y-3 border-t border-slate-100 pt-5">
          <p class="flex items-center gap-2 text-body-sm font-semibold text-slate-700">
            <span
              class="flex h-6 w-6 items-center justify-center rounded-lg bg-primary-tint-08 text-primary-container"
            >
              <span class="material-symbols-outlined text-[15px]">schedule</span>
            </span>
            Programación
          </p>
          <!-- Cooldown -->
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Cooldown (minutos)</label
            >
            <input
              type="number"
              min="1"
              max="1440"
              [(ngModel)]="draft.cooldown_minutos"
              (wheel)="onWheelNumber($event)"
              class="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
            />
            <span class="ml-2 text-caption-xs text-slate-500"
              >tiempo mínimo entre notificaciones</span
            >
          </div>

          <!-- Días activos -->
          <div>
            <p class="mb-2 text-caption-xs font-semibold uppercase tracking-widest text-slate-400">
              Días activos
            </p>
            <div class="flex flex-wrap gap-1.5">
              @for (d of diasOrden; track d) {
                <button
                  type="button"
                  (click)="toggleDia(draft, d)"
                  [attr.aria-pressed]="draft.dias_activos.includes(d)"
                  [class]="
                    draft.dias_activos.includes(d)
                      ? 'bg-primary text-white'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  "
                  class="h-8 min-w-[2rem] rounded-lg px-2 text-caption-xs font-semibold transition-colors active:scale-95"
                >
                  {{ diaShort(d) }}
                </button>
              }
            </div>
          </div>
        </section>

        <!-- Vista previa con datos reales (rule-tester) -->
        @if (esCondicionSimulable(draft.condicion)) {
          <section
            class="space-y-3 rounded-2xl border border-primary-tint-25 bg-primary-tint-08/30 px-4 py-3"
          >
            <header class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="material-symbols-outlined text-[18px] text-primary-container"
                  >science</span
                >
                <p
                  class="text-caption-xs font-semibold uppercase tracking-widest text-primary-container"
                >
                  Vista previa con datos reales
                </p>
              </div>
              <button
                type="button"
                (click)="simularRegla(draft)"
                [disabled]="simulating() || !puedeSimular(draft)"
                class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-caption-xs font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 sm:h-8"
              >
                <span
                  class="material-symbols-outlined text-[14px]"
                  [class.animate-spin]="simulating()"
                  aria-hidden="true"
                  >{{ simulating() ? 'progress_activity' : 'play_circle' }}</span
                >
                {{ simulating() ? 'Probando…' : 'Probar regla' }}
              </button>
            </header>
            <p class="text-caption-xs text-on-surface-variant">
              @if (draft.condicion === 'consumo_diario') {
                Evalúa el umbral contra el consumo real de cada uno de los últimos 30 días.
              } @else {
                Evalúa la condición contra las últimas 500 lecturas crudas del equipo (24 h).
              }
              Read-only — no guarda nada ni dispara notificaciones.
            </p>
            @if (simulationError()) {
              <app-inline-error [message]="simulationError()" />
            }
            @if (simulationSummary(); as sim) {
              <div class="flex flex-wrap items-center gap-3 text-caption-xs">
                <span
                  class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-bold"
                  [class]="
                    sim.matched > 0
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-emerald-100 text-emerald-700'
                  "
                >
                  <span class="material-symbols-outlined text-[14px]" aria-hidden="true">{{
                    sim.matched > 0 ? 'notifications_active' : 'check_circle'
                  }}</span>
                  @if (draft.condicion === 'consumo_diario') {
                    {{ sim.matched }} {{ sim.matched === 1 ? 'día' : 'días' }} de
                    {{ sim.total }}
                  } @else {
                    {{ sim.matched }}
                    {{ sim.matched === 1 ? 'match' : 'matches' }} en {{ sim.total }} lecturas
                  }
                </span>
                @if (draft.condicion === 'consumo_diario') {
                  <span class="text-on-surface-variant">
                    {{ sim.withValueCount }} días con dato
                  </span>
                } @else if (draft.condicion !== 'sin_datos') {
                  <span class="text-on-surface-variant">
                    {{ sim.withValueCount }} con valor numérico
                  </span>
                }
              </div>
              @if (sim.rows.length > 0) {
                <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table class="w-full text-caption-xs">
                    <thead class="bg-slate-50 text-on-surface-muted">
                      <tr>
                        <th class="px-3 py-2 text-left font-semibold uppercase tracking-wider">
                          {{ draft.condicion === 'consumo_diario' ? 'Día' : 'Fecha' }}
                        </th>
                        <th class="px-3 py-2 text-right font-semibold uppercase tracking-wider">
                          {{ draft.condicion === 'consumo_diario' ? 'Consumo' : 'Valor' }}
                        </th>
                        <th class="px-3 py-2 text-right font-semibold uppercase tracking-wider">
                          Resultado
                        </th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
                      @for (row of sim.rows; track row.timestamp) {
                        <tr>
                          <td class="px-3 py-2 font-mono text-slate-600">
                            @if (draft.condicion === 'consumo_diario') {
                              {{ formatSimulationDay(row.timestamp) }}
                            } @else {
                              {{ formatSimulationTime(row.timestamp) }}
                            }
                          </td>
                          <td class="px-3 py-2 text-right font-mono font-bold text-slate-800">
                            @if (row.value !== null) {
                              {{ row.value }}
                              <span class="font-normal text-slate-400">{{
                                unidadVariable(draft.variable_key, draft.condicion)
                              }}</span>
                            } @else {
                              <span class="text-on-surface-variant italic">sin dato</span>
                            }
                          </td>
                          <td class="px-3 py-2 text-right">
                            <span
                              class="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 font-bold text-rose-700"
                            >
                              <span class="material-symbols-outlined text-[12px]" aria-hidden="true"
                                >warning</span
                              >
                              dispara
                            </span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                  @if (sim.matched > sim.rows.length) {
                    <p class="bg-slate-50 px-3 py-2 text-caption-xs text-on-surface-variant">
                      Mostrando los primeros {{ sim.rows.length }} matches de {{ sim.matched }} en
                      total.
                    </p>
                  }
                </div>
              } @else {
                <p
                  class="rounded-xl bg-emerald-50 px-4 py-3 text-caption text-emerald-700"
                  role="status"
                >
                  @if (draft.condicion === 'consumo_diario') {
                    Ninguno de los últimos {{ sim.total }} días superó el umbral. Listo para
                    activar.
                  } @else {
                    La regla no habría disparado contra las últimas {{ sim.total }} lecturas. Listo
                    para activar.
                  }
                </p>
              }
            }
          </section>
        }
      </div>
    </ng-template>
  `,
})
export class AlertasConfiguracionComponent {
  private readonly alertaService = inject(AlertaService);
  private readonly adminService = inject(AdministrationService);
  private readonly companyService = inject(CompanyService);
  private readonly auth = inject(AuthService);

  // Solo Admin/Gerente (+ SuperAdmin) crean/editan/borran alarmas.
  readonly canEdit = computed(
    () => this.auth.isSuperAdmin() || this.auth.isAdmin() || this.auth.isGerente(),
  );

  /** Rule-tester state. Una sola simulación activa a la vez — el draft
   * que está siendo testeado se identifica por su `variable_key` + `condicion`.
   * Se resetea cuando el draft cambia o el panel se cierra. */
  readonly simulating = signal(false);
  readonly simulationSummary = signal<SimulationSummary | null>(null);
  readonly simulationError = signal('');

  readonly sitioId = input<string>('');
  readonly empresaId = input<string>('');

  readonly condicionesDisponibles = CONDICIONES_DISPONIBLES;
  readonly severidadesDisponibles = SEVERIDADES_DISPONIBLES;
  readonly diasOrden = DIAS_ORDEN;

  readonly reglas = signal<AlertaRow[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly reglaExpandida = signal<number | null>(null);
  readonly mostrandoNuevo = signal(false);
  readonly drafts = signal<Record<number, DraftAlerta>>({});

  // Variables registradas del sitio (reg_map). El worker compara
  // data[variable_key] del payload crudo, asi que el value usado es `d1`.
  readonly variables = signal<VariableMapping[]>([]);

  /** Serial del equipo del sitio. Lo necesita el rule-tester para pedir la
   * telemetría cruda; llega en la misma respuesta de `getSiteVariables`. */
  readonly idSerial = signal('');

  nuevaRegla: DraftAlerta = emptyDraft();

  constructor() {
    effect(() => {
      const sid = this.sitioId();
      if (sid) {
        this.recargar();
        this.cargarVariables();
      }
    });
  }

  private cargarVariables(): void {
    const sid = this.sitioId();
    if (!sid) return;
    this.adminService.getSiteVariables(sid).subscribe({
      next: (res) => {
        if (!res.ok) return;
        this.variables.set(res.data.mappings ?? []);
        this.idSerial.set(res.data.site?.id_serial ?? '');
      },
      error: () => {
        // No bloqueante: el input cae a texto libre. Sin serial, el
        // rule-tester queda deshabilitado en vez de fallar en silencio.
        this.variables.set([]);
        this.idSerial.set('');
      },
    });
  }

  private recargar(): void {
    const sid = this.sitioId();
    if (!sid) return;
    this.loading.set(true);
    this.errorMsg.set(null);
    this.alertaService.listar({ sitio_id: sid }).subscribe({
      next: (rows) => {
        this.reglas.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'Error cargando reglas');
        this.loading.set(false);
      },
    });
  }

  toggleNuevo(): void {
    if (this.mostrandoNuevo()) {
      this.mostrandoNuevo.set(false);
      this.nuevaRegla = emptyDraft();
    } else {
      this.nuevaRegla = emptyDraft();
      this.mostrandoNuevo.set(true);
    }
  }

  /** Cierra el modal solo si el click cae en el backdrop, no en el panel. */
  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.toggleNuevo();
  }

  expandirRegla(id: number): void {
    if (this.reglaExpandida() === id) {
      this.reglaExpandida.set(null);
      return;
    }
    const row = this.reglas().find((r) => r.id === id);
    if (!row) return;
    this.drafts.update((d) => ({ ...d, [id]: rowToDraft(row) }));
    this.reglaExpandida.set(id);
  }

  cancelarEdicion(regla: AlertaRow): void {
    this.reglaExpandida.set(null);
    this.drafts.update((d) => {
      const next = { ...d };
      delete next[regla.id];
      return next;
    });
  }

  toggleDia(draft: DraftAlerta, dia: AlertaDia): void {
    const idx = draft.dias_activos.indexOf(dia);
    if (idx >= 0) draft.dias_activos.splice(idx, 1);
    else draft.dias_activos.push(dia);
  }

  // ─── reg_map lookup ─────────────────────────────────────────────────
  // Las reglas guardan la clave cruda del payload (`d1`), que es lo que
  // compara el worker. Para mostrarla usamos el reg_map del sitio cuando
  // existe: alias + unidad son lo que el operador reconoce.

  mappingDe(key: string): VariableMapping | undefined {
    if (!key) return undefined;
    return this.variables().find((v) => v.d1 === key);
  }

  isVariableRegistrada(key: string): boolean {
    return !!this.mappingDe(key);
  }

  /** Alias del reg_map, o la clave cruda si la variable no está mapeada. */
  aliasVariable(key: string): string {
    return this.mappingDe(key)?.alias?.trim() || key;
  }

  /**
   * `true` cuando el reg_map define una transformación para la variable. En
   * ese caso el valor del payload NO está en la unidad declarada: el worker
   * compara `equipo.data[d1]` CRUDO, sin transformar. Ej. AI23 llega como 264
   * y el dashboard lo muestra como 26,4 m — un umbral "4" se compara contra
   * 264, no contra 26,4.
   */
  requiereValorCrudo(key: string, condicion: AlertaCondicion): boolean {
    // `consumo_diario` compara contra el delta ya transformado, así que su
    // umbral SÍ va en la unidad del reg_map.
    if (CONDICIONES_EN_UNIDAD_REAL.includes(condicion)) return false;
    const t = (this.mappingDe(key)?.transformacion ?? 'directo').trim().toLowerCase();
    return t !== '' && t !== 'directo';
  }

  /**
   * `consumo_diario` solo tiene sentido sobre variables que el módulo de
   * contadores sabe acumular (rol_dashboard ∈ totalizador/energia/volumen).
   * El delta de un nivel o un caudal no representa un consumo.
   */
  rolContadorDe(key: string): ContadorRol | null {
    const rol = this.mappingDe(key)?.rol_dashboard?.trim().toLowerCase();
    return CONTADOR_ROLES.includes(rol as ContadorRol) ? (rol as ContadorRol) : null;
  }

  /** Variables del sitio elegibles para la condición seleccionada. */
  variablesParaCondicion(condicion: AlertaCondicion): VariableMapping[] {
    if (condicion !== 'consumo_diario') return this.variables();
    return this.variables().filter((v) => this.rolContadorDe(v.d1));
  }

  /**
   * Unidad declarada en el reg_map, sin condicionar. Describe la MÉTRICA
   * (qué mide la variable); distinto de `unidadVariable()`, que decide si la
   * unidad aplica al UMBRAL de una condición concreta.
   */
  unidadRegMap(key: string): string {
    return this.mappingDe(key)?.unidad?.trim() || '';
  }

  rolVariable(key: string): string {
    return this.mappingDe(key)?.rol_dashboard?.trim() || '';
  }

  transformacionVariable(key: string): string {
    return (this.mappingDe(key)?.transformacion ?? '').trim() || 'directo';
  }

  /** Unidad del reg_map, SOLO si el umbral se expresa en esa unidad. */
  unidadVariable(key: string, condicion: AlertaCondicion): string {
    if (this.requiereValorCrudo(key, condicion)) return '';
    return this.mappingDe(key)?.unidad?.trim() || '';
  }

  puedeGuardar(d: DraftAlerta): boolean {
    if (!d.nombre.trim()) return false;
    if (d.condicion !== 'dga_atrasado' && !d.variable_key.trim()) return false;
    if (
      d.condicion === 'mayor_que' ||
      d.condicion === 'menor_que' ||
      d.condicion === 'igual_a' ||
      d.condicion === 'consumo_diario'
    ) {
      if (umbralVacio(d.umbral_bajo)) return false;
    }
    if (d.condicion === 'fuera_rango') {
      if (umbralVacio(d.umbral_bajo) || umbralVacio(d.umbral_alto)) return false;
    }
    if (!d.dias_activos.length) return false;
    return true;
  }

  guardarNueva(): void {
    const sid = this.sitioId();
    const eid = this.empresaId();
    if (!sid || !eid) {
      this.errorMsg.set('Falta sitio_id o empresa_id');
      return;
    }
    const payload = this.buildPayload(this.nuevaRegla, sid, eid);
    this.saving.set(true);
    this.errorMsg.set(null);
    this.alertaService.crear(payload).subscribe({
      next: (row) => {
        this.reglas.update((rs) => [row, ...rs]);
        this.mostrandoNuevo.set(false);
        this.nuevaRegla = emptyDraft();
        this.saving.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'No se pudo crear la regla');
        this.saving.set(false);
      },
    });
  }

  guardarEdicion(regla: AlertaRow): void {
    const draft = this.drafts()[regla.id];
    if (!draft) return;
    const payload: UpdateAlertaPayload = {
      nombre: draft.nombre,
      descripcion: draft.descripcion || null,
      variable_key: draft.condicion === 'dga_atrasado' ? 'dga' : draft.variable_key,
      condicion: draft.condicion,
      umbral_bajo: this.numOrNull(draft.umbral_bajo, draft.condicion),
      umbral_alto:
        draft.condicion === 'fuera_rango'
          ? this.numOrNull(draft.umbral_alto, draft.condicion)
          : null,
      severidad: draft.condicion === 'dga_atrasado' ? 'media' : draft.severidad,
      cooldown_minutos: Number(draft.cooldown_minutos),
      dias_activos: draft.dias_activos,
      visible_to_all: draft.visible_to_all,
    };
    this.saving.set(true);
    this.errorMsg.set(null);
    this.alertaService.actualizar(regla.id, payload).subscribe({
      next: (updated) => {
        this.reglas.update((rs) => rs.map((r) => (r.id === regla.id ? updated : r)));
        this.cancelarEdicion(regla);
        this.saving.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'No se pudo actualizar la regla');
        this.saving.set(false);
      },
    });
  }

  toggleActiva(regla: AlertaRow): void {
    this.alertaService.actualizar(regla.id, { activa: !regla.activa }).subscribe({
      next: (updated) =>
        this.reglas.update((rs) => rs.map((r) => (r.id === regla.id ? updated : r))),
      error: (err) => this.errorMsg.set(err?.error?.error || 'No se pudo actualizar'),
    });
  }

  eliminar(regla: AlertaRow): void {
    // Sin confirm() nativo: el popup 2FA es la confirmación de la acción.
    this.alertaService.eliminar(regla.id).subscribe({
      next: () => this.reglas.update((rs) => rs.filter((r) => r.id !== regla.id)),
      error: (err) => this.errorMsg.set(err?.error?.error || 'No se pudo eliminar'),
    });
  }

  private buildPayload(d: DraftAlerta, sitio_id: string, empresa_id: string): CreateAlertaPayload {
    return {
      nombre: d.nombre.trim(),
      descripcion: d.descripcion.trim() || null,
      sitio_id,
      empresa_id,
      variable_key: d.condicion === 'dga_atrasado' ? 'dga' : d.variable_key.trim(),
      condicion: d.condicion,
      umbral_bajo: this.numOrNull(d.umbral_bajo, d.condicion),
      umbral_alto:
        d.condicion === 'fuera_rango' ? this.numOrNull(d.umbral_alto, d.condicion) : null,
      severidad: d.condicion === 'dga_atrasado' ? 'media' : d.severidad,
      cooldown_minutos: Number(d.cooldown_minutos) || 5,
      dias_activos: d.dias_activos,
      visible_to_all: d.visible_to_all,
    };
  }

  private numOrNull(val: UmbralValue, condicion: AlertaCondicion): number | null {
    if (condicion === 'sin_datos' || condicion === 'dga_atrasado') return null;
    if (umbralVacio(val)) return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  condicionLabel(c: AlertaCondicion): string {
    return CONDICION_LABELS[c];
  }

  severidadLabel(s: AlertaSeveridad): string {
    return SEVERIDAD_LABELS[s];
  }

  severidadButtonActive(s: AlertaSeveridad): string {
    switch (s) {
      case 'baja':
        return 'bg-emerald-500 text-white';
      case 'media':
        return 'bg-amber-500 text-white';
      case 'alta':
        return 'bg-orange-500 text-white';
      case 'critica':
        return 'bg-rose-600 text-white';
    }
  }

  severidadBadgeClass(s: AlertaSeveridad): string {
    switch (s) {
      case 'baja':
        return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
      case 'media':
        return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100';
      case 'alta':
        return 'bg-orange-50 text-orange-700 ring-1 ring-orange-100';
      case 'critica':
        return 'bg-rose-50 text-rose-700 ring-1 ring-rose-100';
    }
  }

  diaShort(d: AlertaDia): string {
    return DIAS_SHORT[d];
  }

  diasResumen(dias: AlertaDia[]): string {
    if (dias.length === 7) return 'Todos los días';
    const habiles: AlertaDia[] = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'];
    if (dias.length === 5 && habiles.every((d) => dias.includes(d))) return 'Lunes a viernes';
    const finde: AlertaDia[] = ['sabado', 'domingo'];
    if (dias.length === 2 && finde.every((d) => dias.includes(d))) return 'Fines de semana';
    return dias.map((d) => DIAS_SHORT[d]).join(', ');
  }

  condicionResumen(r: AlertaRow): string {
    // La unidad viene del reg_map del sitio; sin mapping se omite en vez de
    // inventar uno.
    const u = this.unidadVariable(r.variable_key, r.condicion);
    const sufijo = u ? ` ${u}` : '';
    const bajo = r.umbral_bajo ?? '—';
    const alto = r.umbral_alto ?? '—';
    switch (r.condicion) {
      case 'consumo_diario':
        return `consumo del día > ${bajo}${sufijo}`;
      case 'mayor_que':
        return `> ${bajo}${sufijo}`;
      case 'menor_que':
        return `< ${bajo}${sufijo}`;
      case 'igual_a':
        return `= ${bajo}${sufijo}`;
      case 'fuera_rango':
        return `fuera de ${bajo} – ${alto}${sufijo}`;
      case 'sin_datos':
        return `Sin datos > ${r.cooldown_minutos} min`;
      case 'dga_atrasado':
        return 'DGA atrasado (24/48/72h)';
      default:
        return r.condicion;
    }
  }

  /** Barra lateral de color por severidad — lectura de prioridad a un vistazo. */
  severidadRailClass(s: AlertaSeveridad): string {
    switch (s) {
      case 'baja':
        return 'bg-emerald-400';
      case 'media':
        return 'bg-amber-400';
      case 'alta':
        return 'bg-orange-500';
      case 'critica':
        return 'bg-rose-500';
    }
  }

  // ─── Rule-tester ────────────────────────────────────────────────────

  /**
   * `dga_atrasado` no simula contra historic readings — depende de la cola
   * SNIA, no de valores de variable. UI oculta el botón para esa condición.
   */
  esCondicionSimulable(condicion: AlertaCondicion): boolean {
    return condicion !== 'dga_atrasado';
  }

  /**
   * Una regla es "simulable" cuando tiene los inputs mínimos: condicion
   * simulable + variable_key + umbrales válidos según condición.
   */
  puedeSimular(draft: DraftAlerta): boolean {
    if (!this.esCondicionSimulable(draft.condicion)) return false;
    if (!this.idSerial()) return false;
    if (draft.condicion === 'sin_datos') {
      return draft.cooldown_minutos > 0;
    }
    if (!draft.variable_key) return false;
    if (draft.condicion === 'consumo_diario') {
      return !umbralVacio(draft.umbral_bajo) && !!this.rolContadorDe(draft.variable_key);
    }
    if (draft.condicion === 'fuera_rango') {
      return !umbralVacio(draft.umbral_bajo) && !umbralVacio(draft.umbral_alto);
    }
    return !umbralVacio(draft.umbral_bajo);
  }

  /**
   * Ejecuta la regla contra las últimas 500 lecturas CRUDAS del equipo y
   * reporta cuántas habrían disparado. NO escribe — solo lectura.
   *
   * Fuente = `/api/data/preset` (tabla `equipo`, payload sin transformar),
   * porque es exactamente lo que evalúa el worker: `equipo.data[variable_key]`.
   * NO sirve `dashboard-history`: ese endpoint devuelve filas mapeadas por rol
   * (`caudal`/`nivel`/`totalizador`/`nivel_freatico`), no un diccionario
   * indexado por la clave cruda de la regla.
   */
  simularRegla(draft: DraftAlerta): void {
    const serial = this.idSerial();
    if (!serial) {
      this.simulationError.set('No se pudo resolver el equipo del sitio.');
      return;
    }
    if (!this.puedeSimular(draft)) {
      this.simulationError.set('Completa la regla antes de probarla.');
      return;
    }

    this.simulating.set(true);
    this.simulationError.set('');
    this.simulationSummary.set(null);

    if (draft.condicion === 'consumo_diario') {
      this.simularConsumoDiario(draft);
      return;
    }

    this.companyService
      .getTelemetryPreset(serial, {
        preset: '24h',
        keys: draft.variable_key ? [draft.variable_key] : undefined,
        limit: 500,
      })
      .subscribe({
        next: (res) => {
          this.simulating.set(false);
          if (!res.ok) {
            this.simulationError.set('No se pudo cargar el histórico para la simulación.');
            return;
          }
          const rows = Array.isArray(res.data) ? res.data : [];
          if (rows.length === 0) {
            this.simulationError.set(
              'El equipo no tiene lecturas en las últimas 24 horas; no hay contra qué probar.',
            );
            return;
          }
          this.simulationSummary.set(this.buildSimulation(draft, rows));
        },
        error: (err: unknown) => {
          this.simulating.set(false);
          const e = err as { error?: { error?: { message?: string }; message?: string } };
          this.simulationError.set(
            e?.error?.error?.message ??
              e?.error?.message ??
              'No se pudo cargar el histórico para la simulación.',
          );
        },
      });
  }

  /**
   * Backtest de `consumo_diario`: en vez de lecturas crudas, evalúa el umbral
   * contra el consumo REAL de cada uno de los últimos 30 días. Responde la
   * pregunta que importa: "¿cuántos días de los últimos 30 habrían disparado
   * esta regla?".
   */
  private simularConsumoDiario(draft: DraftAlerta): void {
    const siteId = this.sitioId();
    const rol = this.rolContadorDe(draft.variable_key);
    if (!siteId || !rol) {
      this.simulating.set(false);
      this.simulationError.set('La variable seleccionada no es un contador acumulable.');
      return;
    }

    this.companyService.getContadoresDiarios(siteId, { rol, dias: 30 }).subscribe({
      next: (res) => {
        this.simulating.set(false);
        if (!res.ok) {
          this.simulationError.set('No se pudo cargar el consumo diario para la simulación.');
          return;
        }
        const puntos = Array.isArray(res.data) ? res.data : [];
        const conDato = puntos.filter((p) => p.delta !== null);
        if (conDato.length === 0) {
          this.simulationError.set(
            'No hay consumo diario calculado para este contador en los últimos 30 días.',
          );
          return;
        }
        this.simulationSummary.set(this.buildSimulacionConsumo(draft, puntos));
      },
      error: (err: unknown) => {
        this.simulating.set(false);
        const e = err as { error?: { error?: { message?: string }; message?: string } };
        this.simulationError.set(
          e?.error?.error?.message ??
            e?.error?.message ??
            'No se pudo cargar el consumo diario para la simulación.',
        );
      },
    });
  }

  private buildSimulacionConsumo(
    draft: DraftAlerta,
    puntos: ContadorDiarioPoint[],
  ): SimulationSummary {
    const umbral = umbralVacio(draft.umbral_bajo) ? null : Number(draft.umbral_bajo);
    // Más reciente primero, igual que el backtest de lecturas crudas.
    const ordenados = [...puntos].sort((a, b) => b.dia.localeCompare(a.dia));

    const rows: SimulationResultRow[] = [];
    let matched = 0;
    let withValueCount = 0;
    for (const p of ordenados) {
      if (p.delta !== null) withValueCount++;
      const dispara =
        umbral !== null && Number.isFinite(umbral) && p.delta !== null && p.delta > umbral;
      if (dispara) matched++;
      if (dispara && rows.length < 5) {
        // `dia` es 'YYYY-MM-DD'; se normaliza a mediodía UTC para que el
        // formateo local no lo corra al día anterior.
        rows.push({
          // El delta viene con la precisión completa del contador
          // (117.21875 m³); a 2 decimales sigue siendo exacto para decidir
          // un umbral y deja de competir con el resto de la tabla.
          timestamp: `${p.dia}T12:00:00Z`,
          value: Math.round(p.delta! * 100) / 100,
          raw: p.delta,
          matched: true,
        });
      }
    }
    return { total: ordenados.length, matched, rows, withValueCount };
  }

  /**
   * La rueda del mouse sobre un input `type="number"` enfocado incrementa o
   * decrementa el valor en silencio — scrollear el modal cambiaba el umbral
   * sin que el usuario lo notara. Sacándole el foco, la rueda vuelve a
   * scrollear la página.
   */
  onWheelNumber(event: WheelEvent): void {
    (event.target as HTMLElement | null)?.blur();
  }

  resetSimulacion(): void {
    this.simulationSummary.set(null);
    this.simulationError.set('');
  }

  /** Evalúa una entry de historial contra la condición del draft. */
  private evalCondicion(value: number | null, draft: DraftAlerta): boolean {
    if (draft.condicion === 'sin_datos') {
      // Para "sin datos", value === null implica que la lectura llegó vacía
      // — el match real depende del gap inter-entry y se evalúa en
      // buildSimulation(), no aquí.
      return false;
    }
    if (value === null) return false;
    // `umbralVacio` cubre el `null` que escribe el input `type="number"` al
    // vaciarse. Con el check anterior (`=== ''`) caía en `Number(null) === 0`
    // y la simulación evaluaba contra un umbral 0 inventado.
    const bajo = umbralVacio(draft.umbral_bajo) ? null : Number(draft.umbral_bajo);
    const alto = umbralVacio(draft.umbral_alto) ? null : Number(draft.umbral_alto);
    switch (draft.condicion) {
      case 'mayor_que':
        return bajo !== null && Number.isFinite(bajo) && value > bajo;
      case 'menor_que':
        return bajo !== null && Number.isFinite(bajo) && value < bajo;
      case 'igual_a':
        return bajo !== null && Number.isFinite(bajo) && Math.abs(value - bajo) < 1e-9;
      case 'fuera_rango':
        if (bajo === null || alto === null || !Number.isFinite(bajo) || !Number.isFinite(alto)) {
          return false;
        }
        return value < bajo || value > alto;
      default:
        return false;
    }
  }

  /** Timestamp UTC de una fila cruda de `/api/data/*`. */
  private rowTimestamp(row: TelemetryHistoryRow): string {
    return row.timestamp_completo ?? `${row.fecha ?? ''}T${row.hora ?? '00:00:00'}`;
  }

  /** Valor crudo de la variable — mismo acceso que hace el worker de alertas. */
  private rowValue(row: TelemetryHistoryRow, key: string): unknown {
    if (!key) return null;
    return (row.data ?? {})[key];
  }

  private buildSimulation(draft: DraftAlerta, rawRows: TelemetryHistoryRow[]): SimulationSummary {
    // Mostrar más recientes primero para que el admin vea los hits relevantes.
    const entries = rawRows.map((row) => ({
      timestamp: this.rowTimestamp(row),
      raw: this.rowValue(row, draft.variable_key),
    }));
    const sorted = entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (draft.condicion === 'sin_datos') {
      // Gap detection: marcar como match cada gap > cooldown_minutos entre
      // entries consecutivas (de más reciente a más antigua), o lecturas con
      // valor null/undefined para el variable_key.
      const gapMs = draft.cooldown_minutos * 60_000;
      const rows: SimulationResultRow[] = [];
      let matchedCount = 0;
      let withValueCount = 0;
      for (let i = 0; i < sorted.length; i++) {
        const entry = sorted[i];
        const raw = entry.raw;
        const isNull = raw === null || raw === undefined || raw === '';
        let isGap = false;
        if (i < sorted.length - 1) {
          const t1 = Date.parse(entry.timestamp);
          const t2 = Date.parse(sorted[i + 1].timestamp);
          if (Number.isFinite(t1) && Number.isFinite(t2) && t1 - t2 > gapMs) isGap = true;
        }
        const matched = isNull || isGap;
        if (matched) matchedCount++;
        if (!isNull) withValueCount++;
        if (rows.length < 5 && matched) {
          rows.push({ timestamp: entry.timestamp, value: this.toNum(raw), raw, matched: true });
        }
      }
      return { total: sorted.length, matched: matchedCount, rows, withValueCount };
    }

    const rows: SimulationResultRow[] = [];
    let matchedCount = 0;
    let withValueCount = 0;
    for (const entry of sorted) {
      const raw = entry.raw;
      const value = this.toNum(raw);
      const hasValue = value !== null;
      if (hasValue) withValueCount++;
      const matched = this.evalCondicion(value, draft);
      if (matched) matchedCount++;
      if (matched && rows.length < 5) {
        rows.push({ timestamp: entry.timestamp, value, raw, matched: true });
      }
    }
    return { total: sorted.length, matched: matchedCount, rows, withValueCount };
  }

  private toNum(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : null;
  }

  /** Día calendario, sin hora — para el backtest de `consumo_diario`. */
  formatSimulationDay(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleDateString('es-CL', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });
  }

  formatSimulationTime(iso: string): string {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    return d.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  }
}
