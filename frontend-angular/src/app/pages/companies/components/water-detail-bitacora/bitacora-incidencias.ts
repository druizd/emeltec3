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
import { FormsModule } from '@angular/forms';
import { A11yModule } from '@angular/cdk/a11y';
import {
  CATEGORIA_LABELS,
  CreateIncidenciaPayload,
  ESTADO_LABELS,
  GRAVEDAD_LABELS,
  IncidenciaCategoria,
  IncidenciaEstado,
  IncidenciaGravedad,
  IncidenciaOrigen,
  IncidenciaRow,
  IncidenciaService,
  ORIGEN_LABELS,
} from '../../../../services/incidencia.service';
import { UserService, type Tecnico } from '../../../../services/user.service';
import { InlineErrorComponent } from '../../../../components/ui/inline-error';
import { TableSkeletonComponent } from '../../../../components/ui/table-skeleton';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../../../components/ui/confirm-dialog';

interface DraftIncidencia {
  titulo: string;
  descripcion: string;
  origen: IncidenciaOrigen;
  categoria: IncidenciaCategoria;
  gravedad: IncidenciaGravedad;
  estado: IncidenciaEstado;
  tecnico_ids: string[];
  alerta_evento_id: number | null;
}

const ORIGENES: IncidenciaOrigen[] = ['terreno', 'remota'];
const CATEGORIAS: IncidenciaCategoria[] = [
  'sensor',
  'comunicacion',
  'mecanico',
  'electrico',
  'otro',
];
const GRAVEDADES: IncidenciaGravedad[] = ['leve', 'media', 'critica'];
const ESTADOS: IncidenciaEstado[] = ['abierta', 'en_progreso', 'resuelta', 'cerrada'];

function emptyDraft(): DraftIncidencia {
  return {
    titulo: '',
    descripcion: '',
    origen: 'remota',
    categoria: 'otro',
    gravedad: 'media',
    estado: 'abierta',
    tecnico_ids: [],
    alerta_evento_id: null,
  };
}

