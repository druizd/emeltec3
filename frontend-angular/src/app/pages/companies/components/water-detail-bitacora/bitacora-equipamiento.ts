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

@Component({
  selector: 'app-bitacora-equipamiento',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <p class="text-[11px] font-semibold text-slate-400">
          {{ equipos().length }} equipos registrados
        </p>
        <button
          type="button"
          (click)="openForm()"
          class="inline-flex items-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[12px] font-bold text-cyan-700 transition-colors hover:bg-cyan-100"
        >
          <span class="material-symbols-outlined text-[16px]">add</span>
          Registrar equipo
        </button>
      </div>

      @if (loading()) {
        <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Cargando equipos…
        </div>
      } @else if (equipos().length === 0) {
        <div
          class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500"
        >
          <span class="material-symbols-outlined mb-2 block text-[28px] text-slate-300"
            >precision_manufacturing</span
          >
          No hay equipos registrados todavía.
        </div>
      } @else {
        <section class="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div class="overflow-x-auto">
            <table class="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr class="border-b border-slate-100 bg-slate-50">
                  <th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Equipo
                  </th>
                  <th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Fabricante / Modelo
                  </th>
                  <th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    N° Serie
                  </th>
                  <th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Compra
                  </th>
                  <th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Garantía
                  </th>
                  <th class="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Estado
                  </th>
                  <th class="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                @for (eq of equipos(); track eq.id) {
                  <tr class="group hover:bg-slate-50/60">
                    <td class="px-3 py-2 font-semibold text-slate-800">{{ eq.nombre }}</td>
                    <td class="px-3 py-2 text-slate-600">
                      <span class="font-semibold">{{ eq.fabricante || '—' }}</span>
                      <span class="block text-[11px] text-slate-400">{{ eq.modelo || '—' }}</span>
                    </td>
                    <td class="px-3 py-2 font-mono text-[11px] text-slate-500">
                      {{ eq.serie || '—' }}
                    </td>
                    <td class="px-3 py-2 font-mono text-[11px] text-slate-500">
                      {{ eq.fecha_compra || '—' }}
                    </td>
                    <td [class]="'px-3 py-2 font-mono text-[11px] ' + garantiaClass(eq.garantia_hasta)">
                      {{ eq.garantia_hasta || '—' }}
                    </td>
                    <td class="px-3 py-2">
                      <span
                        [class]="
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ' +
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
                        class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        title="Editar"
                      >
                        <span class="material-symbols-outlined text-[16px]">edit</span>
                      </button>
                      <button
                        type="button"
                        (click)="onDelete(eq)"
                        class="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="Eliminar"
                      >
                        <span class="material-symbols-outlined text-[16px]">delete</span>
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
        <div
          class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"
        >
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
            <h3 class="text-sm font-black uppercase tracking-wide text-slate-700">
              {{ editingId() ? 'Editar equipo' : 'Registrar equipo' }}
            </h3>
            <button
              type="button"
              (click)="cancelForm()"
              class="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <div class="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
            <label class="col-span-2 grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Nombre
              <input
                type="text"
                [ngModel]="form().nombre"
                (ngModelChange)="updateForm('nombre', $event)"
                placeholder="Ej. Caudalímetro principal"
                class="h-9 rounded border border-slate-200 px-2 text-[13px] outline-none focus:border-cyan-300"
              />
            </label>
            <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Fabricante
              <input
                type="text"
                [ngModel]="form().fabricante"
                (ngModelChange)="updateForm('fabricante', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-[13px] outline-none focus:border-cyan-300"
              />
            </label>
            <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Modelo
              <input
                type="text"
                [ngModel]="form().modelo"
                (ngModelChange)="updateForm('modelo', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-[13px] outline-none focus:border-cyan-300"
              />
            </label>
            <label class="col-span-2 grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              N° Serie
              <input
                type="text"
                [ngModel]="form().serie"
                (ngModelChange)="updateForm('serie', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-[13px] font-mono outline-none focus:border-cyan-300"
              />
            </label>
            <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Fecha compra
              <input
                type="date"
                min="2000-01-01"
                [ngModel]="form().fecha_compra"
                (ngModelChange)="updateForm('fecha_compra', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-[13px] font-mono outline-none focus:border-cyan-300"
              />
            </label>
            <label class="grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Garantía hasta
              <input
                type="date"
                min="2000-01-01"
                [ngModel]="form().garantia_hasta"
                (ngModelChange)="updateForm('garantia_hasta', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-[13px] font-mono outline-none focus:border-cyan-300"
              />
            </label>
            <label class="col-span-2 grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Estado
              <select
                [ngModel]="form().estado"
                (ngModelChange)="updateForm('estado', $event)"
                class="h-9 rounded border border-slate-200 px-2 text-[13px] outline-none focus:border-cyan-300"
              >
                <option value="operativo">Operativo</option>
                <option value="en_mantencion">En mantención</option>
                <option value="fuera_de_servicio">Fuera de servicio</option>
              </select>
            </label>
            <label class="col-span-2 grid gap-1 text-[10px] uppercase tracking-wider font-semibold text-slate-500">
              Notas
              <textarea
                rows="3"
                [ngModel]="form().notas"
                (ngModelChange)="updateForm('notas', $event)"
                class="rounded border border-slate-200 px-2 py-1.5 text-[13px] outline-none focus:border-cyan-300"
              ></textarea>
            </label>
          </div>
          <div class="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button
              type="button"
              (click)="cancelForm()"
              class="rounded px-3 py-1.5 text-sm font-semibold text-slate-500 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              (click)="save()"
              [disabled]="!form().nombre || saving()"
              class="rounded bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:opacity-40"
            >
              {{ saving() ? 'Guardando…' : 'Guardar' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class BitacoraEquipamientoComponent implements OnInit {
  private readonly api = inject(BitacoraSitioService);

  readonly sitioId = input<string>('');

  readonly equipos = signal<SitioEquipo[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string>('');
  readonly saving = signal<boolean>(false);
  readonly formOpen = signal<boolean>(false);
  readonly editingId = signal<string>('');
  readonly form = signal<CreateEquipoPayload>(this.emptyForm());

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
    };
  }

  reload(): void {
    if (!this.sitioId()) return;
    this.loading.set(true);
    this.error.set('');
    this.api.listEquipos(this.sitioId()).subscribe({
      next: (rows) => {
        this.equipos.set(rows);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set('No se pudo cargar equipos: ' + (err?.error?.error?.message ?? err?.message ?? ''));
        this.loading.set(false);
      },
    });
  }

  openForm(eq?: SitioEquipo): void {
    if (eq) {
      this.editingId.set(eq.id);
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
    if (!confirm(`¿Eliminar equipo "${eq.nombre}"? Esta acción no se puede deshacer.`)) return;
    this.api.deleteEquipo(eq.id).subscribe({
      next: () => this.equipos.update((list) => list.filter((e) => e.id !== eq.id)),
      error: (err) =>
        this.error.set('No se pudo eliminar: ' + (err?.error?.error?.message ?? err?.message ?? '')),
    });
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
