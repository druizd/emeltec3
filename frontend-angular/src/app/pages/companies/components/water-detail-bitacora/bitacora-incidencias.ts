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
import type { User } from '@emeltec/shared';
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
import { UserService } from '../../../../services/user.service';

interface DraftIncidencia {
  titulo: string;
  descripcion: string;
  origen: IncidenciaOrigen;
  categoria: IncidenciaCategoria;
  gravedad: IncidenciaGravedad;
  estado: IncidenciaEstado;
  tecnico_id: string | null;
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
    tecnico_id: null,
    alerta_evento_id: null,
  };
}

@Component({
  selector: 'app-bitacora-incidencias',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">
      @if (errorMsg()) {
        <p class="rounded-xl bg-rose-50 px-4 py-3 text-[12px] text-rose-700">{{ errorMsg() }}</p>
      }

      <!-- Filtros + Nueva -->
      <header class="flex flex-wrap items-center gap-2">
        <div class="flex flex-wrap gap-1.5">
          @for (f of filtrosOrigen; track f.key) {
            <button
              type="button"
              (click)="filtroOrigen.set(f.key)"
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
              [class]="filtroEstadoClass(f.key)"
            >
              {{ f.label }}
            </button>
          }
        </div>
        <span class="ml-auto text-[11px] font-semibold text-slate-400">
          {{ incidenciasFiltradas().length }} incidencias
        </span>
        <button
          type="button"
          (click)="toggleNueva()"
          class="inline-flex items-center gap-1 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-[12px] font-bold text-cyan-700 hover:bg-cyan-100"
        >
          <span class="material-symbols-outlined text-[14px]">{{
            mostrandoNueva() ? 'close' : 'add'
          }}</span>
          {{ mostrandoNueva() ? 'Cancelar' : 'Nueva' }}
        </button>
      </header>

      @if (mostrandoNueva()) {
        <article class="rounded-2xl border-2 border-dashed border-cyan-200 bg-cyan-50/30 p-4">
          <p class="mb-3 text-[10px] font-black uppercase tracking-widest text-cyan-700">
            Nueva incidencia
          </p>
          <ng-container
            *ngTemplateOutlet="formTemplate; context: { $implicit: nuevaDraft, isNew: true }"
          ></ng-container>
          <div class="mt-4 flex justify-end gap-2">
            <button
              type="button"
              (click)="toggleNueva()"
              class="rounded-xl bg-slate-100 px-4 py-2 text-[12px] font-bold text-slate-600 hover:bg-slate-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              [disabled]="saving() || !puedeGuardar(nuevaDraft)"
              (click)="guardarNueva()"
              class="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              <span class="material-symbols-outlined text-[16px]">check</span>
              Crear
            </button>
          </div>
        </article>
      }

      @if (loading()) {
        <p class="rounded-xl bg-slate-50 px-4 py-3 text-[12px] text-slate-500">
          Cargando incidencias…
        </p>
      }

      <!-- Lista -->
      <div class="space-y-2">
        @for (inc of incidenciasFiltradas(); track inc.id) {
          <article
            class="group rounded-2xl border bg-white shadow-sm transition-all"
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
                      <span class="font-mono text-[11px] font-bold text-slate-400">{{
                        inc.codigo
                      }}</span>
                      <span
                        [class]="gravedadClass(inc.gravedad)"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide"
                      >
                        <span
                          [class]="gravedadDotClass(inc.gravedad)"
                          class="h-1.5 w-1.5 rounded-full"
                        ></span>
                        {{ gravedadLabel(inc.gravedad) }}
                      </span>
                      <span
                        class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500"
                      >
                        {{ categoriaLabel(inc.categoria) }}
                      </span>
                      @if (inc.alerta_evento_id) {
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                        >
                          <span class="material-symbols-outlined text-[12px]"
                            >notifications_active</span
                          >
                          Alerta #{{ inc.alerta_evento_id }}
                        </span>
                      }
                    </div>
                    <p class="mt-1 font-black text-slate-800">{{ inc.titulo }}</p>
                  </div>
                  <span
                    [class]="estadoClass(inc.estado)"
                    class="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"
                  >
                    <span
                      [class]="estadoDotClass(inc.estado)"
                      class="h-1.5 w-1.5 rounded-full"
                    ></span>
                    {{ estadoLabel(inc.estado) }}
                  </span>
                </div>

                @if (inc.descripcion) {
                  <p class="mt-2 text-[12px] leading-relaxed text-slate-500">
                    {{ inc.descripcion }}
                  </p>
                }

                <div
                  class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400"
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
                        class="rounded-xl bg-slate-100 px-4 py-2 text-[12px] font-bold text-slate-600 hover:bg-slate-200"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        [disabled]="saving() || !puedeGuardar(drafts()[inc.id]!)"
                        (click)="guardarEdicion(inc)"
                        class="inline-flex items-center gap-1.5 rounded-xl bg-cyan-600 px-4 py-2 text-[12px] font-bold text-white hover:bg-cyan-700 disabled:opacity-50"
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
                      class="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 hover:bg-slate-50"
                    >
                      <span class="material-symbols-outlined text-[14px]">edit</span>
                      Editar
                    </button>
                    @if (inc.estado !== 'cerrada') {
                      <button
                        type="button"
                        [disabled]="saving()"
                        (click)="cerrar(inc)"
                        class="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <span class="material-symbols-outlined text-[14px]">check_circle</span>
                        Cerrar
                      </button>
                    }
                    <button
                      type="button"
                      (click)="eliminar(inc)"
                      class="ml-auto inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-[12px] font-bold text-rose-600 hover:bg-rose-50"
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
              <p class="mt-2 text-sm font-semibold text-slate-400">
                Sin incidencias con estos filtros
              </p>
            </div>
          }
        }
      </div>
    </div>

    <!-- Form template reusable -->
    <ng-template #formTemplate let-draft let-isNew="isNew">
      <div class="space-y-3">
        <div>
          <label
            class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
            >Título</label
          >
          <input
            type="text"
            [(ngModel)]="draft.titulo"
            placeholder="Ej. Tablero eléctrico con sobrecalentamiento"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
          />
        </div>

        <div>
          <label
            class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
            >Descripción</label
          >
          <textarea
            rows="3"
            [(ngModel)]="draft.descripcion"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-cyan-400 focus:outline-none"
          ></textarea>
        </div>

        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label
              class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Origen</label
            >
            <select
              [(ngModel)]="draft.origen"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
            >
              @for (o of origenes; track o) {
                <option [value]="o">{{ origenLabel(o) }}</option>
              }
            </select>
          </div>
          <div>
            <label
              class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Categoría</label
            >
            <select
              [(ngModel)]="draft.categoria"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
            >
              @for (c of categorias; track c) {
                <option [value]="c">{{ categoriaLabel(c) }}</option>
              }
            </select>
          </div>
          <div>
            <label
              class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Gravedad</label
            >
            <select
              [(ngModel)]="draft.gravedad"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
            >
              @for (g of gravedades; track g) {
                <option [value]="g">{{ gravedadLabel(g) }}</option>
              }
            </select>
          </div>
          <div>
            <label
              class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Estado</label
            >
            <select
              [(ngModel)]="draft.estado"
              class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700"
            >
              @for (e of estados; track e) {
                <option [value]="e">{{ estadoLabel(e) }}</option>
              }
            </select>
          </div>
        </div>

        <div>
          <label
            class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
            >Técnico asignado</label
          >
          <select
            [(ngModel)]="draft.tecnico_id"
            class="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option [ngValue]="null">Sin asignar</option>
            @for (u of usuariosEmpresa(); track u.id) {
              <option [ngValue]="u.id">{{ u.nombre }} {{ u.apellido }}</option>
            }
          </select>
        </div>

        @if (isNew) {
          <div>
            <label
              class="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >Evento de alerta vinculado (ID, opcional)</label
            >
            <input
              type="number"
              [(ngModel)]="draft.alerta_evento_id"
              placeholder="Ej. 123"
              class="w-32 rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-700"
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
  readonly usuariosEmpresa = signal<User[]>([]);

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
    effect(() => {
      const eid = this.empresaId();
      if (eid) this.cargarUsuarios(eid);
    });
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

  private cargarUsuarios(empresaId: string): void {
    this.userService.getUsers({ empresa_id: empresaId }).subscribe({
      next: (res) => {
        if (res.ok) this.usuariosEmpresa.set(res.data);
      },
    });
  }

  readonly incidenciasFiltradas = computed(() => {
    const fo = this.filtroOrigen();
    const fe = this.filtroEstado();
    return this.incidencias().filter((i) => {
      if (fo !== 'todos' && i.origen !== fo) return false;
      if (fe !== 'todos' && i.estado !== fe) return false;
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
        tecnico_id: inc.tecnico_id,
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
      tecnico_id: this.nuevaDraft.tecnico_id || null,
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
        tecnico_id: draft.tecnico_id || null,
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
    if (!confirm(`¿Eliminar incidencia "${inc.titulo}"? No se puede deshacer.`)) return;
    this.incidenciaService.eliminar(inc.id).subscribe({
      next: () => this.incidencias.update((rs) => rs.filter((r) => r.id !== inc.id)),
      error: (err) => this.errorMsg.set(err?.error?.error || 'No se pudo eliminar'),
    });
  }

  origenIcon(o: IncidenciaOrigen): string {
    return o === 'terreno' ? 'construction' : 'wifi';
  }

  origenIconClass(o: IncidenciaOrigen): string {
    return o === 'terreno' ? 'bg-orange-50 text-orange-600' : 'bg-cyan-50 text-cyan-600';
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
      resuelta: 'bg-cyan-50 text-cyan-700',
      cerrada: 'bg-slate-100 text-slate-500',
    };
    return map[e];
  }

  estadoDotClass(e: IncidenciaEstado): string {
    const map: Record<IncidenciaEstado, string> = {
      abierta: 'bg-rose-500',
      en_progreso: 'bg-amber-500',
      resuelta: 'bg-cyan-500',
      cerrada: 'bg-slate-400',
    };
    return map[e];
  }

  filtroOrigenClass(key: IncidenciaOrigen | 'todos'): string {
    const active = this.filtroOrigen() === key;
    return [
      'inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[12px] font-bold transition-all',
      active
        ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
        : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50',
    ].join(' ');
  }

  filtroEstadoClass(key: IncidenciaEstado | 'todos'): string {
    const active = this.filtroEstado() === key;
    return [
      'rounded-xl px-3 py-1.5 text-[12px] font-bold transition-all',
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