@Component({
  selector: 'app-bitacora-incidencias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    A11yModule,
    InlineErrorComponent,
    TableSkeletonComponent,
    ConfirmDialogComponent,
  ],
  template: `
    <div class="space-y-3">
      @if (errorMsg()) {
        <app-inline-error [message]="errorMsg()" />
      }

      <!-- Filtros + Nueva -->
      <header class="flex flex-wrap items-center gap-2">
        <div class="flex flex-wrap gap-1.5">
          @for (f of filtrosOrigen; track f.key) {
            <button
              type="button"
              (click)="filtroOrigen.set(f.key)"
              [attr.aria-pressed]="filtroOrigen() === f.key"
              [class]="filtroOrigenClass(f.key)"
            >
              <span class="material-symbols-outlined text-[14px]">{{ f.icon }}</span>
              {{ f.label }}
            </button>
          }
        </div>
        <span class="text-slate-300">|</span>
        <div class="flex flex-wrap gap-1.5">
          @for (f of filtrosEstado; track f.key) {
            <button
              type="button"
              (click)="filtroEstado.set(f.key)"
              [attr.aria-pressed]="filtroEstado() === f.key"
              [class]="filtroEstadoClass(f.key)"
            >
              {{ f.label }}
            </button>
          }
        </div>
        <span class="ml-auto text-caption-xs font-semibold text-slate-400">
          {{ incidenciasFiltradas().length }} incidencias
        </span>
        <button
          type="button"
          (click)="toggleNueva()"
          [attr.aria-pressed]="mostrandoNueva()"
          class="inline-flex items-center gap-1 rounded-xl border border-primary-tint-25 bg-primary-tint-08 px-3 py-1.5 text-caption font-bold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95"
        >
          <span class="material-symbols-outlined text-[14px]">{{
            mostrandoNueva() ? 'close' : 'add'
          }}</span>
          {{ mostrandoNueva() ? 'Cancelar' : 'Nueva' }}
        </button>
      </header>

      @if (mostrandoNueva()) {
        <div
          class="anim-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 px-4 backdrop-blur-md"
          animate.leave="anim-overlay-out"
          role="dialog"
          cdkTrapFocus
          cdkTrapFocusAutoCapture
          aria-modal="true"
          aria-labelledby="nueva-incidencia-title"
          (click)="onBackdrop($event)"
          (keydown.escape)="toggleNueva()"
        >
          <div
            class="anim-panel relative flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
            (click)="$event.stopPropagation()"
          >
            <div class="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
              <div class="flex items-center gap-3">
                <span
                  class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-tint-08 text-primary-container"
                >
                  <span class="material-symbols-outlined text-[20px]">add</span>
                </span>
                <h2 id="nueva-incidencia-title" class="text-h6 font-semibold text-slate-800">
                  Nueva incidencia
                </h2>
              </div>
              <button
                type="button"
                (click)="toggleNueva()"
                class="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-95"
                aria-label="Cerrar"
              >
                <span class="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div class="flex-1 overflow-y-auto px-5 py-5">
              <ng-container
                *ngTemplateOutlet="formTemplate; context: { $implicit: nuevaDraft, isNew: true }"
              ></ng-container>
            </div>

            <div
              class="flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-4"
            >
              <button
                type="button"
                (click)="toggleNueva()"
                class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-[0.98]"
              >
                Cancelar
              </button>
              <button
                type="button"
                [disabled]="saving() || !puedeGuardar(nuevaDraft)"
                (click)="guardarNueva()"
                class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span class="material-symbols-outlined text-[16px]">check</span>
                Crear
              </button>
            </div>
          </div>
        </div>
      }

      @if (loading()) {
        <app-table-skeleton [rows]="4" [columns]="4" [showHeader]="false" />
      }

      <!-- Lista -->
      <div class="space-y-2">
        @for (inc of incidenciasFiltradas(); track inc.id) {
          <article
            class="group rounded-2xl border bg-white shadow-sm transition"
            [class]="tarjetaClass(inc)"
          >
            <div class="flex items-start gap-3 p-4">
              <span
                [class]="origenIconClass(inc.origen)"
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              >
                <span class="material-symbols-outlined text-[18px]">{{
                  origenIcon(inc.origen)
                }}</span>
              </span>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-caption-xs font-bold text-slate-400">{{
                        inc.codigo
                      }}</span>
                      <span
                        [class]="gravedadClass(inc.gravedad)"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption-xs font-semibold uppercase tracking-wide"
                      >
                        <span
                          [class]="gravedadDotClass(inc.gravedad)"
                          class="h-1.5 w-1.5 rounded-full"
                        ></span>
                        {{ gravedadLabel(inc.gravedad) }}
                      </span>
                      <span
                        class="rounded-full bg-slate-100 px-2 py-0.5 text-caption-xs font-bold text-slate-500"
                      >
                        {{ categoriaLabel(inc.categoria) }}
                      </span>
                      @if (inc.alerta_evento_id) {
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-caption-xs font-bold text-amber-700"
                        >
                          <span class="material-symbols-outlined text-[12px]"
                            >notifications_active</span
                          >
                          Alerta #{{ inc.alerta_evento_id }}
                        </span>
                      }
                    </div>
                    <p class="mt-1 font-semibold text-slate-800">{{ inc.titulo }}</p>
                  </div>
                  <span
                    [class]="estadoClass(inc.estado)"
                    class="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-caption-xs font-bold"
                  >
                    <span
                      [class]="estadoDotClass(inc.estado)"
                      class="h-1.5 w-1.5 rounded-full"
                    ></span>
                    {{ estadoLabel(inc.estado) }}
                  </span>
                </div>

                @if (inc.descripcion) {
                  <p class="mt-2 text-caption leading-relaxed text-slate-500">
                    {{ inc.descripcion }}
                  </p>
                }

                <div
                  class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption-xs text-slate-400"
                >
                  <span class="flex items-center gap-1">
                    <span class="material-symbols-outlined text-[14px]">calendar_today</span>
                    {{ formatFecha(inc.created_at) }}
                  </span>
                  @if (inc.tecnico_nombre_completo) {
                    <span class="flex items-center gap-1">
                      <span class="material-symbols-outlined text-[14px]">person</span>
                      {{ inc.tecnico_nombre_completo }}
                    </span>
                  }
                  @if (inc.cerrado_at) {
                    <span class="flex items-center gap-1 text-emerald-600">
                      <span class="material-symbols-outlined text-[14px]">check_circle</span>
                      Cerrada {{ formatFecha(inc.cerrado_at) }}
                    </span>
                  }
                </div>

                @if (expandedId() === inc.id && drafts()[inc.id]) {
                  <div class="mt-4 space-y-3 border-t border-slate-100 pt-4">
                    <ng-container
                      *ngTemplateOutlet="
                        formTemplate;
                        context: { $implicit: drafts()[inc.id]!, isNew: false }
                      "
                    ></ng-container>
                    <div class="flex justify-end gap-2">
                      <button
                        type="button"
                        (click)="cancelarEdicion(inc)"
                        class="rounded-xl bg-slate-100 px-4 py-2 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-200 active:scale-95"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        [disabled]="saving() || !puedeGuardar(drafts()[inc.id]!)"
                        (click)="guardarEdicion(inc)"
                        class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-caption font-bold text-white transition-colors hover:bg-primary-container active:scale-95 disabled:opacity-50"
                      >
                        <span class="material-symbols-outlined text-[16px]">check</span>
                        Guardar
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      (click)="expandir(inc)"
                      class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-caption font-bold text-slate-600 transition-colors hover:bg-slate-50 active:scale-95"
                    >
                      <span class="material-symbols-outlined text-[14px]">edit</span>
                      Editar
                    </button>
                    @if (inc.estado !== 'cerrada') {
                      <button
                        type="button"
                        [disabled]="saving()"
                        (click)="cerrar(inc)"
                        class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-caption font-bold text-emerald-700 transition-colors hover:bg-emerald-100 active:scale-95 disabled:opacity-50"
                      >
                        <span class="material-symbols-outlined text-[14px]">check_circle</span>
                        Cerrar
                      </button>
                    }
                    <button
                      type="button"
                      (click)="eliminar(inc)"
                      class="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-caption font-bold text-rose-600 transition-colors hover:bg-rose-50 active:scale-95"
                    >
                      <span class="material-symbols-outlined text-[14px]">delete</span>
                      Eliminar
                    </button>
                  </div>
                }
              </div>
            </div>
          </article>
        } @empty {
          @if (!loading()) {
            <div
              class="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"
            >
              <span class="material-symbols-outlined text-4xl text-slate-300">checklist</span>
              <p class="mt-2 text-body-sm font-semibold text-slate-400">
                Sin incidencias con estos filtros
              </p>
            </div>
          }
        }
      </div>
    </div>

    <app-confirm-dialog
      [data]="confirmData()"
      (accept)="onConfirmAccept()"
      (dismiss)="onConfirmCancel()"
    />

    <!-- Form template reusable -->
    <ng-template #formTemplate let-draft let-isNew="isNew">
      <div class="space-y-3">
        <div>
          <label
            class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
            >Título</label
          >
          <input
            type="text"
            maxlength="120"
            [(ngModel)]="draft.titulo"
            placeholder="Ej. Tablero eléctrico con sobrecalentamiento"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
          />
        </div>

        <div>
          <label
            class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
            >Descripción</label
          >
          <textarea
            rows="3"
            maxlength="600"
            [(ngModel)]="draft.descripcion"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm text-slate-700 focus:border-primary-tint-55 focus:outline-none"
          ></textarea>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Origen</label
            >
            <select
              [(ngModel)]="draft.origen"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm font-bold text-slate-700"
            >
              @for (o of origenes; track o) {
                <option [value]="o">{{ origenLabel(o) }}</option>
              }
            </select>
          </div>
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Categoría</label
            >
            <select
              [(ngModel)]="draft.categoria"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm font-bold text-slate-700"
            >
              @for (c of categorias; track c) {
                <option [value]="c">{{ categoriaLabel(c) }}</option>
              }
            </select>
          </div>
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Gravedad</label
            >
            <select
              [(ngModel)]="draft.gravedad"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm font-bold text-slate-700"
            >
              @for (g of gravedades; track g) {
                <option [value]="g">{{ gravedadLabel(g) }}</option>
              }
            </select>
          </div>
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Estado</label
            >
            <select
              [(ngModel)]="draft.estado"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-body-sm font-bold text-slate-700"
            >
              @for (e of estados; track e) {
                <option [value]="e">{{ estadoLabel(e) }}</option>
              }
            </select>
          </div>
        </div>

        <div>
          <label
            class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
            >Técnicos asignados</label
          >
          <div class="flex flex-wrap gap-1.5">
            @for (t of tecnicos(); track t.id) {
              <button
                type="button"
                (click)="toggleTecnico(draft, t.id)"
                [attr.aria-pressed]="tecnicoSeleccionado(draft, t.id)"
                [class]="tecnicoChipClass(draft, t.id)"
              >
                @if (tecnicoSeleccionado(draft, t.id)) {
                  <span class="material-symbols-outlined text-[13px]">check</span>
                }
                {{ t.nombre }} {{ t.apellido }}
              </button>
            } @empty {
              <span class="text-caption-xs text-slate-400">Sin técnicos disponibles</span>
            }
          </div>
        </div>

        @if (isNew) {
          <div>
            <label
              class="mb-1.5 block text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
              >Evento de alerta vinculado (ID, opcional)</label
            >
            <input
              type="number"
              [(ngModel)]="draft.alerta_evento_id"
              placeholder="Ej. 123"
              class="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-body-sm text-slate-700"
            />
          </div>
        }
      </div>
    </ng-template>
  `,
})
export class BitacoraIncidenciasComponent {
  private readonly incidenciaService = inject(IncidenciaService);
  private readonly userService = inject(UserService);

