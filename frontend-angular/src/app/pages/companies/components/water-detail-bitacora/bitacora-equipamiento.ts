/**
 * Bitácora — Equipamiento del sitio.
 * Conectado a /api/v2/sites/:siteId/bitacora/equipos via BitacoraSitioService.
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  BitacoraSitioService,
  type CreateEquipoPayload,
  type EquipoEstado,
  type SitioEquipo,
} from '../../../../services/bitacora-sitio.service';
import {
  DocumentoService,
  type DocumentoRow,
} from '../../../../services/documento.service';
import { TableSkeletonComponent } from '../../../../components/ui/table-skeleton';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../../../components/ui/confirm-dialog';

@Component({
  selector: 'app-bitacora-equipamiento',
  standalone: true,
  imports: [CommonModule, FormsModule, TableSkeletonComponent, ConfirmDialogComponent],
  template: `
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <p class="text-caption-xs font-semibold text-slate-500">
          {{ equipos().length }} equipos registrados
        </p>
        <button
          type="button"
          (click)="openForm()"
          class="inline-flex items-center gap-1.5 rounded-xl border border-primary-tint-25 bg-primary-tint-08 px-3 py-2 text-caption font-bold text-primary-container transition-colors hover:bg-primary-tint-14 active:scale-95"
        >
          <span class="material-symbols-outlined text-[16px]" aria-hidden="true">add</span>
          Registrar equipo
        </button>
      </div>

      @if (loading()) {
        <app-table-skeleton [rows]="4" [columns]="4" [showHeader]="false" />
      } @else if (equipos().length === 0) {
        <div
          class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-body-sm text-slate-500"
        >
          <span class="material-symbols-outlined mb-2 block text-[28px] text-slate-300"
            >precision_manufacturing</span
          >
          No hay equipos registrados todavía.
        </div>
      } @else {
        <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[860px] text-left text-body-sm">
              <thead>
                <tr class="border-b border-slate-100 bg-slate-50">
                  <th
                    class="px-3 py-2 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Equipo
                  </th>
                  <th
                    class="px-3 py-2 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Fabricante / Modelo
                  </th>
                  <th
                    class="px-3 py-2 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    N° Serie
                  </th>
                  <th
                    class="px-3 py-2 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Compra
                  </th>
                  <th
                    class="px-3 py-2 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Garantía
                  </th>
                  <th
                    class="px-3 py-2 text-caption-xs font-semibold uppercase tracking-widest text-slate-400"
                  >
                    Estado
                  </th>
                  <th class="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (eq of equipos(); track eq.id) {
                  <tr class="group hover:bg-slate-50/60">
                    <td class="px-3 py-2 font-semibold text-slate-800">
                      {{ eq.nombre }}
                      @if (eq.documento_ids.length) {
                        <span
                          class="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-caption-xs font-semibold text-slate-500"
                          [title]="eq.documento_ids.length + ' documento(s) vinculado(s)'"
                        >
                          <span class="material-symbols-outlined text-[12px]" aria-hidden="true"
                            >description</span
                          >
                          {{ eq.documento_ids.length }}
                        </span>
                      }
                    </td>
                    <td class="px-3 py-2 text-slate-600">
                      <span class="font-semibold">{{ eq.fabricante || '—' }}</span>
                      <span class="block text-caption-xs text-slate-500">{{
                        eq.modelo || '—'
                      }}</span>
                    </td>
                    <td class="px-3 py-2 font-mono text-caption-xs text-slate-500">
                      {{ eq.serie || '—' }}
                    </td>
                    <td class="px-3 py-2 font-mono text-caption-xs text-slate-500">
                      {{ eq.fecha_compra || '—' }}
                    </td>
                    <td
                      [class]="
                        'px-3 py-2 font-mono text-caption-xs ' + garantiaClass(eq.garantia_hasta)
                      "
                    >
                      {{ eq.garantia_hasta || '—' }}
                    </td>
                    <td class="px-3 py-2">
                      <span
                        [class]="
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-caption-xs font-bold ' +
                          estadoClass(eq.estado)
                        "
                      >
                        <span
                          [class]="'h-1.5 w-1.5 rounded-full ' + estadoDotClass(eq.estado)"
                        ></span>
                        {{ estadoLabel(eq.estado) }}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-right">
                      <button
                        type="button"
                        (click)="openForm(eq)"
                        class="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 active:scale-95"
                        title="Editar"
                        aria-label="Editar"
                      >
                        <span class="material-symbols-outlined text-[16px]" aria-hidden="true">edit</span>
                      </button>
                      <button
                        type="button"
                        (click)="onDelete(eq)"
                        class="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 active:scale-95"
                        title="Eliminar"
                        aria-label="Eliminar"
                      >
                        <span class="material-symbols-outlined text-[16px]" aria-hidden="true">delete</span>
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      @if (error()) {
        <div class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-caption text-red-700">
          {{ error() }}
        </div>
      }
    </div>

    <!-- Form modal -->
    @if (formOpen()) {
      <div
        class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/60 px-4 backdrop-blur-sm"
        (click)="closeForm($event)"
      >
        <div
          class="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h3 class="text-body-sm font-semibold uppercase tracking-wide text-slate-700">
              {{ editingId() ? 'Editar equipo' : 'Registrar equipo' }}
            </h3>
            <button
              type="button"
              (click)="cancelForm()"
              class="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 active:scale-95"
              aria-label="Cerrar"
            >
              <span class="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
            </button>
          </div>
          <div class="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
            <label
              class="col-span-2 grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              Nombre
              <input
                type="text"
                maxlength="80"
                [ngModel]="form().nombre"
                (ngModelChange)="updateForm('nombre', $event)"
                placeholder="Ej. Caudalímetro principal"
                class="h-9 rounded border border-slate-200 px-2 text-body-sm outline-none focus:border-primary-tint-35"
              />
            </label>
            <label
              class="grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              Fabricante
              <input
                type="text"
                maxlength="60"
                [ngModel]="form().fabricante"
                (ngModelChange)="updateForm('fabricante', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-body-sm outline-none focus:border-primary-tint-35"
              />
            </label>
            <label
              class="grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              Modelo
              <input
                type="text"
                maxlength="60"
                [ngModel]="form().modelo"
                (ngModelChange)="updateForm('modelo', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-body-sm outline-none focus:border-primary-tint-35"
              />
            </label>
            <label
              class="col-span-2 grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              N° Serie
              <input
                type="text"
                maxlength="50"
                [ngModel]="form().serie"
                (ngModelChange)="updateForm('serie', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-body-sm font-mono outline-none focus:border-primary-tint-35"
              />
            </label>
            <label
              class="grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              Fecha compra
              <input
                type="date"
                min="2000-01-01"
                [ngModel]="form().fecha_compra"
                (ngModelChange)="updateForm('fecha_compra', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-body-sm font-mono outline-none focus:border-primary-tint-35"
              />
            </label>
            <label
              class="grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              Garantía hasta
              <input
                type="date"
                min="2000-01-01"
                [ngModel]="form().garantia_hasta"
                (ngModelChange)="updateForm('garantia_hasta', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-body-sm font-mono outline-none focus:border-primary-tint-35"
              />
            </label>
            <label
              class="col-span-2 grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              Estado
              <select
                [ngModel]="form().estado"
                (ngModelChange)="updateForm('estado', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-body-sm outline-none focus:border-primary-tint-35"
              >
                <option value="operativo">Operativo</option>
                <option value="en_mantencion">En mantención</option>
                <option value="fuera_de_servicio">Fuera de servicio</option>
              </select>
            </label>
            <label
              class="col-span-2 grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              Notas
              <textarea
                rows="3"
                maxlength="500"
                [ngModel]="form().notas"
                (ngModelChange)="updateForm('notas', $event)"
                class="rounded border border-slate-200 px-2 py-1.5 text-body-sm outline-none focus:border-primary-tint-35"
              ></textarea>
            </label>
            <div
              class="col-span-2 grid gap-1 text-caption-xs uppercase tracking-wider font-semibold text-slate-500"
            >
              Documentos vinculados
              @if (linkedDocs().length) {
                <div class="flex flex-wrap gap-1.5">
                  @for (doc of linkedDocs(); track doc.id) {
                    <span
                      class="inline-flex items-center gap-1 rounded-full border border-primary-tint-35 bg-primary-tint-10 px-2 py-0.5 text-caption-xs font-semibold normal-case text-primary"
                    >
                      <span class="material-symbols-outlined text-[13px]" aria-hidden="true"
                        >description</span
                      >
                      {{ doc.titulo }}
                      <button
                        type="button"
                        (click)="removeDoc(doc.id + '')"
                        class="rounded-full p-0.5 transition-colors hover:bg-primary/10 active:scale-95"
                        [attr.aria-label]="'Quitar ' + doc.titulo"
                      >
                        <span class="material-symbols-outlined text-[13px]" aria-hidden="true"
                          >close</span
                        >
                      </button>
                    </span>
                  }
                </div>
              }
              <div class="relative">
                <input
                  type="text"
                  [ngModel]="docSearch()"
                  (ngModelChange)="docSearch.set($event)"
                  placeholder="Buscar documento del sitio…"
                  class="h-9 w-full rounded border border-slate-200 px-2 text-body-sm font-normal normal-case tracking-normal outline-none focus:border-primary-tint-35"
                />
                @if (docSearch() && docSuggestions().length) {
                  <ul
                    class="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg"
                  >
                    @for (doc of docSuggestions(); track doc.id) {
                      <li>
                        <button
                          type="button"
                          (click)="addDoc(doc)"
                          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm font-normal normal-case tracking-normal text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <span class="material-symbols-outlined text-[15px] text-slate-400" aria-hidden="true"
                            >description</span
                          >
                          {{ doc.titulo }}
                        </button>
                      </li>
                    }
                  </ul>
                }
                @if (docSearch() && !docSuggestions().length) {
                  <p class="mt-1 text-caption-xs font-normal normal-case tracking-normal text-slate-400">
                    Sin documentos que coincidan.
                  </p>
                }
              </div>
            </div>
          </div>
          <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              (click)="cancelForm()"
              class="rounded px-3 py-1.5 text-body-sm font-semibold text-slate-500 transition-colors hover:bg-slate-50 active:scale-95"
            >
              Cancelar
            </button>
            <button
              type="button"
              (click)="save()"
              [disabled]="!form().nombre || saving()"
              class="rounded bg-primary px-4 py-1.5 text-body-sm font-bold text-white transition-colors hover:bg-primary-container active:scale-95 disabled:opacity-40"
            >
              {{ saving() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </div>
      </div>
    }

    <app-confirm-dialog
      [data]="confirmData()"
      (accept)="onConfirmAccept()"
      (dismiss)="onConfirmCancel()"
    />
  `,
})
export class BitacoraEquipamientoComponent implements OnInit {
  private readonly api = inject(BitacoraSitioService);
  private readonly documentoService = inject(DocumentoService);

  readonly sitioId = input<string>('');

  readonly equipos = signal<SitioEquipo[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string>('');
  readonly saving = signal<boolean>(false);
  readonly formOpen = signal<boolean>(false);
  readonly editingId = signal<string>('');
  readonly form = signal<CreateEquipoPayload>(this.emptyForm());

  // ---- Documentos vinculables ----
  // Todos los documentos del sitio (para resolver título y ofrecer en el buscador).
  readonly docs = signal<DocumentoRow[]>([]);
  // Ids (string) de docs ligados al equipo en edición.
  readonly linkedDocIds = signal<string[]>([]);
  // Texto del buscador de documentos.
  readonly docSearch = signal<string>('');

  /** Docs ya ligados, resueltos a fila (para pintar los chips). */
  readonly linkedDocs = computed<DocumentoRow[]>(() => {
    const linked = new Set(this.linkedDocIds());
    return this.docs().filter((d) => linked.has(String(d.id)));
  });

  /** Sugerencias del buscador: docs no ligados que matchean el texto. Máx 8. */
  readonly docSuggestions = computed<DocumentoRow[]>(() => {
    const linked = new Set(this.linkedDocIds());
    const q = this.docSearch().trim().toLowerCase();
    return this.docs()
      .filter((d) => !linked.has(String(d.id)))
      .filter((d) => (q ? d.titulo.toLowerCase().includes(q) : true))
      .slice(0, 8);
  });

  addDoc(doc: DocumentoRow): void {
    const id = String(doc.id);
    this.linkedDocIds.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
    this.docSearch.set('');
  }

  removeDoc(id: string): void {
    this.linkedDocIds.update((ids) => ids.filter((x) => x !== id));
  }

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

  ngOnInit(): void {
    this.reload();
  }

  private emptyForm(): CreateEquipoPayload {
    return {
      nombre: '',
      modelo: '',
      fabricante: '',
      serie: '',
      fecha_compra: '',
      garantia_hasta: '',
      estado: 'operativo',
      notas: '',
      documento_ids: [],
    };
  }

  reload(): void {
    if (!this.sitioId()) return;
    this.loading.set(true);
    this.error.set('');
    // Docs del sitio para resolver títulos y alimentar el buscador.
    this.documentoService.listar({ sitio_id: this.sitioId(), limit: 200 }).subscribe({
      next: (rows) => this.docs.set(rows),
      error: () => this.docs.set([]),
    });
    this.api.listEquipos(this.sitioId()).subscribe({
      next: (rows) => {
        this.equipos.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(
          'No se pudo cargar equipos: ' + (err?.error?.error?.message ?? err?.message ?? ''),
        );
        this.loading.set(false);
      },
    });
  }

  openForm(eq?: SitioEquipo): void {
    this.docSearch.set('');
    if (eq) {
      this.editingId.set(eq.id);
      this.linkedDocIds.set([...(eq.documento_ids ?? [])]);
      this.form.set({
        nombre: eq.nombre,
        modelo: eq.modelo ?? '',
        fabricante: eq.fabricante ?? '',
        serie: eq.serie ?? '',
        fecha_compra: eq.fecha_compra ?? '',
        garantia_hasta: eq.garantia_hasta ?? '',
        estado: eq.estado,
        notas: eq.notas ?? '',
      });
    } else {
      this.editingId.set('');
      this.linkedDocIds.set([]);
      this.form.set(this.emptyForm());
    }
    this.formOpen.set(true);
  }

  cancelForm(): void {
    this.formOpen.set(false);
  }

  closeForm(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.cancelForm();
  }

  updateForm(field: keyof CreateEquipoPayload, value: unknown): void {
    this.form.update((f) => ({ ...f, [field]: value as never }));
  }

  save(): void {
    const f = this.form();
    if (!f.nombre?.trim()) return;
    // Al editar un equipo existente, pedimos confirmación. Al crear uno
    // nuevo no hace falta (no hay dato previo que se sobrescriba).
    if (this.editingId()) {
      this.askConfirm(
        {
          title: 'Guardar cambios',
          message: `¿Confirmás los cambios en el equipo "${f.nombre.trim()}"?`,
          confirmText: 'Guardar',
          tone: 'primary',
          icon: 'edit',
        },
        () => this.doSave(),
      );
      return;
    }
    this.doSave();
  }

  private doSave(): void {
    const f = this.form();
    if (!f.nombre?.trim()) return;
    // Limpiar strings vacíos a null para que backend acepte.
    const clean = (v: string | null | undefined) => (v && String(v).trim() !== '' ? v : null);
    const payload: CreateEquipoPayload = {
      nombre: f.nombre.trim(),
      modelo: clean(f.modelo),
      fabricante: clean(f.fabricante),
      serie: clean(f.serie),
      fecha_compra: clean(f.fecha_compra),
      garantia_hasta: clean(f.garantia_hasta),
      estado: f.estado ?? 'operativo',
      notas: clean(f.notas),
      documento_ids: this.linkedDocIds(),
    };
    this.saving.set(true);
    this.error.set('');

    const id = this.editingId();
    const obs = id
      ? this.api.patchEquipo(id, payload)
      : this.api.createEquipo(this.sitioId(), payload);

    obs.subscribe({
      next: (row) => {
        this.saving.set(false);
        if (id) {
          this.equipos.update((list) => list.map((e) => (e.id === id ? row : e)));
        } else {
          this.equipos.update((list) => [row, ...list]);
        }
        this.formOpen.set(false);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set('No se pudo guardar: ' + (err?.error?.error?.message ?? err?.message ?? ''));
      },
    });
  }

  onDelete(eq: SitioEquipo): void {
    this.askConfirm(
      {
        title: 'Eliminar equipo',
        message: `¿Eliminar el equipo "${eq.nombre}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        tone: 'danger',
        icon: 'delete',
      },
      () => {
        this.api.deleteEquipo(eq.id).subscribe({
          next: () => this.equipos.update((list) => list.filter((e) => e.id !== eq.id)),
          error: (err) =>
            this.error.set(
              'No se pudo eliminar: ' + (err?.error?.error?.message ?? err?.message ?? ''),
            ),
        });
      },
    );
  }

  private diasParaVencimientoGarantia(fecha: string | null): number | null {
    if (!fecha) return null;
    const t = new Date(fecha).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.ceil((t - Date.now()) / 86400000);
  }

  garantiaClass(fecha: string | null): string {
    const dias = this.diasParaVencimientoGarantia(fecha);
    if (dias === null) return 'text-slate-400';
    if (dias < 0) return 'text-slate-400 line-through';
    if (dias <= 90) return 'text-amber-600 font-semibold';
    return 'text-slate-600';
  }

  estadoLabel(estado: EquipoEstado): string {
    const map: Record<EquipoEstado, string> = {
      operativo: 'Operativo',
      en_mantencion: 'En mantención',
      fuera_de_servicio: 'Fuera de servicio',
    };
    return map[estado];
  }

  estadoClass(estado: EquipoEstado): string {
    const map: Record<EquipoEstado, string> = {
      operativo: 'bg-emerald-50 text-emerald-700',
      en_mantencion: 'bg-amber-50 text-amber-700',
      fuera_de_servicio: 'bg-rose-50 text-rose-700',
    };
    return map[estado];
  }

  estadoDotClass(estado: EquipoEstado): string {
    const map: Record<EquipoEstado, string> = {
      operativo: 'bg-emerald-500',
      en_mantencion: 'bg-amber-500',
      fuera_de_servicio: 'bg-rose-500',
    };
    return map[estado];
  }
}
