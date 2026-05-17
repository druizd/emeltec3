/**
 * Bitácora — Ficha del sitio.
 * Conectado a /api/v2/sites/:siteId/bitacora/ficha.
 *
 * Vista admin: editable (contactos, acreditaciones, riesgos, pin crítico).
 * Vista cliente: solo lectura.
 */
import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../../services/auth.service';
import {
  BitacoraSitioService,
  type FichaAcreditacion,
  type FichaContacto,
  type FichaRiesgo,
  type FichaSitio,
} from '../../../../services/bitacora-sitio.service';

@Component({
  selector: 'app-bitacora-ficha-sitio',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-3">
      <!-- Pin crítico -->
      @if (isInternal() || ficha().pin_critico) {
        <div
          class="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <span class="material-symbols-outlined mt-0.5 shrink-0 text-[20px] text-amber-600"
            >warning</span
          >
          <div class="min-w-0 flex-1">
            <p class="text-[10px] font-black uppercase tracking-widest text-amber-600">Atención</p>
            @if (isInternal()) {
              <input
                type="text"
                [ngModel]="ficha().pin_critico"
                (ngModelChange)="updatePin($event)"
                placeholder="Mensaje crítico (ej. Acceso requiere permiso DGA)"
                class="mt-0.5 w-full bg-transparent text-sm font-semibold text-amber-900 placeholder:text-amber-400 focus:outline-none"
              />
            } @else {
              <p class="mt-0.5 text-sm font-semibold text-amber-900">{{ ficha().pin_critico }}</p>
            }
          </div>
        </div>
      }

      <div class="grid gap-3 xl:grid-cols-2">
        <!-- Contactos -->
        <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Contactos técnicos
            </h3>
            @if (isInternal()) {
              <button
                type="button"
                (click)="addContacto()"
                class="rounded p-1 text-cyan-600 hover:bg-cyan-50"
              >
                <span class="material-symbols-outlined text-[16px]">add</span>
              </button>
            }
          </div>
          @if (ficha().contactos.length === 0) {
            <p class="text-[12px] italic text-slate-400">Sin contactos registrados.</p>
          } @else {
            <ul class="space-y-2">
              @for (c of ficha().contactos; track $index) {
                <li class="rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                  @if (isInternal()) {
                    <div class="grid grid-cols-2 gap-2 text-[12px]">
                      <input
                        type="text"
                        [ngModel]="c.nombre"
                        (ngModelChange)="updateContacto($index, 'nombre', $event)"
                        placeholder="Nombre"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-cyan-300"
                      />
                      <select
                        [ngModel]="c.rol"
                        (ngModelChange)="updateContacto($index, 'rol', $event)"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-cyan-300"
                      >
                        <option value="Responsable">Responsable</option>
                        <option value="Operador">Operador</option>
                      </select>
                      <input
                        type="text"
                        [ngModel]="c.telefono"
                        (ngModelChange)="updateContacto($index, 'telefono', $event)"
                        placeholder="Teléfono"
                        class="rounded border border-slate-200 px-2 py-1 font-mono outline-none focus:border-cyan-300"
                      />
                      <input
                        type="email"
                        [ngModel]="c.email"
                        (ngModelChange)="updateContacto($index, 'email', $event)"
                        placeholder="Email"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-cyan-300"
                      />
                    </div>
                    <button
                      type="button"
                      (click)="removeContacto($index)"
                      class="mt-1 text-[10px] font-semibold text-rose-500 hover:underline"
                    >
                      Eliminar
                    </button>
                  } @else {
                    <p class="text-[13px] font-semibold text-slate-700">{{ c.nombre }}</p>
                    <p class="text-[11px] text-slate-500">
                      {{ c.rol }} · {{ c.telefono || '—' }} · {{ c.email || '—' }}
                    </p>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <!-- Acreditaciones -->
        <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Acreditaciones
            </h3>
            @if (isInternal()) {
              <button
                type="button"
                (click)="addAcreditacion()"
                class="rounded p-1 text-cyan-600 hover:bg-cyan-50"
              >
                <span class="material-symbols-outlined text-[16px]">add</span>
              </button>
            }
          </div>
          @if (ficha().acreditaciones.length === 0) {
            <p class="text-[12px] italic text-slate-400">Sin acreditaciones registradas.</p>
          } @else {
            <ul class="space-y-2">
              @for (a of ficha().acreditaciones; track $index) {
                <li class="rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-[12px]">
                  @if (isInternal()) {
                    <div class="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        [ngModel]="a.persona"
                        (ngModelChange)="updateAcreditacion($index, 'persona', $event)"
                        placeholder="Persona"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-cyan-300"
                      />
                      <input
                        type="text"
                        [ngModel]="a.tipo"
                        (ngModelChange)="updateAcreditacion($index, 'tipo', $event)"
                        placeholder="Tipo (DGA, etc)"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-cyan-300"
                      />
                      <input
                        type="date"
                        min="2000-01-01"
                        [ngModel]="a.vigencia_hasta"
                        (ngModelChange)="updateAcreditacion($index, 'vigencia_hasta', $event)"
                        class="rounded border border-slate-200 px-2 py-1 font-mono outline-none focus:border-cyan-300"
                      />
                    </div>
                    <button
                      type="button"
                      (click)="removeAcreditacion($index)"
                      class="mt-1 text-[10px] font-semibold text-rose-500 hover:underline"
                    >
                      Eliminar
                    </button>
                  } @else {
                    <p class="font-semibold text-slate-700">
                      {{ a.persona }} · {{ a.tipo }}
                    </p>
                    <p [class]="vigenciaClass(a.vigencia_hasta)">
                      {{
                        a.vigencia_hasta
                          ? 'Vigente hasta ' + a.vigencia_hasta
                          : 'Sin vigencia'
                      }}
                    </p>
                  }
                </li>
              }
            </ul>
          }
        </section>

        <!-- Riesgos -->
        <section
          class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2"
        >
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Riesgos identificados
            </h3>
            @if (isInternal()) {
              <button
                type="button"
                (click)="addRiesgo()"
                class="rounded p-1 text-cyan-600 hover:bg-cyan-50"
              >
                <span class="material-symbols-outlined text-[16px]">add</span>
              </button>
            }
          </div>
          @if (ficha().riesgos.length === 0) {
            <p class="text-[12px] italic text-slate-400">Sin riesgos registrados.</p>
          } @else {
            <ul class="space-y-2">
              @for (r of ficha().riesgos; track $index) {
                <li class="rounded-lg border border-slate-100 bg-slate-50/60 p-2 text-[12px]">
                  @if (isInternal()) {
                    <div class="grid gap-2 md:grid-cols-[1fr_auto_auto_1fr]">
                      <input
                        type="text"
                        [ngModel]="r.descripcion"
                        (ngModelChange)="updateRiesgo($index, 'descripcion', $event)"
                        placeholder="Descripción del riesgo"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-cyan-300"
                      />
                      <input
                        type="number"
                        min="1"
                        max="5"
                        [ngModel]="r.probabilidad"
                        (ngModelChange)="updateRiesgo($index, 'probabilidad', $event)"
                        placeholder="Prob (1-5)"
                        class="w-24 rounded border border-slate-200 px-2 py-1 font-mono outline-none focus:border-cyan-300"
                      />
                      <input
                        type="number"
                        min="1"
                        max="5"
                        [ngModel]="r.impacto"
                        (ngModelChange)="updateRiesgo($index, 'impacto', $event)"
                        placeholder="Imp (1-5)"
                        class="w-24 rounded border border-slate-200 px-2 py-1 font-mono outline-none focus:border-cyan-300"
                      />
                      <input
                        type="text"
                        [ngModel]="r.mitigacion"
                        (ngModelChange)="updateRiesgo($index, 'mitigacion', $event)"
                        placeholder="Mitigación"
                        class="rounded border border-slate-200 px-2 py-1 outline-none focus:border-cyan-300"
                      />
                    </div>
                    <button
                      type="button"
                      (click)="removeRiesgo($index)"
                      class="mt-1 text-[10px] font-semibold text-rose-500 hover:underline"
                    >
                      Eliminar
                    </button>
                  } @else {
                    <p class="font-semibold text-slate-700">{{ r.descripcion }}</p>
                    <p class="text-slate-500">
                      Prob: {{ r.probabilidad ?? '—' }} · Impacto:
                      {{ r.impacto ?? '—' }} · Mitigación:
                      {{ r.mitigacion || '—' }}
                    </p>
                  }
                </li>
              }
            </ul>
          }
        </section>
      </div>

      @if (isInternal()) {
        <div class="flex items-center justify-end gap-2">
          @if (saveMsg()) {
            <span class="text-[11px] font-semibold text-emerald-600">{{ saveMsg() }}</span>
          }
          @if (error()) {
            <span class="text-[11px] font-semibold text-rose-600">{{ error() }}</span>
          }
          <button
            type="button"
            (click)="save()"
            [disabled]="saving() || !dirty()"
            class="rounded-lg bg-cyan-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-cyan-700 disabled:opacity-40"
          >
            {{ saving() ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </div>
      }
    </div>
  `,
})
export class BitacoraFichaSitioComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly api = inject(BitacoraSitioService);

  readonly sitioId = input<string>('');

  readonly isInternal = computed(() => this.auth.isSuperAdmin() || this.auth.isAdmin());

  readonly ficha = signal<FichaSitio>({
    pin_critico: null,
    contactos: [],
    acreditaciones: [],
    riesgos: [],
  });
  private original = JSON.stringify(this.ficha());

  readonly saving = signal<boolean>(false);
  readonly saveMsg = signal<string>('');
  readonly error = signal<string>('');
  readonly dirty = computed(() => JSON.stringify(this.ficha()) !== this.original);

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    if (!this.sitioId()) return;
    this.error.set('');
    this.api.getFicha(this.sitioId()).subscribe({
      next: (f) => {
        this.ficha.set(f);
        this.original = JSON.stringify(f);
      },
      error: (err) =>
        this.error.set('No se pudo cargar ficha: ' + (err?.error?.error?.message ?? err?.message ?? '')),
    });
  }

  save(): void {
    if (!this.dirty() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    this.saveMsg.set('');
    this.api.patchFicha(this.sitioId(), this.ficha()).subscribe({
      next: (f) => {
        this.ficha.set(f);
        this.original = JSON.stringify(f);
        this.saving.set(false);
        this.saveMsg.set('Guardado.');
        setTimeout(() => this.saveMsg.set(''), 3000);
      },
      error: (err) => {
        this.saving.set(false);
        this.error.set('No se pudo guardar: ' + (err?.error?.error?.message ?? err?.message ?? ''));
      },
    });
  }

  // -------- Pin --------
  updatePin(v: string): void {
    this.ficha.update((f) => ({ ...f, pin_critico: v || null }));
  }

  // -------- Contactos --------
  addContacto(): void {
    const next: FichaContacto = { nombre: '', rol: 'Responsable', telefono: '', email: '' };
    this.ficha.update((f) => ({ ...f, contactos: [...f.contactos, next] }));
  }
  removeContacto(idx: number): void {
    this.ficha.update((f) => ({
      ...f,
      contactos: f.contactos.filter((_, i) => i !== idx),
    }));
  }
  updateContacto(idx: number, field: keyof FichaContacto, value: unknown): void {
    this.ficha.update((f) => ({
      ...f,
      contactos: f.contactos.map((c, i) => (i === idx ? { ...c, [field]: value as never } : c)),
    }));
  }

  // -------- Acreditaciones --------
  addAcreditacion(): void {
    const next: FichaAcreditacion = { persona: '', tipo: '', vigencia_hasta: null };
    this.ficha.update((f) => ({ ...f, acreditaciones: [...f.acreditaciones, next] }));
  }
  removeAcreditacion(idx: number): void {
    this.ficha.update((f) => ({
      ...f,
      acreditaciones: f.acreditaciones.filter((_, i) => i !== idx),
    }));
  }
  updateAcreditacion(idx: number, field: keyof FichaAcreditacion, value: unknown): void {
    this.ficha.update((f) => ({
      ...f,
      acreditaciones: f.acreditaciones.map((a, i) =>
        i === idx ? { ...a, [field]: value as never } : a,
      ),
    }));
  }

  // -------- Riesgos --------
  addRiesgo(): void {
    const next: FichaRiesgo = { descripcion: '', probabilidad: null, impacto: null, mitigacion: '' };
    this.ficha.update((f) => ({ ...f, riesgos: [...f.riesgos, next] }));
  }
  removeRiesgo(idx: number): void {
    this.ficha.update((f) => ({
      ...f,
      riesgos: f.riesgos.filter((_, i) => i !== idx),
    }));
  }
  updateRiesgo(idx: number, field: keyof FichaRiesgo, value: unknown): void {
    this.ficha.update((f) => ({
      ...f,
      riesgos: f.riesgos.map((r, i) => (i === idx ? { ...r, [field]: value as never } : r)),
    }));
  }

  vigenciaClass(fecha: string | null | undefined): string {
    if (!fecha) return 'text-slate-400';
    const t = new Date(fecha).getTime();
    if (!Number.isFinite(t)) return 'text-slate-400';
    const dias = Math.ceil((t - Date.now()) / 86400000);
    if (dias < 0) return 'text-rose-500 font-semibold';
    if (dias <= 30) return 'text-amber-600 font-semibold';
    return 'text-emerald-600';
  }
}