  readonly sitioId = input<string>('');
  /** Búsqueda transversal desde el header de Bitácora. */
  readonly search = input<string>('');
  readonly empresaId = input<string>('');

  readonly origenes = ORIGENES;
  readonly categorias = CATEGORIAS;
  readonly gravedades = GRAVEDADES;
  readonly estados = ESTADOS;

  readonly filtroOrigen = signal<IncidenciaOrigen | 'todos'>('todos');
  readonly filtroEstado = signal<IncidenciaEstado | 'todos'>('todos');

  readonly incidencias = signal<IncidenciaRow[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly errorMsg = signal<string | null>(null);
  readonly mostrandoNueva = signal(false);
  readonly expandedId = signal<number | null>(null);
  readonly drafts = signal<Record<number, DraftIncidencia>>({});
  /** Técnicos asignables: equipo Emeltec (SuperAdmin), no usuarios del cliente. */
  readonly tecnicos = signal<Tecnico[]>([]);

  // Confirmación con modal del proyecto (reemplaza confirm() nativo).
  readonly confirmData = signal<ConfirmDialogData | null>(null);
  private pendingConfirm: (() => void) | null = null;

  private askConfirm(data: ConfirmDialogData, action: () => void): void {
    this.pendingConfirm = action;
    this.confirmData.set(data);
  }

  onConfirmAccept(): void {
    const action = this.pendingConfirm;
    this.pendingConfirm = null;
    this.confirmData.set(null);
    action?.();
  }

  onConfirmCancel(): void {
    this.pendingConfirm = null;
    this.confirmData.set(null);
  }

  nuevaDraft: DraftIncidencia = emptyDraft();

  readonly filtrosOrigen: { key: IncidenciaOrigen | 'todos'; label: string; icon: string }[] = [
    { key: 'todos', label: 'Todos', icon: 'list' },
    { key: 'terreno', label: 'Terreno', icon: 'construction' },
    { key: 'remota', label: 'Remota', icon: 'wifi' },
  ];

  readonly filtrosEstado: { key: IncidenciaEstado | 'todos'; label: string }[] = [
    { key: 'todos', label: 'Todos' },
    { key: 'abierta', label: 'Abierta' },
    { key: 'en_progreso', label: 'En progreso' },
    { key: 'resuelta', label: 'Resuelta' },
    { key: 'cerrada', label: 'Cerrada' },
  ];

  constructor() {
    effect(() => {
      const sid = this.sitioId();
      if (sid) this.recargar();
    });
    this.cargarTecnicos();
  }

  private recargar(): void {
    const sid = this.sitioId();
    if (!sid) return;
    this.loading.set(true);
    this.errorMsg.set(null);
    this.incidenciaService.listar({ sitio_id: sid, limit: 200 }).subscribe({
      next: (rows) => {
        this.incidencias.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'Error cargando incidencias');
        this.loading.set(false);
      },
    });
  }

