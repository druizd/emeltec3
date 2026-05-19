import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { CompanyService } from '../../../../services/company.service';
import type { SiteDashboardHistoryEntry, VariableMapping } from '@emeltec/shared';
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

interface DraftAlerta {
  nombre: string;
  descripcion: string;
  variable_key: string;
  condicion: AlertaCondicion;
  umbral_bajo: string;
  umbral_alto: string;
  severidad: AlertaSeveridad;
  cooldown_minutos: number;
  dias_activos: AlertaDia[];
}

const CONDICIONES_DISPONIBLES: AlertaCondicion[] = [
  'mayor_que',
  'menor_que',
  'igual_a',
  'fuera_rango',
  'sin_datos',
  'dga_atrasado',
];

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
  };
}

@Component({
  selector: 'app-alertas-configuracion',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, InlineErrorComponent, TableSkeletonComponent],
  template: `
    <div class="space-y-3">
      <!-- Header -->
      <div class="flex items-center justify-between gap-3">
        <p class="text-caption-xs font-semibold text-slate-400">
          {{ reglas().length }}
          {{ reglas().length === 1 ? 'regla configurada' : 'reglas configuradas' }}
        </p>
        <button
          type="button"
          (click)="toggleNuevo()"
          class="inline-flex items-center gap-1.5 rounded-xl border border-primary-tint-25 bg-primary-tint-08 px-3 py-2 text-caption font-bold text-primary-container transition-colors hover:bg-primary-tint-14"
        >
          <span class="material-symbols-outlined text-[16px]">{{
            mostrandoNuevo() ? 'close' : 'add'
          }}</span>
          {{ mostrandoNuevo() ? 'Cancelar' : 'Nueva regla' }}
        </button>
      </div>

      <!-- Loading / error -->
      @if (loading()) {
        <app-table-skeleton [rows]="4" [columns]="4" [showHeader]="false" />
      }
      @if (errorMsg()) {
        <app-inline-error [message]="errorMsg()" />
      }

      <!-- Formulario nueva regla -->
      @if (mostrandoNuevo()) {
        <article
          class="rounded-2xl border-2 border-dashed border-primary-tint-25 bg-primary-tint-08/30 p-4"
        >
          <p
            class="mb-3 text-caption-xs font-semibold uppercase tracking-widest text-primary-container"
          >
            Nueva regla
          </p>
          <ng-container
            *ngTemplateOutlet="reglaForm; context: { $implicit: nuevaRegla, isNew: true }"
          ></ng-container>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              (click)="toggleNuevo()"
              class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              [disabled]="saving() || !puedeGuardar(nuevaRegla)"
              (click)="guardarNueva()"
              class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-[#0899a5] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span class="material-symbols-outlined text-[16px]">check</span>
              Crear regla
            </button>
          </div>
        </article>
      }

      <!-- Lista de reglas existentes -->
      @for (regla of reglas(); track regla.id) {
        <article
          class="rounded-2xl border bg-white shadow-sm transition-all"
          [class]="regla.activa ? 'border-slate-200' : 'border-slate-100 opacity-60'"
        >
          <div class="flex items-start justify-between gap-3 px-5 py-4">
            <div class="flex items-start gap-3">
              <button
                type="button"
                (click)="toggleActiva(regla)"
                [class]="regla.activa ? 'bg-primary/10' : 'bg-slate-300'"
                class="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
                [attr.aria-label]="regla.activa ? 'Desactivar' : 'Activar'"
              >
                <span
                  [class]="regla.activa ? 'translate-x-4' : 'translate-x-0.5'"
                  class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                ></span>
              </button>
              <div class="min-w-0">
                <p class="font-semibold text-slate-800">{{ regla.nombre }}</p>
                <p class="mt-0.5 text-caption text-slate-500">
                  <span class="font-mono font-bold text-slate-700">{{
                    condicionResumen(regla)
                  }}</span>
                  <span
                    class="ml-2 inline-block rounded-full px-2 py-0.5 text-caption-xs font-bold"
                    [class]="severidadBadgeClass(regla.severidad)"
                  >
                    {{ severidadLabel(regla.severidad) }}
                  </span>
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                (click)="expandirRegla(regla.id)"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                [attr.aria-label]="reglaExpandida() === regla.id ? 'Colapsar' : 'Editar'"
              >
                <span class="material-symbols-outlined text-[18px]">{{
                  reglaExpandida() === regla.id ? 'expand_less' : 'edit'
                }}</span>
              </button>
              <button
                type="button"
                (click)="eliminar(regla)"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                aria-label="Eliminar regla"
              >
                <span class="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </div>
          </div>

          @if (reglaExpandida() !== regla.id) {
            <div
              class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-5 py-3"
            >
              <span class="flex items-center gap-1 text-caption-xs text-slate-400">
                <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                {{ diasResumen(regla.dias_activos) }}
              </span>
              <span class="flex items-center gap-1 text-caption-xs text-slate-400">
                <span class="material-symbols-outlined text-[14px]">schedule</span>
                cooldown {{ regla.cooldown_minutos }} min
              </span>
              @if (regla.variable_key && regla.condicion !== 'dga_atrasado') {
                <span class="flex items-center gap-1 text-caption-xs text-slate-400">
                  <span class="material-symbols-outlined text-[14px]">data_object</span>
                  {{ regla.variable_key }}
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
                  class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  [disabled]="saving() || !puedeGuardar(drafts()[regla.id]!)"
                  (click)="guardarEdicion(regla)"
                  class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-[#0899a5] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span class="material-symbols-outlined text-[16px]">check</span>
                  Guardar
                </button>
              </div>
            </div>
          }
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
      <div class="space-y-4">
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
            @if (variables().length > 0) {
              <select
                [(ngModel)]="draft.variable_key"
                (ngModelChange)="resetSimulacion()"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
              >
                <option value="" disabled>Selecciona una variable…</option>
                @for (v of variables(); track v.id) {
                  <option [value]="v.d1">
                    {{ v.alias }} ({{ v.d1 }}){{ v.unidad ? ' · ' + v.unidad : '' }}
                  </option>
                }
              </select>
              @if (draft.variable_key && !isVariableRegistrada(draft.variable_key)) {
                <p class="mt-1 flex items-center gap-1 text-caption-xs text-amber-600">
                  <span class="material-symbols-outlined text-[14px]" aria-hidden="true"
                    >warning</span
                  >
                  "{{ draft.variable_key }}" no está en las variables registradas del sitio.
                </p>
              }
            } @else {
              <input
                type="text"
                [(ngModel)]="draft.variable_key"
                (ngModelChange)="resetSimulacion()"
                placeholder="Ej: caudal, nivel_freatico"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
              />
              <p class="mt-1 text-caption-xs text-slate-400">
                Sin variables registradas en el sitio; ingresa la clave manualmente.
              </p>
            }
          </div>
        }

        <!-- Umbrales (según condición) -->
        @if (
          draft.condicion === 'mayor_que' ||
          draft.condicion === 'menor_que' ||
          draft.condicion === 'igual_a'
        ) {
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Umbral</label
            >
            <input
              type="number"
              step="any"
              [(ngModel)]="draft.umbral_bajo"
              (ngModelChange)="resetSimulacion()"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
            />
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
              El sistema notifica al cruzar 24h, 48h y 72h sin reporte DGA (severidades media → alta
              → crítica). No requiere umbral ni variable. Aplica al informante DGA del sitio.
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
                  [class]="
                    draft.severidad === s
                      ? severidadButtonActive(s)
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  "
                  class="rounded-full px-3 py-1 text-caption-xs font-bold transition-colors"
                >
                  {{ severidadLabel(s) }}
                </button>
              }
            </div>
          </div>
        }

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
            class="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center font-mono text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
          />
          <span class="ml-2 text-caption-xs text-slate-400"
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
                [class]="
                  draft.dias_activos.includes(d)
                    ? 'bg-primary text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                "
                class="h-8 min-w-[2rem] rounded-lg px-2 text-caption-xs font-semibold transition-colors"
              >
                {{ diaShort(d) }}
              </button>
            }
          </div>
        </div>

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
                class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-caption-xs font-bold text-white transition-colors hover:bg-[#0899a5] disabled:cursor-not-allowed disabled:opacity-50 sm:h-8"
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
            <p class="text-caption-xs text-on-surface-muted">
              Evalúa la condición contra las últimas 500 lecturas del sitio. Read-only — no guarda
              nada ni dispara notificaciones.
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
                  {{ sim.matched }}
                  {{ sim.matched === 1 ? 'match' : 'matches' }} en {{ sim.total }} lecturas
                </span>
                @if (draft.condicion !== 'sin_datos') {
                  <span class="text-on-surface-muted">
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
                          Fecha
                        </th>
                        <th class="px-3 py-2 text-right font-semibold uppercase tracking-wider">
                          Valor
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
                            {{ formatSimulationTime(row.timestamp) }}
                          </td>
                          <td class="px-3 py-2 text-right font-mono font-bold text-slate-800">
                            @if (row.value !== null) {
                              {{ row.value }}
                            } @else {
                              <span class="text-on-surface-muted italic">sin dato</span>
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
                    <p class="bg-slate-50 px-3 py-2 text-caption-xs text-on-surface-muted">
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
                  La regla no habría disparado contra las últimas {{ sim.total }} lecturas. Listo
                  para activar.
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
        if (res.ok) this.variables.set(res.data.mappings ?? []);
      },
      error: () => {
        // No bloqueante: el input cae a texto libre.
        this.variables.set([]);
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

  isVariableRegistrada(key: string): boolean {
    return this.variables().some((v) => v.d1 === key);
  }

  puedeGuardar(d: DraftAlerta): boolean {
    if (!d.nombre.trim()) return false;
    if (d.condicion !== 'dga_atrasado' && !d.variable_key.trim()) return false;
    if (d.condicion === 'mayor_que' || d.condicion === 'menor_que' || d.condicion === 'igual_a') {
      if (d.umbral_bajo === '') return false;
    }
    if (d.condicion === 'fuera_rango') {
      if (d.umbral_bajo === '' || d.umbral_alto === '') return false;
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
    if (!confirm(`¿Eliminar la regla "${regla.nombre}"? Esta acción no se puede deshacer.`)) return;
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
    };
  }

  private numOrNull(val: string, condicion: AlertaCondicion): number | null {
    if (condicion === 'sin_datos' || condicion === 'dga_atrasado') return null;
    if (val === '' || val === null || val === undefined) return null;
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
    switch (r.condicion) {
      case 'mayor_que':
        return `> ${r.umbral_bajo ?? '—'}`;
      case 'menor_que':
        return `< ${r.umbral_bajo ?? '—'}`;
      case 'igual_a':
        return `= ${r.umbral_bajo ?? '—'}`;
      case 'fuera_rango':
        return `${r.umbral_bajo ?? '—'} – ${r.umbral_alto ?? '—'}`;
      case 'sin_datos':
        return `Sin datos > ${r.cooldown_minutos}m`;
      case 'dga_atrasado':
        return 'DGA atrasado (24/48/72h)';
      default:
        return r.condicion;
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
    if (draft.condicion === 'sin_datos') {
      return !!this.sitioId() && draft.cooldown_minutos > 0;
    }
    if (!draft.variable_key) return false;
    if (draft.condicion === 'fuera_rango') {
      return draft.umbral_bajo !== '' && draft.umbral_alto !== '';
    }
    return draft.umbral_bajo !== '';
  }

  /**
   * Ejecuta la regla contra las últimas 500 lecturas del dashboard-history
   * endpoint y reporta cuántas habrían disparado. NO escribe — solo lectura.
   * 500 entries ≈ últimas 8.3 horas (a 60s polling) o más si el sitio tiene
   * polling más lento. Buffer suficiente para que el admin pruebe sin
   * sobrecargar el backend.
   */
  simularRegla(draft: DraftAlerta): void {
    const siteId = this.sitioId();
    if (!siteId) {
      this.simulationError.set('No hay sitio seleccionado.');
      return;
    }
    if (!this.puedeSimular(draft)) {
      this.simulationError.set('Completa la regla antes de probarla.');
      return;
    }

    this.simulating.set(true);
    this.simulationError.set('');
    this.simulationSummary.set(null);

    this.companyService.getSiteDashboardHistory(siteId, 500).subscribe({
      next: (res) => {
        this.simulating.set(false);
        if (!res.ok) {
          this.simulationError.set('No se pudo cargar el histórico para la simulación.');
          return;
        }
        const entries = res.data ?? [];
        this.simulationSummary.set(this.buildSimulation(draft, entries));
      },
      error: (err: unknown) => {
        this.simulating.set(false);
        const e = err as { error?: { error?: { message?: string } }; message?: string };
        this.simulationError.set(
          e?.error?.error?.message ?? 'No se pudo cargar el histórico para la simulación.',
        );
      },
    });
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
    const bajo = draft.umbral_bajo === '' ? null : Number(draft.umbral_bajo);
    const alto = draft.umbral_alto === '' ? null : Number(draft.umbral_alto);
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

  private buildSimulation(
    draft: DraftAlerta,
    entries: SiteDashboardHistoryEntry[],
  ): SimulationSummary {
    // Mostrar más recientes primero para que el admin vea los hits relevantes.
    const sorted = [...entries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

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
        const raw = draft.variable_key ? entry.variables[draft.variable_key] : null;
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
      const raw = entry.variables[draft.variable_key];
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
