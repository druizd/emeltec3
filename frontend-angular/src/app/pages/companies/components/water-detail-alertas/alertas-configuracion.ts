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
import type { VariableMapping } from '@emeltec/shared';

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
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">
      <!-- Header -->
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] font-semibold text-slate-400">
          {{ reglas().length }}
          {{ reglas().length === 1 ? 'regla configurada' : 'reglas configuradas' }}
        </p>
        <button
          type="button"
          (click)="toggleNuevo()"
          class="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[12px] font-bold text-cyan-700 transition-colors hover:bg-cyan-100"
        >
          <span class="material-symbols-outlined text-[16px]">{{
            mostrandoNuevo() ? 'close' : 'add'
          }}</span>
          {{ mostrandoNuevo() ? 'Cancelar' : 'Nueva regla' }}
        </button>
      </div>

      <!-- Loading / error -->
      @if (loading()) {
        <p class="rounded-xl bg-slate-50 px-4 py-3 text-[12px] text-slate-500">Cargando reglas…</p>
      }
      @if (errorMsg()) {
        <p class="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{{ errorMsg() }}</p>
      }

      <!-- Formulario nueva regla -->
      @if (mostrandoNuevo()) {
        <article class="rounded-2xl border-2 border-dashed border-cyan-200 bg-cyan-50/30 p-4">
          <p class="mb-3 text-[10px] font-black uppercase tracking-widest text-cyan-700">
            Nueva regla
          </p>
          <ng-container
            *ngTemplateOutlet="reglaForm; context: { $implicit: nuevaRegla, isNew: true }"
          ></ng-container>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              (click)="toggleNuevo()"
              class="rounded-xl bg-slate-100 px-4 py-2 text-[12px] font-bold text-slate-600 transition-colors hover:bg-slate-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              [disabled]="saving() || !puedeGuardar(nuevaRegla)"
              (click)="guardarNueva()"
              class="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
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
                [class]="regla.activa ? 'bg-cyan-500' : 'bg-slate-300'"
                class="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
                [attr.aria-label]="regla.activa ? 'Desactivar' : 'Activar'"
              >
                <span
                  [class]="regla.activa ? 'translate-x-4' : 'translate-x-0.5'"
                  class="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
                ></span>
              </button>
              <div class="min-w-0">
                <p class="font-black text-slate-800">{{ regla.nombre }}</p>
                <p class="mt-0.5 text-[12px] text-slate-500">
                  <span class="font-mono font-bold text-slate-700">{{
                    condicionResumen(regla)
                  }}</span>
                  <span
                    class="ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold"
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
              <span class="flex items-center gap-1 text-[11px] text-slate-400">
                <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                {{ diasResumen(regla.dias_activos) }}
              </span>
              <span class="flex items-center gap-1 text-[11px] text-slate-400">
                <span class="material-symbols-outlined text-[14px]">schedule</span>
                cooldown {{ regla.cooldown_minutos }} min
              </span>
              @if (regla.variable_key && regla.condicion !== 'dga_atrasado') {
                <span class="flex items-center gap-1 text-[11px] text-slate-400">
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
                  class="rounded-xl bg-slate-100 px-4 py-2 text-[12px] font-bold text-slate-600 transition-colors hover:bg-slate-200"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  [disabled]="saving() || !puedeGuardar(drafts()[regla.id]!)"
                  (click)="guardarEdicion(regla)"
                  class="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
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
          <p class="rounded-xl bg-slate-50 px-4 py-6 text-center text-[12px] text-slate-500">
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
            class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
            >Nombre</label
          >
          <input
            type="text"
            [(ngModel)]="draft.nombre"
            placeholder="Ej: Nivel freático crítico"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
          />
        </div>

        <!-- Descripción -->
        <div>
          <label
            class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
            >Descripción (opcional)</label
          >
          <input
            type="text"
            [(ngModel)]="draft.descripcion"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
          />
        </div>

        <!-- Condición -->
        <div>
          <label
            class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
            >Condición</label
          >
          <select
            [(ngModel)]="draft.condicion"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 focus:border-cyan-400 focus:outline-none"
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
              class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Variable</label
            >
            @if (variables().length > 0) {
              <select
                [(ngModel)]="draft.variable_key"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
              >
                <option value="" disabled>Selecciona una variable…</option>
                @for (v of variables(); track v.id) {
                  <option [value]="v.d1">
                    {{ v.alias }} ({{ v.d1 }}){{ v.unidad ? ' · ' + v.unidad : '' }}
                  </option>
                }
              </select>
              @if (
                draft.variable_key &&
                !isVariableRegistrada(draft.variable_key)
              ) {
                <p class="mt-1 text-[11px] text-amber-600">
                  ⚠ "{{ draft.variable_key }}" no esta en las variables registradas del sitio.
                </p>
              }
            } @else {
              <input
                type="text"
                [(ngModel)]="draft.variable_key"
                placeholder="Ej: caudal, nivel_freatico"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
              />
              <p class="mt-1 text-[11px] text-slate-400">
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
              class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Umbral</label
            >
            <input
              type="number"
              step="any"
              [(ngModel)]="draft.umbral_bajo"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
            />
          </div>
        }
        @if (draft.condicion === 'fuera_rango') {
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label
                class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
                >Mínimo</label
              >
              <input
                type="number"
                step="any"
                [(ngModel)]="draft.umbral_bajo"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label
                class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
                >Máximo</label
              >
              <input
                type="number"
                step="any"
                [(ngModel)]="draft.umbral_alto"
                class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>
        }

        <!-- Nota especial dga_atrasado -->
        @if (draft.condicion === 'dga_atrasado') {
          <div
            class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800"
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
              class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
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
                  class="rounded-full px-3 py-1 text-[11px] font-bold transition-colors"
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
            class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
            >Cooldown (minutos)</label
          >
          <input
            type="number"
            min="1"
            max="1440"
            [(ngModel)]="draft.cooldown_minutos"
            class="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 text-center font-mono text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
          />
          <span class="ml-2 text-[11px] text-slate-400">tiempo mínimo entre notificaciones</span>
        </div>

        <!-- Días activos -->
        <div>
          <p class="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
            Días activos
          </p>
          <div class="flex flex-wrap gap-1.5">
            @for (d of diasOrden; track d) {
              <button
                type="button"
                (click)="toggleDia(draft, d)"
                [class]="
                  draft.dias_activos.includes(d)
                    ? 'bg-cyan-600 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                "
                class="h-8 min-w-[2rem] rounded-lg px-2 text-[11px] font-black transition-colors"
              >
                {{ diaShort(d) }}
              </button>
            }
          </div>
        </div>
      </div>
    </ng-template>
  `,
})
export class AlertasConfiguracionComponent {
  private readonly alertaService = inject(AlertaService);
  private readonly adminService = inject(AdministrationService);

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
}