  tecnicoSeleccionado(d: DraftIncidencia, id: string): boolean {
    return d.tecnico_ids.includes(id);
  }

  toggleTecnico(d: DraftIncidencia, id: string): void {
    d.tecnico_ids = this.tecnicoSeleccionado(d, id)
      ? d.tecnico_ids.filter((x) => x !== id)
      : [...d.tecnico_ids, id];
  }

  tecnicoChipClass(d: DraftIncidencia, id: string): string {
    const base =
      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-caption-xs font-semibold transition-colors active:scale-95 ';
    return this.tecnicoSeleccionado(d, id)
      ? base + 'border-primary-tint-35 bg-primary-tint-14 text-primary-container'
      : base + 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50';
  }

  private cargarTecnicos(): void {
    this.userService.getTecnicos().subscribe({
      next: (res) => {
        if (res.ok) this.tecnicos.set(res.data);
      },
    });
  }

  readonly incidenciasFiltradas = computed(() => {
    const fo = this.filtroOrigen();
    const fe = this.filtroEstado();
    const q = this.search().trim().toLowerCase();
    return this.incidencias().filter((i) => {
      if (fo !== 'todos' && i.origen !== fo) return false;
      if (fe !== 'todos' && i.estado !== fe) return false;
      if (q) {
        const hay = `${i.codigo} ${i.titulo} ${i.descripcion ?? ''} ${i.categoria}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  toggleNueva(): void {
    if (this.mostrandoNueva()) {
      this.mostrandoNueva.set(false);
      this.nuevaDraft = emptyDraft();
    } else {
      this.nuevaDraft = emptyDraft();
      this.mostrandoNueva.set(true);
    }
  }

  /** Cierra el modal solo si el click cae en el backdrop, no en el panel. */
  onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.toggleNueva();
  }

  expandir(inc: IncidenciaRow): void {
    if (this.expandedId() === inc.id) {
      this.expandedId.set(null);
      return;
    }
    this.drafts.update((d) => ({
      ...d,
      [inc.id]: {
        titulo: inc.titulo,
        descripcion: inc.descripcion ?? '',
        origen: inc.origen,
        categoria: inc.categoria,
        gravedad: inc.gravedad,
        estado: inc.estado,
        tecnico_ids: (inc.tecnicos ?? []).map((t) => t.id),
        alerta_evento_id: inc.alerta_evento_id,
      },
    }));
    this.expandedId.set(inc.id);
  }

  cancelarEdicion(inc: IncidenciaRow): void {
    this.expandedId.set(null);
    this.drafts.update((d) => {
      const next = { ...d };
      delete next[inc.id];
      return next;
    });
  }

  puedeGuardar(d: DraftIncidencia): boolean {
    return !!d.titulo.trim();
  }

  guardarNueva(): void {
    const sid = this.sitioId();
    const eid = this.empresaId();
    if (!sid || !eid) {
      this.errorMsg.set('Falta sitio o empresa');
      return;
    }
    const payload: CreateIncidenciaPayload = {
      sitio_id: sid,
      empresa_id: eid,
      titulo: this.nuevaDraft.titulo.trim(),
      descripcion: this.nuevaDraft.descripcion.trim() || null,
      origen: this.nuevaDraft.origen,
      categoria: this.nuevaDraft.categoria,
      gravedad: this.nuevaDraft.gravedad,
      estado: this.nuevaDraft.estado,
      tecnico_ids: this.nuevaDraft.tecnico_ids,
      alerta_evento_id: this.nuevaDraft.alerta_evento_id || null,
    };
    this.saving.set(true);
    this.errorMsg.set(null);
    this.incidenciaService.crear(payload).subscribe({
      next: (row) => {
        this.incidencias.update((rs) => [row, ...rs]);
        this.mostrandoNueva.set(false);
        this.nuevaDraft = emptyDraft();
        this.saving.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'No se pudo crear la incidencia');
        this.saving.set(false);
      },
    });
  }

  guardarEdicion(inc: IncidenciaRow): void {
    const draft = this.drafts()[inc.id];
    if (!draft) return;
    this.askConfirm(
      {
        title: 'Guardar cambios',
        message: `¿Confirmás los cambios en la incidencia "${draft.titulo.trim() || inc.titulo}"?`,
        confirmText: 'Guardar',
        tone: 'primary',
        icon: 'edit',
      },
      () => this.doGuardarEdicion(inc),
    );
  }

  private doGuardarEdicion(inc: IncidenciaRow): void {
    const draft = this.drafts()[inc.id];
    if (!draft) return;
    this.saving.set(true);
    this.errorMsg.set(null);
    this.incidenciaService
      .actualizar(inc.id, {
        titulo: draft.titulo.trim(),
        descripcion: draft.descripcion.trim() || null,
        origen: draft.origen,
        categoria: draft.categoria,
        gravedad: draft.gravedad,
        estado: draft.estado,
        tecnico_ids: draft.tecnico_ids,
      })
      .subscribe({
        next: (updated) => {
          this.incidencias.update((rs) => rs.map((r) => (r.id === inc.id ? updated : r)));
          this.cancelarEdicion(inc);
          this.saving.set(false);
        },
        error: (err) => {
          this.errorMsg.set(err?.error?.error || 'No se pudo actualizar');
          this.saving.set(false);
        },
      });
  }

  cerrar(inc: IncidenciaRow): void {
    this.saving.set(true);
    this.incidenciaService.actualizar(inc.id, { estado: 'cerrada' }).subscribe({
      next: (updated) => {
        this.incidencias.update((rs) => rs.map((r) => (r.id === inc.id ? updated : r)));
        this.saving.set(false);
      },
      error: (err) => {
        this.errorMsg.set(err?.error?.error || 'No se pudo cerrar');
        this.saving.set(false);
      },
    });
  }

  eliminar(inc: IncidenciaRow): void {
    this.askConfirm(
      {
        title: 'Eliminar incidencia',
        message: `¿Eliminar la incidencia "${inc.titulo}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        tone: 'danger',
        icon: 'delete',
      },
      () => {
        this.incidenciaService.eliminar(inc.id).subscribe({
          next: () => this.incidencias.update((rs) => rs.filter((r) => r.id !== inc.id)),
          error: (err) => this.errorMsg.set(err?.error?.error || 'No se pudo eliminar'),
        });
      },
    );
  }

  origenIcon(o: IncidenciaOrigen): string {
    return o === 'terreno' ? 'construction' : 'wifi';
  }

  origenIconClass(o: IncidenciaOrigen): string {
    return o === 'terreno'
      ? 'bg-orange-50 text-orange-600'
      : 'bg-primary-tint-08 text-primary-container';
  }

  origenLabel(o: IncidenciaOrigen): string {
    return ORIGEN_LABELS[o];
  }

  categoriaLabel(c: IncidenciaCategoria): string {
    return CATEGORIA_LABELS[c];
  }

  gravedadLabel(g: IncidenciaGravedad): string {
    return GRAVEDAD_LABELS[g];
  }

  estadoLabel(e: IncidenciaEstado): string {
    return ESTADO_LABELS[e];
  }

  tarjetaClass(inc: IncidenciaRow): string {
    if (inc.estado === 'cerrada') return 'border-slate-100 opacity-70';
    if (inc.gravedad === 'critica') return 'border-rose-200';
    if (inc.gravedad === 'media') return 'border-amber-200';
    return 'border-slate-200';
  }

  gravedadClass(g: IncidenciaGravedad): string {
    if (g === 'critica') return 'bg-rose-50 text-rose-600';
    if (g === 'media') return 'bg-amber-50 text-amber-600';
    return 'bg-emerald-50 text-emerald-600';
  }

  gravedadDotClass(g: IncidenciaGravedad): string {
    if (g === 'critica') return 'bg-rose-500';
    if (g === 'media') return 'bg-amber-500';
    return 'bg-emerald-500';
  }

  estadoClass(e: IncidenciaEstado): string {
    const map: Record<IncidenciaEstado, string> = {
      abierta: 'bg-rose-50 text-rose-600',
      en_progreso: 'bg-amber-50 text-amber-700',
      resuelta: 'bg-primary-tint-08 text-primary-container',
      cerrada: 'bg-slate-100 text-slate-500',
    };
    return map[e];
  }

  estadoDotClass(e: IncidenciaEstado): string {
    const map: Record<IncidenciaEstado, string> = {
      abierta: 'bg-rose-500',
      en_progreso: 'bg-amber-500',
      resuelta: 'bg-primary/10',
      cerrada: 'bg-slate-400',
    };
    return map[e];
  }

  filtroOrigenClass(key: IncidenciaOrigen | 'todos'): string {
    const active = this.filtroOrigen() === key;
    return [
      'inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-caption font-bold transition active:scale-95',
      active
        ? 'bg-primary-tint-08 text-primary-container ring-1 ring-primary-tint-30'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  filtroEstadoClass(key: IncidenciaEstado | 'todos'): string {
    const active = this.filtroEstado() === key;
    return [
      'rounded-xl px-3 py-1.5 text-caption font-bold transition active:scale-95',
      active
        ? 'bg-slate-800 text-white'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  formatFecha(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
